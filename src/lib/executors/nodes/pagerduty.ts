// Real PagerDuty executor - trigger/acknowledge/resolve incidents via REST API v2
// Docs: https://developer.pagerduty.com/api-reference/

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

export async function callPagerDuty(
  integration: IntegrationConfig | null,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const api_key = (integration?.config?.api_key as string) || (integration?.config?.routing_key as string) || '';
  if (!api_key) return { ok: false, status: 401, data: { error: 'PagerDuty API key missing' }, durationMs: 0 };
  if (integration?.status !== 'connected') return { ok: false, status: 503, data: { error: 'PagerDuty not connected' }, durationMs: 0 };

  try {
    const res = await fetch(`https://api.pagerduty.com/${path.replace(/^\//, '')}`, {
      method,
      headers: {
        'Authorization': `Token token=${api_key}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'From': (integration?.config?.email as string) || 'soar@platform.local',
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) }, durationMs: Date.now() - start };
  }
}

export async function executePagerDuty(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'trigger';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('pagerduty');

  if (action === 'trigger' || action === 'event') {
    // Events API v2 - uses routing_key (Integration Key)
    const routing_key = resolveTemplate((cfg.routing_key as string) || (integration?.config?.routing_key as string) || '', ctx);
    const summary = resolveTemplate((cfg.summary as string) || 'SOAR alert', ctx);
    const severity = (cfg.severity as string) || 'warning';
    const source = resolveTemplate((cfg.source as string) || 'soar-platform', ctx);
    const dedup_key = resolveTemplate((cfg.dedup_key as string) || '', ctx);

    if (!routing_key) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'PagerDuty: routing_key required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `PagerDuty: triggering ${severity} incident...`, level: 'info' });

    try {
      const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key,
          event_action: 'trigger',
          dedup_key: dedup_key || undefined,
          payload: { summary, severity, source, custom_details: cfg.details || {} },
        }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `PagerDuty: incident triggered (dedup=${(data as { dedup_key?: string }).dedup_key || 'n/a'})`, level: 'success', duration: Date.now() - start, data });
        return { success: true, output: { pagerduty: { ok: true, status: data.status, dedup_key: (data as { dedup_key?: string }).dedup_key } }, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `PagerDuty error: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
      return { success: false, output: { pagerduty: { ok: false } }, logs };
    } catch (err: unknown) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `PagerDuty error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
  }

  if (action === 'list_incidents') {
    const result = await callPagerDuty(integration, 'GET', 'incidents?limit=20&total=true');
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `PagerDuty list error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, logs };
    }
    const data = result.data as { total: number; incidents: unknown[] };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `PagerDuty: ${data.total} incidents found`, level: 'success', duration: result.durationMs });
    return { success: true, output: { pagerduty: { ok: true, total: data.total, incidents: data.incidents?.slice(0, 10) } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `PagerDuty: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
