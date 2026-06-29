/**
 * pfSense REST API (Netgate pfSense Plus / CE with API enabled)
 * Docs: https://docs.netgate.com/pfsense/en/latest/api/index.html
 */
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

export interface PfSenseCreds {
  host: string;
  port: number;
  apiKey: string;
}

export function parsePfSenseCreds(integration: IntegrationConfig | null): PfSenseCreds | null {
  const c = integration?.config || {};
  const host = String(c.host || c.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const port = Number(c.port) || 443;
  const apiKey = String(c.api_key || c.apiKey || c.token || '');
  if (!host || !apiKey) return null;
  return { host, port, apiKey };
}

async function pfFetch(creds: PfSenseCreds, path: string, init: RequestInit = {}) {
  const url = `https://${creds.host}:${creds.port}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.apiKey}`,
      ...(init.headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function testPfSenseConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const creds = parsePfSenseCreds({
    id: 't', name: 'pfsense', type: 'pfsense', category: 'firewall', config, status: 'connected',
  });
  if (!creds) return { ok: false, message: 'host and api_key required' };
  const start = Date.now();
  const r = await pfFetch(creds, '/api/v2/status/system');
  if (!r.ok) {
    const alt = await pfFetch(creds, '/api/v1/system/status');
    if (!alt.ok) return { ok: false, message: `pfSense API ${r.status}`, durationMs: Date.now() - start };
  }
  return { ok: true, message: 'pfSense API connected', durationMs: Date.now() - start };
}

export async function executePfSense(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'system_status';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('pfsense') || ctx.getIntegration('pfsense_plus');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'pfSense: not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const creds = parsePfSenseCreds(integration);
  if (!creds) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'pfSense: host + api_key required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    if (action === 'system_status') {
      let r = await pfFetch(creds, '/api/v2/status/system');
      if (!r.ok) r = await pfFetch(creds, '/api/v1/system/status');
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `pfSense status failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'pfSense: system status OK', level: 'success', duration: Date.now() - start });
      return { success: true, output: { pfsense: { ok: true, action, status: r.data } }, logs };
    }

    if (action === 'block_ip' || action === 'add_alias_ip') {
      const ip = resolveTemplate(String(cfg.ip || ''), ctx);
      const aliasName = resolveTemplate(String(cfg.alias || cfg.alias_name || 'SOAR_BlockList'), ctx);
      if (!ip) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'pfSense: ip required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const body = { name: aliasName, type: 'host', address: [ip], detail: 'Added by LumiSec SOAR' };
      let r = await pfFetch(creds, '/api/v2/firewall/alias', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) {
        r = await pfFetch(creds, `/api/v2/firewall/alias/${encodeURIComponent(aliasName)}/address`, {
          method: 'POST',
          body: JSON.stringify({ address: ip }),
        });
      }
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `pfSense block_ip failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start, data: r.data });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `pfSense: added ${ip} to alias ${aliasName}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { pfsense: { ok: true, action, ip, alias: aliasName } }, logs };
    }

    if (action === 'list_aliases') {
      const r = await pfFetch(creds, '/api/v2/firewall/aliases');
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `pfSense list_aliases failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'pfSense: aliases listed', level: 'success', duration: Date.now() - start });
      return { success: true, output: { pfsense: { ok: true, action, aliases: r.data } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `pfSense: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `pfSense error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
