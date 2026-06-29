import type { WFEdge, WFNode } from '@/lib/executors/types';

export const WORKFLOW_QUEUE_NAME = 'soar-workflow-executions';

export interface WorkflowJobPayload {
  executionId: string;
  workflowId: string;
  workflowName: string;
  nodes: WFNode[];
  edges: WFEdge[];
  trigger: Record<string, unknown>;
  tenantId?: string | null;
  startedBy?: string | null;
  requestId?: string | null;
  triggerType?: string;
}
