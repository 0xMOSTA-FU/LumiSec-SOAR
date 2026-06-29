// Generic HTTP executor - real fetch against any URL
// Supports template variables in URL, headers, body: {{trigger.ip}}, {{outputs.n1.score}}
//
// CRITICAL SECURITY: Uses safeFetch() from soar/security/ssrf-guard which:
//   - Blocks private/loopback/metadata IPs (RFC 1918, 169.254/16, etc.)
//   - Validates against decimal/hex/octal IP encodings
//   - Pins the connection to the pre-resolved IP (prevents DNS rebinding)
//   - Follows redirects with per-hop re-validation
//   - Enforces protocol allowlist (http/https only)
// Previously this file used raw `fetch()` which allowed SSRF attacks
// against http://169.254.169.254/ (cloud metadata), http://127.0.0.1/,
// and internal RFC 1918 addresses. See AUDIT-2 finding #1.

import { NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';
import { safeFetch } from '@/lib/soar/security/ssrf-guard';

export async function executeHTTP(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const method = ((cfg.method as string) || 'GET').toUpperCase();
  let url = (cfg.url as string) || '';
  const headersStr = (cfg.headers as string) || (cfg.headers ? JSON.stringify(cfg.headers) : '{}');
  let bodyStr = (cfg.body as string) || '';

  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  if (!url) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'HTTP: no URL configured', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  url = resolveTemplate(url, ctx);
  bodyStr = bodyStr ? resolveTemplate(bodyStr, ctx) : '';

  let headers: Record<string, string> = {};
  try {
    const parsed = JSON.parse(resolveTemplate(headersStr, ctx));
    headers = typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'HTTP: invalid headers JSON, ignoring', level: 'warning' });
  }

  // Add Authorization from integration if "auth_integration" is set
  const authIntKey = (cfg.auth_integration as string) || '';
  if (authIntKey) {
    const int = ctx.getIntegration(authIntKey);
    if (int) {
      const ak = (int.config?.api_key as string) || (int.config?.apiKey as string) || (int.config?.token as string);
      if (ak) {
        const scheme = (int.config?.auth_scheme as string) || 'Bearer';
        headers['Authorization'] = `${scheme} ${ak}`;
      }
    }
  }

  logs.push({
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: `HTTP ${method} ${url}`,
    level: 'info',
  });

  try {
    const fetchOpts: RequestInit = {
      method,
      headers,
      cache: 'no-store',
    };
    if (bodyStr && method !== 'GET' && method !== 'HEAD') {
      fetchOpts.body = bodyStr;
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }
    // SECURITY: use safeFetch() — applies SSRF guard, redirect re-validation,
    // DNS-rebinding protection, protocol allowlist, and per-request timeout.
    const res = await safeFetch(url, {
      ...fetchOpts,
      timeoutMs: Number(process.env.NODE_TIMEOUT_MS || 30000),
      maxRedirects: 5,
    });
    const responseTime = Date.now() - start;
    const contentType = res.headers.get('content-type') || '';
    let body: unknown = null;
    if (contentType.includes('application/json')) {
      body = await res.json().catch(() => null);
    } else {
      body = await res.text().catch(() => null);
      // Try to parse as JSON anyway
      if (typeof body === 'string' && (body.startsWith('{') || body.startsWith('['))) {
        try { body = JSON.parse(body); } catch { /* keep as text */ }
      }
    }

    const output = {
      http: {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url,
        method,
        responseTimeMs: responseTime,
        body,
      },
    };

    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `HTTP ${res.status} ${res.statusText} (${responseTime}ms)`,
      level: res.ok ? 'success' : 'error',
      duration: responseTime,
      data: { status: res.status, body_preview: typeof body === 'string' ? body.slice(0, 200) : body },
    });

    return { success: res.ok, output, logs };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `HTTP error: ${msg}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
