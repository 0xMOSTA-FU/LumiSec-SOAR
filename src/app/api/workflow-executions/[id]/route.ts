// GET /api/workflow-executions/[id]
// Returns the full execution record (status, logs, result, trigger, workflow graph).
//
// SECURITY FIX (AUDIT-2 finding #1 — CRITICAL):
// Previously this route had ZERO authentication. Anyone could read any
// execution's logs — including trigger payloads (which often contain
// incident data, IOC values, user emails) and node outputs (which often
// contain integration responses with PII). Now enforces:
//   1. extractAuthContext() — must be authenticated
//   2. requirePermission(WORKFLOW_READ)
//   3. Tenant ownership: execution.tenantId must match caller's tenant
//      (superadmin bypasses)
//   4. Per-caller rate limit

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  extractAuthContext,
  requirePermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  getConnectorCalls,
  getExecutionTraces,
  isMongoEnabled,
} from '@/lib/mongo';
import { buildExecutionView } from '@/lib/platform/execution-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.WORKFLOW_READ);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const { id } = await params;
    const execution = await db.workflowExecution.findUnique({
      where: { id },
      include: { workflow: { select: { name: true, nodes: true, edges: true, tenantId: true } } },
    });
    if (!execution) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Tenant ownership check
    if (ctx.tenantId) {
      const execTenant = execution.tenantId || execution.workflow?.tenantId;
      if (execTenant && execTenant !== ctx.tenantId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }

    let logs: unknown[] = [];
    let result: unknown = {};
    let trigger: unknown = {};
    try { logs = JSON.parse(execution.logs || '[]'); } catch { /* keep empty */ }
    try { result = JSON.parse(execution.result || '{}'); } catch { /* keep empty */ }
    try { trigger = JSON.parse(execution.trigger || '{}'); } catch { /* keep empty */ }

    let mongoTraces: unknown[] = [];
    let mongoConnectorCalls: unknown[] = [];
    if (isMongoEnabled()) {
      [mongoTraces, mongoConnectorCalls] = await Promise.all([
        getExecutionTraces(id),
        getConnectorCalls(id),
      ]);
    }

    const view = buildExecutionView(result, trigger, execution.workflow?.nodes);

    return NextResponse.json({
      id: execution.id,
      workflowId: execution.workflowId,
      workflowName: execution.workflow?.name,
      status: execution.status,
      trigger,
      result,
      logs,
      enrichment: view.enrichment,
      displayIp: view.displayIp,
      partialSuccess: view.partialSuccess,
      nodeOutputs: view.nodeSummaries,
      mongo: isMongoEnabled()
        ? { traces: mongoTraces, connector_calls: mongoConnectorCalls }
        : undefined,
      startedAt: execution.startedAt,
      endedAt: execution.endedAt,
      startedBy: execution.startedBy,
      durationMs: execution.durationMs,
      nodes: execution.workflow?.nodes,
      edges: execution.workflow?.edges,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    logger.error({ err: error }, 'Execution GET error');
    return NextResponse.json({ error: 'Failed to fetch execution' }, { status: 500 });
  }
}
