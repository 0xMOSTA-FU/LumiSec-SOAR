/**
 * Microsoft Entra ID (Azure AD) — identity operations via Microsoft Graph
 * Docs: https://learn.microsoft.com/en-us/graph/api/resources/identity-network-access-overview
 */
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';
import {
  getGraphAccessToken,
  parseAzureAppCreds,
  testGraphConnectivity,
} from './azure-auth';

export { testGraphConnectivity as testEntraIdConnectivity };

async function graphRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`https://graph.microsoft.com/v1.0/${path.replace(/^\//, '')}`, {
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

export async function executeEntraId(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'list_users';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('entra_id')
    || ctx.getIntegration('entra')
    || ctx.getIntegration('azure_ad')
    || ctx.getIntegration('entraid');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Entra ID: not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const creds = parseAzureAppCreds(integration);
  if (!creds) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Entra ID: tenant_id + client_id + client_secret required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const { token, error } = await getGraphAccessToken(creds);
  if (!token) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID auth failed: ${error}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    if (action === 'list_users') {
      const top = Number(cfg.top) || 25;
      const r = await graphRequest(token, `users?$top=${top}&$select=id,displayName,userPrincipalName,accountEnabled`);
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID list_users failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start, data: r.data });
        return { success: false, logs };
      }
      const count = (r.data as { value?: unknown[] }).value?.length || 0;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID: ${count} user(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { entra_id: { ok: true, action, count, users: (r.data as { value?: unknown[] }).value } }, logs };
    }

    if (action === 'get_user') {
      const upn = resolveTemplate(String(cfg.upn || cfg.user_id || ''), ctx);
      if (!upn) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Entra ID: upn or user_id required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const r = await graphRequest(token, `users/${encodeURIComponent(upn)}`);
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID get_user failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID: fetched user ${upn}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { entra_id: { ok: true, action, user: r.data } }, logs };
    }

    if (action === 'disable_user' || action === 'enable_user') {
      const upn = resolveTemplate(String(cfg.upn || cfg.user_id || ''), ctx);
      if (!upn) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Entra ID: upn required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const enabled = action === 'enable_user';
      const r = await graphRequest(token, `users/${encodeURIComponent(upn)}`, {
        method: 'PATCH',
        body: JSON.stringify({ accountEnabled: enabled }),
      });
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID ${action} failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start, data: r.data });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID: ${upn} accountEnabled=${enabled}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { entra_id: { ok: true, action, upn, accountEnabled: enabled } }, logs };
    }

    if (action === 'list_groups') {
      const top = Number(cfg.top) || 25;
      const r = await graphRequest(token, `groups?$top=${top}&$select=id,displayName,mailEnabled,securityEnabled`);
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID list_groups failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const count = (r.data as { value?: unknown[] }).value?.length || 0;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID: ${count} group(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { entra_id: { ok: true, action, count, groups: (r.data as { value?: unknown[] }).value } }, logs };
    }

    if (action === 'add_user_to_group') {
      const groupId = resolveTemplate(String(cfg.group_id || ''), ctx);
      const userId = resolveTemplate(String(cfg.user_id || cfg.upn || ''), ctx);
      if (!groupId || !userId) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Entra ID: group_id and user_id required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const r = await graphRequest(token, `groups/${encodeURIComponent(groupId)}/members/$ref`, {
        method: 'POST',
        body: JSON.stringify({ '@odata.id': `https://graph.microsoft.com/v1.0/users/${userId}` }),
      });
      if (!r.ok && r.status !== 204) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID add_user_to_group failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start, data: r.data });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID: added ${userId} to group ${groupId}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { entra_id: { ok: true, action, group_id: groupId, user_id: userId } }, logs };
    }

    if (action === 'list_sign_ins') {
      const top = Number(cfg.top) || 20;
      const r = await graphRequest(token, `auditLogs/signIns?$top=${top}`);
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID list_sign_ins failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const count = (r.data as { value?: unknown[] }).value?.length || 0;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID: ${count} sign-in(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { entra_id: { ok: true, action, count, signIns: (r.data as { value?: unknown[] }).value } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Entra ID error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
