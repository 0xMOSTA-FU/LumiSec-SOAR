// GET /api/attack-patterns        → list ATT&CK techniques (paginated, searchable)
// GET /api/attack-patterns/[id]   → single technique
// POST /api/attack-patterns/map   → map a case or alert to a technique
//
// SECURITY FIX (AUDIT-2 finding #1): Previously GET only called
// extractAuthContext() without checking the result — anonymous callers
// could enumerate the full ATT&CK knowledge base. POST did call it but
// didn't require any permission, so anonymous users could mutate mappings.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MapSchema = z.object({
  caseId: z.string().optional(),
  alertId: z.string().optional(),
  techniqueId: z.string().min(1),
  confidence: z.number().min(0).max(1).optional().default(0.5),
}).refine(v => v.caseId || v.alertId, { message: 'caseId or alertId required' });

function authError(err: unknown) {
  if (err instanceof AuthenticationError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof AuthorizationError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  return null;
}

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

    const url = new URL(req.url);
    const q = url.searchParams.get('q') || '';
    const tactic = url.searchParams.get('tactic');
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);

    const patterns = await db.attackPattern.findMany({
      where: {
        ...(q ? {
          OR: [
            { techniqueId: { contains: q } },
            { name: { contains: q } },
            { description: { contains: q } },
          ],
        } : {}),
        ...(tactic ? { tactic } : {}),
      },
      take: limit,
      orderBy: { techniqueId: 'asc' },
    });

    return NextResponse.json({ patterns, count: patterns.length });
  } catch (error) {
    const authResp = authError(error);
    if (authResp) return authResp;
    logger.error({ err: error }, 'Attack patterns GET error');
    return NextResponse.json({ error: 'Failed to fetch attack patterns' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.CASE_WRITE);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

    const parsed = MapSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { caseId, alertId, techniqueId, confidence } = parsed.data;

    const pattern = await db.attackPattern.findUnique({ where: { techniqueId } });
    if (!pattern) return NextResponse.json({ error: `technique ${techniqueId} not found` }, { status: 404 });

    if (caseId) {
      await db.caseAttackPattern.upsert({
        where: { caseId_attackPatternId: { caseId, attackPatternId: pattern.id } },
        update: { confidence, mappedBy: ctx.userId, mappedAt: new Date() },
        create: { caseId, attackPatternId: pattern.id, confidence, mappedBy: ctx.userId },
      });
    }
    if (alertId) {
      await db.alertAttackPattern.upsert({
        where: { alertId_attackPatternId: { alertId, attackPatternId: pattern.id } },
        update: { confidence },
        create: { alertId, attackPatternId: pattern.id, confidence },
      });
    }

    await writeAudit(ctx, {
      action: 'attack_pattern.map',
      resource: 'attack_pattern',
      resourceId: pattern.id,
      description: `Mapped ${techniqueId} (${pattern.name}) to ${caseId ? `case ${caseId}` : `alert ${alertId}`}`,
      metadata: { techniqueId, caseId, alertId, confidence },
    });

    return NextResponse.json({ ok: true, mapped: { techniqueId, caseId, alertId, confidence } });
  } catch (error) {
    const authResp = authError(error);
    if (authResp) return authResp;
    logger.error({ err: error }, 'Attack pattern map POST error');
    return NextResponse.json({ error: 'Failed to map attack pattern' }, { status: 500 });
  }
}
