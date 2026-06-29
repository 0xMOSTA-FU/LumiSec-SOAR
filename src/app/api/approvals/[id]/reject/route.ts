// POST /api/approvals/[id]/reject — reject a pending approval request

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractAuthContext, requirePermission, PERMISSIONS, AuthorizationError } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await extractAuthContext(req);

  try {
    requirePermission(ctx, PERMISSIONS.APPROVAL_REJECT);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const approval = await db.approval.findUnique({
    where: { id },
    include: { steps: true },
  });
  if (!approval) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (approval.status !== 'pending') return NextResponse.json({ error: `approval already ${approval.status}` }, { status: 409 });

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const rejectionReason = body.reason || body.comment || 'Rejected';

  const currentStep = approval.steps.find(s => s.status === 'pending');
  if (currentStep) {
    await db.approvalStep.update({
      where: { id: currentStep.id },
      data: {
        status: 'rejected',
        approverId: ctx.userId || 'system',
        decidedAt: new Date(),
        comment: rejectionReason,
      },
    });
  }

  await db.approval.update({
    where: { id },
    data: {
      status: 'rejected',
      rejectedBy: ctx.userId,
      rejectedAt: new Date(),
      rejectionReason,
    },
  });

  await writeAudit(ctx, {
    action: 'approval.reject',
    resource: 'approval',
    resourceId: id,
    description: `Rejected ${approval.action} on ${approval.targetType}="${approval.targetValue}": ${rejectionReason}`,
    metadata: { reason: rejectionReason },
  });

  logger.info({ approvalId: id, rejectedBy: ctx.userId }, 'approval rejected');

  return NextResponse.json({ approval: { id, status: 'rejected' } });
}
