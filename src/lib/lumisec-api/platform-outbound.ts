/**
 * LumiSec monolith client — real HTTP to GRC / UCTC / Phishing / LumiNet modules.
 * Uses LUMISEC_PLATFORM_URL (full monolith), NOT the mini SOAR backend stubs.
 */
import { SOAR_INTERNAL_API_KEY } from '@/lib/soar-api/node-proxy';
import { recordPlatformIntegrationCall } from '@/lib/mongo';

/** Full LumiSec monolith (GRC, UCTC, Phishing, LumiNet). Never mini-services stubs. */
export const PLATFORM_API_URL =
  process.env.LUMISEC_PLATFORM_URL ||
  process.env.LUMISEC_API_URL ||
  process.env.NEXT_PUBLIC_LUMISEC_API_URL ||
  process.env.NEXT_PUBLIC_LUMISEC_PLATFORM_URL ||
  '';

export const PLATFORM_INTERNAL_KEY =
  process.env.LUMISEC_INTERNAL_API_KEY ||
  process.env.SERVICE_API_KEY ||
  process.env.SOAR_INTERNAL_API_KEY ||
  SOAR_INTERNAL_API_KEY;

export function isPlatformOutboundConfigured(): boolean {
  return Boolean(PLATFORM_API_URL?.trim());
}

export interface PlatformEnvelope<T = unknown> {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
  pagination?: { page: number; limit: number; total: number; pages: number };
}

export interface PlatformCallResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
  route?: string;
}

export async function platformFetch<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    jwt?: string | null;
    timeoutMs?: number;
    audit?: { module: string; action: string; incidentId?: string };
  } = {},
): Promise<PlatformCallResult<T>> {
  if (!isPlatformOutboundConfigured()) {
    return {
      ok: false,
      status: 501,
      data: null,
      message:
        'LumiSec platform URL not configured. Set LUMISEC_PLATFORM_URL to the monolith (e.g. http://localhost:4000).',
      route: path,
    };
  }

  const { method = 'GET', body, jwt, timeoutMs = 25000, audit } = options;
  const base = PLATFORM_API_URL.replace(/\/$/, '');
  const url = `${base}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    if (PLATFORM_INTERNAL_KEY) {
      headers['X-Internal-Api-Key'] = PLATFORM_INTERNAL_KEY;
      headers['x-service-key'] = PLATFORM_INTERNAL_KEY;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);

    const text = await res.text();
    let parsed: PlatformEnvelope<T> | T | null = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    const envelope = parsed as PlatformEnvelope<T> | null;
    const data =
      envelope && typeof envelope === 'object' && envelope.data !== undefined
        ? envelope.data
        : (parsed as T | null);
    const message =
      (envelope && typeof envelope === 'object' && (envelope.message || envelope.error)) ||
      (res.ok ? 'Request completed' : text.slice(0, 400) || `HTTP ${res.status}`);

    const result: PlatformCallResult<T> = {
      ok: res.ok,
      status: res.status,
      data: data ?? null,
      message: String(message),
      route: path,
    };

    if (audit) {
      void recordPlatformIntegrationCall({
        module: audit.module,
        action: audit.action,
        incidentId: audit.incidentId,
        method,
        path,
        status: res.status,
        success: res.ok,
        durationMs: Date.now() - started,
        requestBody: body,
        responseBody: data ?? text.slice(0, 2000),
      });
    }

    return result;
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    const result: PlatformCallResult<T> = {
      ok: false,
      status: 502,
      data: null,
      message: `Platform unreachable: ${message}`,
      route: path,
    };
    if (audit) {
      void recordPlatformIntegrationCall({
        module: audit.module,
        action: audit.action,
        incidentId: audit.incidentId,
        method,
        path,
        status: 502,
        success: false,
        durationMs: Date.now() - started,
        requestBody: body,
        responseBody: { error: message },
      });
    }
    return result;
  }
}

export async function pingPlatformModules(): Promise<{
  ok: boolean;
  baseUrl: string;
  modules: Record<string, { ok: boolean; message?: string }>;
}> {
  const modules: Record<string, { ok: boolean; message?: string }> = {};
  const checks: Array<[string, string]> = [
    ['health', '/api/health'],
    ['soar', '/api/soar/dashboard/overview'],
    ['grc', '/api/grc/dashboard/overview'],
    ['uctc', '/api/uctc/dashboard/stats'],
    ['phishing', '/api/phishing/dashboard/overview'],
    ['network', '/api/luminet/assets/inventory?limit=1'],
  ];

  await Promise.all(
    checks.map(async ([name, path]) => {
      const r = await platformFetch(path, { timeoutMs: 8000 });
      modules[name] = { ok: r.ok, message: r.ok ? undefined : r.message };
    }),
  );

  const ok = modules.health?.ok === true;
  return { ok, baseUrl: PLATFORM_API_URL, modules };
}

function pickString(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = body[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export function mapGrcFindingPayload(body: Record<string, unknown>): Record<string, unknown> {
  const incidentId = pickString(body, 'incidentId', 'incident_id', 'sourceId', 'source_id');
  const sourceModule = pickString(body, 'sourceModule', 'source_module') || 'soar';
  return {
    title: pickString(body, 'title') || 'SOAR finding',
    description: pickString(body, 'description'),
    severity: pickString(body, 'severity') || 'medium',
    asset: pickString(body, 'asset', 'affectedAsset', 'affected_asset', 'affectedHost', 'affected_host', 'ip'),
    sourceModule,
    sourceId: incidentId || pickString(body, 'sourceId', 'source_id'),
    incidentId,
    createRisk: body.createRisk === true || body.create_risk === true,
  };
}

export function mapGrcRiskPayload(body: Record<string, unknown>): Record<string, unknown> {
  const incidentId = pickString(body, 'incidentId', 'incident_id', 'sourceId', 'source_id');
  return {
    title: pickString(body, 'title') || 'SOAR risk',
    description: pickString(body, 'description'),
    severity: pickString(body, 'severity') || 'medium',
    likelihood: pickString(body, 'likelihood') || 'medium',
    impact: pickString(body, 'impact') || 'medium',
    asset: pickString(body, 'asset', 'affectedAsset', 'affected_asset'),
    sourceModule: pickString(body, 'sourceModule', 'source_module') || 'soar',
    sourceId: incidentId,
    incidentId,
  };
}

export function mapUctcRulePayload(body: Record<string, unknown>): Record<string, unknown> {
  const ruleId = pickString(body, 'ruleId', 'rule_id', 'id');
  return {
    ruleId,
    id: ruleId,
    name: pickString(body, 'name', 'title'),
    description: pickString(body, 'description'),
    yaml: pickString(body, 'yaml', 'sigmaYaml', 'sigma_yaml', 'content'),
    ruleType: pickString(body, 'ruleType', 'rule_type', 'type'),
    enabled: body.enabled !== false,
    incidentId: pickString(body, 'incidentId', 'incident_id'),
  };
}

export function mapUctcTriggerPayload(body: Record<string, unknown>): Record<string, unknown> {
  const ruleId = pickString(body, 'ruleId', 'rule_id', 'id');
  return {
    ruleId,
    id: ruleId,
    incidentId: pickString(body, 'incidentId', 'incident_id'),
    context: body.context,
  };
}

export function mapPhishingCampaignPayload(body: Record<string, unknown>): Record<string, unknown> {
  return {
    name: pickString(body, 'name', 'campaignName', 'campaign_name') || 'SOAR-linked campaign',
    description: pickString(body, 'description'),
    templateId: pickString(body, 'templateId', 'template_id'),
    landingPageId: pickString(body, 'landingPageId', 'landing_page_id'),
    incidentId: pickString(body, 'incidentId', 'incident_id'),
    campaignId: pickString(body, 'campaignId', 'campaign_id'),
    launchDate: pickString(body, 'launchDate', 'launch_date', 'startDate', 'start_date'),
    targetGroup: pickString(body, 'targetGroup', 'target_group', 'department'),
    autoLaunch: body.autoLaunch === true || body.auto_launch === true,
  };
}

function normalizePlatformSuccess(
  result: PlatformCallResult<Record<string, unknown>>,
  module: string,
  action: string,
): PlatformCallResult {
  if (!result.ok) return result;
  const data = result.data || {};
  return {
    ...result,
    message: result.message || `${module} ${action} completed`,
    data: {
      ...data,
      reference:
        data.reference ||
        data._id ||
        data.id ||
        data.finding_id ||
        data.risk_id ||
        data.rule_id ||
        data.campaign_id,
    },
  };
}

/** Native monolith module routes (when SOAR integration shim returns 501/404). */
async function callNativeModuleApi(
  module: 'grc' | 'uctc' | 'phishing',
  action: string,
  payload: Record<string, unknown>,
  jwt?: string | null,
): Promise<PlatformCallResult | null> {
  const incidentId = pickString(payload, 'incidentId', 'incident_id');
  const audit = { module, action, incidentId };

  if (module === 'grc' && action === 'finding') {
    return normalizePlatformSuccess(
      await platformFetch('/api/grc/findings', { method: 'POST', body: payload, jwt, audit }),
      module,
      action,
    );
  }

  if (module === 'grc' && action === 'risk') {
    return normalizePlatformSuccess(
      await platformFetch('/api/grc/risks', { method: 'POST', body: payload, jwt, audit }),
      module,
      action,
    );
  }

  if (module === 'uctc' && action === 'rule') {
    const ruleId = pickString(payload, 'ruleId', 'rule_id', 'id');
    if (ruleId) {
      return normalizePlatformSuccess(
        await platformFetch(`/api/uctc/rules/${encodeURIComponent(ruleId)}/deploy`, {
          method: 'POST',
          body: payload,
          jwt,
          audit,
        }),
        module,
        action,
      );
    }
    const yaml = pickString(payload, 'yaml', 'sigmaYaml', 'content');
    if (yaml) {
      return normalizePlatformSuccess(
        await platformFetch('/api/uctc/rules', {
          method: 'POST',
          body: { ...payload, yaml, title: payload.name, content: yaml },
          jwt,
          audit,
        }),
        module,
        action,
      );
    }
    return null;
  }

  if (module === 'uctc' && (action === 'rule-trigger' || action === 'rule_trigger')) {
    const ruleId = pickString(payload, 'ruleId', 'rule_id', 'id');
    if (!ruleId) return null;
    return normalizePlatformSuccess(
      await platformFetch(`/api/uctc/rules/${encodeURIComponent(ruleId)}/deploy`, {
        method: 'POST',
        body: payload,
        jwt,
        audit,
      }),
      module,
      action,
    );
  }

  if (module === 'phishing' && action === 'campaign') {
    const created = await platformFetch<Record<string, unknown>>('/api/phishing/campaigns', {
      method: 'POST',
      body: payload,
      jwt,
      audit,
    });
    if (!created.ok) return normalizePlatformSuccess(created, module, action);

    const campaignId = String(created.data?._id || created.data?.id || '');
    if (payload.autoLaunch === true && campaignId) {
      const launched = await platformFetch(`/api/phishing/campaigns/${encodeURIComponent(campaignId)}/launch`, {
        method: 'POST',
        body: {},
        jwt,
        audit: { module, action: 'launch', incidentId },
      });
      if (!launched.ok) {
        return {
          ...normalizePlatformSuccess(created, module, action),
          message: `Campaign created (${campaignId}) but launch failed: ${launched.message}`,
        };
      }
    }
    return normalizePlatformSuccess(created, module, action);
  }

  return null;
}

export async function callPlatformOutbound(
  module: 'grc' | 'uctc' | 'phishing',
  action: string,
  body: Record<string, unknown>,
  jwt?: string | null,
): Promise<PlatformCallResult> {
  let payload = { ...body };
  if (module === 'grc' && action === 'finding') payload = mapGrcFindingPayload(body);
  if (module === 'grc' && action === 'risk') payload = mapGrcRiskPayload(body);
  if (module === 'uctc' && action === 'rule') payload = mapUctcRulePayload(body);
  if (module === 'uctc' && (action === 'rule-trigger' || action === 'rule_trigger')) {
    payload = mapUctcTriggerPayload(body);
  }
  if (module === 'phishing' && action === 'campaign') payload = mapPhishingCampaignPayload(body);

  const incidentId = pickString(payload, 'incidentId', 'incident_id');
  const soarPath = `/api/soar/integrations/${module}/${action}`;
  const soarResult = await platformFetch<Record<string, unknown>>(soarPath, {
    method: 'POST',
    body: payload,
    jwt,
    audit: { module, action, incidentId },
  });

  if (soarResult.ok) {
    return normalizePlatformSuccess(soarResult, module, action);
  }

  if (soarResult.status === 404 || soarResult.status === 501 || soarResult.status === 410) {
    const native = await callNativeModuleApi(module, action, payload, jwt);
    if (native) return native;
  }

  return soarResult;
}

export async function fetchPlatformLookup<T = unknown>(
  path: string,
  jwt?: string | null,
): Promise<PlatformCallResult<T[]>> {
  const r = await platformFetch<T[] | { items?: T[] }>(path, { jwt });
  if (!r.ok) return r as PlatformCallResult<T[]>;

  const data = r.data;
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { items?: T[] }).items)
      ? (data as { items: T[] }).items
      : [];

  return { ...r, data: list };
}
