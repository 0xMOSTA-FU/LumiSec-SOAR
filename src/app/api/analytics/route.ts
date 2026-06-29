import { NextRequest, NextResponse } from 'next/server';
import {
  extractAuthContext,
  hasAnyPermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  getLegacyAnalyticsView,
  parseAnalyticsDays,
} from '@/lib/soar/metrics/dashboard-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    if (!hasAnyPermission(ctx, [PERMISSIONS.CASE_READ, PERMISSIONS.ALERT_READ])) {
      throw new AuthorizationError('Insufficient permissions to view analytics');
    }

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const tenantWhere = ctx.tenantId ? { tenantId: ctx.tenantId } : {};
    const days = parseAnalyticsDays(req.nextUrl.searchParams.get('days'));
    const data = await getLegacyAnalyticsView(tenantWhere, days);

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    logger.error({ err: error }, 'Analytics GET error');
    return NextResponse.json({ error: 'Failed to load analytics data' }, { status: 500 });
  }
}
