// Approval workflow API
// POST /api/approvals        → request a new approval (e.g., for high-impact containment)
// GET  /api/approvals        → list pending approvals (filtered by user role)
// GET  /api/approvals/[id]   → get a single approval
// POST /api/approvals/[id]/approve  → approve (calls executor if multi-step done)
// POST /api/approvals/[id]/reject   → reject
//
// In production: every containment action (block_ip, isolate_host, disable_user,
// reset_password, firewall_rule) MUST go through approval workflow if the actor
// is not superadmin OR the target is a critical asset.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractAuthContext, requirePermission, PERMISSIONS, AuthorizationError } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await extractAuthContext(req);
  const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
  const rlResp = rateLimitResponse(rl);
  if (rlResp) return rlResp;

  try {
    requirePermission(ctx, PERMISSIONS.APPROVAL_REQUEST);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'pending';

  const approvals = await db.approval.findMany({
    where: {
      status,
      ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { steps: true },
  });

  return NextResponse.json({ approvals });
}

export async function POST(req: NextRequest) {
  const ctx = await extractAuthContext(req);
  const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
  const rlResp = rateLimitResponse(rl);
  if (rlResp) return rlResp;

  try {
    requirePermission(ctx, PERMISSIONS.APPROVAL_REQUEST);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const { action, targetType, targetValue, reason, riskLevel, workflowExecutionId, expiresInSeconds, metadata } = body || {};
  if (!action || !targetType || !targetValue) {
    return NextResponse.json({ error: 'action, targetType, targetValue required' }, { status: 400 });
  }

  // Auto-escalate riskLevel based on action type
  const HIGH_IMPACT_ACTIONS = ['block_ip', 'isolate_host', 'disable_user', 'reset_password', 'firewall_rule'];
  const effectiveRisk = riskLevel || (HIGH_IMPACT_ACTIONS.includes(action) ? 'high' : 'medium');

  // Determine required approvers based on risk
  let approverRole = 'admin';
  if (effectiveRisk === 'critical') approverRole = 'superadmin';

  const expiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : new Date(Date.now() + 24 * 3600 * 1000);

  const approval = await db.approval.create({
    data: {
      tenantId: ctx.tenantId,
      workflowExecutionId,
      requestedBy: ctx.userId || 'system',
      action,
      targetType,
      targetValue,
      reason: reason || '',
      riskLevel: effectiveRisk,
      expiresAt,
      metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata || {}),
      steps: {
        create: [{
          stepNumber: 1,
          approverRole,
        }],
      },
    },
    include: { steps: true },
  });

  await writeAudit(ctx, {
    action: 'approval.request',
    resource: 'approval',
    resourceId: approval.id,
    description: `Approval requested: ${action} on ${targetType}="${targetValue}" (risk=${effectiveRisk})`,
    metadata: { action, targetType, targetValue, riskLevel: effectiveRisk },
  });

  logger.info({ approvalId: approval.id, action, targetValue, requestedBy: ctx.userId }, 'approval requested');

  return NextResponse.json({ approval }, { status: 201 });
}
