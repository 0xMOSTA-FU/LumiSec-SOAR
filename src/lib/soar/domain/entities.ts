/**
 * SOAR Domain Entities
 * ---------------------------------------------------------------------------
 * Pure domain models — no infrastructure concerns (no MongoDB, no Prisma).
 * These define the canonical shape of every SOAR object. Repositories
 * translate between these and storage-specific representations.
 *
 * Hexagonal Architecture: this file lives at the center. Everything else
 * (MongoDB, REST, UI) is a port or adapter that depends on these types.
 */

// ============================================================================
// WORKFLOW
// ============================================================================
export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'action' | 'condition' | 'output';
  subtype?: string;
  position: { x: number; y: number };
  data: {
    label: string;
    description?: string;
    config: Record<string, unknown>;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourcePort?: string;
  targetPort?: string;
}

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';

export interface Workflow {
  id: string;
  tenantId?: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  trigger: Record<string, unknown>;
  tags: string[] | Record<string, unknown>;
  requiresApproval: boolean;
  maxExecutionsPerHour: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// WORKFLOW EXECUTION
// ============================================================================
export type ExecutionStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'awaiting_approval';

export type TriggerType = 'manual' | 'webhook' | 'schedule' | 'alert' | 'api';

export interface WorkflowExecution {
  id: string;
  tenantId?: string;
  workflowId: string;
  workflowName?: string;
  status: ExecutionStatus;
  trigger: Record<string, unknown>;
  triggerType: TriggerType;
  result: Record<string, unknown>;
  logs: ExecutionLog[];
  requestId?: string;
  correlationId?: string;
  startedBy?: string;
  startedAt: Date;
  endedAt?: Date;
  durationMs?: number;
}

export interface ExecutionLog {
  time: string;
  nodeId?: string;
  nodeLabel?: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  data?: unknown;
}

// ============================================================================
// INTEGRATION
// ============================================================================
export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'paused';

export interface Integration {
  id: string;
  tenantId?: string;
  name: string;
  type: string;
  category: string;
  description?: string;
  config: Record<string, unknown>; // decrypted in-memory only
  encryptedConfig: string; // never expose to client
  status: IntegrationStatus;
  icon?: string;
  lastTestedAt?: Date;
  lastTestResult?: 'success' | 'failed';
  rateLimitPerMin?: number;
  timeoutMs?: number;
  retryCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// CASE
// ============================================================================
export type CaseSeverity = 'low' | 'medium' | 'high' | 'critical';
export type CaseStatus = 'open' | 'in_progress' | 'contained' | 'closed' | 'false_positive';

export interface Case {
  id: string;
  tenantId?: string;
  title: string;
  description: string;
  severity: CaseSeverity;
  status: CaseStatus;
  tags: string[];
  artifacts: CaseArtifact[];
  timeline: CaseTimelineEntry[];
  assigneeId?: string;
  workflowExecutionId?: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
}

export interface CaseArtifact {
  type: 'ip' | 'domain' | 'url' | 'hash' | 'email' | 'user' | 'host' | 'file' | 'other';
  value: string;
  classification?: 'malicious' | 'suspicious' | 'benign' | 'unknown';
  source?: string;
}

export interface CaseTimelineEntry {
  ts: string;
  actor: string;
  actorType: 'system' | 'analyst' | 'automation';
  action: string;
  details?: unknown;
}

// ============================================================================
// ALERT
// ============================================================================
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AlertStatus = 'new' | 'triaging' | 'investigating' | 'closed' | 'false_positive';

export interface Alert {
  id: string;
  tenantId?: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  source: string;
  status: AlertStatus;
  assigneeId?: string;
  caseId?: string;
  mitreTactics?: string[];
  mitreTechniques?: string[];
  rawPayload?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// AuditLog (tamper-evident via SHA-256 hash chain)
export interface AuditLog {
  id: string;
  tenantId?: string;
  userId?: string;
  actor: string;
  actorIp?: string;
  actorType: 'user' | 'system' | 'api-key' | 'webhook';
  action: string;
  resource: string;
  resourceId?: string;
  description: string;
  before?: unknown;
  after?: unknown;
  metadata: Record<string, unknown>;
  hash: string; // SHA-256(prev_hash + canonical_json(this_record))
  prevHash?: string;
  requestId?: string;
  correlationId?: string;
  createdAt: Date;
}

// ============================================================================
// APPROVAL
// ============================================================================
export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'executed';

export interface Approval {
  id: string;
  tenantId?: string;
  workflowExecutionId?: string;
  caseId?: string;
  requestedBy: string;
  action: string;
  targetType: 'ip' | 'host' | 'user' | 'domain' | 'hash';
  targetValue: string;
  reason: string;
  status: ApprovalStatus;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  rejectionReason?: string;
  expiresAt?: Date;
  executedAt?: Date;
  executionResult?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// EXECUTION TRACE (per-node call — high-volume, stored in MongoDB)
// ============================================================================
export interface ExecutionTrace {
  _id?: string;
  executionId: string;
  workflowId: string;
  nodeId: string;
  nodeLabel?: string;
  nodeSubtype?: string;
  nodeType?: string;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  success: boolean;
  branch?: string;
  logs?: unknown[];
  output?: unknown;
  error?: string;
  attempt?: number;
  integrationType?: string;
  integrationId?: string;
  correlationId?: string;
}

// ============================================================================
// IDEMPOTENCY KEY
// ============================================================================
export interface IdempotencyRecord {
  key: string;
  executionId?: string;
  result?: unknown;
  status: 'pending' | 'completed' | 'failed';
  createdAt: Date;
  expiresAt: Date;
}
