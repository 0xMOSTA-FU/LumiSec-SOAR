/**
 * Arkime (open-source network forensics, formerly Moloch)
 * Docs: https://arkime.com/faq#api
 */
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

export function parseArkimeCreds(integration: IntegrationConfig | null): { baseUrl: string; authHeader?: string } | null {
  const c = integration?.config || {};
  const baseUrl = String(c.url || c.host || '').replace(/\/$/, '');
  if (!baseUrl) return null;
  const user = String(c.username || '');
  const pass = String(c.password || '');
  const authHeader = user && pass
    ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
    : undefined;
  return { baseUrl, authHeader };
}

export async function testArkimeConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const creds = parseArkimeCreds({
    id: 't', name: 'arkime', type: 'arkime', category: 'siem', config, status: 'connected',
  });
  if (!creds) return { ok: false, message: 'url required' };
  const start = Date.now();
  const res = await fetch(`${creds.baseUrl}/api/stats`, {
    headers: creds.authHeader ? { Authorization: creds.authHeader } : {},
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, message: `Arkime ${res.status}`, durationMs: Date.now() - start };
  return { ok: true, message: 'Arkime API connected', durationMs: Date.now() - start };
}

export async function executeArkime(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'search_sessions';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('arkime') || ctx.getIntegration('moloch');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Arkime: not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const creds = parseArkimeCreds(integration);
  if (!creds) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Arkime: url required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (creds.authHeader) headers.Authorization = creds.authHeader;

  try {
    if (action === 'search_sessions') {
      const expression = resolveTemplate(String(cfg.expression || cfg.query || 'ip.src==*'), ctx);
      const startTime = Number(cfg.start_time) || Math.floor(Date.now() / 1000) - 3600;
      const stopTime = Number(cfg.stop_time) || Math.floor(Date.now() / 1000);
      const url = `${creds.baseUrl}/api/sessions?expression=${encodeURIComponent(expression)}&startTime=${startTime}&stopTime=${stopTime}`;
      const res = await fetch(url, { headers, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Arkime search failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const count = Array.isArray(data) ? data.length : (data as { data?: unknown[] }).data?.length || 0;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Arkime: ${count} session(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { arkime: { ok: true, action, count, sessions: data } }, logs };
    }

    if (action === 'stats') {
      const res = await fetch(`${creds.baseUrl}/api/stats`, { headers, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Arkime stats failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Arkime: stats retrieved', level: 'success', duration: Date.now() - start });
      return { success: true, output: { arkime: { ok: true, action, stats: data } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Arkime: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Arkime error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
