/**
 * CrowdStrike Falcon API executor
 * Docs: https://falcon.crowdstrike.com/documentation/46/crowdstrike-oauth2-based-apis
 */
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

export interface CrowdStrikeCreds {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export function parseCrowdStrikeCreds(integration: IntegrationConfig | null): CrowdStrikeCreds | null {
  const c = integration?.config || {};
  const clientId = String(c.client_id || c.clientId || '');
  const clientSecret = String(c.client_secret || c.clientSecret || '');
  const baseUrl = String(c.base_url || c.baseUrl || 'https://api.crowdstrike.com').replace(/\/$/, '');
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, baseUrl };
}

export async function getCrowdStrikeToken(creds: CrowdStrikeCreds): Promise<{ token: string | null; error?: string }> {
  try {
    const res = await fetch(`${creds.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret }),
      cache: 'no-store',
    });
    const data = await res.json() as { access_token?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      return { token: null, error: data.error_description || `HTTP ${res.status}` };
    }
    return { token: data.access_token };
  } catch (err) {
    return { token: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function testCrowdStrikeConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const creds = parseCrowdStrikeCreds({
    id: 'test', name: 'crowdstrike', type: 'crowdstrike', category: 'edr', config, status: 'connected',
  });
  if (!creds) return { ok: false, message: 'client_id and client_secret required' };
  const start = Date.now();
  const { token, error } = await getCrowdStrikeToken(creds);
  if (!token) return { ok: false, message: error || 'OAuth failed', durationMs: Date.now() - start };
  const res = await fetch(`${creds.baseUrl}/devices/queries/devices/v1?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, message: `Falcon API ${res.status}: ${body.slice(0, 150)}`, durationMs: Date.now() - start };
  }
  return { ok: true, message: 'CrowdStrike Falcon API connected', durationMs: Date.now() - start };
}

async function falconFetch(
  creds: CrowdStrikeCreds,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function executeCrowdStrike(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'list_hosts';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('crowdstrike') || ctx.getIntegration('falcon') || ctx.getIntegration('cs');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'CrowdStrike: not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const creds = parseCrowdStrikeCreds(integration);
  if (!creds) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'CrowdStrike: client_id + client_secret required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const { token, error } = await getCrowdStrikeToken(creds);
  if (!token) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike auth failed: ${error}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    if (action === 'list_hosts') {
      const filter = resolveTemplate(String(cfg.filter || ''), ctx);
      let path = '/devices/queries/devices/v1?limit=50';
      if (filter) path += `&filter=${encodeURIComponent(filter)}`;
      const q = await falconFetch(creds, token, path);
      if (!q.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike query failed: HTTP ${q.status}`, level: 'error', duration: Date.now() - start, data: q.data });
        return { success: false, logs };
      }
      const ids = (q.data as { resources?: string[] }).resources || [];
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike: ${ids.length} device id(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { crowdstrike: { ok: true, action, count: ids.length, device_ids: ids.slice(0, 20) } }, logs };
    }

    if (action === 'list_detections') {
      const filter = resolveTemplate(String(cfg.filter || ''), ctx);
      let path = '/detects/queries/detects/v1?limit=50';
      if (filter) path += `&filter=${encodeURIComponent(filter)}`;
      const q = await falconFetch(creds, token, path);
      if (!q.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike detections query failed: HTTP ${q.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const ids = (q.data as { resources?: string[] }).resources || [];
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike: ${ids.length} detection id(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { crowdstrike: { ok: true, action, count: ids.length, detection_ids: ids.slice(0, 20) } }, logs };
    }

    if (action === 'contain_host') {
      const deviceId = resolveTemplate(String(cfg.device_id || ''), ctx);
      if (!deviceId) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'CrowdStrike: device_id required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const r = await falconFetch(creds, token, '/devices/entities/devices-actions/v2?action_name=contain', {
        method: 'POST',
        body: JSON.stringify({ ids: [deviceId] }),
      });
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike contain failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start, data: r.data });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike: contained device ${deviceId}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { crowdstrike: { ok: true, action, device_id: deviceId, contained: true } }, logs };
    }

    if (action === 'lift_containment') {
      const deviceId = resolveTemplate(String(cfg.device_id || ''), ctx);
      if (!deviceId) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'CrowdStrike: device_id required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const r = await falconFetch(creds, token, '/devices/entities/devices-actions/v2?action_name=lift_containment', {
        method: 'POST',
        body: JSON.stringify({ ids: [deviceId] }),
      });
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike lift containment failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike: lifted containment on ${deviceId}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { crowdstrike: { ok: true, action, device_id: deviceId } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CrowdStrike error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
