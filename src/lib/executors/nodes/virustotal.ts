// Real VirusTotal API executor
// Docs: https://docs.virustotal.com/reference/api
// Supports: ip, hash (file), domain, url lookups

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

interface VTResponse {
  data?: {
    attributes?: {
      last_analysis_stats?: { malicious: number; suspicious: number; harmless: number; undetected: number };
      reputation?: number;
      categories?: Record<string, string>;
      country?: string;
      asn?: number;
      as_owner?: string;
      last_modification_date?: number;
    };
    id?: string;
    type?: string;
  };
  error?: { code: string; message: string };
}

export async function callVirusTotal(
  integration: IntegrationConfig | null,
  endpoint: string
): Promise<{ ok: boolean; status: number; data: VTResponse | unknown; durationMs: number }> {
  const start = Date.now();
  const apiKey = (integration?.config?.api_key as string) || (integration?.config?.apiKey as string) || '';
  if (!apiKey) {
    return { ok: false, status: 401, data: { error: { code: 'NO_API_KEY', message: 'No VirusTotal API key configured' } }, durationMs: Date.now() - start };
  }
  if (!integration || integration.status !== 'connected') {
    return { ok: false, status: 503, data: { error: { code: 'NOT_CONNECTED', message: 'VirusTotal integration is not connected' } }, durationMs: Date.now() - start };
  }

  try {
    const res = await fetch(`https://www.virustotal.com/api/v3/${endpoint.replace(/^\//, '')}`, {
      method: 'GET',
      headers: {
        'x-apikey': apiKey,
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });
    const data: VTResponse = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: { error: { code: 'NETWORK_ERROR', message: msg } }, durationMs: Date.now() - start };
  }
}

export async function executeVirusTotal(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const iocType = (cfg.ioc_type as string) || (cfg.type as string) || 'ip';
  let iocValue = (cfg.ioc_value as string) || (cfg.value as string) || (cfg.target as string) || '';

  // Resolve template if ioc_value uses {{...}}
  if (iocValue.includes('{{')) {
    iocValue = resolveTemplate(iocValue, ctx);
  }

  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  if (!iocValue) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'VirusTotal: no IOC value provided', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const integration = ctx.getIntegration('virustotal');
  let endpoint = '';
  switch (iocType) {
    case 'ip':
      endpoint = `ip_addresses/${encodeURIComponent(iocValue)}`;
      break;
    case 'hash':
    case 'file':
      endpoint = `files/${encodeURIComponent(iocValue)}`;
      break;
    case 'domain':
      endpoint = `domains/${encodeURIComponent(iocValue)}`;
      break;
    case 'url': {
      // URL lookup requires base64(url) without padding
      const b64 = Buffer.from(iocValue).toString('base64').replace(/=/g, '');
      endpoint = `urls/${b64}`;
      break;
    }
    default:
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `VirusTotal: unknown ioc_type "${iocType}"`, level: 'error', duration: Date.now() - start });
      return { success: false, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `VirusTotal: querying ${iocType} "${iocValue}"...`, level: 'info' });

  const result = await callVirusTotal(integration, endpoint);

  if (!result.ok) {
    const errData = result.data as { error?: { message?: string; code?: string } };
    const errMsg = errData?.error?.message || `HTTP ${result.status}`;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `VirusTotal error: ${errMsg}`, level: 'error', duration: result.durationMs, data: result.data });
    return { success: false, logs, output: { virustotal: { ok: false, error: errMsg, ioc: iocValue, ioc_type: iocType } } };
  }

  const vtData = (result.data as VTResponse).data;
  const attrs = vtData?.attributes;
  const stats = attrs?.last_analysis_stats;
  const malicious = (stats?.malicious || 0) + (stats?.suspicious || 0);
  const total = malicious + (stats?.harmless || 0) + (stats?.undetected || 0);
  const score = total > 0 ? Math.round((malicious / total) * 100) : 0;

  const output = {
    virustotal: {
      ok: true,
      ioc: iocValue,
      ioc_type: iocType,
      vt_id: vtData?.id,
      malicious,
      suspicious: stats?.suspicious || 0,
      harmless: stats?.harmless || 0,
      undetected: stats?.undetected || 0,
      total,
      score,
      reputation: attrs?.reputation,
      country: attrs?.country,
      as_owner: attrs?.as_owner,
      asn: attrs?.asn,
      is_malicious: malicious >= 3,
      raw: vtData,
    },
  };

  logs.push({
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: `VirusTotal: ${malicious}/${total} engines flagged as malicious (score=${score}%)`,
    level: malicious >= 3 ? 'warning' : 'success',
    duration: result.durationMs,
    data: { malicious, total, score, is_malicious: malicious >= 3 },
  });

  return { success: true, output, logs };
}
