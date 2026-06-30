import { db } from '@/lib/db';
import type { AuthContext } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { runWorkflow } from '@/lib/executors/engine';

export async function listApprovals(
  tenantWhere: Record<string, unknown>,
  status = 'pending',
) {
  return db.approval.findMany({
    where: {
      status,
      ...tenantWhere,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { steps: true },
  });
}

export async function approveApproval(id: string, ctx: AuthContext, comment?: string) {
  const approval = await db.approval.findUnique({
    where: { id },
    include: { steps: true },
  });
  if (!approval) return { ok: false, status: 404, message: 'not found' };
  if (approval.status !== 'pending') {
    return { ok: false, status: 409, message: `approval already ${approval.status}` };
  }
  if (approval.expiresAt && approval.expiresAt < new Date()) {
    await db.approval.update({ where: { id }, data: { status: 'expired' } });
    return { ok: false, status: 410, message: 'approval expired' };
  }

  const currentStep = approval.steps.find((s) => s.status === 'pending');
  if (!currentStep) return { ok: false, status: 409, message: 'no pending step' };

  await db.approvalStep.update({
    where: { id: currentStep.id },
    data: {
      status: 'approved',
      approverId: ctx.userId || 'system',
      decidedAt: new Date(),
      comment: comment || null,
    },
  });

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
        try {
          trigger = JSON.parse(exec.trigger || '{}');
        } catch {
          /* empty */
        }
        runWorkflow({
          executionId: exec.id,
          workflowId: exec.workflowId,
          triggerPayload: trigger,
          tenantId: exec.tenantId,
          startedBy: 'approval',
          requestId: exec.requestId || undefined,
        }).catch((e) =>
          logger.error({ err: e, executionId: exec.id }, 'resume after approval failed'),
        );
      }
    }
    executed = true;
  }

  await writeAudit(ctx, {
    action: 'approval.approve',
    resource: 'approval',
    resourceId: id,
    description: `Approved ${approval.action} on ${approval.targetValue}`,
    metadata: { executed, comment },
  });

  return {
    ok: true,
    data: { id, status: executed ? 'approved' : 'pending_step_approved', executed },
    message: executed ? 'Approval complete' : 'Step approved',
  };
}

export async function rejectApproval(id: string, ctx: AuthContext, comment?: string) {
  const approval = await db.approval.findUnique({ where: { id }, include: { steps: true } });
  if (!approval) return { ok: false, status: 404, message: 'not found' };
  if (approval.status !== 'pending') {
    return { ok: false, status: 409, message: `approval already ${approval.status}` };
  }

  await db.approval.update({
    where: { id },
    data: { status: 'rejected', approvedBy: ctx.userId, approvedAt: new Date() },
  });
  await db.approvalStep.updateMany({
    where: { approvalId: id, status: 'pending' },
    data: {
      status: 'rejected',
      approverId: ctx.userId || 'system',
      decidedAt: new Date(),
      comment: comment || null,
    },
  });

  if (approval.workflowExecutionId) {
    await db.workflowExecution.update({
      where: { id: approval.workflowExecutionId },
      data: {
        status: 'failed',
        result: JSON.stringify({ error: 'Approval rejected' }),
        endedAt: new Date(),
      },
    }).catch(() => {});
  }

  await writeAudit(ctx, {
    action: 'approval.reject',
    resource: 'approval',
    resourceId: id,
    description: `Rejected ${approval.action} on ${approval.targetValue}`,
    metadata: { comment },
  });

  return { ok: true, data: { id, status: 'rejected' }, message: 'Approval rejected' };
}
