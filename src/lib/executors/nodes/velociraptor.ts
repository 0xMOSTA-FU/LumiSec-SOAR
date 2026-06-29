// Real Velociraptor executor - create/list hunts via VQL REST API
// Docs: https://docs.velociraptor.app/docs/server_automation/server_api/

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const url = (c.url as string) || (c.host as string) || '';
  const api_key = (c.api_key as string) || (c.key as string) || '';
  return { url: url.replace(/\/$/, ''), api_key };
}

export async function executeVelociraptor(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'list_hunts';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('velociraptor');
  const creds = getCreds(integration);

  if (!creds.url || !creds.api_key) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Velociraptor: url+api_key required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Velociraptor not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    if (action === 'list_hunts') {
      const vql = 'SELECT * FROM hunts() LIMIT 20';
      const res = await fetch(`${creds.url}/api/v1/Hunts`, {
        method: 'POST',
        headers: { 'X-Velociraptor-ApiKey': creds.api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ vql }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as { rows?: { hunt_id: string; state: string }[] };
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Velociraptor: ${data.rows?.length || 0} hunts`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { velociraptor: { ok: true, count: data.rows?.length, hunts: data.rows?.slice(0, 20) } }, logs };
    }

    if (action === 'create_hunt') {
      const hunt_description = resolveTemplate((cfg.description as string) || 'SOAR hunt', ctx);
      const artifact = (cfg.artifact as string) || 'Windows.System.ProcessVads';
      const vql = `SELECT * FROM hunt(description="${hunt_description}", art="${artifact}")`;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Velociraptor: creating hunt for artifact "${artifact}"...`, level: 'info' });
      const res = await fetch(`${creds.url}/api/v1/Hunts`, {
        method: 'POST',
        headers: { 'X-Velociraptor-ApiKey': creds.api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ vql }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as { rows?: { hunt_id: string }[] };
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Velociraptor error: HTTP ${res.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, output: { velociraptor: { ok: false } }, logs };
      }
      const huntId = data.rows?.[0]?.hunt_id;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Velociraptor: hunt created (id=${huntId || 'n/a'})`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { velociraptor: { ok: true, hunt_id: huntId, artifact } }, logs };
    }

    if (action === 'list_clients') {
      const vql = 'SELECT * FROM clients() LIMIT 20';
      const res = await fetch(`${creds.url}/api/v1/Hunts`, {
        method: 'POST',
        headers: { 'X-Velociraptor-ApiKey': creds.api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ vql }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as { rows?: { client_id: string; os_info: string }[] };
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Velociraptor: ${data.rows?.length || 0} clients`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { velociraptor: { ok: true, count: data.rows?.length, clients: data.rows?.slice(0, 20) } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Velociraptor: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err: unknown) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Velociraptor error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
