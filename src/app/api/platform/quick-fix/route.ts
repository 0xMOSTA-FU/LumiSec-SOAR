/**
 * POST /api/platform/quick-fix — MVP one-click platform maintenance actions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  extractAuthContext,
  requirePermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { writeAudit } from '@/lib/audit';
import { runQuickFix, type QuickFixAction } from '@/lib/platform/quick-fix';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  action: z.enum([
    'health_check',
    'test_all_connectors',
    'connect_free_tier',
    'sync_artifacts',
    'fix_all',
  ]),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.INTEGRATION_WRITE);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'integrations:test');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const body = await req.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid action', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const action = parsed.data.action as QuickFixAction;
    const result = await runQuickFix(action, ctx.tenantId);

    await writeAudit(ctx, {
      action: `platform.quick_fix.${action}`,
      resource: 'platform',
      description: result.steps.map(s => s.message).join(' · '),
      metadata: { action, steps: result.steps.map(s => ({ action: s.action, ok: s.ok })) },
    }).catch(() => {});

    return NextResponse.json({
      ok: result.ok,
      action,
      steps: result.steps,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Quick fix failed' },
      { status: 500 },
    );
  }
}
