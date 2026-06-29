// Real Jira executor - create/update/search issues via Jira Cloud REST API
// Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
// Supports: create_issue, update_issue, add_comment, search

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

interface JiraConfig {
  host: string;       // e.g. acme.atlassian.net
  email: string;      // user email
  api_token: string;  // API token
}

function getCreds(integration: IntegrationConfig | null): JiraConfig | null {
  const c = integration?.config || {};
  const host = (c.host as string) || (c.domain as string) || '';
  const email = (c.email as string) || (c.username as string) || '';
  const api_token = (c.api_token as string) || (c.token as string) || (c.password as string) || '';
  if (!host || !api_token) return null;
  return { host: host.replace(/^https?:\/\//, '').replace(/\/$/, ''), email, api_token };
}

export async function callJira(
  integration: IntegrationConfig | null,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const creds = getCreds(integration);
  if (!creds) return { ok: false, status: 401, data: { error: 'Jira credentials missing (host + api_token required)' }, durationMs: 0 };
  if (integration?.status !== 'connected') return { ok: false, status: 503, data: { error: 'Jira not connected' }, durationMs: 0 };

  try {
    const auth = Buffer.from(`${creds.email}:${creds.api_token}`).toString('base64');
    const url = `https://${creds.host}/rest/api/3/${path.replace(/^\//, '')}`;
    const res = await fetch(url, {
      method,
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: { error: msg }, durationMs: Date.now() - start };
  }
}

export async function executeJira(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'create_issue';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('jira');

  if (action === 'create_issue') {
    const project_key = resolveTemplate((cfg.project_key as string) || '', ctx);
    const summary = resolveTemplate((cfg.summary as string) || 'SOAR issue', ctx);
    const description = resolveTemplate((cfg.description as string) || '', ctx);
    const issue_type = (cfg.issue_type as string) || 'Task';
    const priority = (cfg.priority as string) || 'Medium';

    if (!project_key) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Jira: project_key required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Jira: creating ${issue_type} in ${project_key}...`, level: 'info' });

    const result = await callJira(integration, 'POST', 'issue', {
      fields: {
        project: { key: project_key },
        summary,
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] },
        issuetype: { name: issue_type },
        priority: { name: priority },
      },
    });
    if (!result.ok) {
      const err = (result.data as { errorMessages?: string[] })?.errorMessages?.[0] || `HTTP ${result.status}`;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Jira error: ${err}`, level: 'error', duration: result.durationMs, data: result.data });
      return { success: false, output: { jira: { ok: false, error: err } }, logs };
    }
    const issue = result.data as { id: string; key: string; self: string };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Jira: created ${issue.key} (${issue.id})`, level: 'success', duration: result.durationMs, data: { key: issue.key } });
    return { success: true, output: { jira: { ok: true, key: issue.key, id: issue.id, url: `https://${(integration?.config.host as string) || ''}/browse/${issue.key}` } }, logs };
  }

  if (action === 'add_comment') {
    const issue_key = resolveTemplate((cfg.issue_key as string) || '', ctx);
    const comment = resolveTemplate((cfg.comment as string) || '', ctx);
    if (!issue_key || !comment) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Jira: issue_key and comment required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const result = await callJira(integration, 'POST', `issue/${issue_key}/comment`, {
      body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] },
    });
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Jira comment error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, output: { jira: { ok: false } }, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Jira: comment added to ${issue_key}`, level: 'success', duration: result.durationMs });
    return { success: true, output: { jira: { ok: true, issue_key, commented: true } }, logs };
  }

  if (action === 'search') {
    const jql = resolveTemplate((cfg.jql as string) || 'created >= -7d ORDER BY created DESC', ctx);
    const result = await callJira(integration, 'GET', `search?jql=${encodeURIComponent(jql)}&maxResults=${cfg.max_results || 20}`);
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Jira search error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, output: { jira: { ok: false } }, logs };
    }
    const sr = result.data as { total: number; issues: { key: string; fields: { summary: string; status: { name: string } } }[] };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Jira: search returned ${sr.total} issues`, level: 'success', duration: result.durationMs, data: { total: sr.total } });
    return { success: true, output: { jira: { ok: true, total: sr.total, issues: sr.issues?.slice(0, 10) } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Jira: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
