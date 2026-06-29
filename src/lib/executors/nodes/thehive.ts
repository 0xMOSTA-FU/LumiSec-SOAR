// Real TheHive executor - create cases/observables via TheHive 5 REST API
// Docs: https://docs.thehive.io/

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const url = (c.url as string) || (c.host as string) || '';
  const api_key = (c.api_key as string) || (c.token as string) || '';
  return { url: url.replace(/\/$/, ''), api_key };
}

export async function callTheHive(
  integration: IntegrationConfig | null,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const creds = getCreds(integration);
  if (!creds.url || !creds.api_key) return { ok: false, status: 401, data: { error: 'TheHive url+api_key required' }, durationMs: 0 };
  if (integration?.status !== 'connected') return { ok: false, status: 503, data: { error: 'TheHive not connected' }, durationMs: 0 };

  try {
    const res = await fetch(`${creds.url}/api/v1/${path.replace(/^\//, '')}`, {
      method,
      headers: { 'Authorization': `Bearer ${creds.api_key}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) }, durationMs: Date.now() - start };
  }
}

export async function executeTheHive(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'create_case';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('thehive');

  if (action === 'create_case') {
    const title = resolveTemplate((cfg.title as string) || 'SOAR case', ctx);
    const description = resolveTemplate((cfg.description as string) || '', ctx);
    const severity = (cfg.severity as number) || 2; // 1=low,2=medium,3=high
    const tags = (cfg.tags as string[]) || ['soar', 'auto'];
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `TheHive: creating case "${title}"...`, level: 'info' });

    const result = await callTheHive(integration, 'POST', 'case', {
      title, description, severity, tags, startDate: Date.now(),
    });
    if (!result.ok) {
      const err = (result.data as { type?: string; description?: string })?.description || `HTTP ${result.status}`;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `TheHive error: ${err}`, level: 'error', duration: result.durationMs, data: result.data });
      return { success: false, output: { thehive: { ok: false, error: err } }, logs };
    }
    const c = result.data as { id: string; number?: number; _id?: string };
    const caseId = c.id || c._id || '';
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `TheHive: case created (#${c.number || caseId})`, level: 'success', duration: result.durationMs, data: { id: caseId } });
    return { success: true, output: { thehive: { ok: true, case_id: caseId, number: c.number } }, logs };
  }

  if (action === 'create_observable') {
    const caseId = resolveTemplate((cfg.case_id as string) || '', ctx);
    const dataType = (cfg.data_type as string) || 'ip';
    const data = resolveTemplate((cfg.data as string) || (cfg.value as string) || '', ctx);
    if (!caseId || !data) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'TheHive: case_id + data required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const result = await callTheHive(integration, 'POST', `case/${caseId}/observable`, {
      dataType, data, message: 'added by SOAR', tlp: 2,
    });
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `TheHive observable error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `TheHive: observable ${dataType}="${data}" added to case ${caseId}`, level: 'success', duration: result.durationMs });
    return { success: true, output: { thehive: { ok: true, case_id: caseId, observable: { dataType, data } } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `TheHive: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
