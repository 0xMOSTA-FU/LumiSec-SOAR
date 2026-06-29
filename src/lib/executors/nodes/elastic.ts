// Real Elasticsearch executor - query ES via _search API
// Docs: https://www.elastic.co/guide/en/elasticsearch/reference/current/search-search.html

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const url = (c.url as string) || (c.host as string) || '';
  const username = (c.username as string) || (c.user as string) || '';
  const password = (c.password as string) || '';
  const api_key = (c.api_key as string) || '';
  return { url: url.replace(/\/$/, ''), username, password, api_key };
}

export async function executeElastic(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'search';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('elastic');
  const creds = getCreds(integration);

  if (!creds.url) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Elastic: url required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Elastic not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const headers: Record<string, string> = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  if (creds.api_key) headers['Authorization'] = `ApiKey ${creds.api_key}`;
  else if (creds.username && creds.password) headers['Authorization'] = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;

  try {
    if (action === 'search') {
      const index = resolveTemplate((cfg.index as string) || '*', ctx);
      let query_str = (cfg.query as string) || '';
      // Resolve templates inside query string
      query_str = resolveTemplate(query_str, ctx);
      // Try parse JSON, else build a query_string query
      let body: unknown;
      try {
        body = JSON.parse(query_str);
      } catch {
        body = { query: { query_string: { query: query_str } }, size: cfg.size || 50 };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic: searching index "${index}"...`, level: 'info' });
      const res = await fetch(`${creds.url}/${encodeURIComponent(index)}/_search`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as { hits?: { total?: { value?: number } | number; hits?: { _id: string; _source: unknown }[] } };
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic error: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
        return { success: false, output: { elastic: { ok: false } }, logs };
      }
      const total = typeof data.hits?.total === 'number' ? data.hits.total : data.hits?.total?.value || 0;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic: ${total} hits in index "${index}"`, level: 'success', duration: Date.now() - start, data: { total } });
      return { success: true, output: { elastic: { ok: true, total, hits: data.hits?.hits?.slice(0, 10) } }, logs };
    }

    if (action === 'count') {
      const index = resolveTemplate((cfg.index as string) || '*', ctx);
      const res = await fetch(`${creds.url}/${encodeURIComponent(index)}/_count`, { method: 'GET', headers, cache: 'no-store' });
      const data = await res.json().catch(() => ({})) as { count?: number };
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic count error: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
        return { success: false, output: { elastic: { ok: false } }, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic: ${data.count || 0} docs in "${index}"`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { elastic: { ok: true, count: data.count } }, logs };
    }

    if (action === 'index') {
      const index = resolveTemplate((cfg.index as string) || 'soar-events', ctx);
      const bodyRaw = resolveTemplate((cfg.body as string) || '', ctx);
      let body: unknown;
      try {
        body = bodyRaw ? JSON.parse(bodyRaw) : { '@timestamp': new Date().toISOString(), source: 'soar-workflow' };
      } catch {
        body = { message: bodyRaw, '@timestamp': new Date().toISOString(), source: 'soar-workflow' };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic: indexing document into "${index}"...`, level: 'info' });
      const res = await fetch(`${creds.url}/${encodeURIComponent(index)}/_doc`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as { _id?: string; result?: string };
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic index error: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
        return { success: false, output: { elastic: { ok: false } }, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic: indexed doc ${data._id || '(auto)'} → ${data.result}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { elastic: { ok: true, id: data._id, result: data.result } }, logs };
    }

    if (action === 'alerts_search') {
      const index = resolveTemplate((cfg.index as string) || '.alerts-security.alerts-*', ctx);
      const queryStr = resolveTemplate((cfg.query as string) || '*', ctx);
      const size = Number(cfg.size) || 50;
      const body = {
        query: { query_string: { query: queryStr } },
        size,
        sort: [{ '@timestamp': { order: 'desc' } }],
      };
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic: searching security alerts in "${index}"...`, level: 'info' });
      const res = await fetch(`${creds.url}/${encodeURIComponent(index)}/_search`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as { hits?: { total?: { value?: number } | number; hits?: { _id: string; _source: unknown }[] } };
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic alerts error: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
        return { success: false, output: { elastic: { ok: false } }, logs };
      }
      const total = typeof data.hits?.total === 'number' ? data.hits.total : data.hits?.total?.value || 0;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic: ${total} security alert(s) matched`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { elastic: { ok: true, total, alerts: data.hits?.hits?.slice(0, 10) } }, logs };
    }

    if (action === 'get_document') {
      const index = resolveTemplate((cfg.index as string) || '', ctx);
      const docId = resolveTemplate((cfg.doc_id as string) || '', ctx);
      if (!index || !docId) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Elastic: index and doc_id required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const res = await fetch(`${creds.url}/${encodeURIComponent(index)}/_doc/${encodeURIComponent(docId)}`, { method: 'GET', headers, cache: 'no-store' });
      const data = await res.json().catch(() => ({})) as { _source?: unknown; found?: boolean };
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic get error: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
        return { success: false, output: { elastic: { ok: false } }, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic: fetched document ${docId}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { elastic: { ok: true, document: data } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err: unknown) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Elastic error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
