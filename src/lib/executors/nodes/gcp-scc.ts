/**
 * GCP Security Command Center (SCC) executor
 * Docs: https://cloud.google.com/security-command-center/docs/reference/rest
 */
import { createSign } from 'crypto';
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

const SCC_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export interface GcpServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export interface GcpSccCreds {
  serviceAccount: GcpServiceAccount;
  organizationId?: string;
  projectId?: string;
}

export function parseGcpServiceAccountJson(raw: unknown): GcpServiceAccount | null {
  if (!raw) return null;
  let parsed: Record<string, unknown>;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return null; }
  } else if (typeof raw === 'object') {
    parsed = raw as Record<string, unknown>;
  } else return null;
  const client_email = String(parsed.client_email || '');
  const private_key = String(parsed.private_key || '').replace(/\\n/g, '\n');
  if (!client_email || !private_key) return null;
  return {
    client_email,
    private_key,
    project_id: parsed.project_id ? String(parsed.project_id) : undefined,
  };
}

export function parseGcpSccCreds(integration: IntegrationConfig | null): GcpSccCreds | null {
  const c = integration?.config || {};
  const sa = parseGcpServiceAccountJson(c.service_account_json || c.serviceAccountJson || c.credentials_json);
  if (!sa) return null;
  return {
    serviceAccount: sa,
    organizationId: String(c.organization_id || c.organizationId || '') || undefined,
    projectId: String(c.project_id || c.projectId || sa.project_id || '') || undefined,
  };
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

async function getGcpAccessToken(sa: GcpServiceAccount): Promise<{ token: string | null; error?: string }> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({
      iss: sa.client_email,
      scope: SCC_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }));
    const signingInput = `${header}.${payload}`;
    const sign = createSign('RSA-SHA256');
    sign.update(signingInput);
    sign.end();
    const signature = sign.sign(sa.private_key, 'base64url');
    const jwt = `${signingInput}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
      cache: 'no-store',
    });
    const data = await res.json() as { access_token?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      return { token: null, error: data.error_description || `HTTP ${res.status}` };
    }
    return { token: data.access_token };
  } catch (err) {
    return { token: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function testGcpSccConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const creds = parseGcpSccCreds({
    id: 'test',
    name: 'gcp',
    type: 'gcp_scc',
    category: 'cloud_iam',
    config,
    status: 'connected',
  });
  if (!creds) return { ok: false, message: 'service_account_json required (valid GCP SA key JSON)' };
  const start = Date.now();
  const { token, error } = await getGcpAccessToken(creds.serviceAccount);
  if (!token) return { ok: false, message: error || 'GCP OAuth failed', durationMs: Date.now() - start };

  const parent = creds.organizationId
    ? `organizations/${creds.organizationId}`
    : creds.projectId
      ? `projects/${creds.projectId}`
      : null;
  if (!parent) {
    return { ok: true, message: 'GCP auth OK (set organization_id or project_id to query SCC)', durationMs: Date.now() - start };
  }

  const url = `https://securitycenter.googleapis.com/v1/${parent}/sources/-/findings?pageSize=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, message: `SCC API ${res.status}: ${body.slice(0, 150)}`, durationMs: Date.now() - start };
  }
  return { ok: true, message: 'GCP Security Command Center connected', durationMs: Date.now() - start };
}

function sccParent(creds: GcpSccCreds): string | null {
  if (creds.organizationId) return `organizations/${creds.organizationId}`;
  if (creds.projectId) return `projects/${creds.projectId}`;
  return null;
}

export async function executeGcpScc(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'list_findings';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('gcp_scc')
    || ctx.getIntegration('security_command_center');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'GCP SCC: not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const creds = parseGcpSccCreds(integration);
  if (!creds) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'GCP SCC: service_account_json required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const parent = sccParent(creds);
  if (!parent) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'GCP SCC: organization_id or project_id required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const { token, error } = await getGcpAccessToken(creds.serviceAccount);
  if (!token) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GCP auth failed: ${error}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const apiBase = 'https://securitycenter.googleapis.com/v1';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

  try {
    if (action === 'list_findings') {
      const pageSize = Math.min(Number(cfg.page_size) || 50, 100);
      const filter = resolveTemplate(String(cfg.filter || ''), ctx);
      let url = `${apiBase}/${parent}/sources/-/findings?pageSize=${pageSize}`;
      if (filter) url += `&filter=${encodeURIComponent(filter)}`;
      const res = await fetch(url, { headers, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GCP SCC list_findings failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
        return { success: false, logs };
      }
      const findings = (data as { listFindingsResults?: unknown[] }).listFindingsResults || [];
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GCP SCC: ${findings.length} finding(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { gcp_scc: { ok: true, action, count: findings.length, findings: findings.slice(0, 20) } }, logs };
    }

    if (action === 'get_finding') {
      const findingName = resolveTemplate(String(cfg.finding_name || ''), ctx);
      if (!findingName) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'GCP SCC: finding_name required (full resource name)', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const path = findingName.startsWith('http') ? findingName.replace(apiBase + '/', '') : findingName.replace(/^\//, '');
      const res = await fetch(`${apiBase}/${path}`, { headers, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GCP SCC get_finding failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'GCP SCC: finding retrieved', level: 'success', duration: Date.now() - start });
      return { success: true, output: { gcp_scc: { ok: true, action, finding: data } }, logs };
    }

    if (action === 'update_finding') {
      const findingName = resolveTemplate(String(cfg.finding_name || ''), ctx);
      const state = resolveTemplate(String(cfg.state || 'INACTIVE'), ctx);
      if (!findingName) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'GCP SCC: finding_name required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const path = findingName.replace(/^\//, '');
      const res = await fetch(`${apiBase}/${path}?updateMask=state`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ state }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GCP SCC update_finding failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GCP SCC: finding state → ${state}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { gcp_scc: { ok: true, action, state, finding: data } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GCP SCC: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `GCP SCC error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
