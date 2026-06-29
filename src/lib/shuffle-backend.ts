/**
 * HTTP client for Shuffle-compatible API on soar-backend
 */

const BACKEND_URL = (process.env.SHUFFLE_BACKEND_URL
  || process.env.NEXT_PUBLIC_EXTERNAL_API_URL
  || 'http://localhost:4000').replace(/\/$/, '');

const API_KEY = process.env.EXTERNAL_API_KEY || '';

async function shuffleRequest(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.reason || json.error || `Shuffle API ${path} failed (${res.status})`);
  }
  return json;
}

export function isShuffleBackendEnabled(): boolean {
  return Boolean(process.env.SHUFFLE_BACKEND_URL || process.env.NEXT_PUBLIC_EXTERNAL_API_URL);
}

export async function finishExecution(executionId: string, status: 'FINISHED' | 'FAILED' | 'ABORTED') {
  const workerKey = process.env.WORKER_API_KEY || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (workerKey) headers.Authorization = `Bearer ${workerKey}`;
  if (API_KEY) headers['X-API-Key'] = API_KEY;

  const res = await fetch(`${BACKEND_URL}/api/v1/streams/finish`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ execution_id: executionId, status }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.reason || `finishExecution failed (${res.status})`);
  }
  return res.json();
}

export async function syncWorkflowToShuffle(workflow: {
  id: string;
  name: string;
  description?: string;
  tenantId?: string | null;
  nodes: unknown[];
  edges: unknown[];
  tags?: unknown;
}) {
  const { lumiSecToShuffleWorkflow } = await import('@/lib/shuffle/adapter');
  const shuffleDoc = lumiSecToShuffleWorkflow({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    orgId: workflow.tenantId || 'default',
    nodes: workflow.nodes as import('@/lib/executors/types').WFNode[],
    edges: workflow.edges as import('@/lib/executors/types').WFEdge[],
    tags: Array.isArray(workflow.tags) ? workflow.tags as string[] : [],
  });
  shuffleDoc.lumisec_nodes = workflow.nodes;
  shuffleDoc.lumisec_edges = workflow.edges;
  const doc = shuffleDoc as unknown as Record<string, unknown>;
  try {
    return await shuffleRequest(`/api/v1/workflows/${workflow.id}`, {
      method: 'PUT',
      body: JSON.stringify(doc),
    });
  } catch {
    return shuffleRequest('/api/v1/workflows', {
      method: 'POST',
      body: JSON.stringify(doc),
    });
  }
}

export async function executeShuffleWorkflow(workflowId: string, argument: Record<string, unknown> = {}) {
  return shuffleRequest(`/api/v1/workflows/${workflowId}/execute`, {
    method: 'POST',
    body: JSON.stringify({ execution_argument: argument }),
  });
}

export { shuffleRequest, BACKEND_URL as shuffleBackendUrl };
