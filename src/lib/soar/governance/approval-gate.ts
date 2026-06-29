/**
 * Human-in-the-loop governance — destructive actions require approval.
 */
import { db } from '@/lib/db';
import type { AuthContext } from '@/lib/auth';

export const DESTRUCTIVE_ACTIONS = new Set([
  'block_ip',
  'isolate_host',
  'disable_user',
  'reset_password',
  'firewall_rule',
  'execute_workflow',
]);

export const DESTRUCTIVE_NODE_SUBTYPES = new Set([
  'block',
  'isolate',
]);

function stringifyMeta(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

export interface ApprovalGateResult {
  allowed: boolean;
  approvalId?: string;
  reason?: string;
}

/** Superadmin may bypass approval only when SOAR_APPROVAL_BYPASS=1 (dev/demo). */
export function canBypassApproval(ctx: AuthContext): boolean {
  if (process.env.SOAR_APPROVAL_BYPASS !== '1') return false;
  return ctx.roles?.includes('superadmin') ?? false;
}

export async function verifyApprovedAction(
  approvalId: string,
  action: string,
  targetValue: string,
  tenantId?: string | null,
): Promise<ApprovalGateResult> {
  const approval = await db.approval.findUnique({
    where: { id: approvalId },
    include: { steps: true },
  });

  if (!approval) return { allowed: false, reason: 'Approval not found' };
  if (tenantId && approval.tenantId && approval.tenantId !== tenantId) {
    return { allowed: false, reason: 'Approval tenant mismatch' };
  }
  if (approval.status !== 'approved') {
    return { allowed: false, reason: `Approval status is ${approval.status}` };
  }
  if (approval.action !== action) {
    return { allowed: false, reason: 'Approval action mismatch' };
  }
  if (approval.targetValue !== targetValue) {
    return { allowed: false, reason: 'Approval target mismatch' };
  }
  if (approval.expiresAt && approval.expiresAt < new Date()) {
    return { allowed: false, reason: 'Approval expired' };
  }

  return { allowed: true, approvalId };
}

export async function getOrCreatePendingApproval(input: {
  ctx: AuthContext;
  action: string;
  targetType: string;
  targetValue: string;
  reason?: string;
  workflowExecutionId?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string; status: string }> {
  const existing = await db.approval.findFirst({
    where: {
      action: input.action,
      targetValue: input.targetValue,
      status: 'pending',
      ...(input.ctx.tenantId ? { tenantId: input.ctx.tenantId } : {}),
      ...(input.workflowExecutionId ? { workflowExecutionId: input.workflowExecutionId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return { id: existing.id, status: existing.status };

  const HIGH_IMPACT = ['block_ip', 'isolate_host', 'disable_user', 'reset_password', 'firewall_rule'];
  const riskLevel = HIGH_IMPACT.includes(input.action) ? 'high' : 'medium';
  const approverRole = riskLevel === 'high' ? 'admin' : 'analyst';

  const approval = await db.approval.create({
    data: {
      tenantId: input.ctx.tenantId,
      workflowExecutionId: input.workflowExecutionId,
      requestedBy: input.ctx.userId || 'system',
      action: input.action,
      targetType: input.targetType,
      targetValue: input.targetValue,
      reason: input.reason || '',
      riskLevel,
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      metadata: stringifyMeta(input.metadata),
      steps: {
        create: [{ stepNumber: 1, approverRole }],
      },
    },
  });

  return { id: approval.id, status: approval.status };
}

export async function requireDestructiveApproval(input: {
  ctx: AuthContext;
  action: string;
  targetType: string;
  targetValue: string;
  approvalId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<ApprovalGateResult> {
  if (canBypassApproval(input.ctx)) {
    return { allowed: true };
  }

  if (input.approvalId) {
    return verifyApprovedAction(
      input.approvalId,
      input.action,
      input.targetValue,
      input.ctx.tenantId,
    );
  }

  const pending = await getOrCreatePendingApproval(input);
  return {
    allowed: false,
    approvalId: pending.id,
    reason: 'Human approval required for destructive action',
  };
}

export async function verifyNodeExecutionApproval(
  executionId: string,
  nodeId: string,
  subtype: string,
  tenantId?: string | null,
): Promise<ApprovalGateResult> {
  if (process.env.SOAR_APPROVAL_BYPASS === '1') {
    return { allowed: true };
  }

  const action = `node_${subtype}`;
  const targetValue = `${executionId}:${nodeId}`;

  const approved = await db.approval.findFirst({
    where: {
      action,
      targetValue,
      status: 'approved',
      ...(tenantId ? { tenantId } : {}),
    },
    orderBy: { approvedAt: 'desc' },
  });

  if (approved) {
    if (approved.expiresAt && approved.expiresAt < new Date()) {
      return { allowed: false, reason: 'Node approval expired' };
    }
    return { allowed: true, approvalId: approved.id };
  }

  const pending = await db.approval.findFirst({
    where: {
      action,
      targetValue,
      status: 'pending',
      ...(tenantId ? { tenantId } : {}),
    },
  });

  if (pending) {
    return { allowed: false, approvalId: pending.id, reason: 'Awaiting node approval' };
  }

  return { allowed: false, reason: 'Node approval required' };
}

export async function createNodeApprovalRequest(input: {
  executionId: string;
  workflowId: string;
  nodeId: string;
  nodeLabel: string;
  subtype: string;
  tenantId?: string | null;
  requestedBy?: string;
}): Promise<string> {
  const action = `node_${input.subtype}`;
  const targetValue = `${input.executionId}:${input.nodeId}`;

  const approval = await db.approval.create({
    data: {
      tenantId: input.tenantId,
      workflowExecutionId: input.executionId,
      requestedBy: input.requestedBy || 'system',
      action,
      targetType: 'workflow_node',
      targetValue,
      reason: `Destructive node "${input.nodeLabel}" (${input.subtype}) in workflow execution`,
      riskLevel: 'high',
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      metadata: stringifyMeta({
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        subtype: input.subtype,
      }),
      steps: {
        create: [{ stepNumber: 1, approverRole: 'admin' }],
      },
    },
  });

  return approval.id;
}
