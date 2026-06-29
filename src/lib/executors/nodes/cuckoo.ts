/**
 * Cuckoo Sandbox REST API
 * Docs: https://cuckoo.readthedocs.io/en/latest/usage/api.html
 */
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

export interface CuckooCreds {
  baseUrl: string;
  apiToken: string;
}

export function parseCuckooCreds(integration: IntegrationConfig | null): CuckooCreds | null {
  const c = integration?.config || {};
  const baseUrl = String(c.url || c.host || '').replace(/\/$/, '');
  const apiToken = String(c.api_token || c.apiToken || c.token || '');
  if (!baseUrl) return null;
  return { baseUrl, apiToken };
}

async function cuckooFetch(creds: CuckooCreds, path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(creds.apiToken ? { Authorization: `Bearer ${creds.apiToken}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${creds.baseUrl}${path}`, { ...init, headers, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function testCuckooConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const creds = parseCuckooCreds({
    id: 't', name: 'cuckoo', type: 'cuckoo', category: 'utility', config, status: 'connected',
  });
  if (!creds) return { ok: false, message: 'url required' };
  const start = Date.now();
  const r = await cuckooFetch(creds, '/cuckoo/status');
  if (!r.ok) {
    const alt = await cuckooFetch(creds, '/tasks/list/0/10');
    if (!alt.ok) return { ok: false, message: `Cuckoo API ${r.status}`, durationMs: Date.now() - start };
  }
  return { ok: true, message: 'Cuckoo Sandbox API connected', durationMs: Date.now() - start };
}

export async function executeCuckoo(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'submit_url';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('cuckoo') || ctx.getIntegration('cuckoo_sandbox');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Cuckoo: not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const creds = parseCuckooCreds(integration);
  if (!creds) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Cuckoo: url required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    if (action === 'submit_url') {
      const targetUrl = resolveTemplate(String(cfg.url || cfg.target || ''), ctx);
      if (!targetUrl) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Cuckoo: url required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const form = new URLSearchParams({ url: targetUrl });
      const r = await cuckooFetch(creds, '/tasks/create/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Cuckoo submit_url failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start, data: r.data });
        return { success: false, logs };
      }
      const taskId = (r.data as { task_id?: number }).task_id;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Cuckoo: submitted URL task_id=${taskId}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { cuckoo: { ok: true, action, task_id: taskId, url: targetUrl } }, logs };
    }

    if (action === 'get_report' || action === 'view_task') {
      const taskId = resolveTemplate(String(cfg.task_id || ''), ctx);
      if (!taskId) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Cuckoo: task_id required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const path = action === 'get_report' ? `/tasks/report/${taskId}/json` : `/tasks/view/${taskId}`;
      const r = await cuckooFetch(creds, path);
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Cuckoo report failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const score = (r.data as { info?: { score?: number } }).info?.score;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Cuckoo: task ${taskId} score=${score ?? 'n/a'}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { cuckoo: { ok: true, action, task_id: taskId, score, report: r.data } }, logs };
    }

    if (action === 'list_tasks') {
      const limit = Number(cfg.limit) || 10;
      const r = await cuckooFetch(creds, `/tasks/list/0/${limit}`);
      if (!r.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Cuckoo list_tasks failed: HTTP ${r.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const tasks = (r.data as { tasks?: unknown[] }).tasks || r.data;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Cuckoo: tasks listed', level: 'success', duration: Date.now() - start });
      return { success: true, output: { cuckoo: { ok: true, action, tasks } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Cuckoo: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Cuckoo error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
