// Alert CRUD API
//
// SECURITY FIX (AUDIT-2 finding #1 — CRITICAL):
// Previously this route had ZERO authentication. Anyone with network access
// could read all alerts across all tenants (exposing IOC values, victim
// hosts, detection rules) and create/update/delete arbitrary alerts.
//
// Also fixes a data-integrity bug: the old code wrote `assignee` (which is
// not a column — only `assigneeId` is), causing every PUT to throw a
// Prisma validation error.
//
// Now enforces:
//   1. extractAuthContext() — must be authenticated (no anonymous)
//   2. requirePermission() — ALERT_READ for GET, ALERT_WRITE for POST/PUT
//   3. tenantId scoping on GET (superadmin sees all)
//   4. Tenant ownership on PUT/DELETE
//   5. Zod input validation
//   6. Audit log entry on every mutation

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { forwardSoarEvent, isExternalBackendEnabled } from '@/lib/external-api';
import { ingestAlertRecord } from '@/lib/soar/alerts/upsert-alert';
import {
  extractAuthContext,
  requirePermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  enrichAlertIocsFromRaw,
  syncArtifactsForIncident,
} from '@/lib/incidents/sync-artifacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Zod schemas ──────────────────────────────────────────────────────────

const AlertCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional().default(''),
  source: z.string().max(100).optional().default('manual'),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  status: z.enum(['new', 'triaging', 'investigating', 'escalated', 'closed', 'false_positive']).optional().default('new'),
  assigneeId: z.string().optional().nullable(),
  caseId: z.string().optional().nullable(),
  raw: z.record(z.string(), z.unknown()).optional().default({}),
  iocs: z.array(z.object({ type: z.string(), value: z.string() }).passthrough()).optional().default([]),
  dedupKey: z.string().optional(),
});

const AlertUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['new', 'triaging', 'investigating', 'escalated', 'closed', 'false_positive']).optional(),
  assigneeId: z.string().optional().nullable(),
  caseId: z.string().optional().nullable(),
  raw: z.record(z.string(), z.unknown()).optional(),
  iocs: z.array(z.object({ type: z.string(), value: z.string() }).passthrough()).optional(),
});

function authError(err: unknown) {
  if (err instanceof AuthenticationError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof AuthorizationError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  return null;
}

// ── Handlers ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.ALERT_READ);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const severity = url.searchParams.get('severity');

    const where = {
      ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
      ...(status ? { status } : {}),
      ...(severity ? { severity } : {}),
    };

    const alerts = await db.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return NextResponse.json(alerts);
  } catch (error) {
    const authResp = authError(error);
    if (authResp) return authResp;
    logger.error({ err: error }, 'Alerts GET error');
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.ALERT_WRITE);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const body = await request.json();
    const parsed = AlertCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const ingested = await ingestAlertRecord({
      payload: {
        ...data,
        title: data.title,
        description: data.description,
        source: data.source,
        severity: data.severity,
        status: data.status,
        dedupKey: data.dedupKey,
        raw: data.raw,
        iocs: data.iocs,
      },
      tenantId: ctx.tenantId,
      assigneeId: data.assigneeId || null,
      caseId: data.caseId || null,
    });
    const alert = ingested.alert;

    await writeAudit(ctx, {
      action: ingested.deduplicated ? 'alert.dedup' : 'alert.create',
      resource: 'alert',
      resourceId: alert.id,
      description: ingested.deduplicated
        ? `Deduplicated alert "${alert.title}" (count=${alert.occurrenceCount})`
        : `Created alert "${alert.title}" (severity=${alert.severity}, source=${alert.source})`,
      after: { title: alert.title, severity: alert.severity, source: alert.source, dedupKey: alert.dedupKey },
    });

    // Best-effort: forward event to external backend
    if (isExternalBackendEnabled()) {
      forwardSoarEvent({
        type: 'alert_created',
        payload: { alertId: alert.id, title: alert.title, severity: alert.severity, source: alert.source },
        ts: new Date().toISOString(),
      }).catch(() => {/* swallow */});
    }

    return NextResponse.json(alert, { status: 201 });
  } catch (error) {
    const authResp = authError(error);
    if (authResp) return authResp;
    logger.error({ err: error }, 'Alert POST error');
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.ALERT_WRITE);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const body = await request.json();
    const parsed = AlertUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { id, ...data } = parsed.data;

    const existing = await db.alert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }
    if (ctx.tenantId && existing.tenantId && existing.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.severity !== undefined) updateData.severity = data.severity;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId;
    if (data.caseId !== undefined) updateData.caseId = data.caseId;
    if (data.raw !== undefined) updateData.raw = JSON.stringify(data.raw);
    if (data.iocs !== undefined) updateData.iocs = JSON.stringify(data.iocs);

    const alert = await db.alert.update({ where: { id }, data: updateData });

    const tenantWhere = ctx.tenantId ? { tenantId: ctx.tenantId } : {};
    await enrichAlertIocsFromRaw(alert.id, tenantWhere).catch(() => {});
    if (alert.caseId) {
      await syncArtifactsForIncident(alert.caseId, tenantWhere).catch(() => {});
    }

    await writeAudit(ctx, {
      action: 'alert.update',
      resource: 'alert',
      resourceId: id,
      description: `Updated alert "${existing.title}"`,
      before: existing,
      after: alert,
    });

    return NextResponse.json(alert);
  } catch (error) {
    const authResp = authError(error);
    if (authResp) return authResp;
    logger.error({ err: error }, 'Alert PUT error');
    return NextResponse.json({ error: 'Failed to update alert' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.ALERT_WRITE);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const existing = await db.alert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }
    if (ctx.tenantId && existing.tenantId && existing.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    await db.alert.delete({ where: { id } });

    await writeAudit(ctx, {
      action: 'alert.delete',
      resource: 'alert',
      resourceId: id,
      description: `Deleted alert "${existing.title}"`,
      before: existing,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResp = authError(error);
    if (authResp) return authResp;
    logger.error({ err: error }, 'Alert DELETE error');
    return NextResponse.json({ error: 'Failed to delete alert' }, { status: 500 });
  }
}
