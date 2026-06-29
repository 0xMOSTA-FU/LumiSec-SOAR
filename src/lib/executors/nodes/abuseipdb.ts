// Real AbuseIPDB executor - checks IP reputation
// Docs: https://www.abuseipdb.com/api

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

interface AbuseIPDBResponse {
  data?: {
    ipAddress?: string;
    abuseConfidenceScore?: number;
    countryCode?: string;
    usageType?: string;
    isp?: string;
    domain?: string;
    totalReports?: number;
    numDistinctUsers?: number;
    isPublic?: boolean;
  };
  errors?: Array<{ detail: string; status: number }>;
}

export async function callAbuseIPDB(
  integration: IntegrationConfig | null,
  ip: string
): Promise<{ ok: boolean; status: number; data: AbuseIPDBResponse | unknown; durationMs: number }> {
  const start = Date.now();
  const apiKey = (integration?.config?.api_key as string) || (integration?.config?.apiKey as string) || '';
  if (!apiKey) {
    return { ok: false, status: 401, data: { errors: [{ detail: 'No AbuseIPDB API key configured', status: 401 }] }, durationMs: Date.now() - start };
  }
  if (!integration || integration.status !== 'connected') {
    return { ok: false, status: 503, data: { errors: [{ detail: 'AbuseIPDB integration is not connected', status: 503 }] }, durationMs: Date.now() - start };
  }
  try {
    const url = `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Key': apiKey, 'Accept': 'application/json' },
      cache: 'no-store',
    });
    const data: AbuseIPDBResponse = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: { errors: [{ detail: msg, status: 0 }] }, durationMs: Date.now() - start };
  }
}

export async function executeAbuseIPDB(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  let ip = (cfg.ip as string) || (cfg.target as string) || (cfg.ioc_value as string) || '';
  if (ip.includes('{{')) ip = resolveTemplate(ip, ctx);

  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  if (!ip) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'AbuseIPDB: no IP provided', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `AbuseIPDB: checking IP "${ip}"...`, level: 'info' });

  const integration = ctx.getIntegration('abuseipdb');
  const apiKey =
    (integration?.config?.api_key as string) ||
    (integration?.config?.apiKey as string) ||
    '';

  if (!apiKey) {
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: 'AbuseIPDB: skipped — no API key (optional integration)',
      level: 'warning',
      duration: Date.now() - start,
    });
    return {
      success: true,
      logs,
      output: {
        abuseipdb: {
          ok: false,
          skipped: true,
          error: 'No AbuseIPDB API key configured',
          ip,
        },
      },
    };
  }

  const result = await callAbuseIPDB(integration, ip);

  if (!result.ok) {
    const errData = result.data as AbuseIPDBResponse;
    const errMsg = errData?.errors?.[0]?.detail || `HTTP ${result.status}`;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `AbuseIPDB error: ${errMsg}`, level: 'error', duration: result.durationMs });
    return { success: false, logs, output: { abuseipdb: { ok: false, error: errMsg, ip } } };
  }

  const d = (result.data as AbuseIPDBResponse).data!;
  const score = d.abuseConfidenceScore || 0;
  const isMalicious = score >= 50;
  const output = {
    abuseipdb: {
      ok: true,
      ip: d.ipAddress,
      abuse_score: score,
      country: d.countryCode,
      usage_type: d.usageType,
      isp: d.isp,
      domain: d.domain,
      total_reports: d.totalReports,
      distinct_users: d.numDistinctUsers,
      is_malicious: isMalicious,
      raw: d,
    },
  };

  logs.push({
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: `AbuseIPDB: confidence=${score}%, reports=${d.totalReports}, ${isMalicious ? 'MALICIOUS' : 'clean'}`,
    level: isMalicious ? 'warning' : 'success',
    duration: result.durationMs,
    data: { abuse_score: score, total_reports: d.totalReports },
  });

  return { success: true, output, logs };
}
