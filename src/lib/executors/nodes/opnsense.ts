/* eslint-disable @typescript-eslint/no-unused-vars */
// Real OPNsense executor - block/unblock IPs via firewall alias API
// Docs: https://docs.opnsense.org/development/api.html

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const host = (c.host as string) || (c.url as string) || '';
  const port = (c.port as number) || 443;
  const api_key = (c.api_key as string) || (c.key as string) || '';
  const api_secret = (c.api_secret as string) || (c.secret as string) || '';
  return { host: host.replace(/^https?:\/\//, ''), port, api_key, api_secret };
}

export async function callOPNsense(
  integration: IntegrationConfig | null,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const creds = getCreds(integration);
  if (!creds.host || !creds.api_key || !creds.api_secret) return { ok: false, status: 401, data: { error: 'OPNsense host+api_key+api_secret required' }, durationMs: 0 };
  if (integration?.status !== 'connected') return { ok: false, status: 503, data: { error: 'OPNsense not connected' }, durationMs: 0 };

  try {
    const auth = Buffer.from(`${creds.api_key}:${creds.api_secret}`).toString('base64');
    const url = `https://${creds.host}:${creds.port}/api/${path.replace(/^\//, '')}`;
    const res = await fetch(url, {
      method,
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) }, durationMs: Date.now() - start };
  }
}

export async function executeOPNsense(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'block_ip';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('opnsense');

  if (action === 'block_ip') {
    const ip = resolveTemplate((cfg.ip as string) || (cfg.target as string) || '', ctx);
    if (!ip) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'OPNsense: ip required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OPNsense: blocking ${ip}...`, level: 'info' });

    const aliasName = (cfg.alias as string) || 'SOAR_BlockList';
    const searchRes = await callOPNsense(integration, 'GET', 'firewall/alias/searchItem');
    const rows = (searchRes.data as { rows?: { uuid: string; name: string; content?: string; type?: string }[] })?.rows || [];
    const existing = rows.find(r => r.name === aliasName);

    if (!existing) {
      const createRes = await callOPNsense(integration, 'POST', 'firewall/alias/addItem/', {
        alias: { enabled: '1', name: aliasName, type: 'host', content: ip, description: 'Blocked by SOAR' },
      });
      if (!createRes.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OPNsense create alias error: HTTP ${createRes.status}`, level: 'error', duration: Date.now() - start, data: createRes.data });
        return { success: false, output: { opnsense: { ok: false } }, logs };
      }
    } else {
      const ips = (existing.content || '').split('\n').map(s => s.trim()).filter(Boolean);
      if (!ips.includes(ip)) ips.push(ip);
      const updateRes = await callOPNsense(integration, 'POST', `firewall/alias/setItem/${existing.uuid}`, {
        alias: { enabled: '1', name: aliasName, type: existing.type || 'host', content: ips.join('\n'), description: 'Blocked by SOAR' },
      });
      if (!updateRes.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OPNsense update alias error: HTTP ${updateRes.status}`, level: 'error', duration: Date.now() - start, data: updateRes.data });
        return { success: false, output: { opnsense: { ok: false } }, logs };
      }
    }

    const applyRes = await callOPNsense(integration, 'POST', 'firewall/alias/reconfigure', {});

    if (applyRes.ok || (applyRes.data as { status?: string })?.status === 'ok') {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OPNsense: ${ip} blocked via alias "${aliasName}"`, level: 'success', duration: Date.now() - start, data: { ip, alias: aliasName } });
      return { success: true, output: { opnsense: { ok: true, ip, alias: aliasName } }, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OPNsense error: HTTP ${applyRes.status}`, level: 'error', duration: Date.now() - start, data: applyRes.data });
    return { success: false, output: { opnsense: { ok: false } }, logs };
  }

  if (action === 'list_aliases') {
    const res = await callOPNsense(integration, 'GET', 'firewall/alias/searchItem');
    const data = res.data as { rows?: { name: string; description?: string }[] };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OPNsense: ${data.rows?.length || 0} aliases`, level: 'success', duration: Date.now() - start });
    return { success: true, output: { opnsense: { ok: true, count: data.rows?.length, aliases: data.rows?.slice(0, 20) } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OPNsense: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
