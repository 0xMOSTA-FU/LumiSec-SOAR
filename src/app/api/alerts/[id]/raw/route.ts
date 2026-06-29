/**
 * GET /api/alerts/[id]/raw — forensic raw payload from MongoDB archive.
 * Requires Prisma alert to exist (auth + tenant check); payload comes from Mongo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRawAlert, isMongoEnabled } from '@/lib/mongo';
import {
  extractAuthContext,
  requirePermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.ALERT_READ);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    if (!isMongoEnabled()) {
      return NextResponse.json(
        { error: 'MongoDB not configured (set MONGODB_URI to enable raw alert archive)' },
        { status: 503 },
      );
    }

    const { id } = await params;
    const alert = await db.alert.findUnique({ where: { id } });
    if (!alert) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (ctx.tenantId && alert.tenantId && alert.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const raw = await getRawAlert(id);
    if (!raw) {
      return NextResponse.json(
        { alertId: id, archived: false, message: 'No MongoDB archive for this alert yet' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      alertId: id,
      archived: true,
      source: raw.source,
      ts: raw.ts,
      payload: raw.payload,
      signature: raw.signature,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to fetch raw alert' }, { status: 500 });
  }
}
