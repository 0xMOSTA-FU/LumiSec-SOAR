/**
 * Workflow execution rate limits — maxExecutionsPerHour enforcement.
 */
import { db } from '@/lib/db';

export interface ExecutionLimitResult {
  allowed: boolean;
  count?: number;
  limit?: number;
  reason?: string;
}

export async function checkWorkflowExecutionLimit(
  workflowId: string,
): Promise<ExecutionLimitResult> {
  const wf = await db.workflow.findUnique({
    where: { id: workflowId },
    select: { maxExecutionsPerHour: true, name: true },
  });

  if (!wf) return { allowed: false, reason: 'Workflow not found' };

  const limit = wf.maxExecutionsPerHour ?? 100;
  const since = new Date(Date.now() - 3600_000);

  const count = await db.workflowExecution.count({
    where: {
      workflowId,
      startedAt: { gte: since },
    },
  });

  if (count >= limit) {
    return {
      allowed: false,
      count,
      limit,
      reason: `Workflow "${wf.name}" exceeded maxExecutionsPerHour (${count}/${limit})`,
    };
  }

  return { allowed: true, count, limit };
}
