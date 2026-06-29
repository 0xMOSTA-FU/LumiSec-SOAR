// IPInfo.io executor - IP geolocation & ASN info (free tier, no key required for basic)
// Docs: https://ipinfo.io/developers

import { NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

interface IPInfoResponse {
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
  org?: string;
  postal?: string;
  timezone?: string;
  asn?: { asn?: string; name?: string; domain?: string; route?: string; type?: string };
  company?: { name?: string; domain?: string; type?: string };
  abuse?: { address?: string; country?: string; email?: string; network?: string; phone?: string };
  error?: { title: string; message: string };
}

export async function callIPInfo(ip: string, token?: string): Promise<{ ok: boolean; status: number; data: IPInfoResponse | unknown; durationMs: number }> {
  const start = Date.now();
  try {
    const url = token
      ? `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`
      : `https://ipinfo.io/${encodeURIComponent(ip)}/json`;
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    const data: IPInfoResponse = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: { error: { title: 'Network error', message: msg } }, durationMs: Date.now() - start };
  }
}

export async function executeIPInfo(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  let ip = (cfg.ip as string) || (cfg.target as string) || (cfg.ioc_value as string) || '';
  if (ip.includes('{{')) ip = resolveTemplate(ip, ctx);

  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  if (!ip) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'IPInfo: no IP provided', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const integration = ctx.getIntegration('ipinfo');
  const token = (integration?.config?.token as string) || (integration?.config?.api_key as string) || '';

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `IPInfo: looking up "${ip}"...`, level: 'info' });
  const result = await callIPInfo(ip, token);

  if (!result.ok) {
    const errData = result.data as IPInfoResponse;
    const errMsg = errData?.error?.message || `HTTP ${result.status}`;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `IPInfo error: ${errMsg}`, level: 'error', duration: result.durationMs });
    return { success: false, logs, output: { ipinfo: { ok: false, error: errMsg, ip } } };
  }

  const d = (result.data as IPInfoResponse);
  const output = {
    ipinfo: {
      ok: true,
      ip: d.ip,
      city: d.city,
      region: d.region,
      country: d.country,
      loc: d.loc,
      org: d.org,
      asn: d.asn?.asn,
      asn_name: d.asn?.name,
      timezone: d.timezone,
      raw: d,
    },
  };

  logs.push({
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: `IPInfo: ${d.country || '?'}, ${d.city || '?'}, ASN: ${d.asn?.asn || d.org || '?'}`,
    level: 'success',
    duration: result.durationMs,
    data: { country: d.country, asn: d.asn?.asn || d.org },
  });

  return { success: true, output, logs };
}
