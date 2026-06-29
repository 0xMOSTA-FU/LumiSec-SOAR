/**
 * Factory for certified Wave 2+ connectors — full manifest + legacy executor bridge.
 */
import type { NodeManifest, NodeExecutor } from './manifest';
import { safeValidateManifest } from './manifest';
import { defineNode } from './registry';
import { toLegacyCtx, toLegacyNode } from './legacy-bridge';
import type { NodeExecutorResult, WFNode, ExecutionContext } from '@/lib/executors/types';

type ManifestInput = Record<string, unknown> &
  Pick<NodeManifest, 'id' | 'name' | 'category' | 'description'>;

export function buildCertifiedConnector(
  manifest: ManifestInput,
  execute: (node: WFNode, ctx: ExecutionContext) => Promise<NodeExecutorResult>,
): NodeExecutor {
  const validated = safeValidateManifest({
    version: '1.0.0',
    errors: [
      { code: 'AUTH_FAILED', message: 'Authentication failed', retryable: false },
      { code: 'NO_INTEGRATION', message: 'Integration not configured', retryable: false },
      { code: 'INVALID_INPUT', message: 'Invalid input parameters', retryable: false },
      { code: 'NETWORK_ERROR', message: 'Network error', retryable: true },
    ],
    compliance: { dataClassification: 'confidential', piiHandling: true, gdprRelevant: true, retentionDays: 90 },
    examples: [],
    ...manifest,
  });
  if (!validated.ok) {
    throw new Error(`Invalid connector manifest (${manifest.id}): ${validated.error}`);
  }
  return defineNode(validated.manifest, async (node, ctx) => {
    const legacy = await execute(toLegacyNode(node), toLegacyCtx(ctx));
    return {
      success: legacy.success,
      output: legacy.output,
      branch: legacy.branch,
      logs: legacy.logs,
    };
  });
}
