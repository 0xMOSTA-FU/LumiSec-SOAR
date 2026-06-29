export type Page =
  | 'dashboard'
  | 'workflows'
  | 'workflow-builder'
  | 'cases'
  | 'integrations'
  | 'playbooks'
  | 'alerts'
  | 'settings'
  | 'analytics'
  | 'threat-ops'
  | 'incident-detail'
  // Gateway mode (LumiSec /api/soar/*)
  | 'incidents'
  | 'connectors'
  | 'vault'
  | 'artifacts'
  | 'webhook-sources'
  | 'gateway-incident-detail'
  | 'playbook-runs'
  | 'playbook-run-detail';

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'action' | 'condition' | 'output';
  subtype?: string;
  position: { x: number; y: number };
  data: { label: string; config: Record<string, unknown>; description?: string };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  trigger: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  executions?: { id: string; status: string; startedAt: string }[];
}

export interface CaseItem {
  id: string;
  title: string;
  description?: string;
  severity: string;
  status: string;
  assignee?: string;
  tags: string[];
  artifacts: string[];
  timeline: { time: string; event: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface Integration {
  id: string;
  name: string;
  type: string;
  category: string;
  description?: string;
  config: Record<string, unknown>;
  status: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

export interface Playbook {
  id: string;
  name: string;
  description?: string;
  category: string;
  steps: { order: number; name: string; action: string; automation: string }[];
  triggers: { type: string; condition: string }[];
  status: string;
  tags: string[];
  workflowId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertItem {
  id: string;
  title: string;
  description?: string;
  source: string;
  severity: string;
  status: string;
  assignee?: string;
  caseId?: string;
  raw: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardMetrics {
  openCases: number;
  criticalCases: number;
  activeWorkflows: number;
  newAlerts: number;
  connectedIntegrations: number;
  runningExecutions: number;
  recentAlerts: number;
  recentCases: number;
  recentExecutions: number;
  totalWorkflows: number;
  totalCases: number;
  totalAlerts: number;
  totalPlaybooks: number;
  externalIncidents?: number;
  externalAssets?: number;
  externalBackendOk?: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string | null;
  fullName: string | null;
  roles: string[];
  authMethod: string;
  devAuth?: boolean;
}
