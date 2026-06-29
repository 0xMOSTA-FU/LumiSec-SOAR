// Real MISP executor - add/get events + attributes via MISP REST API
// Docs: https://www.circl.lu/doc/misp/

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const url = (c.url as string) || (c.host as string) || '';
  const api_key = (c.api_key as string) || (c.key as string) || '';
  return { url: url.replace(/\/$/, ''), api_key };
}

export async function callMISP(
  integration: IntegrationConfig | null,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const creds = getCreds(integration);
  if (!creds.url || !creds.api_key) return { ok: false, status: 401, data: { error: 'MISP url+api_key required' }, durationMs: 0 };
  if (integration?.status !== 'connected') return { ok: false, status: 503, data: { error: 'MISP not connected' }, durationMs: 0 };

  try {
    const res = await fetch(`${creds.url}/${path.replace(/^\//, '')}`, {
      method: 'POST',
      headers: { 'Authorization': creds.api_key, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : '{}',
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) }, durationMs: Date.now() - start };
  }
}

export async function executeMISP(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'search_attributes';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('misp');

  if (action === 'search_attributes') {
    const value = resolveTemplate((cfg.value as string) || (cfg.ioc as string) || '', ctx);
    const type = (cfg.type as string) || 'ip-src';
    if (!value) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'MISP: value required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MISP: searching ${type}="${value}"...`, level: 'info' });

    const result = await callMISP(integration, 'attributes/restSearch', { value, type, last: '30d' });
    if (!result.ok) {
      const err = (result.data as { message?: string })?.message || `HTTP ${result.status}`;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MISP error: ${err}`, level: 'error', duration: result.durationMs });
      return { success: false, output: { misp: { ok: false, error: err } }, logs };
    }
    const data = result.data as { response?: { Attribute: { id: string; type: string; value: string; comment?: string; event_id: string } }[] | { Attribute: { id: string; type: string; value: string; comment?: string; event_id: string } } };
    let attrArray: { id: string; type: string; value: string; comment?: string; event_id: string }[] = [];
    if (Array.isArray(data.response)) {
      attrArray = data.response.flatMap(item => item.Attribute ? [item.Attribute] : []);
    } else if (data.response && data.response.Attribute) {
      attrArray = [data.response.Attribute];
    }
    const count = attrArray.length;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MISP: ${count} matching attributes found`, level: count > 0 ? 'warning' : 'success', duration: result.durationMs, data: { count } });
    return { success: true, output: { misp: { ok: true, count, matches: attrArray.slice(0, 10) } }, logs };
  }

  if (action === 'add_attribute') {
    const event_id = resolveTemplate((cfg.event_id as string) || '', ctx);
    const type = (cfg.type as string) || 'ip-src';
    const value = resolveTemplate((cfg.value as string) || '', ctx);
    const comment = resolveTemplate((cfg.comment as string) || '', ctx);
    if (!event_id || !value) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'MISP: event_id + value required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const result = await callMISP(integration, 'attributes/add', { event_id, type, value, comment, to_ids: true, distribution: 0 });
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MISP add error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MISP: attribute ${type}="${value}" added to event ${event_id}`, level: 'success', duration: result.durationMs });
    return { success: true, output: { misp: { ok: true, event_id, attribute: { type, value } } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MISP: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
