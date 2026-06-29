// Public webhook trigger endpoint
// POST /api/webhook/[path]?workflow=<workflowId>
//
// Authentication (any of):
//   1. X-Webhook-Signature: t=<timestamp>,v1=<hmac-sha256-of-(timestamp.body)>
//      (Stripe/GitHub-style HMAC — RECOMMENDED. Rejects replays >5 min old.)
//   2. X-Webhook-Key: <secret>  (constant-time compared — for systems that
//      can't compute HMAC)
//   3. ?key=<secret>  (LEGACY — logged by proxies, do NOT use in production.
//      Kept only for backward compatibility with existing workflows.)
//
// Security fixes (AUDIT-2 findings #2, #3, #4, #5):
//   - Constant-time secret comparison (was timing-attack vulnerable)
//   - HMAC-SHA256 signature with 5-min replay window (was static shared secret)
//   - Request body size limit (was unbounded — OOM vector)
//   - Sensitive headers stripped from persisted trigger (was storing Authorization/Cookie)
//   - Per-IP rate limit (was unlimited — DoS vector)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runWorkflow } from '@/lib/executors/engine';
import { hmacSign, safeEqual, decrypt } from '@/lib/crypto';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { ingestAlertRecord } from '@/lib/soar/alerts/upsert-alert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Maximum body size: 1 MB. Webhooks with larger payloads should use a
// pre-signed S3 URL pattern instead of inlining the payload.
const MAX_BODY_BYTES = 1 * 1024 * 1024;

// Replay window: 5 minutes (300 s) — matches Stripe/GitHub convention.
const REPLAY_WINDOW_SECONDS = 300;

// Headers that must NEVER be persisted to the execution record.
const SENSITIVE_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie', 'x-api-key',
  'x-webhook-key', 'x-webhook-signature', 'x-auth-token',
  'proxy-authorization', 'x-csrf-token',
]);

function sanitizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers.entries()) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Verify an HMAC-SHA256 signature in constant time.
 * Format: `t=<unix-seconds>,v1=<hex-hmac>`
 * HMAC input: `${t}.${rawBody}`
 */
function verifyHmacSignature(
  signatureHeader: string,
  rawBody: string,
  secret: string,
): { valid: boolean; reason?: string } {
  const parts = signatureHeader.split(',').map(s => s.trim());
  let t: string | null = null;
  let v1: string | null = null;
  for (const part of parts) {
    if (part.startsWith('t=')) t = part.slice(2);
    else if (part.startsWith('v1=')) v1 = part.slice(3);
  }
  if (!t || !v1) {
    return { valid: false, reason: 'malformed signature header' };
  }
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: 'invalid timestamp' };
  }
  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > REPLAY_WINDOW_SECONDS) {
    return { valid: false, reason: `signature expired (${Math.round(ageSeconds)}s old)` };
  }
  const expected = hmacSign(secret, `${t}.${rawBody}`);
  if (!safeEqual(expected, v1)) {
    return { valid: false, reason: 'signature mismatch' };
  }
  return { valid: true };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  const url = new URL(req.url);
  const webhookSource = await db.webhookSource.findFirst({
    where: { slug: path, enabled: true },
  });
  let workflowId = url.searchParams.get('workflow') || webhookSource?.workflowId || null;

  if (!workflowId) {
    return NextResponse.json(
      {
        ok: false,
        error: webhookSource
          ? 'Webhook source has no bound workflow. Set workflow_id on the source or pass ?workflow=<id>.'
          : 'Missing workflow. Register a webhook source with workflow_id or pass ?workflow=<id>.',
      },
      { status: 400 },
    );
  }

  // Per-IP rate limit using the 'workflow:execute' route config (30/min, burst 30).
  // Prevents a single attacker from exhausting the workflow execution slots.
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  const rlKey = `webhook:${clientIp}`;
  const rl = rateLimit(rlKey, 'workflow:execute');
  if (!rl.allowed) {
    return rateLimitResponse(rl) as unknown as NextResponse;
  }

  const wf = await db.workflow.findUnique({ where: { id: workflowId } });
  if (!wf) {
    return NextResponse.json({ ok: false, error: 'Workflow not found' }, { status: 404 });
  }

  // Read raw body once (needed for HMAC verification + size limit).
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Body exceeds ${MAX_BODY_BYTES} byte limit` },
      { status: 413 },
    );
  }

  // Parse body by content-type
  let body: unknown = {};
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { body = JSON.parse(rawBody); } catch { body = {}; }
  } else if (ct.includes('form')) {
    const params = new URLSearchParams(rawBody);
    body = Object.fromEntries(params.entries());
  } else {
    body = rawBody;
  }

  // ── AUTHENTICATION ──────────────────────────────────────────────
  // Resolve secret: webhook source → per-workflow tag → env-wide.
  const envSecret = process.env.WEBHOOK_SECRET;
  let workflowSecret: string | undefined;
  try {
    const tags = JSON.parse(wf.tags || '[]');
    if (tags && typeof tags === 'object' && !Array.isArray(tags) && typeof tags.webhook_secret === 'string') {
      workflowSecret = tags.webhook_secret;
    }
  } catch { /* tags is a plain array — no per-workflow secret */ }

  let sourceSecret: string | undefined;
  if (webhookSource?.secret) {
    try {
      const decrypted = decrypt<string>(webhookSource.secret);
      sourceSecret = decrypted ?? undefined;
    } catch {
      sourceSecret = webhookSource.secret;
    }
  }

  const expectedSecret = sourceSecret || workflowSecret || envSecret;
  if (expectedSecret) {
    // Try HMAC signature first (preferred — Stripe/GitHub style).
    const sigHeader = req.headers.get('x-webhook-signature');
    if (sigHeader) {
      const result = verifyHmacSignature(sigHeader, rawBody, expectedSecret);
      if (!result.valid) {
        return NextResponse.json(
          { ok: false, error: `Signature verification failed: ${result.reason}` },
          { status: 401 },
        );
      }
    } else {
      // Fall back to shared-secret (X-Webhook-Key header preferred over ?key=
      // because query params are logged by proxies).
      const providedKey = req.headers.get('x-webhook-key') || url.searchParams.get('key') || url.searchParams.get('secret');
      if (!providedKey) {
        return NextResponse.json(
          { ok: false, error: 'Missing authentication. Send X-Webhook-Signature or X-Webhook-Key header.' },
          { status: 401 },
        );
      }
      // SECURITY: constant-time comparison to prevent timing attacks.
      if (!safeEqual(providedKey, expectedSecret)) {
        return NextResponse.json({ ok: false, error: 'Invalid secret' }, { status: 401 });
      }
    }
  }

  // Create execution record — sanitized headers only.
  const execution = await db.workflowExecution.create({
    data: {
      workflowId,
      status: 'running',
      trigger: JSON.stringify({
        source: 'webhook',
        path,
        body,
        headers: sanitizeHeaders(req.headers),
      }),
      result: JSON.stringify({}),
      logs: JSON.stringify([{
        time: new Date().toISOString(),
        message: `Webhook trigger fired on /api/webhook/${path} from ${clientIp}`,
        level: 'info',
      }]),
    },
  });

  // Trigger payload: flatten the webhook body keys to the top level so
  // workflow nodes can reference {{trigger.ip}} directly.
  // Sensitive headers are NOT included in the trigger payload.
  const triggerPayload: Record<string, unknown> = {
    source: 'webhook',
    path,
    method: req.method,
    _webhook: {
      path,
      method: req.method,
      // Only expose non-sensitive headers to the workflow context
      headers: sanitizeHeaders(req.headers),
      clientIp,
    },
  };
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    Object.assign(triggerPayload, body as Record<string, unknown>);
  } else {
    triggerPayload.body = body;
  }

  // Optional: auto-create alert record for observability + alert-triggered workflows
  const looksLikeAlert = !!(
    triggerPayload.title ||
    triggerPayload.alert ||
    triggerPayload.alert_title ||
    triggerPayload.severity
  );
  if (looksLikeAlert) {
    const bodyRecord = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : { body };
    const ingested = await ingestAlertRecord({
      payload: {
        ...bodyRecord,
        title: triggerPayload.title || triggerPayload.alert_title,
        source: triggerPayload.source || path,
        severity: triggerPayload.severity,
      },
      tenantId: wf.tenantId,
      source: path,
    });
    triggerPayload.alert_id = ingested.alert.id;
    triggerPayload.deduplicated = ingested.deduplicated;
    triggerPayload.occurrence_count = ingested.alert.occurrenceCount;
  }

  runWorkflow({
    executionId: execution.id,
    workflowId,
    triggerPayload,
    tenantId: wf.tenantId,
    startedBy: `webhook:${path}`,
  }).catch(e => console.error('webhook runWorkflow error:', e));

  return NextResponse.json({
    ok: true,
    executionId: execution.id,
    workflow: wf.name,
    path,
    message: 'Workflow triggered — poll GET /api/workflow-executions/' + execution.id + ' for live logs',
  }, { status: 202 });
}

// GET on a webhook URL returns metadata (so users can verify the URL is correct
// without firing the workflow). Does NOT reveal whether the workflow exists.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  return NextResponse.json({
    ok: true,
    path,
    message: 'Webhook endpoint is live. POST to this URL with ?workflow=<id> to trigger a workflow.',
  });
}
