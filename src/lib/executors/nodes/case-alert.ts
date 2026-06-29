// Create Case / Create Alert executors - write to DB via ctx callbacks

import { NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

export async function executeCreateCase(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  let title = (cfg.title as string) || 'Untitled Case';
  const description = (cfg.description as string) || '';
  const severity = (cfg.severity as string) || 'medium';
  const tags = Array.isArray(cfg.tags) ? cfg.tags : (typeof cfg.tags === 'string' ? cfg.tags.split(',').map((s: string) => s.trim()) : []);

  title = resolveTemplate(title, ctx);

  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  if (!ctx.createCase) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'CreateCase: DB callback not available', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    // Collect artifacts from upstream outputs (look for IPs, hashes, domains)
    const artifacts: unknown[] = [];
    for (const [nodeId, out] of Object.entries(ctx.outputs)) {
      if (!out || typeof out !== 'object') continue;
      const o = out as Record<string, unknown>;
      // VT output
      if (o.virustotal) {
        const vt = o.virustotal as Record<string, unknown>;
        artifacts.push({ type: vt.ioc_type, value: vt.ioc, source: 'VirusTotal', malicious: vt.is_malicious });
      }
      if (o.abuseipdb) {
        const ab = o.abuseipdb as Record<string, unknown>;
        artifacts.push({ type: 'ip', value: ab.ip, source: 'AbuseIPDB', abuse_score: ab.abuse_score });
      }
      if (o.ipinfo) {
        const ipi = o.ipinfo as Record<string, unknown>;
        artifacts.push({ type: 'ip', value: ipi.ip, source: 'IPInfo', country: ipi.country, asn: ipi.asn });
      }
      void nodeId;
    }

    const caseId = await ctx.createCase({
      title,
      description: description || `Auto-created by workflow execution. Triggered by: ${JSON.stringify(ctx.trigger).slice(0, 200)}`,
      severity,
      tags: JSON.stringify(tags),
      artifacts: JSON.stringify(artifacts),
      timeline: JSON.stringify([{ time: new Date().toISOString(), event: 'Case created automatically by SOAR workflow', actor: 'system' }]),
      status: 'open',
    });

    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `Case created: "${title}" (id=${caseId}, severity=${severity}, artifacts=${artifacts.length})`,
      level: 'success',
      duration: Date.now() - start,
      data: { caseId, title, severity, artifact_count: artifacts.length },
    });

    return {
      success: !!caseId,
      output: { case: { id: caseId, title, severity, artifact_count: artifacts.length } },
      logs,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CreateCase error: ${msg}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}

export async function executeCreateAlert(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  let title = (cfg.title as string) || 'Untitled Alert';
  const description = (cfg.description as string) || '';
  const severity = (cfg.severity as string) || 'medium';
  const source = (cfg.source as string) || 'workflow';

  title = resolveTemplate(title, ctx);

  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  if (!ctx.createAlert) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'CreateAlert: DB callback not available', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  try {
    const alertId = await ctx.createAlert({
      title,
      description,
      severity,
      source,
      status: 'new',
    });

    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `Alert created: "${title}" (id=${alertId}, severity=${severity})`,
      level: 'success',
      duration: Date.now() - start,
      data: { alertId, title, severity },
    });

    return {
      success: !!alertId,
      output: { alert: { id: alertId, title, severity } },
      logs,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `CreateAlert error: ${msg}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
