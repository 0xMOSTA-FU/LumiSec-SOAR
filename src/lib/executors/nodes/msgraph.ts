// Real Microsoft Graph executor - query users, alerts, mail via Graph API v1.0
// Docs: https://learn.microsoft.com/en-us/graph/api/overview

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

async function getMSGraphToken(integration: IntegrationConfig | null): Promise<string | null> {
  const c = integration?.config || {};
  const tenant_id = (c.tenant_id as string) || (c.tenantId as string) || '';
  const client_id = (c.client_id as string) || (c.clientId as string) || '';
  const client_secret = (c.client_secret as string) || (c.clientSecret as string) || '';
  if (!tenant_id || !client_id || !client_secret) return null;

  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenant_id}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id,
        client_secret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
      cache: 'no-store',
    });
    const data = await res.json() as { access_token?: string; error?: string };
    return data.access_token || null;
  } catch { return null; }
}

export async function executeMSGraph(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'list_users';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('msgraph') || ctx.getIntegration('microsoft');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'MSGraph not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MSGraph: requesting token...`, level: 'info' });
  const token = await getMSGraphToken(integration);
  if (!token) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'MSGraph: tenant_id + client_id + client_secret required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    let endpoint = '';
    switch (action) {
      case 'list_users': endpoint = 'users?$top=20&$select=id,displayName,userPrincipalName,mail'; break;
      case 'list_alerts': endpoint = 'security/alerts?$top=20'; break;
      case 'list_signins': endpoint = 'auditLogs/signIns?$top=20'; break;
      case 'get_user': {
        const upn = resolveTemplate((cfg.upn as string) || '', ctx);
        if (!upn) { logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'MSGraph: upn required', level: 'error', duration: Date.now() - start }); return { success: false, logs }; }
        endpoint = `users/${encodeURIComponent(upn)}`;
        break;
      }
      case 'send_mail': {
        const to = resolveTemplate((cfg.to as string) || '', ctx);
        const subject = resolveTemplate((cfg.subject as string) || 'SOAR notification', ctx);
        const body = resolveTemplate((cfg.body as string) || '', ctx);
        const from = resolveTemplate((cfg.from as string) || '', ctx);
        if (!to || !from) { logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'MSGraph: from + to required', level: 'error', duration: Date.now() - start }); return { success: false, logs }; }
        const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { subject, body: { contentType: 'Text', content: body }, toRecipients: [{ emailAddress: { address: to } }] } }),
          cache: 'no-store',
        });
        if (res.ok) {
          logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MSGraph: mail sent to ${to}`, level: 'success', duration: Date.now() - start });
          return { success: true, output: { msgraph: { ok: true, sent: true, to, subject } }, logs };
        }
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MSGraph mail error: HTTP ${res.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      default:
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MSGraph: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MSGraph: GET ${endpoint.slice(0, 80)}`, level: 'info' });
    const res = await fetch(`https://graph.microsoft.com/v1.0/${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({})) as { value?: unknown[]; error?: { message?: string } };
    if (!res.ok) {
      const err = data.error?.message || `HTTP ${res.status}`;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MSGraph error: ${err}`, level: 'error', duration: Date.now() - start, data });
      return { success: false, output: { msgraph: { ok: false, error: err } }, logs };
    }
    const count = data.value?.length || 0;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MSGraph: ${action} returned ${count} items`, level: 'success', duration: Date.now() - start, data: { count } });
    return { success: true, output: { msgraph: { ok: true, action, count, value: data.value?.slice(0, 20) } }, logs };
  } catch (err: unknown) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `MSGraph error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
