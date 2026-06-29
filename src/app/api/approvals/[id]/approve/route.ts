// POST /api/approvals/[id]/approve — approve a pending approval request
// On approval, if the approval references a workflow execution, that execution
// is unblocked. If the approval has an inline action (e.g., block_ip), the
// executor is dispatched.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractAuthContext, requirePermission, PERMISSIONS, AuthorizationError } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { runWorkflow } from '@/lib/executors/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await extractAuthContext(req);

  try {
    requirePermission(ctx, PERMISSIONS.APPROVAL_APPROVE);
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
  if (approval.expiresAt && approval.expiresAt < new Date()) {
    await db.approval.update({ where: { id }, data: { status: 'expired' } });
    return NextResponse.json({ error: 'approval expired' }, { status: 410 });
  }

  // Approve the current step
  const currentStep = approval.steps.find(s => s.status === 'pending');
  if (!currentStep) return NextResponse.json({ error: 'no pending step' }, { status: 409 });

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }

  await db.approvalStep.update({
    where: { id: currentStep.id },
    data: {
      status: 'approved',
      approverId: ctx.userId || 'system',
      decidedAt: new Date(),
      comment: body.comment || null,
    },
  });

  // Check if all steps approved
  const remainingSteps = await db.approvalStep.count({
    where: { approvalId: id, status: 'pending' },
  });

  let executed = false;
  if (remainingSteps === 0) {
    await db.approval.update({
      where: { id },
      data: {
        status: 'approved',
        approvedBy: ctx.userId,
        approvedAt: new Date(),
      },
    });

    // If there's a queued workflow execution, unblock it
    if (approval.workflowExecutionId) {
      const exec = await db.workflowExecution.findUnique({
        where: { id: approval.workflowExecutionId },
      });
      await db.workflowExecution.update({
        where: { id: approval.workflowExecutionId },
        data: { status: 'running' },
      });
      if (exec) {
        let trigger: Record<string, unknown> = {};
        try { trigger = JSON.parse(exec.trigger || '{}'); } catch { /* empty */ }
        runWorkflow({
          executionId: exec.id,
          workflowId: exec.workflowId,
          triggerPayload: trigger,
          tenantId: exec.tenantId,
          startedBy: 'approval',
          requestId: exec.requestId || undefined,
        }).catch(e => logger.error({ err: e, executionId: exec.id }, 'resume after approval failed'));
        logger.info({ approvalId: id, executionId: approval.workflowExecutionId }, 'workflow execution resumed after approval');
      }
    }

    executed = true;
  }

  await writeAudit(ctx, {
    action: 'approval.approve',
    resource: 'approval',
    resourceId: id,
    description: `Approved step ${currentStep.stepNumber} for ${approval.action} on ${approval.targetType}="${approval.targetValue}"${executed ? ' (all steps complete)' : ''}`,
    metadata: { step: currentStep.stepNumber, allStepsComplete: executed, comment: body.comment },
  });

  return NextResponse.json({ approval: { id, status: executed ? 'approved' : 'pending_step_approved' }, executed });
}
