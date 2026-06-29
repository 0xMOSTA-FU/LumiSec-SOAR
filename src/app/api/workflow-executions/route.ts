// Workflow execution API
//
// SECURITY FIX (AUDIT-2 finding #1 — CRITICAL):
// Previously this route had ZERO authentication. Anyone with network access
// could execute ANY workflow (triggering outbound HTTP calls to Slack,
// VirusTotal, firewalls, email) and list all execution logs across all
// tenants — exposing trigger payloads, secrets in logs, and integration
// responses. This was the #1 critical finding.
//
// Now enforces:
//   1. extractAuthContext() — must be authenticated (no anonymous)
//   2. requirePermission(WORKFLOW_EXECUTE) for POST, WORKFLOW_READ for GET
//   3. tenantId scoping on GET (superadmin sees all)
//   4. Workflow must belong to caller's tenant (or caller is superadmin)
//   5. Per-caller rate limit (prevent workflow-execution DoS)
//   6. Zod input validation
//   7. Audit log entry on every execution

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { forwardSoarEvent, isExternalBackendEnabled } from '@/lib/external-api';
import {
  extractAuthContext,
  requirePermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { startWorkflowExecution } from '@/lib/soar/execution/start-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ExecuteSchema = z.object({
  workflowId: z.string().min(1),
  trigger: z.record(z.string(), z.unknown()).optional().default({}),
  /** Builder "Run Test" — allows draft workflows without activating */
  testRun: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.WORKFLOW_EXECUTE);

    // Per-caller rate limit — workflow execution is expensive.
    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'workflow:execute');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const body = await request.json();
    const parsed = ExecuteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { workflowId, trigger, testRun } = parsed.data;

    const triggerPayload: Record<string, unknown> = {
      ...(trigger || {}),
      ...(testRun ? { testRun: true, _source: 'workflow_builder' } : {}),
    };

    // Tenant ownership check: the workflow must belong to the caller's tenant.
    // Superadmin (tenantId=null) can execute any workflow.
    const workflow = await db.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }
    if (ctx.tenantId && workflow.tenantId && workflow.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }
    if (!testRun && workflow.status !== 'active') {
      return NextResponse.json(
        { error: `Workflow is not active (status=${workflow.status}). Activate it first, or use Run Test from the builder.` },
        { status: 409 },
      );
    }
    if (testRun && !['active', 'draft'].includes(workflow.status)) {
      return NextResponse.json(
        { error: `Cannot test-run workflow in status=${workflow.status}` },
        { status: 409 },
      );
    }

    const started = await startWorkflowExecution({
      workflow,
      trigger: triggerPayload,
      triggerType: testRun ? 'manual' : 'api',
      startedBy: ctx.userId || ctx.email || ctx.actorIp || 'unknown',
      requestId: ctx.requestId,
      tenantId: ctx.tenantId || workflow.tenantId,
    });

    await writeAudit(ctx, {
      action: 'workflow.execute',
      resource: 'workflow',
      resourceId: workflowId,
      description: `Executed workflow "${workflow.name}" (execution ${started.executionId}, mode=${started.mode})`,
      metadata: { executionId: started.executionId, trigger: triggerPayload, mode: started.mode, testRun },
    });

    if (isExternalBackendEnabled()) {
      forwardSoarEvent({
        type: 'workflow_executed',
        payload: { executionId: started.executionId, workflowId, trigger, mode: started.mode },
        ts: new Date().toISOString(),
      }).catch(() => {});
    }

    if (started.mode === 'inline') {
      await new Promise(r => setTimeout(r, 800));
    }

    return NextResponse.json({
      id: started.executionId,
      execution_id: started.executionId,
      workflowId,
      status: started.status,
      mode: started.mode,
      message: started.status === 'queued'
        ? `Execution queued (${started.mode}) — poll GET /api/workflow-executions/${started.executionId}`
        : 'Execution started - poll GET for live logs',
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    logger.error({ err: error }, 'Execution POST error');
    return NextResponse.json({ error: 'Failed to create execution' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.WORKFLOW_READ);

    // Scope to caller's tenant. Superadmin (tenantId=null) sees all.
    const where = ctx.tenantId ? { tenantId: ctx.tenantId } : {};
    const executions = await db.workflowExecution.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { workflow: { select: { name: true } } },
    });
    return NextResponse.json(executions);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    logger.error({ err: error }, 'Executions GET error');
    return NextResponse.json({ error: 'Failed to fetch executions' }, { status: 500 });
  }
}
