// Real Splunk executor - run saved searches + ad-hoc SPL via REST API
// Docs: https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTsearch

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const host = (c.host as string) || (c.url as string) || '';
  const port = (c.port as number) || 8089;
  const username = (c.username as string) || '';
  const password = (c.password as string) || (c.token as string) || '';
  return { host: host.replace(/^https?:\/\//, ''), port, username, password };
}

export async function executeSplunk(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'search';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('splunk');
  const creds = getCreds(integration);

  if (!creds.host || !creds.username) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Splunk: host + username required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Splunk not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    // Self-signed certs are common on Splunk - we have to accept them in Node via env
    const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');

    if (action === 'search') {
      const search = resolveTemplate((cfg.search as string) || 'search * | head 10', ctx);
      const earliest = (cfg.earliest as string) || '-1h';
      const latest = (cfg.latest as string) || 'now';
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Splunk: running search "${search.slice(0, 80)}..."`, level: 'info' });

      // Create search job
      const createRes = await fetch(`https://${creds.host}:${creds.port}/services/search/jobs`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ search, earliest_time: earliest, latest_time: latest, output_mode: 'json' }).toString(),
        cache: 'no-store',
      });
      const createData = await createRes.json().catch(() => ({})) as { sid?: string };
      if (!createRes.ok || !createData.sid) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Splunk search create error: HTTP ${createRes.status}`, level: 'error', duration: Date.now() - start, data: createData });
        return { success: false, output: { splunk: { ok: false } }, logs };
      }
      const sid = createData.sid;

      // Poll for results (max 60s)
      let done = false;
      let waited = 0;
      while (!done && waited < 60000) {
        await new Promise(r => setTimeout(r, 1000));
        waited += 1000;
        const statusRes = await fetch(`https://${creds.host}:${creds.port}/services/search/jobs/${sid}?output_mode=json`, {
          headers: { 'Authorization': `Basic ${auth}` },
          cache: 'no-store',
        });
        const statusData = await statusRes.json().catch(() => ({})) as { entry?: { content?: { dispatchState?: string } }[] };
        if (statusData.entry?.[0]?.content?.dispatchState === 'DONE') { done = true; break; }
      }

      if (!done) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Splunk: search timed out (sid=${sid})`, level: 'warning', duration: Date.now() - start });
        return { success: false, output: { splunk: { ok: false, sid, timeout: true } }, logs };
      }

      // Fetch results
      const resultsRes = await fetch(`https://${creds.host}:${creds.port}/services/search/jobs/${sid}/results?output_mode=json&count=100`, {
        headers: { 'Authorization': `Basic ${auth}` },
        cache: 'no-store',
      });
      const resultsData = await resultsRes.json().catch(() => ({})) as { results?: unknown[] };
      const count = resultsData.results?.length || 0;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Splunk: ${count} results (sid=${sid})`, level: 'success', duration: Date.now() - start, data: { sid, count } });
      return { success: true, output: { splunk: { ok: true, sid, count, results: resultsData.results?.slice(0, 20) } }, logs };
    }

    if (action === 'list_saved_searches') {
      const res = await fetch(`https://${creds.host}:${creds.port}/services/saved/searches?output_mode=json&count=50`, {
        headers: { 'Authorization': `Basic ${auth}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as { entry?: { name: string; content?: { description?: string } }[] };
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Splunk: ${data.entry?.length || 0} saved searches`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { splunk: { ok: true, count: data.entry?.length, saved_searches: data.entry?.map(e => e.name).slice(0, 20) } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Splunk: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err: unknown) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Splunk error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
