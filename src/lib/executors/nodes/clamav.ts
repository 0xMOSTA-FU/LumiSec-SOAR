/**
 * ClamAV — HTTP wrapper (clamav-rest) or version endpoint
 * Docs: https://docs.clamav.net/
 */
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

export function parseClamAvUrl(integration: IntegrationConfig | null): string | null {
  const c = integration?.config || {};
  return String(c.url || c.host || '').replace(/\/$/, '') || null;
}

export async function testClamAvConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const url = String(config.url || config.host || '').replace(/\/$/, '');
  if (!url) return { ok: false, message: 'url required (clamav-rest base URL)' };
  const start = Date.now();
  for (const path of ['/version', '/health', '/']) {
    const res = await fetch(`${url}${path}`, { cache: 'no-store' }).catch(() => null);
    if (res && res.ok) {
      return { ok: true, message: 'ClamAV HTTP endpoint reachable', durationMs: Date.now() - start };
    }
  }
  return { ok: false, message: 'ClamAV endpoint not reachable', durationMs: Date.now() - start };
}

export async function executeClamAv(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'scan_hash';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('clamav');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'ClamAV: not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const baseUrl = parseClamAvUrl(integration);
  if (!baseUrl) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'ClamAV: url required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    if (action === 'scan_hash') {
      const hash = resolveTemplate(String(cfg.hash || cfg.sha256 || ''), ctx);
      if (!hash) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'ClamAV: hash required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const res = await fetch(`${baseUrl}/scan/${encodeURIComponent(hash)}`, { cache: 'no-store' });
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ClamAV scan failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
      const infected = JSON.stringify(data).toLowerCase().includes('found') || JSON.stringify(data).toLowerCase().includes('infected');
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ClamAV: hash ${hash} → ${infected ? 'DETECTED' : 'clean'}`, level: infected ? 'warning' : 'success', duration: Date.now() - start });
      return { success: true, output: { clamav: { ok: true, action, hash, infected, result: data } }, logs };
    }

    if (action === 'scan_url') {
      const fileUrl = resolveTemplate(String(cfg.file_url || cfg.url || ''), ctx);
      if (!fileUrl) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'ClamAV: file_url required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      const res = await fetch(`${baseUrl}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fileUrl }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ClamAV scan failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'ClamAV: URL scan complete', level: 'success', duration: Date.now() - start });
      return { success: true, output: { clamav: { ok: true, action, result: data } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ClamAV: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `ClamAV error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
