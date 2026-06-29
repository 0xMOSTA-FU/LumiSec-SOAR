// Case CRUD API
//
// SECURITY FIX (AUDIT-2 finding #1 — CRITICAL):
// Previously this route had ZERO authentication. Anyone with network access
// could read all cases across all tenants (exposing incident details,
// IOCs, victim identities) and create/update/delete arbitrary cases.
//
// Now enforces:
//   1. extractAuthContext() — must be authenticated (no anonymous)
//   2. requirePermission() — CASE_READ for GET, CASE_WRITE for POST/PUT, CASE_DELETE for DELETE
//   3. tenantId scoping on GET (superadmin sees all)
//   4. Tenant ownership on PUT/DELETE (cannot mutate other tenants' cases)
//   5. Zod input validation — no mass-assignment
//   6. Audit log entry on every mutation
//   7. Per-caller rate limit

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { forwardSoarEvent, isExternalBackendEnabled, pushCaseToExternal } from '@/lib/external-api';
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
import { syncArtifactsForIncident } from '@/lib/incidents/sync-artifacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Zod schemas ──────────────────────────────────────────────────────────

const CaseCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional().default(''),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  status: z.enum(['open', 'investigating', 'contained', 'resolved', 'closed']).optional().default('open'),
  priority: z.enum(['p1', 'p2', 'p3', 'p4']).optional().default('p3'),
  assigneeId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  artifacts: z.array(z.any()).optional().default([]),
  timeline: z.array(z.any()).optional().default([]),
});

const CaseUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['open', 'investigating', 'contained', 'resolved', 'closed']).optional(),
  priority: z.enum(['p1', 'p2', 'p3', 'p4']).optional(),
  assigneeId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  artifacts: z.array(z.any()).optional(),
  timeline: z.array(z.any()).optional(),
  resolution: z.string().max(5000).optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────

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
    requirePermission(ctx, PERMISSIONS.CASE_READ);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    // Tenant scoping
    const where = ctx.tenantId ? { tenantId: ctx.tenantId } : {};
    const cases = await db.case.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return NextResponse.json(cases);
  } catch (error) {
    const authResp = authError(error);
    if (authResp) return authResp;
    logger.error({ err: error }, 'Cases GET error');
    return NextResponse.json({ error: 'Failed to fetch cases' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.CASE_WRITE);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const body = await request.json();
    const parsed = CaseCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const caseItem = await db.case.create({
      data: {
        tenantId: ctx.tenantId,
        title: data.title,
        description: data.description,
        severity: data.severity,
        status: data.status,
        priority: data.priority,
        assigneeId: data.assigneeId || null,
        tags: JSON.stringify(data.tags),
        artifacts: JSON.stringify(data.artifacts),
        timeline: JSON.stringify(data.timeline),
      },
    });

    const tenantWhere = ctx.tenantId ? { tenantId: ctx.tenantId } : {};
    await syncArtifactsForIncident(caseItem.id, tenantWhere).catch(err =>
      logger.warn({ err, caseId: caseItem.id }, 'artifact sync on case create failed'),
    );

    await writeAudit(ctx, {
      action: 'case.create',
      resource: 'case',
      resourceId: caseItem.id,
      description: `Created case "${caseItem.title}" (severity=${caseItem.severity})`,
      after: { title: caseItem.title, severity: caseItem.severity, status: caseItem.status },
    });

    // Best-effort: push to external backend so it knows about our new case
    if (isExternalBackendEnabled()) {
      pushCaseToExternal({
        title: caseItem.title,
        description: caseItem.description || '',
        severity: caseItem.severity,
        status: caseItem.status,
        source: 'soar',
        soarCaseId: caseItem.id,
      }).catch(() => {/* swallow */});
      forwardSoarEvent({
        type: 'case_created',
        payload: { caseId: caseItem.id, title: caseItem.title, severity: caseItem.severity },
        ts: new Date().toISOString(),
      }).catch(() => {/* swallow */});
    }

    return NextResponse.json(caseItem, { status: 201 });
  } catch (error) {
    const authResp = authError(error);
    if (authResp) return authResp;
    logger.error({ err: error }, 'Case POST error');
    return NextResponse.json({ error: 'Failed to create case' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.CASE_WRITE);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const body = await request.json();
    const parsed = CaseUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { id, ...data } = parsed.data;

    // Fetch existing to check tenant ownership + capture `before` for audit
    const existing = await db.case.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }
    if (ctx.tenantId && existing.tenantId && existing.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.severity !== undefined) updateData.severity = data.severity;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId;
    if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags);
    if (data.artifacts !== undefined) updateData.artifacts = JSON.stringify(data.artifacts);
    if (data.timeline !== undefined) updateData.timeline = JSON.stringify(data.timeline);
    if (data.resolution !== undefined) updateData.resolution = data.resolution;
    if (data.status === 'closed' && !existing.closedAt) {
      updateData.closedAt = new Date();
      updateData.closedBy = ctx.userId || ctx.email || 'unknown';
    }

    const caseItem = await db.case.update({ where: { id }, data: updateData });

    const tenantWhere = ctx.tenantId ? { tenantId: ctx.tenantId } : {};
    if (data.artifacts !== undefined || data.description !== undefined || data.title !== undefined) {
      await syncArtifactsForIncident(id, tenantWhere).catch(() => {});
    }

    await writeAudit(ctx, {
      action: 'case.update',
      resource: 'case',
      resourceId: id,
      description: `Updated case "${existing.title}"`,
      before: existing,
      after: caseItem,
    });

    // Best-effort: notify external backend
    if (isExternalBackendEnabled()) {
      forwardSoarEvent({
        type: 'case_updated',
        payload: { caseId: id, status: data.status, severity: data.severity },
        ts: new Date().toISOString(),
      }).catch(() => {/* swallow */});
    }

    return NextResponse.json(caseItem);
  } catch (error) {
    const authResp = authError(error);
    if (authResp) return authResp;
    logger.error({ err: error }, 'Case PUT error');
    return NextResponse.json({ error: 'Failed to update case' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.CASE_DELETE);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    // Fetch existing for tenant check + audit
    const existing = await db.case.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }
    if (ctx.tenantId && existing.tenantId && existing.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    await db.case.delete({ where: { id } });

    await writeAudit(ctx, {
      action: 'case.delete',
      resource: 'case',
      resourceId: id,
      description: `Deleted case "${existing.title}"`,
      before: existing,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResp = authError(error);
    if (authResp) return authResp;
    logger.error({ err: error }, 'Case DELETE error');
    return NextResponse.json({ error: 'Failed to delete case' }, { status: 500 });
  }
}
