// Real DefectDojo executor - create findings, list tests via REST API v2
// Docs: https://documentation.defectdojo.com/

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const url = (c.url as string) || (c.host as string) || '';
  const api_key = (c.api_key as string) || (c.token as string) || '';
  return { url: url.replace(/\/$/, ''), api_key };
}

export async function callDefectDojo(
  integration: IntegrationConfig | null,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const creds = getCreds(integration);
  if (!creds.url || !creds.api_key) return { ok: false, status: 401, data: { error: 'DefectDojo url+api_key required' }, durationMs: 0 };
  if (integration?.status !== 'connected') return { ok: false, status: 503, data: { error: 'DefectDojo not connected' }, durationMs: 0 };

  try {
    const res = await fetch(`${creds.url}/api/v2/${path.replace(/^\//, '')}`, {
      method,
      headers: { 'Authorization': `Token ${creds.api_key}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) }, durationMs: Date.now() - start };
  }
}

export async function executeDefectDojo(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'list_findings';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('defectdojo');

  if (action === 'list_findings') {
    const res = await callDefectDojo(integration, 'GET', 'findings?limit=20');
    if (!res.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DefectDojo error: HTTP ${res.status}`, level: 'error', duration: res.durationMs });
      return { success: false, output: { defectdojo: { ok: false } }, logs };
    }
    const data = res.data as { results?: { id: number; title: string; severity: string; active: boolean }[]; count: number };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DefectDojo: ${data.count} findings`, level: 'success', duration: res.durationMs });
    return { success: true, output: { defectdojo: { ok: true, count: data.count, findings: data.results?.slice(0, 20) } }, logs };
  }

  if (action === 'create_finding') {
    const title = resolveTemplate((cfg.title as string) || 'SOAR finding', ctx);
    const description = resolveTemplate((cfg.description as string) || '', ctx);
    const severity = (cfg.severity as string) || 'Medium';
    const product_id = (cfg.product_id as number) || 1;
    const engagement_id = (cfg.engagement_id as number) || null;

    const res = await callDefectDojo(integration, 'POST', 'findings', {
      title, description, severity, product_id, engagement: engagement_id,
      active: true, verified: false, numerical_severity: severity === 'Critical' ? 4 : severity === 'High' ? 3 : severity === 'Medium' ? 2 : 1,
    });
    if (!res.ok) {
      const err = (res.data as { detail?: string })?.detail || `HTTP ${res.status}`;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DefectDojo error: ${err}`, level: 'error', duration: res.durationMs, data: res.data });
      return { success: false, output: { defectdojo: { ok: false, error: err } }, logs };
    }
    const finding = res.data as { id: number };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DefectDojo: finding #${finding.id} created`, level: 'success', duration: res.durationMs, data: { id: finding.id } });
    return { success: true, output: { defectdojo: { ok: true, finding_id: finding.id } }, logs };
  }

  if (action === 'list_engagements') {
    const res = await callDefectDojo(integration, 'GET', 'engagements?limit=20');
    if (!res.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DefectDojo error: HTTP ${res.status}`, level: 'error', duration: res.durationMs });
      return { success: false, logs };
    }
    const data = res.data as { results?: { id: number; name: string; status: string }[]; count: number };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DefectDojo: ${data.count} engagements`, level: 'success', duration: res.durationMs });
    return { success: true, output: { defectdojo: { ok: true, count: data.count, engagements: data.results?.slice(0, 20) } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DefectDojo: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
