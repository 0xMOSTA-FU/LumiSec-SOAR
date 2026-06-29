/**
 * LumiSec production SOAR API client (colleague backend).
 *
 * Contract: docs/soar/reference/SOAR_API_Reference.md
 * Postman:  docs/soar/reference/LumiSec_SOAR.postman_collection.json
 *
 * All routes live under `/api/soar/*` on the API gateway (not this Next app's
 * local Prisma routes). Service calls use X-Internal-Api-Key when JWT is absent.
 */
import type { IncidentActionResult, ResponseActionId } from '@/lib/incidents/types';
import type { IncidentContext } from '@/lib/incidents/types';

import {
  LUMISEC_API_URL as LEGACY_URL,
  LUMISEC_INTERNAL_API_KEY as LEGACY_KEY,
  isLumisecBackendEnabled as legacyIsEnabled,
} from '@/lib/lumisec-api/config';

export const LUMISEC_API_URL = LEGACY_URL;
export const LUMISEC_INTERNAL_API_KEY = LEGACY_KEY;

export function isLumisecBackendEnabled(): boolean {
  return legacyIsEnabled();
}

export interface LumisecApiEnvelope<T = unknown> {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
}

async function lumisecRequest<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    jwt?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<{ ok: boolean; status: number; data: T | null; message?: string }> {
  if (!LUMISEC_API_URL) {
    return { ok: false, status: 0, data: null, message: 'LUMISEC_API_URL not configured' };
  }

  const { method = 'GET', body, jwt, timeoutMs = 15000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    if (LUMISEC_INTERNAL_API_KEY) {
      headers['X-Internal-Api-Key'] = LUMISEC_INTERNAL_API_KEY;
      headers['x-service-key'] = LUMISEC_INTERNAL_API_KEY;
    }

    const res = await fetch(`${LUMISEC_API_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);

    const text = await res.text();
    let parsed: LumisecApiEnvelope<T> | T | null = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text as unknown as T;
    }

    const envelope = parsed as LumisecApiEnvelope<T>;
    const data = (envelope?.data !== undefined ? envelope.data : parsed) as T | null;
    const message = envelope?.message || envelope?.error || (res.ok ? undefined : text.slice(0, 300));

    return { ok: res.ok, status: res.status, data, message };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: null, message };
  }
}

export async function pingLumisecBackend(): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
  const start = Date.now();
  const r = await lumisecRequest('/api/soar/docs/openapi.json', { timeoutMs: 5000 });
  return { ok: r.ok, latencyMs: Date.now() - start, message: r.message };
}

export async function lumisecBlockIp(payload: {
  ip: string;
  incidentId: string;
  comment?: string;
}): Promise<{ ok: boolean; message: string }> {
  const r = await lumisecRequest('/api/soar/integrations/firewall/block-ip', {
    method: 'POST',
    body: {
      ip: payload.ip,
      incidentId: payload.incidentId,
      comment: payload.comment || 'SOAR automated block',
    },
  });
  return { ok: r.ok, message: r.message || (r.ok ? `Blocked ${payload.ip}` : 'Firewall block failed') };
}

export async function lumisecIsolateHost(payload: {
  host: string;
  incidentId: string;
  os?: 'linux' | 'windows';
  via?: 'edr' | 'network';
}): Promise<{ ok: boolean; message: string }> {
  const path = payload.via === 'network'
    ? '/api/soar/integrations/network/isolate-host'
    : '/api/soar/integrations/edr/isolate-host';
  const r = await lumisecRequest(path, {
    method: 'POST',
    body: {
      host: payload.host,
      incidentId: payload.incidentId,
      os: payload.os || 'linux',
    },
  });
  return { ok: r.ok, message: r.message || (r.ok ? `Isolated ${payload.host}` : 'Host isolation failed') };
}

export async function lumisecRunIncidentPlaybook(
  incidentId: string,
  body: Record<string, unknown> = {},
): Promise<{ ok: boolean; message: string; runId?: string }> {
  const r = await lumisecRequest<{ _id?: string; id?: string }>(
    `/api/soar/incidents/${encodeURIComponent(incidentId)}/playbooks/run`,
    { method: 'POST', body },
  );
  const runId = r.data?._id || r.data?.id;
  return {
    ok: r.ok,
    message: r.message || (r.ok ? 'Playbook run started' : 'Playbook run failed'),
    runId,
  };
}

export async function lumisecPatchIncident(
  incidentId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  const r = await lumisecRequest(`/api/soar/incidents/${encodeURIComponent(incidentId)}`, {
    method: 'PATCH',
    body: patch,
  });
  return { ok: r.ok, message: r.message || (r.ok ? 'Incident updated' : 'Incident update failed') };
}

export async function lumisecCloseIncident(incidentId: string): Promise<{ ok: boolean; message: string }> {
  const r = await lumisecRequest(`/api/soar/incidents/${encodeURIComponent(incidentId)}/close`, {
    method: 'PATCH',
    body: {},
  });
  return { ok: r.ok, message: r.message || (r.ok ? 'Incident closed' : 'Close failed') };
}

const LUMISEC_DELEGATED: Set<ResponseActionId> = new Set([
  'block_ip',
  'isolate_host',
  'run_enrichment_playbook',
  'mark_investigating',
  'mark_contained',
]);

export function shouldDelegateActionToLumisec(actionId: ResponseActionId): boolean {
  return isLumisecBackendEnabled() && LUMISEC_DELEGATED.has(actionId);
}

export async function runLumisecIncidentAction(
  actionId: ResponseActionId,
  incident: IncidentContext,
  params: Record<string, unknown> = {},
): Promise<IncidentActionResult | null> {
  if (!shouldDelegateActionToLumisec(actionId)) return null;

  const incidentId = String(params.lumisecIncidentId || incident.id);
  const now = new Date().toISOString();

  if (actionId === 'block_ip') {
    const ip = String(params.ip || incident.ips[0] || '');
    const result = await lumisecBlockIp({ ip, incidentId });
    return {
      ok: result.ok,
      message: result.message,
      actionId,
      logs: [{ time: now, message: result.message, level: result.ok ? 'success' : 'error' }],
      statusUpdated: result.ok ? 'investigating' : undefined,
    };
  }

  if (actionId === 'isolate_host') {
    const host = String(params.hostname || params.host || incident.hostnames[0] || incident.ips[0] || '');
    const result = await lumisecIsolateHost({
      host,
      incidentId,
      os: (params.os as 'linux' | 'windows') || 'linux',
      via: incident.hostnames.length ? 'edr' : 'network',
    });
    return {
      ok: result.ok,
      message: result.message,
      actionId,
      logs: [{ time: now, message: result.message, level: result.ok ? 'success' : 'error' }],
      statusUpdated: result.ok ? 'contained' : undefined,
    };
  }

  if (actionId === 'run_enrichment_playbook') {
    const result = await lumisecRunIncidentPlaybook(incidentId, {
      ip: params.ip || incident.ips[0],
      hash: params.hash || incident.hashes[0],
      playbookId: params.playbook_id || params.workflow_id,
    });
    return {
      ok: result.ok,
      message: result.message,
      actionId,
      logs: [{ time: now, message: result.message, level: result.ok ? 'info' : 'error' }],
      executionId: result.runId,
      statusUpdated: result.ok ? 'investigating' : undefined,
    };
  }

  if (actionId === 'mark_investigating') {
    const result = await lumisecPatchIncident(incidentId, { status: 'investigating' });
    return {
      ok: result.ok,
      message: result.message,
      actionId,
      logs: [],
      statusUpdated: result.ok ? 'investigating' : undefined,
    };
  }

  if (actionId === 'mark_contained') {
    const result = await lumisecPatchIncident(incidentId, { status: 'contained' });
    return {
      ok: result.ok,
      message: result.message,
      actionId,
      logs: [],
      statusUpdated: result.ok ? 'contained' : undefined,
    };
  }

  return null;
}
