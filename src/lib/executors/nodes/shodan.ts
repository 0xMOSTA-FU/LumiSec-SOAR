/**
 * Shodan API executor
 * Docs: https://developer.shodan.io/api
 */
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

const SHODAN_HOST = 'api.shodan.io';

export function parseShodanKey(integration: IntegrationConfig | null): string | null {
  const c = integration?.config || {};
  return String(c.api_key || c.apiKey || c.key || '') || null;
}

export async function testShodanConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const key = String(config.api_key || config.apiKey || '');
  if (!key) return { ok: false, message: 'api_key required' };
  const start = Date.now();
  const res = await fetch(`https://${SHODAN_HOST}/api-info?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: `Shodan ${res.status}`, durationMs: Date.now() - start };
  const plan = (data as { plan?: string }).plan;
  return { ok: true, message: `Shodan connected (plan: ${plan || 'unknown'})`, durationMs: Date.now() - start };
}

export async function executeShodan(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'host_lookup';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('shodan');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Shodan: not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const apiKey = parseShodanKey(integration);
  if (!apiKey) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Shodan: api_key required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    if (action === 'host_lookup') {
      const ip = resolveTemplate(String(cfg.ip || cfg.host || ''), ctx);
      if (!ip) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Shodan: ip required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const res = await fetch(`https://${SHODAN_HOST}/shodan/host/${encodeURIComponent(ip)}?key=${encodeURIComponent(apiKey)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Shodan host lookup failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
        return { success: false, logs };
      }
      const ports = (data as { ports?: number[] }).ports || [];
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Shodan: ${ip} — ${ports.length} open port(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { shodan: { ok: true, action, ip, ports: ports.slice(0, 50), host: data } }, logs };
    }

    if (action === 'search') {
      const query = resolveTemplate(String(cfg.query || ''), ctx);
      if (!query) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Shodan: query required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const res = await fetch(`https://${SHODAN_HOST}/shodan/host/search?key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Shodan search failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const total = (data as { total?: number }).total || 0;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Shodan search: ${total} result(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { shodan: { ok: true, action, total, matches: (data as { matches?: unknown[] }).matches?.slice(0, 10) } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Shodan: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Shodan error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
