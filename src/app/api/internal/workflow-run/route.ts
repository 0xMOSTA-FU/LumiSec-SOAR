/**
 * Internal endpoint for soar-worker — runs LumiSec engine without user session.
 * Auth: Authorization: Bearer WORKER_API_KEY
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { runWorkflow } from '@/lib/executors/engine';
import { finishExecution } from '@/lib/shuffle-backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKER_API_KEY = process.env.WORKER_API_KEY || '';

function authorize(req: NextRequest): boolean {
  if (!WORKER_API_KEY) {
    return process.env.NODE_ENV !== 'production';
  }
  const auth = req.headers.get('authorization') || '';
  return auth.replace(/^Bearer\s+/i, '') === WORKER_API_KEY;
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ success: false, reason: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      executionId,
      workflowId,
      workflowName,
      nodes,
      edges,
      trigger = {},
      tenantId,
    } = body;

    if (!executionId || !workflowId || !Array.isArray(nodes)) {
      return NextResponse.json(
        { success: false, reason: 'executionId, workflowId, nodes required' },
        { status: 400 },
      );
    }

    // Persist execution row for UI polling when workflow exists in Prisma
    const existingWf = await db.workflow.findUnique({ where: { id: workflowId } }).catch(() => null);

    if (existingWf) {
      await db.workflowExecution.create({
        data: {
          id: executionId,
          workflowId,
          status: 'running',
          trigger: JSON.stringify(trigger),
          logs: '[]',
          result: '{}',
          tenantId: tenantId || existingWf.tenantId || null,
        },
      }).catch(() => {
        // May already exist if triggered from UI
      });
    }

    const result = await runWorkflow({
      executionId,
      workflowId,
      triggerPayload: trigger,
      tenantId: tenantId || existingWf?.tenantId || null,
      startedBy: 'worker',
      requestId: randomUUID(),
      workflowOverride: {
        id: workflowId,
        name: workflowName || existingWf?.name || 'Workflow',
        nodes,
        edges: edges || [],
      },
    });

    if (existingWf) {
      await db.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: result.success ? 'success' : 'failed',
          logs: JSON.stringify(result.logs),
          result: JSON.stringify(result.result),
          endedAt: new Date(),
          durationMs: result.durationMs,
        },
      }).catch(() => {});
    }

    // Notify shuffle backend (best-effort)
    await finishExecution(executionId, result.success ? 'FINISHED' : 'FAILED').catch(() => {});

    return NextResponse.json({
      success: result.success,
      executionId,
      logs: result.logs,
      outputs: result.outputs,
      executedNodeIds: result.executedNodeIds,
      failedNodeIds: result.failedNodeIds,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error('[internal/workflow-run]', error);
    return NextResponse.json(
      { success: false, reason: error instanceof Error ? error.message : 'Execution failed' },
      { status: 500 },
    );
  }
}
