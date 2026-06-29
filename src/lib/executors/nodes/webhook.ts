// Real Webhook executor - send HTTP webhook to arbitrary URL with template resolution
// Distinct from generic HTTP node: this is the "outbound webhook" action with sane defaults

import { safeFetch } from '@/lib/soar/security/ssrf-guard';
import { NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

export async function executeWebhook(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  let url = (cfg.url as string) || (cfg.webhook_url as string) || '';
  const method = (cfg.method as string) || 'POST';
  const headers_in = (cfg.headers as Record<string, string>) || { 'Content-Type': 'application/json' };
  const body = (cfg.body as string) || (cfg.payload as string) || '';
  const auth_header = (cfg.auth_header as string) || '';

  url = resolveTemplate(url, ctx);
  const resolvedBody = body.includes('{{') ? resolveTemplate(body, ctx) : body;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers_in)) {
    headers[k] = resolveTemplate(v, ctx);
  }
  if (auth_header) {
    headers['Authorization'] = resolveTemplate(auth_header, ctx);
  }

  if (!url) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Webhook: url required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  // Try to parse body as JSON; if fails, send as text
  let bodyToSend: string | undefined = undefined;
  if (resolvedBody) {
    bodyToSend = resolvedBody;
    if (headers['Content-Type']?.includes('json') && !resolvedBody.startsWith('{') && !resolvedBody.startsWith('[')) {
      // Wrap in JSON
      bodyToSend = JSON.stringify({ data: resolvedBody });
    }
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Webhook: ${method} ${url.slice(0, 100)}...`, level: 'info' });

  try {
    // SECURITY: use safeFetch() — SSRF guard, redirect re-validation, timeout.
    const res = await safeFetch(url, {
      method,
      headers,
      body: bodyToSend,
      cache: 'no-store',
      timeoutMs: Number(process.env.NODE_TIMEOUT_MS || 30000),
      maxRedirects: 5,
    });
    const respText = await res.text().catch(() => '');
    const responseTime = Date.now() - start;
    if (res.ok) {
      let respData: unknown = respText;
      try { respData = JSON.parse(respText); } catch { /* keep as text */ }
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: `Webhook: ${method} ${url.slice(0, 60)} → ${res.status} (${responseTime}ms)`,
        level: 'success',
        duration: responseTime,
        data: { status: res.status, response_preview: respText.slice(0, 200) },
      });
      return { success: true, output: { webhook: { ok: true, status: res.status, response: respData } }, logs };
    }
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `Webhook error: ${res.status} - ${respText.slice(0, 200)}`,
      level: 'error',
      duration: responseTime,
    });
    return { success: false, output: { webhook: { ok: false, status: res.status, error: respText } }, logs };
  } catch (err: unknown) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Webhook error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}

// Webhook trigger executor - receives HTTP requests, runs them through a workflow
export async function executeWebhookTrigger(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const path = (cfg.path as string) || '/webhook';
  const method = (cfg.method as string) || 'POST';
  const secret = (cfg.secret as string) || '';
  const logs: NodeExecutorResult['logs'] = [{
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: `Webhook trigger fired: ${method} ${path} (body keys: ${Object.keys(ctx.trigger).join(', ') || 'none'})${secret ? ' [auth=on]' : ''}`,
    level: 'info',
    duration: 0,
    data: ctx.trigger,
  }];
  return { success: true, output: { trigger: ctx.trigger }, logs };
}
