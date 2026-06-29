/**
 * SOAR Worker — Orborus-style queue poller (Shuffle pattern)
 *
 * Polls GET /api/v1/workflows/queue, runs executions via Next.js engine,
 * confirms POST /api/v1/workflows/queue/confirm
 *
 * Env:
 *   BACKEND_URL=http://localhost:4000
 *   NEXT_APP_URL=http://localhost:3000
 *   WORKER_API_KEY=...
 *   ENVIRONMENT_NAME=default
 *   POLL_INTERVAL_MS=3000
 */

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const NEXT_APP_URL = (process.env.NEXT_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const WORKER_API_KEY = process.env.WORKER_API_KEY || '';
const ENVIRONMENT = process.env.ENVIRONMENT_NAME || 'default';
const POLL_MS = Number(process.env.POLL_INTERVAL_MS) || 3000;

const workerHeaders = {
  'Content-Type': 'application/json',
  'Org-Id': ENVIRONMENT,
  ...(WORKER_API_KEY ? { Authorization: `Bearer ${WORKER_API_KEY}` } : {}),
};

async function backendFetch(path, opts = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...opts,
    headers: { ...workerHeaders, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Backend ${path} → ${res.status}: ${json.reason || json.error || text}`);
  }
  return json;
}

function shuffleToNodesEdges(workflow, lumisecNodes, lumisecEdges) {
  if (lumisecNodes?.length) {
    return { nodes: lumisecNodes, edges: lumisecEdges || [] };
  }
  const nodes = [];
  const edges = [];
  for (const t of workflow.triggers || []) {
    nodes.push({
      id: t.id_,
      type: 'trigger',
      subtype: (t.name || 'webhook').toLowerCase(),
      position: t.position || { x: 100, y: 200 },
      data: { label: t.label || t.name, config: { subtype: (t.name || 'webhook').toLowerCase() } },
    });
  }
  for (const c of workflow.conditions || []) {
    nodes.push({
      id: c.id_,
      type: 'condition',
      subtype: 'condition',
      position: c.position || { x: 400, y: 200 },
      data: { label: c.label || 'Condition', config: { subtype: 'condition', expression: c.conditional } },
    });
  }
  for (const a of workflow.actions || []) {
    nodes.push({
      id: a.id_,
      type: 'action',
      subtype: a.name,
      position: a.position || { x: 400, y: 200 },
      data: { label: a.label || a.name, config: { subtype: a.name } },
    });
  }
  for (const b of workflow.branches || []) {
    edges.push({ id: b.id_, source: b.source_id, target: b.destination_id, label: b.label });
  }
  return { nodes, edges };
}

async function runExecution(queueItem) {
  const stream = await backendFetch('/api/v1/streams', {
    method: 'POST',
    body: JSON.stringify({ execution_id: queueItem.execution_id }),
  });
  const execution = stream.data;
  if (!execution) throw new Error('No execution payload from /streams');

  const wf = execution.workflow || {};
  const { nodes, edges } = shuffleToNodesEdges(
    wf,
    wf.lumisec_nodes,
    wf.lumisec_edges,
  );

  const runRes = await fetch(`${NEXT_APP_URL}/api/internal/workflow-run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(WORKER_API_KEY ? { Authorization: `Bearer ${WORKER_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      executionId: execution.id_,
      workflowId: execution.workflow_id,
      workflowName: wf.name || 'Workflow',
      nodes,
      edges,
      trigger: execution.execution_argument || {},
      tenantId: execution.org_id,
    }),
  });

  const runJson = await runRes.json();
  if (!runRes.ok) {
    throw new Error(runJson.error || runJson.reason || `Engine failed ${runRes.status}`);
  }

  // Report action results (summary) back to Shuffle streams API
  for (const nodeId of runJson.executedNodeIds || []) {
    await backendFetch('/api/v1/streams/results', {
      method: 'POST',
      body: JSON.stringify({
        execution_id: execution.id_,
        action_id: nodeId,
        result: runJson.outputs?.[nodeId] ?? {},
        status: (runJson.failedNodeIds || []).includes(nodeId) ? 'FAILED' : 'SUCCESS',
      }),
    }).catch(() => { /* non-fatal */ });
  }

  await backendFetch('/api/v1/workflows/queue/confirm', {
    method: 'POST',
    body: JSON.stringify({ execution_ids: [queueItem.execution_id] }),
  });

  await backendFetch('/api/v1/streams/finish', {
    method: 'POST',
    body: JSON.stringify({
      execution_id: execution.id_,
      status: runJson.success ? 'FINISHED' : 'FAILED',
    }),
  }).catch(() => {});

  console.log(`[worker] finished ${execution.id_} success=${runJson.success} duration=${runJson.durationMs}ms`);
}

async function pollOnce() {
  const resp = await backendFetch('/api/v1/workflows/queue');
  const items = resp.data || [];
  for (const item of items) {
    try {
      await runExecution(item);
    } catch (err) {
      console.error(`[worker] execution ${item.execution_id} failed:`, err.message);
      await backendFetch('/api/v1/workflows/queue/confirm', {
        method: 'POST',
        body: JSON.stringify({ execution_ids: [item.execution_id] }),
      }).catch(() => {});
    }
  }
}

console.log(`[worker] starting — backend=${BACKEND_URL} next=${NEXT_APP_URL} env=${ENVIRONMENT}`);
setInterval(() => {
  pollOnce().catch(err => console.error('[worker] poll error:', err.message));
}, POLL_MS);
pollOnce().catch(err => console.error('[worker] initial poll:', err.message));
