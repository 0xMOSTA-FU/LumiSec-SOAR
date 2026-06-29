// Real Wazuh executor - query Wazuh manager API v4
// Docs: https://documentation.wazuh.com/current/api/index.html

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const host = (c.host as string) || (c.url as string) || '';
  const port = (c.port as number) || 55000;
  const username = (c.username as string) || 'wazuh';
  const password = (c.password as string) || '';
  return { host: host.replace(/^https?:\/\//, ''), port, username, password };
}

async function getWazuhToken(creds: { host: string; port: number; username: string; password: string }): Promise<string | null> {
  try {
    const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
    const res = await fetch(`https://${creds.host}:${creds.port}/security/user/authenticate`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: { token?: string } };
    return data.data?.token || null;
  } catch { return null; }
}

export async function executeWazuh(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'list_agents';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('wazuh');
  const creds = getCreds(integration);

  if (!creds.host || !creds.password) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Wazuh: host + password required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Wazuh not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Wazuh: authenticating...`, level: 'info' });
  const token = await getWazuhToken(creds);
  if (!token) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Wazuh: auth failed', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  let endpoint = '';
  switch (action) {
    case 'list_agents': endpoint = 'agents?limit=20'; break;
    case 'list_alerts': endpoint = 'alerts?limit=20'; break;
    case 'agent_active': {
      const agent_id = resolveTemplate((cfg.agent_id as string) || '', ctx);
      endpoint = `agents/${agent_id}`;
      break;
    }
    case 'syscheck': {
      const agent_id = resolveTemplate((cfg.agent_id as string) || '', ctx);
      endpoint = `syscheck/${agent_id}?limit=20`;
      break;
    }
    default:
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Wazuh: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
      return { success: false, logs };
  }

  try {
    const res = await fetch(`https://${creds.host}:${creds.port}/${endpoint.replace(/^\//, '')}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({})) as { data?: { affected_items?: unknown[]; total_affected_items?: number }; error?: number };
    if (!res.ok || data.error) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Wazuh error: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
      return { success: false, output: { wazuh: { ok: false } }, logs };
    }
    const count = data.data?.total_affected_items ?? data.data?.affected_items?.length ?? 0;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Wazuh: ${action} returned ${count} items`, level: 'success', duration: Date.now() - start, data: { count } });
    return { success: true, output: { wazuh: { ok: true, action, count, items: data.data?.affected_items?.slice(0, 10) } }, logs };
  } catch (err: unknown) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Wazuh error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
