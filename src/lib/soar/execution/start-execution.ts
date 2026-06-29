/**
 * Unified workflow execution starter — inline, Shuffle queue, or BullMQ.
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { runWorkflow } from '@/lib/executors/engine';
import { logger } from '@/lib/logger';
import { recordWorkflowStart } from '@/lib/soar/observability/metrics';
import {
  getExecutionMode,
  useBullMqExecution,
} from '@/lib/soar/config';
import { enqueueWorkflowJob } from '@/lib/soar/queue/workflow-queue';
import {
  executeShuffleWorkflow,
  isShuffleBackendEnabled,
  syncWorkflowToShuffle,
} from '@/lib/shuffle-backend';
import type { WFEdge, WFNode } from '@/lib/executors/types';
import { normalizeWorkflowNode } from '@/lib/executors/types';
import { checkWorkflowExecutionLimit } from '@/lib/soar/governance/execution-limits';

export interface StartWorkflowExecutionInput {
  workflow: {
    id: string;
    name: string;
    description?: string | null;
    tenantId?: string | null;
    nodes: string;
    edges: string;
    tags?: string;
  };
  trigger: Record<string, unknown>;
  triggerType?: string;
  startedBy?: string | null;
  requestId?: string | null;
  tenantId?: string | null;
  executionId?: string;
}

export interface StartWorkflowExecutionResult {
  executionId: string;
  mode: 'inline' | 'shuffle' | 'bullmq';
  status: 'running' | 'queued';
}

function parseGraph(workflow: StartWorkflowExecutionInput['workflow']) {
  let nodes: WFNode[] = [];
  let edges: WFEdge[] = [];
  let tags: unknown = [];
  try { nodes = JSON.parse(workflow.nodes || '[]').map((n: WFNode) => normalizeWorkflowNode(n)); } catch { /* empty */ }
  try { edges = JSON.parse(workflow.edges || '[]'); } catch { /* empty */ }
  try { tags = JSON.parse(workflow.tags || '[]'); } catch { /* empty */ }
  return { nodes, edges, tags };
}

export async function startWorkflowExecution(
  input: StartWorkflowExecutionInput,
): Promise<StartWorkflowExecutionResult> {
  const limit = await checkWorkflowExecutionLimit(input.workflow.id);
  if (!limit.allowed) {
    throw new Error(limit.reason || 'WORKFLOW_RATE_LIMIT');
  }

  const executionId = input.executionId || randomUUID();
  const mode = getExecutionMode();
  const effectiveTenant = input.tenantId ?? input.workflow.tenantId ?? null;
  const { nodes, edges, tags } = parseGraph(input.workflow);

  if (mode === 'shuffle' && isShuffleBackendEnabled()) {
    await syncWorkflowToShuffle({
      id: input.workflow.id,
      name: input.workflow.name,
      description: input.workflow.description || undefined,
      tenantId: effectiveTenant,
      nodes,
      edges,
      tags,
    }).catch(e => logger.warn({ err: e }, 'shuffle sync failed'));

    const queued = await executeShuffleWorkflow(input.workflow.id, input.trigger);
    const shuffleExecId = (queued.execution_id || queued.data?.id_ || executionId) as string;

    await db.workflowExecution.create({
      data: {
        id: shuffleExecId,
        workflowId: input.workflow.id,
        tenantId: effectiveTenant,
        status: 'running',
        triggerType: input.triggerType || 'api',
        trigger: JSON.stringify(input.trigger),
        result: JSON.stringify({ queued: true, backend: 'shuffle' }),
        startedBy: input.startedBy || 'system',
        requestId: input.requestId || null,
        logs: JSON.stringify([
          { time: new Date().toISOString(), message: 'Execution queued for shuffle worker', level: 'info' },
        ]),
      },
    });

    recordWorkflowStart(input.workflow.id, effectiveTenant || 'default');
    return { executionId: shuffleExecId, mode: 'shuffle', status: 'queued' };
  }

  await db.workflowExecution.create({
    data: {
      id: executionId,
      workflowId: input.workflow.id,
      tenantId: effectiveTenant,
      status: 'running',
      triggerType: input.triggerType || 'api',
      trigger: JSON.stringify(input.trigger),
      result: JSON.stringify({}),
      startedBy: input.startedBy || 'system',
      requestId: input.requestId || null,
      logs: JSON.stringify([
        {
          time: new Date().toISOString(),
          message: mode === 'inline'
            ? 'Workflow execution started'
            : `Workflow execution queued (${mode})`,
          level: 'info',
        },
      ]),
    },
  });

  recordWorkflowStart(input.workflow.id, effectiveTenant || 'default');

  if (useBullMqExecution()) {
    await enqueueWorkflowJob({
      executionId,
      workflowId: input.workflow.id,
      workflowName: input.workflow.name,
      nodes,
      edges,
      trigger: input.trigger,
      tenantId: effectiveTenant,
      startedBy: input.startedBy,
      requestId: input.requestId,
      triggerType: input.triggerType,
    });
    return { executionId, mode: 'bullmq', status: 'queued' };
  }

  runWorkflow({
    executionId,
    workflowId: input.workflow.id,
    triggerPayload: input.trigger,
    tenantId: effectiveTenant,
    startedBy: input.startedBy,
    requestId: input.requestId,
  }).catch(e => logger.error({ err: e, executionId, workflowId: input.workflow.id }, 'runWorkflow error'));

  return { executionId, mode: 'inline', status: 'running' };
}
