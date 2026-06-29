// Real ServiceNow executor - create/query incidents via Table API
// Docs: https://developer.servicenow.com/dev.do#!/reference/api/utah/rest/c_TableAPI

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const host = (c.host as string) || (c.instance as string) || '';
  const username = (c.username as string) || '';
  const password = (c.password as string) || (c.api_key as string) || '';
  return { host: host.replace(/^https?:\/\//, '').replace(/\/$/, ''), username, password };
}

export async function callServiceNow(
  integration: IntegrationConfig | null,
  table: string,
  method: string,
  body?: unknown,
  query?: string
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const creds = getCreds(integration);
  if (!creds.host || !creds.username) return { ok: false, status: 401, data: { error: 'ServiceNow credentials missing' }, durationMs: 0 };
  if (integration?.status !== 'connected') return { ok: false, status: 503, data: { error: 'ServiceNow not connected' }, durationMs: 0 };

  try {
    const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
    const url = `https://${creds.host}/api/now/table/${table}${query ? `?${query}` : ''}`;
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

export async function executeServiceNow(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'create_incident';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('servicenow');

  if (action === 'create_incident') {
    const short_description = resolveTemplate((cfg.short_description as string) || 'SOAR incident', ctx);
    const description = resolveTemplate((cfg.description as string) || '', ctx);
    const urgency = (cfg.urgency as string) || '3';
    const impact = (cfg.impact as string) || '3';
    const caller_id = resolveTemplate((cfg.caller_id as string) || '', ctx);
    const category = (cfg.category as string) || 'inquiry';

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow: creating incident...`, level: 'info' });

    const result = await callServiceNow(integration, 'incident', 'POST', {
      short_description, description, urgency, impact, category, caller_id: caller_id || undefined,
    });
    if (!result.ok) {
      const err = (result.data as { error?: { message?: string; detail?: string } })?.error?.message || `HTTP ${result.status}`;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow error: ${err}`, level: 'error', duration: result.durationMs, data: result.data });
      return { success: false, output: { servicenow: { ok: false, error: err } }, logs };
    }
    const inc = (result.data as { result: { sys_id: string; number: string } }).result;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow: created ${inc.number} (${inc.sys_id})`, level: 'success', duration: result.durationMs, data: { number: inc.number } });
    return { success: true, output: { servicenow: { ok: true, number: inc.number, sys_id: inc.sys_id } }, logs };
  }

  if (action === 'query') {
    const table = (cfg.table as string) || 'incident';
    const sysparm_query = resolveTemplate((cfg.sysparm_query as string) || 'active=true', ctx);
    const sysparm_limit = (cfg.limit as string) || '20';
    const result = await callServiceNow(integration, table, 'GET', undefined, `sysparm_query=${encodeURIComponent(sysparm_query)}&sysparm_limit=${sysparm_limit}`);
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow query error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, output: { servicenow: { ok: false } }, logs };
    }
    const data = result.data as { result: unknown[] };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow: ${data.result?.length || 0} records returned`, level: 'success', duration: result.durationMs });
    return { success: true, output: { servicenow: { ok: true, count: data.result?.length, records: data.result?.slice(0, 10) } }, logs };
  }

  if (action === 'update_incident') {
    const sys_id = resolveTemplate((cfg.sys_id as string) || '', ctx);
    if (!sys_id) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'ServiceNow: sys_id required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const result = await callServiceNow(integration, `incident/${sys_id}`, 'PATCH', cfg.fields || {});
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow update error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow: incident ${sys_id} updated`, level: 'success', duration: result.durationMs });
    return { success: true, output: { servicenow: { ok: true, updated: sys_id } }, logs };
  }

  // CMDB (Wave 2)
  if (action === 'query_cmdb') {
    const table = (cfg.table as string) || 'cmdb_ci';
    const sysparm_query = resolveTemplate((cfg.sysparm_query as string) || 'operational_status=1', ctx);
    const sysparm_limit = (cfg.limit as string) || '20';
    const result = await callServiceNow(integration, table, 'GET', undefined, `sysparm_query=${encodeURIComponent(sysparm_query)}&sysparm_limit=${sysparm_limit}`);
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow CMDB query error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, logs };
    }
    const data = result.data as { result: unknown[] };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow CMDB: ${data.result?.length || 0} CI(s)`, level: 'success', duration: result.durationMs });
    return { success: true, output: { servicenow: { ok: true, action, count: data.result?.length, records: data.result?.slice(0, 10) } }, logs };
  }

  if (action === 'get_ci') {
    const sys_id = resolveTemplate((cfg.sys_id as string) || '', ctx);
    const table = (cfg.table as string) || 'cmdb_ci';
    if (!sys_id) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'ServiceNow: sys_id required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const result = await callServiceNow(integration, `${table}/${sys_id}`, 'GET');
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow get_ci error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow: fetched CI ${sys_id}`, level: 'success', duration: result.durationMs });
    return { success: true, output: { servicenow: { ok: true, action, ci: (result.data as { result?: unknown }).result } }, logs };
  }

  if (action === 'create_ci') {
    const name = resolveTemplate((cfg.name as string) || '', ctx);
    const ci_class = (cfg.ci_class as string) || 'cmdb_ci_server';
    if (!name) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'ServiceNow: name required for create_ci', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const result = await callServiceNow(integration, ci_class, 'POST', {
      name,
      short_description: resolveTemplate((cfg.short_description as string) || '', ctx),
      ip_address: resolveTemplate((cfg.ip_address as string) || '', ctx) || undefined,
    });
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow create_ci error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, logs };
    }
    const ci = (result.data as { result: { sys_id: string; name: string } }).result;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow: created CI ${ci.name}`, level: 'success', duration: result.durationMs });
    return { success: true, output: { servicenow: { ok: true, action, sys_id: ci.sys_id, name: ci.name } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ServiceNow: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
