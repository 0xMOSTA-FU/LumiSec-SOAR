// Real DigitalOcean executor - manage firewall rules + droplets
// Docs: https://docs.digitalocean.com/reference/api/api-reference/

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

export async function callDigitalOcean(
  integration: IntegrationConfig | null,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const api_token = (integration?.config?.api_token as string) || (integration?.config?.token as string) || '';
  if (!api_token) return { ok: false, status: 401, data: { error: 'DigitalOcean api_token required' }, durationMs: 0 };
  if (integration?.status !== 'connected') return { ok: false, status: 503, data: { error: 'DigitalOcean not connected' }, durationMs: 0 };

  try {
    const res = await fetch(`https://api.digitalocean.com/v2/${path.replace(/^\//, '')}`, {
      method,
      headers: { 'Authorization': `Bearer ${api_token}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) }, durationMs: Date.now() - start };
  }
}

export async function executeDigitalOcean(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'list_droplets';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('digitalocean') || ctx.getIntegration('do');

  if (action === 'list_droplets') {
    const res = await callDigitalOcean(integration, 'GET', 'droplets?page=1&per_page=20');
    if (!res.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DigitalOcean error: HTTP ${res.status}`, level: 'error', duration: res.durationMs });
      return { success: false, output: { digitalocean: { ok: false } }, logs };
    }
    const data = res.data as { droplets?: { id: number; name: string; status: string; ip_address?: string }[]; meta?: { total: number } };
    const total = data.meta?.total ?? data.droplets?.length ?? 0;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DigitalOcean: ${total} droplets`, level: 'success', duration: res.durationMs });
    return { success: true, output: { digitalocean: { ok: true, total, droplets: data.droplets?.slice(0, 20) } }, logs };
  }

  if (action === 'add_firewall_rule') {
    const firewall_id = resolveTemplate((cfg.firewall_id as string) || '', ctx);
    const ip = resolveTemplate((cfg.ip as string) || (cfg.target as string) || '', ctx);
    const port = (cfg.port as string) || '0:65535';
    const protocol = (cfg.protocol as string) || 'tcp';
    if (!firewall_id || !ip) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'DigitalOcean: firewall_id + ip required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    // Get existing firewall then add a deny rule
    const getRes = await callDigitalOcean(integration, 'GET', `firewalls/${firewall_id}`);
    if (!getRes.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DigitalOcean: firewall not found`, level: 'error', duration: getRes.durationMs });
      return { success: false, logs };
    }
    const fw = (getRes.data as { firewall?: { name: string; inbound_rules: { protocol: string; ports?: string; sources: Record<string, unknown> }[]; outbound_rules: unknown[]; droplet_ids: number[] } }).firewall;
    if (!fw) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'DigitalOcean: firewall payload missing', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    // Add a new deny-from-rule (we add an inbound rule with source = ip)
    fw.inbound_rules.push({ protocol, ports: port, sources: { addresses: [ip] } });
    const updRes = await callDigitalOcean(integration, 'PUT', `firewalls/${firewall_id}`, { firewall: fw });
    if (!updRes.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DigitalOcean error: HTTP ${updRes.status}`, level: 'error', duration: updRes.durationMs });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DigitalOcean: rule for ${ip} added to firewall ${firewall_id}`, level: 'success', duration: Date.now() - start });
    return { success: true, output: { digitalocean: { ok: true, firewall_id, ip } }, logs };
  }

  if (action === 'power_off_droplet') {
    const droplet_id = resolveTemplate((cfg.droplet_id as string) || '', ctx);
    if (!droplet_id) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'DigitalOcean: droplet_id required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const res = await callDigitalOcean(integration, 'POST', `droplets/${droplet_id}/actions`, { type: 'power_off' });
    if (!res.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DigitalOcean error: HTTP ${res.status}`, level: 'error', duration: res.durationMs });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DigitalOcean: droplet ${droplet_id} power_off requested`, level: 'success', duration: res.durationMs });
    return { success: true, output: { digitalocean: { ok: true, droplet_id, action: 'power_off' } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `DigitalOcean: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
