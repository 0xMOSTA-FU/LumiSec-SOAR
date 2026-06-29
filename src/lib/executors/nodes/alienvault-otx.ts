// Real AlienVault OTX executor - query pulses + IOC details via OTX REST API
// Docs: https://otx.alienvault.com/api/v1/

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

export async function callOTX(
  integration: IntegrationConfig | null,
  path: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const api_key = (integration?.config?.api_key as string) || (integration?.config?.key as string) || '';
  // OTX can be queried anonymously for some endpoints, but a key increases rate limit
  if (integration && integration.status !== 'connected') {
    // Allow anonymous queries if no integration, but warn
  }

  try {
    const headers: Record<string, string> = { 'Accept': 'application/json', 'X-OTX-API-KEY': api_key, ...extraHeaders };
    const res = await fetch(`https://otx.alienvault.com/api/v1/${path.replace(/^\//, '')}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) }, durationMs: Date.now() - start };
  }
}

export async function executeOTX(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'lookup_indicator';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('alienvault') || ctx.getIntegration('otx');

  if (action === 'lookup_indicator') {
    const ioc_type_raw = (cfg.ioc_type as string) || 'ip';
    // OTX API expects specific type strings: IPv4, IPv6, domain, hostname,
    // email, url, file (hash), cve. Normalize common alternatives.
    const typeMap: Record<string, string> = {
      ip: 'IPv4',
      ipv4: 'IPv4',
      ipv6: 'IPv6',
      domain: 'domain',
      hostname: 'hostname',
      email: 'email',
      url: 'url',
      hash: 'file',
      file: 'file',
      md5: 'file',
      sha256: 'file',
      cve: 'cve',
    };
    const ioc_type = typeMap[ioc_type_raw.toLowerCase()] || ioc_type_raw;
    const ioc_value = resolveTemplate((cfg.ioc_value as string) || (cfg.value as string) || '', ctx);
    if (!ioc_value) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'OTX: ioc_value required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const section = (cfg.section as string) || 'general';
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OTX: looking up ${ioc_type}="${ioc_value}" (${section})...`, level: 'info' });

    const result = await callOTX(integration, `indicators/${ioc_type}/${encodeURIComponent(ioc_value)}/${section}`);
    if (!result.ok) {
      const err = (result.data as { detail?: string })?.detail || `HTTP ${result.status}`;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OTX error: ${err}`, level: 'error', duration: result.durationMs });
      return { success: false, output: { otx: { ok: false, error: err } }, logs };
    }
    const data = result.data as { pulse_info?: { count?: number; pulses?: { name: string; id: string; tags?: string[] }[] } };
    const pulseCount = data.pulse_info?.count ?? data.pulse_info?.pulses?.length ?? 0;
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `OTX: ${pulseCount} pulses reference ${ioc_type}="${ioc_value}"`,
      level: pulseCount > 0 ? 'warning' : 'success',
      duration: result.durationMs,
      data: { pulse_count: pulseCount },
    });
    return {
      success: true,
      output: {
        otx: {
          ok: true,
          ioc: ioc_value,
          ioc_type: ioc_type,
          pulse_count: pulseCount,
          is_malicious: pulseCount >= 1,
          pulses: data.pulse_info?.pulses?.slice(0, 10),
        },
      },
      logs,
    };
  }

  if (action === 'list_subscribed_pulses') {
    const result = await callOTX(integration, 'pulses/subscribed?limit=20');
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OTX error: HTTP ${result.status}`, level: 'error', duration: result.durationMs });
      return { success: false, output: { otx: { ok: false } }, logs };
    }
    const data = result.data as { results?: { id: string; name: string; description?: string; created?: string }[]; count: number };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OTX: ${data.count} subscribed pulses`, level: 'success', duration: result.durationMs });
    return { success: true, output: { otx: { ok: true, count: data.count, pulses: data.results?.slice(0, 20) } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OTX: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
