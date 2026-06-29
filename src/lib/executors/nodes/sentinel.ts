/**
 * Microsoft Sentinel executor — Azure Resource Manager + Log Analytics APIs
 * Docs: https://learn.microsoft.com/en-us/rest/api/securityinsights/
 */

import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

export const SENTINEL_API_VERSION = '2024-03-01';

export interface SentinelCreds {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
  resourceGroup: string;
  workspaceName: string;
  workspaceId: string;
}

export function parseSentinelCreds(integration: IntegrationConfig | null): SentinelCreds | null {
  const c = integration?.config || {};
  const tenantId = String(c.tenant_id || c.tenantId || '');
  const clientId = String(c.client_id || c.clientId || '');
  const clientSecret = String(c.client_secret || c.clientSecret || '');
  const subscriptionId = String(c.subscription_id || c.subscriptionId || '');
  const resourceGroup = String(c.resource_group || c.resourceGroup || '');
  const workspaceName = String(c.workspace_name || c.workspaceName || '');
  const workspaceId = String(c.workspace_id || c.workspaceId || '');
  if (!tenantId || !clientId || !clientSecret || !subscriptionId || !resourceGroup || !workspaceName) {
    return null;
  }
  return {
    tenantId,
    clientId,
    clientSecret,
    subscriptionId,
    resourceGroup,
    workspaceName,
    workspaceId,
  };
}

export function buildSentinelBaseUrl(creds: SentinelCreds): string {
  return `https://management.azure.com/subscriptions/${encodeURIComponent(creds.subscriptionId)}/resourceGroups/${encodeURIComponent(creds.resourceGroup)}/providers/Microsoft.OperationalInsights/workspaces/${encodeURIComponent(creds.workspaceName)}/providers/Microsoft.SecurityInsights`;
}

export async function getAzureAccessToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  scope: string,
): Promise<{ token: string | null; error?: string }> {
  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope,
        grant_type: 'client_credentials',
      }).toString(),
      cache: 'no-store',
    });
    const data = await res.json() as { access_token?: string; error_description?: string; error?: string };
    if (!res.ok || !data.access_token) {
      return { token: null, error: data.error_description || data.error || `HTTP ${res.status}` };
    }
    return { token: data.access_token };
  } catch (err) {
    return { token: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function testSentinelConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const creds = parseSentinelCreds({
    id: 'test',
    name: 'sentinel',
    type: 'sentinel',
    category: 'siem',
    config,
    status: 'connected',
  });
  if (!creds) {
    return { ok: false, message: 'tenant_id, client_id, client_secret, subscription_id, resource_group, workspace_name required' };
  }
  const start = Date.now();
  const { token, error } = await getAzureAccessToken(
    creds.tenantId,
    creds.clientId,
    creds.clientSecret,
    'https://management.azure.com/.default',
  );
  if (!token) {
    return { ok: false, message: error || 'OAuth token failed', durationMs: Date.now() - start };
  }
  const url = `${buildSentinelBaseUrl(creds)}/incidents?api-version=${SENTINEL_API_VERSION}&$top=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  const durationMs = Date.now() - start;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, message: `Sentinel API ${res.status}: ${body.slice(0, 200)}`, durationMs };
  }
  return { ok: true, message: 'Microsoft Sentinel connected (listed incidents)', durationMs };
}

export async function executeSentinel(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'list_incidents';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('sentinel')
    || ctx.getIntegration('microsoft_sentinel')
    || ctx.getIntegration('microsoft sentinel');

  if (integration?.status !== 'connected') {
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: 'Sentinel: integration not connected',
      level: 'error',
      duration: Date.now() - start,
    });
    return { success: false, logs };
  }

  const creds = parseSentinelCreds(integration);
  if (!creds) {
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: 'Sentinel: missing Azure credentials or workspace config',
      level: 'error',
      duration: Date.now() - start,
    });
    return { success: false, logs };
  }

  try {
    if (action === 'run_query') {
      if (!creds.workspaceId) {
        logs.push({
          time: new Date().toISOString(),
          nodeId: node.id,
          nodeLabel: node.data.label,
          message: 'Sentinel: workspace_id required for KQL queries',
          level: 'error',
          duration: Date.now() - start,
        });
        return { success: false, logs };
      }
      const { token, error } = await getAzureAccessToken(
        creds.tenantId,
        creds.clientId,
        creds.clientSecret,
        'https://api.loganalytics.azure.com/.default',
      );
      if (!token) {
        logs.push({
          time: new Date().toISOString(),
          nodeId: node.id,
          nodeLabel: node.data.label,
          message: `Sentinel Log Analytics auth failed: ${error}`,
          level: 'error',
          duration: Date.now() - start,
        });
        return { success: false, logs };
      }
      const query = resolveTemplate(String(cfg.query || 'SecurityIncident | take 5'), ctx);
      const timespan = String(cfg.timespan || 'PT1H');
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: `Sentinel: running KQL (${query.slice(0, 60)}...)`,
        level: 'info',
      });
      const res = await fetch(
        `https://api.loganalytics.azure.com/v1/workspaces/${encodeURIComponent(creds.workspaceId)}/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, timespan }),
          cache: 'no-store',
        },
      );
      const data = await res.json().catch(() => ({})) as { tables?: { rows?: unknown[][] }[]; error?: { message?: string } };
      if (!res.ok) {
        const err = data.error?.message || `HTTP ${res.status}`;
        logs.push({
          time: new Date().toISOString(),
          nodeId: node.id,
          nodeLabel: node.data.label,
          message: `Sentinel KQL error: ${err}`,
          level: 'error',
          duration: Date.now() - start,
          data,
        });
        return { success: false, output: { sentinel: { ok: false, action } }, logs };
      }
      const rowCount = data.tables?.[0]?.rows?.length || 0;
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: `Sentinel: KQL returned ${rowCount} row(s)`,
        level: 'success',
        duration: Date.now() - start,
        data: { rowCount },
      });
      return {
        success: true,
        output: { sentinel: { ok: true, action, rowCount, tables: data.tables } },
        logs,
      };
    }

    const { token, error } = await getAzureAccessToken(
      creds.tenantId,
      creds.clientId,
      creds.clientSecret,
      'https://management.azure.com/.default',
    );
    if (!token) {
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: `Sentinel auth failed: ${error}`,
        level: 'error',
        duration: Date.now() - start,
      });
      return { success: false, logs };
    }

    const base = buildSentinelBaseUrl(creds);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (action === 'list_incidents') {
      const top = Number(cfg.top) || 50;
      const filter = resolveTemplate(String(cfg.filter || ''), ctx);
      let url = `${base}/incidents?api-version=${SENTINEL_API_VERSION}&$top=${top}`;
      if (filter) url += `&$filter=${encodeURIComponent(filter)}`;
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: 'Sentinel: listing incidents',
        level: 'info',
      });
      const { 'Content-Type': _omitCt, ...fetchHeaders } = headers;
      const res = await fetch(url, { headers: fetchHeaders, cache: 'no-store' });
      const data = await res.json().catch(() => ({})) as { value?: unknown[]; error?: { message?: string } };
      if (!res.ok) {
        const err = data.error?.message || `HTTP ${res.status}`;
        logs.push({
          time: new Date().toISOString(),
          nodeId: node.id,
          nodeLabel: node.data.label,
          message: `Sentinel list_incidents error: ${err}`,
          level: 'error',
          duration: Date.now() - start,
        });
        return { success: false, logs };
      }
      const count = data.value?.length || 0;
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: `Sentinel: ${count} incident(s)`,
        level: 'success',
        duration: Date.now() - start,
      });
      return {
        success: true,
        output: { sentinel: { ok: true, action, count, incidents: data.value?.slice(0, 20) } },
        logs,
      };
    }

    if (action === 'get_incident') {
      const incidentId = resolveTemplate(String(cfg.incident_id || ''), ctx);
      if (!incidentId) {
        logs.push({
          time: new Date().toISOString(),
          nodeId: node.id,
          nodeLabel: node.data.label,
          message: 'Sentinel: incident_id required',
          level: 'error',
          duration: Date.now() - start,
        });
        return { success: false, logs };
      }
      const url = `${base}/incidents/${encodeURIComponent(incidentId)}?api-version=${SENTINEL_API_VERSION}`;
      const { 'Content-Type': _omitCt, ...fetchHeaders } = headers;
      const res = await fetch(url, { headers: fetchHeaders, cache: 'no-store' });
      const data = await res.json().catch(() => ({})) as Record<string, unknown> & { error?: { message?: string } };
      if (!res.ok) {
        const err = data.error?.message || `HTTP ${res.status}`;
        logs.push({
          time: new Date().toISOString(),
          nodeId: node.id,
          nodeLabel: node.data.label,
          message: `Sentinel get_incident error: ${err}`,
          level: 'error',
          duration: Date.now() - start,
        });
        return { success: false, logs };
      }
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: `Sentinel: fetched incident ${incidentId}`,
        level: 'success',
        duration: Date.now() - start,
      });
      return { success: true, output: { sentinel: { ok: true, action, incident: data } }, logs };
    }

    if (action === 'update_incident') {
      const incidentId = resolveTemplate(String(cfg.incident_id || ''), ctx);
      const status = resolveTemplate(String(cfg.status || ''), ctx);
      if (!incidentId || !status) {
        logs.push({
          time: new Date().toISOString(),
          nodeId: node.id,
          nodeLabel: node.data.label,
          message: 'Sentinel: incident_id and status required for update',
          level: 'error',
          duration: Date.now() - start,
        });
        return { success: false, logs };
      }
      const properties: Record<string, unknown> = { status };
      const classification = resolveTemplate(String(cfg.classification || ''), ctx);
      const ownerEmail = resolveTemplate(String(cfg.owner_email || ''), ctx);
      const comment = resolveTemplate(String(cfg.comment || ''), ctx);
      if (classification) properties.classification = classification;
      if (ownerEmail) properties.owner = { email: ownerEmail };
      if (comment) properties.additionalData = { comment };

      const url = `${base}/incidents/${encodeURIComponent(incidentId)}?api-version=${SENTINEL_API_VERSION}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown> & { error?: { message?: string } };
      if (!res.ok) {
        const err = data.error?.message || `HTTP ${res.status}`;
        logs.push({
          time: new Date().toISOString(),
          nodeId: node.id,
          nodeLabel: node.data.label,
          message: `Sentinel update_incident error: ${err}`,
          level: 'error',
          duration: Date.now() - start,
        });
        return { success: false, logs };
      }
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: `Sentinel: updated incident ${incidentId} → ${status}`,
        level: 'success',
        duration: Date.now() - start,
      });
      return { success: true, output: { sentinel: { ok: true, action, incident_id: incidentId, status } }, logs };
    }

    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `Sentinel: unknown action "${action}"`,
      level: 'error',
      duration: Date.now() - start,
    });
    return { success: false, logs };
  } catch (err: unknown) {
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `Sentinel error: ${err instanceof Error ? err.message : String(err)}`,
      level: 'error',
      duration: Date.now() - start,
    });
    return { success: false, logs };
  }
}
