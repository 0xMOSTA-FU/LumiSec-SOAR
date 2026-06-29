// External Node.js backend API client.
//
// CONTEXT:
//   The user has a SEPARATE Node.js backend (already built) that exposes
//   REST endpoints. We need to:
//     1. Proxy relevant calls from this Next.js app to that backend
//     2. Merge the responses with our own data
//     3. Push our SOAR events to that backend so it can act on them
//
// CONFIGURATION:
//   Set NEXT_PUBLIC_EXTERNAL_API_URL to the base URL of the external backend
//   (e.g. http://localhost:4000 or https://api.my-soar-backend.com).
//
//   Set EXTERNAL_API_KEY (server-side only) for the shared secret used to
//   authenticate server-to-server calls.
//
// GRACEFUL DEGRADATION:
//   If NEXT_PUBLIC_EXTERNAL_API_URL is not set, every function returns null
//   (or empty arrays) and the main app behaves as if it's standalone.
//   This is by design — the Next.js app must remain fully functional even
//   when the external backend is offline or not yet deployed.

export const EXTERNAL_API_URL = process.env.NEXT_PUBLIC_EXTERNAL_API_URL || '';
export const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || '';

export function isExternalBackendEnabled(): boolean {
  return !!EXTERNAL_API_URL;
}

// Generic request wrapper with timeout + retries
async function externalRequest<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    timeoutMs?: number;
    retries?: number;
  } = {}
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  if (!EXTERNAL_API_URL) {
    return { ok: false, status: 0, data: null, error: 'External backend not configured' };
  }

  const { method = 'GET', body, timeoutMs = 8000, retries = 2 } = options;
  let lastErr: string | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${EXTERNAL_API_URL}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(EXTERNAL_API_KEY ? { 'X-API-Key': EXTERNAL_API_KEY } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timer);

      const text = await res.text();
      let data: unknown = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      if (res.ok) return { ok: true, status: res.status, data: data as T };
      // 4xx = non-retryable
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, status: res.status, data: null, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }
      // 5xx = retry
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err instanceof Error ? err.message : String(err);
    }

    if (attempt < retries) {
      const delay = Math.min(500 * Math.pow(2, attempt), 4000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return { ok: false, status: 0, data: null, error: lastErr };
}

// ============================================================================
// HEALTH & DISCOVERY
// ============================================================================

export interface ExternalBackendInfo {
  name?: string;
  version?: string;
  endpoints?: string[];
  status?: string;
}

export async function getExternalBackendInfo(): Promise<ExternalBackendInfo | null> {
  const r = await externalRequest<ExternalBackendInfo>('/api/info');
  return r.ok ? r.data : null;
}

export async function pingExternalBackend(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  if (!EXTERNAL_API_URL) return { ok: false, latencyMs: 0, error: 'Not configured' };
  const start = Date.now();
  const r = await externalRequest('/api/health', { timeoutMs: 3000, retries: 0 });
  return { ok: r.ok, latencyMs: Date.now() - start, error: r.error };
}

// ============================================================================
// INCIDENTS (read from external backend, merge with our cases)
// ============================================================================

export interface ExternalIncident {
  id: string;
  title: string;
  description?: string;
  severity?: string;
  status?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  soarCaseId?: string;
  tags?: string[];
  artifacts?: unknown[];
  timeline?: { time: string; event: string }[];
  raw?: unknown;
}

export async function listExternalIncidents(limit = 50): Promise<ExternalIncident[]> {
  const r = await externalRequest<{ data?: ExternalIncident[] } | ExternalIncident[]>(`/api/incidents?limit=${limit}`);
  if (!r.ok || !r.data) return [];
  // Backend may return either a paginated wrapper {data: [...]} or a bare array
  if (Array.isArray(r.data)) return r.data;
  if (Array.isArray((r.data as { data?: ExternalIncident[] }).data)) {
    return (r.data as { data: ExternalIncident[] }).data;
  }
  return [];
}

export async function getExternalIncident(id: string): Promise<ExternalIncident | null> {
  const r = await externalRequest<ExternalIncident>(`/api/incidents/${id}`);
  return r.ok ? r.data : null;
}

/** Merge helper — external incident by soarCaseId or same id */
export async function findExternalIncidentForSoar(soarId: string): Promise<ExternalIncident | null> {
  const direct = await getExternalIncident(soarId);
  if (direct) return direct;
  const list = await listExternalIncidents(100);
  return list.find(i => (i as ExternalIncident & { soarCaseId?: string }).soarCaseId === soarId) || null;
}

// Push a SOAR case to the external backend (so it knows about our incidents)
export async function pushCaseToExternal(caseData: {
  externalId?: string;
  title: string;
  description?: string;
  severity: string;
  status: string;
  source: string;
  soarCaseId: string;
}): Promise<{ ok: boolean; externalId?: string; error?: string }> {
  const r = await externalRequest<{ id?: string }>('/api/incidents', {
    method: 'POST',
    body: caseData,
  });
  return { ok: r.ok, externalId: r.data?.id, error: r.error };
}

// ============================================================================
// ASSETS (CMDB-style reads from external backend)
// ============================================================================

export interface ExternalAsset {
  id: string;
  hostname: string;
  ip?: string;
  type?: string;
  os?: string;
  location?: string;
  criticality?: string;
  tags?: string[];
}

export async function listExternalAssets(): Promise<ExternalAsset[]> {
  const r = await externalRequest<{ data?: ExternalAsset[] } | ExternalAsset[]>('/api/assets');
  if (!r.ok || !r.data) return [];
  if (Array.isArray(r.data)) return r.data;
  if (Array.isArray((r.data as { data?: ExternalAsset[] }).data)) {
    return (r.data as { data: ExternalAsset[] }).data;
  }
  return [];
}

// ============================================================================
// THREAT INTEL (external backend may have its own intel feeds)
// ============================================================================

export interface ExternalThreatIntel {
  id: string;
  ioc: string;
  ioc_type: string;
  verdict?: string;
  confidence?: number;
  source?: string;
  tags?: string[];
  first_seen?: string;
  last_seen?: string;
}

export async function lookupExternalThreatIntel(ioc: string): Promise<ExternalThreatIntel | null> {
  const r = await externalRequest<ExternalThreatIntel>(`/api/threat-intel/lookup?ioc=${encodeURIComponent(ioc)}`);
  return r.ok ? r.data : null;
}

// ============================================================================
// SOAR EVENT FORWARDING (push our workflow executions / alerts to external)
// ============================================================================

export async function forwardSoarEvent(event: {
  type:
    | 'workflow_executed'
    | 'alert_created'
    | 'case_created'
    | 'case_updated'
    | 'integration_tested'
    | 'incident_action_executed';
  payload: unknown;
  ts: string;
}): Promise<{ ok: boolean; error?: string }> {
  const r = await externalRequest('/api/soar-events', { method: 'POST', body: event });
  return { ok: r.ok, error: r.error };
}

// ============================================================================
// GENERIC PROXY (for ad-hoc endpoints)
// ============================================================================

export async function proxyExternalGet<T = unknown>(path: string): Promise<{ ok: boolean; data: T | null; error?: string }> {
  const r = await externalRequest<T>(path);
  return { ok: r.ok, data: r.data, error: r.error };
}

export async function proxyExternalPost<T = unknown>(path: string, body: unknown): Promise<{ ok: boolean; data: T | null; error?: string }> {
  const r = await externalRequest<T>(path, { method: 'POST', body });
  return { ok: r.ok, data: r.data, error: r.error };
}
