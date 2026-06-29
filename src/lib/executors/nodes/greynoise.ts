/**
 * GreyNoise Community / Enterprise API
 * Docs: https://docs.greynoise.io/docs
 */
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

const GN_HOST = 'api.greynoise.io';

export function parseGreyNoiseKey(integration: IntegrationConfig | null): string | null {
  const c = integration?.config || {};
  const key = String(c.api_key || c.apiKey || c.key || '');
  return key || null;
}

export async function testGreyNoiseConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const key = String(config.api_key || config.apiKey || config.key || '');
  if (!key) return { ok: false, message: 'api_key required' };
  const start = Date.now();
  const res = await fetch(`https://${GN_HOST}/v3/meta/metadata`, {
    headers: { key, Accept: 'application/json' },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, message: `GreyNoise ${res.status}`, durationMs: Date.now() - start };
  }
  return { ok: true, message: 'GreyNoise API key valid', durationMs: Date.now() - start };
}

export async function lookupGreyNoiseIp(ip: string, apiKey: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`https://${GN_HOST}/v3/community/${encodeURIComponent(ip)}`, {
    headers: { key: apiKey, Accept: 'application/json' },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function executeGreyNoise(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'lookup_ip';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('greynoise') || ctx.getIntegration('gn');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'GreyNoise: not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const apiKey = parseGreyNoiseKey(integration);
  if (!apiKey) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'GreyNoise: api_key required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    if (action === 'lookup_ip' || action === 'context') {
      const ip = resolveTemplate(String(cfg.ip || cfg.ioc || ''), ctx);
      if (!ip) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'GreyNoise: ip required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const path = action === 'context' ? `/v3/noise/context/${encodeURIComponent(ip)}` : `/v3/community/${encodeURIComponent(ip)}`;
      const res = await fetch(`https://${GN_HOST}${path}`, {
        headers: { key: apiKey, Accept: 'application/json' },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GreyNoise lookup failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
        return { success: false, logs };
      }
      const noise = (data as { noise?: boolean; riot?: boolean }).noise;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GreyNoise: ${ip} noise=${noise}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { greynoise: { ok: true, action, ip, ...(data as object) } }, logs };
    }

    if (action === 'riot_lookup') {
      const ip = resolveTemplate(String(cfg.ip || ''), ctx);
      if (!ip) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'GreyNoise: ip required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const res = await fetch(`https://${GN_HOST}/v2/riot/${encodeURIComponent(ip)}`, {
        headers: { key: apiKey, Accept: 'application/json' },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GreyNoise RIOT failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GreyNoise RIOT: ${ip}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { greynoise: { ok: true, action, ip, ...(data as object) } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GreyNoise: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GreyNoise error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
