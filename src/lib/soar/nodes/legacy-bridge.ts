/**
 * Wrap legacy executor functions in NodeManifest registry entries.
 * Enables gradual migration without rewriting all 27 nodes at once.
 */

import type { NodeCategory, NodeExecutor } from './manifest';
import { safeValidateManifest } from './manifest';
import { defineNode } from './registry';
import type { NodeExecutorResult, WFNode, ExecutionContext, NodeExecutor as LegacyExecutor } from '@/lib/executors/types';
import type { NodeExecutionContext } from './manifest';

export function toLegacyCtx(ctx: NodeExecutionContext): ExecutionContext {
  return {
    trigger: ctx.trigger,
    outputs: ctx.outputs,
    result: {},
    getIntegration: (key) => {
      const i = ctx.getIntegration(key);
      if (!i) return null;
      return {
        id: i.id,
        name: i.name,
        type: i.type,
        category: i.type,
        config: i.config,
        status: i.status,
      };
    },
    createCase: ctx.createCase,
    createAlert: ctx.createAlert,
  };
}

export function toLegacyNode(node: Parameters<NodeExecutor['execute']>[0]): WFNode {
  return {
    id: node.id,
    type: node.type,
    subtype: node.subtype,
    position: { x: 0, y: 0 },
    data: node.data,
  };
}

export function wrapLegacyExecutor(opts: {
  id: string;
  name: string;
  category: NodeCategory;
  description: string;
  vendor?: string;
  docsUrl?: string;
  allowedHosts?: string[];
  requiresApproval?: boolean;
  execute: (node: WFNode, ctx: ExecutionContext) => Promise<NodeExecutorResult>;
}): NodeExecutor {
  const validated = safeValidateManifest({
    id: opts.id,
    name: opts.name,
    version: '1.0.0',
    category: opts.category,
    description: opts.description,
    vendor: opts.vendor || 'CyberSOAR',
    docsUrl: opts.docsUrl,
    allowedHosts: opts.allowedHosts || [],
    requiresApproval: opts.requiresApproval || false,
    errors: [
      { code: 'AUTH_FAILED', message: 'Authentication failed', retryable: false },
      { code: 'NETWORK_ERROR', message: 'Network error', retryable: true },
      { code: 'TIMEOUT', message: 'Request timed out', retryable: true },
    ],
    compliance: { dataClassification: 'internal' as const, piiHandling: false, gdprRelevant: false, retentionDays: 90 },
    examples: [],
  });
  if (!validated.ok) {
    throw new Error(`Invalid legacy node manifest (${opts.id}): ${validated.error}`);
  }

  return defineNode(validated.manifest, async (node, ctx) => {
    const legacy = await opts.execute(toLegacyNode(node), toLegacyCtx(ctx));
    return {
      success: legacy.success,
      output: legacy.output,
      branch: legacy.branch,
      logs: legacy.logs,
    };
  });
}

export type { LegacyExecutor };
