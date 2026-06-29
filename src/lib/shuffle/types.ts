/**
 * Shuffle-compatible workflow document shapes (reference: TECHNICAL_DOCUMENTATION_AR.md §5)
 */

export interface ShuffleParameter {
  name: string;
  value: string;
  configuration?: boolean;
  required?: boolean;
}

export interface ShuffleAction {
  id_: string;
  app_name: string;
  app_version: string;
  name: string;
  label: string;
  environment?: string;
  parameters: ShuffleParameter[];
  position?: { x: number; y: number };
  priority?: number;
  execution_delay?: number;
}

export interface ShuffleBranch {
  id_: string;
  source_id: string;
  destination_id: string;
  conditions?: unknown[];
  label?: string;
}

export interface ShuffleCondition {
  id_: string;
  app_name: string;
  name: string;
  label?: string;
  conditional: string;
  position?: { x: number; y: number };
}

export interface ShuffleTrigger {
  id_: string;
  app_name: string;
  name: string;
  label?: string;
  triggerType?: string;
  parameters: ShuffleParameter[];
  position?: { x: number; y: number };
}

export interface ShuffleWorkflow {
  id_: string;
  org_id?: string;
  name: string;
  description?: string;
  start: string;
  is_valid: boolean;
  actions: ShuffleAction[];
  branches: ShuffleBranch[];
  conditions: ShuffleCondition[];
  triggers: ShuffleTrigger[];
  transforms?: unknown[];
  workflow_variables?: unknown[];
  tags?: string[];
  lumisec_nodes?: unknown[];
  lumisec_edges?: unknown[];
  created_at?: string;
  updated_at?: string;
}

export type ShuffleExecutionStatus =
  | 'EXECUTING'
  | 'FINISHED'
  | 'FAILED'
  | 'ABORTED'
  | 'WAITING';

export interface ShuffleActionResult {
  action_id: string;
  result: unknown;
  status: string;
  completed_at?: string;
}

export interface ShuffleWorkflowExecution {
  id_: string;
  workflow_id: string;
  org_id?: string;
  status: ShuffleExecutionStatus;
  workflow: ShuffleWorkflow;
  results: ShuffleActionResult[];
  authorization?: string;
  started_at: string;
  completed_at?: string;
  execution_argument?: Record<string, unknown>;
}

export interface ShuffleQueueItem {
  execution_id: string;
  workflow_id: string;
  org_id?: string;
  environment: string;
  priority: number;
  status: 'pending' | 'processing' | 'done';
}
