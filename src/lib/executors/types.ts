// Real workflow execution engine types
// Each node executor receives a context and returns a result + logs

export interface WFNode {
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

/** Resolve executor subtype from top-level field or legacy config.subtype. */
export function resolveNodeSubtype(node: WFNode): string {
  const top = (node.subtype || '').trim();
  const cfg = node.data?.config?.subtype;
  const fromConfig = typeof cfg === 'string' ? cfg.trim() : '';
  return (top || fromConfig).toLowerCase();
}

/** Ensure subtype is set at top level and mirrored in config for persistence. */
export function normalizeWorkflowNode(raw: WFNode): WFNode {
  const subtype = resolveNodeSubtype(raw);
  if (!subtype) return raw;
  return {
    ...raw,
    subtype,
    data: {
      ...raw.data,
      config: { ...raw.data.config, subtype },
    },
  };
}

export interface WFEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourcePort?: string;
  targetPort?: string;
}

export interface WorkflowShape {
  id: string;
  name: string;
  nodes: WFNode[];
  edges: WFEdge[];
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

// Mutable execution context - flows through the graph
export interface ExecutionContext {
  trigger: Record<string, unknown>;
  outputs: Record<string, unknown>;
  result: Record<string, unknown>;
  getIntegration: (key: string) => IntegrationConfig | null;
  createCase?: (data: Record<string, unknown>) => Promise<string | null>;
  createAlert?: (data: Record<string, unknown>) => Promise<string | null>;
}

export interface IntegrationConfig {
  id: string;
  name: string;
  type: string;
  category: string;
  config: Record<string, unknown>;
  status: string;
}

export interface NodeExecutorResult {
  success: boolean;
  output?: Record<string, unknown>;
  branch?: string;
  logs: ExecutionLog[];
}

export type NodeExecutor = (
  node: WFNode,
  ctx: ExecutionContext
) => Promise<NodeExecutorResult>;

// Helper to read a value from a dotted path against a context object
export function readPath(ctx: ExecutionContext, path: string): unknown {
  if (!path) return undefined;
  if (!path.includes('.') && !path.startsWith('trigger') && !path.startsWith('outputs') && !path.startsWith('result')) {
    return path;
  }
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

import { resolveUnifiedTemplate } from '@/lib/shuffle/parameter-resolver';

// String template resolver — LumiSec {{path}} + Shuffle $exec / $action.field
export function resolveTemplate(template: string, ctx: ExecutionContext): string {
  if (!template) return '';
  return resolveUnifiedTemplate(template, ctx, { exec: ctx.trigger });
}
