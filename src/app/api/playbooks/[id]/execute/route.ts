// POST /api/playbooks/[id]/execute
// Executes the workflow linked to this playbook (if any) and returns
// the new execution id so the front-end can poll for live logs.
//
// SECURITY FIX (AUDIT-2 finding #1 — CRITICAL):
// Previously this route had ZERO authentication. Anyone could execute any
// playbook, triggering outbound HTTP calls (Slack, VirusTotal, firewalls).
// Now enforces: extractAuthContext + requirePermission(WORKFLOW_EXECUTE)
// + tenant ownership check + per-caller rate limit.
//
// PERF FIX (AUDIT-3): removed the 800ms artificial `setTimeout` delay
// that every playbook execution paid just to let initial logs persist.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runWorkflow } from '@/lib/executors/engine';
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
import { recordWorkflowStart } from '@/lib/soar/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.WORKFLOW_EXECUTE);

    // Per-caller rate limit: 30 playbook executions / minute.
    const rlKey = ctx.userId || ctx.apiKeyId || request.headers.get('x-forwarded-for') || 'unknown';
    const rl = rateLimit(`playbook-execute:${rlKey}`, 'workflow:execute');
    if (!rl.allowed) {
      return rateLimitResponse(rl) as unknown as NextResponse;
    }

    const { id: playbookId } = await params;
    const body = await request.json().catch(() => ({}));
    const trigger = body.trigger || {};

    const playbook = await db.playbook.findUnique({ where: { id: playbookId } });
    if (!playbook) {
      return NextResponse.json({ error: 'Playbook not found' }, { status: 404 });
    }
    // SECURITY: tenant ownership check
    if (ctx.tenantId && playbook.tenantId && playbook.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Playbook not found' }, { status: 404 });
    }

    if (!playbook.workflowId) {
      return NextResponse.json(
        { error: 'This playbook has no linked workflow. Link a workflow first.' },
        { status: 409 }
      );
    }

    const workflow = await db.workflow.findUnique({ where: { id: playbook.workflowId } });
    if (!workflow) {
      return NextResponse.json(
        { error: 'Linked workflow no longer exists. Update the playbook.' },
        { status: 409 }
      );
    }
    // SECURITY: tenant ownership check on workflow
    if (ctx.tenantId && workflow.tenantId && workflow.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    // Build a trigger payload that includes playbook context
    const fullTrigger: Record<string, unknown> = {
      ...trigger,
      playbook_id: playbook.id,
      playbook_name: playbook.name,
      playbook_category: playbook.category,
      _meta: {
        triggeredBy: ctx.userId,
        triggeredByEmail: ctx.email,
        triggeredAt: new Date().toISOString(),
        requestId: ctx.requestId,
      },
    };

    // Create execution record
    const execution = await db.workflowExecution.create({
      data: {
        workflowId: workflow.id,
        tenantId: ctx.tenantId || workflow.tenantId,
        status: 'running',
        trigger: JSON.stringify(fullTrigger),
        triggerType: 'api',
        startedBy: ctx.userId,
        requestId: ctx.requestId,
        result: JSON.stringify({}),
        logs: JSON.stringify([
          {
            time: new Date().toISOString(),
            message: `Playbook "${playbook.name}" triggered workflow "${workflow.name}" by ${ctx.email || ctx.username}`,
            level: 'info',
          },
        ]),
      },
    });

    // Record metrics (now actually works — see metrics.ts fix)
    recordWorkflowStart(workflow.id, ctx.tenantId || 'default');

    // Run the engine in the background
    runWorkflow({
      executionId: execution.id,
      workflowId: workflow.id,
      triggerPayload: fullTrigger,
      tenantId: ctx.tenantId || workflow.tenantId,
      startedBy: ctx.userId || ctx.email,
      requestId: ctx.requestId,
    }).catch(e => console.error('runWorkflow error:', e));

    // Audit log
    await writeAudit(ctx, {
      action: 'playbook.execute',
      resource: 'playbook',
      resourceId: playbook.id,
      description: `Executed playbook "${playbook.name}" (workflow: ${workflow.name})`,
      metadata: { executionId: execution.id, workflowId: workflow.id },
    }).catch(() => { /* audit failure non-blocking */ });

    // Notify external backend (best-effort)
    if (isExternalBackendEnabled()) {
      forwardSoarEvent({
        type: 'workflow_executed',
        payload: {
          executionId: execution.id,
          workflowId: workflow.id,
          playbookId: playbook.id,
          playbookName: playbook.name,
          trigger: fullTrigger,
        },
        ts: new Date().toISOString(),
      }).catch(() => {/* swallow */});
    }

    // PERF FIX: removed `await new Promise(r => setTimeout(r, 600))`.
    // The 600ms artificial delay was a hack to let logs persist before
    // responding. The client polls /api/workflow-executions/[id] anyway,
    // so the delay just added latency. If logs aren't there yet on first
    // poll, the client retries — that's the correct pattern.

    return NextResponse.json({
      id: execution.id,
      workflowId: workflow.id,
      workflowName: workflow.name,
      playbookId: playbook.id,
      playbookName: playbook.name,
      message: 'Playbook execution started — poll GET /api/workflow-executions/[id] for live logs',
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Playbook execute error:', error);
    return NextResponse.json({ error: 'Failed to execute playbook' }, { status: 500 });
  }
}
