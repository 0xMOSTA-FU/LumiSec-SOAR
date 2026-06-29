// CRUD for workflows.
//
// SECURITY FIX (AUDIT-2 finding #1 — CRITICAL):
// Previously this route had ZERO authentication. Anyone with network access
// could list, create, update, and delete any workflow across all tenants.
// Now every handler enforces:
//   1. extractAuthContext() — must be authenticated (no anonymous)
//   2. requirePermission() — must have the right RBAC permission
//   3. tenantId filter — queries scoped to caller's tenant
//   4. Zod input validation — no mass-assignment
//   5. Audit log entry on every mutation

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  extractAuthContext,
  requirePermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { writeAudit as logAudit } from '@/lib/audit';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Zod schemas (input validation — prevents mass-assignment) ─────────────

const WorkflowCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional().default('draft'),
  nodes: z.array(z.any()).optional().default([]),
  edges: z.array(z.any()).optional().default([]),
  trigger: z.any().optional().default({}),
  tags: z.array(z.any()).optional().default([]),
  requiresApproval: z.boolean().optional().default(false),
  maxExecutionsPerHour: z.number().int().min(1).max(10000).optional().default(100),
});

const WorkflowUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
  nodes: z.array(z.any()).optional(),
  edges: z.array(z.any()).optional(),
  trigger: z.any().optional(),
  tags: z.array(z.any()).optional(),
  requiresApproval: z.boolean().optional(),
  maxExecutionsPerHour: z.number().int().min(1).max(10000).optional(),
});

// ── Handlers ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.WORKFLOW_READ);

    // SECURITY: scope to caller's tenant. Superadmin (tenantId=null) sees all.
    const where = ctx.tenantId ? { tenantId: ctx.tenantId } : {};
    const workflows = await db.workflow.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { executions: { take: 1, orderBy: { startedAt: 'desc' } } },
    });
    return NextResponse.json(workflows);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Workflows GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch workflows' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.WORKFLOW_WRITE);

    const body = await req.json();
    const parsed = WorkflowCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const workflow = await db.workflow.create({
      data: {
        tenantId: ctx.tenantId,
        name: data.name,
        description: data.description,
        status: data.status,
        nodes: JSON.stringify(data.nodes),
        edges: JSON.stringify(data.edges),
        trigger: JSON.stringify(data.trigger),
        tags: JSON.stringify(data.tags),
        requiresApproval: data.requiresApproval,
        maxExecutionsPerHour: data.maxExecutionsPerHour,
      },
    });

    await logAudit(ctx, {
      action: 'workflow.create',
      resource: 'workflow',
      resourceId: workflow.id,
      description: `Created workflow "${workflow.name}"`,
      after: { name: workflow.name, status: workflow.status },
    }).catch(() => { /* audit failure non-blocking */ });

    return NextResponse.json(workflow, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Workflow POST error:', error);
    return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.WORKFLOW_WRITE);

    const body = await req.json();
    const parsed = WorkflowUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { id, ...data } = parsed.data;

    // SECURITY: ownership check — caller can only update workflows in their tenant.
    const existing = await db.workflow.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }
    if (ctx.tenantId && existing.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    // Build update data — only allowlisted fields (no mass-assignment)
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.nodes !== undefined) updateData.nodes = JSON.stringify(data.nodes);
    if (data.edges !== undefined) updateData.edges = JSON.stringify(data.edges);
    if (data.trigger !== undefined) updateData.trigger = JSON.stringify(data.trigger);
    if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags);
    if (data.requiresApproval !== undefined) updateData.requiresApproval = data.requiresApproval;
    if (data.maxExecutionsPerHour !== undefined) updateData.maxExecutionsPerHour = data.maxExecutionsPerHour;

    const workflow = await db.workflow.update({ where: { id }, data: updateData });

    await logAudit(ctx, {
      action: 'workflow.update',
      resource: 'workflow',
      resourceId: id,
      description: `Updated workflow "${workflow.name}"`,
      before: { name: existing.name, status: existing.status },
      after: { name: workflow.name, status: workflow.status },
    }).catch(() => { /* audit failure non-blocking */ });

    return NextResponse.json(workflow);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Workflow PUT error:', error);
    return NextResponse.json({ error: 'Failed to update workflow' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.WORKFLOW_DELETE);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    // SECURITY: ownership check
    const existing = await db.workflow.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }
    if (ctx.tenantId && existing.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    // Delete executions first (foreign key constraint) — but PRESERVE them
    // as audit evidence by soft-deleting instead. For now, hard-delete with
    // audit log entry capturing the workflow metadata.
    await db.workflowExecution.deleteMany({ where: { workflowId: id } });
    await db.workflow.delete({ where: { id } });

    await logAudit(ctx, {
      action: 'workflow.delete',
      resource: 'workflow',
      resourceId: id,
      description: `Deleted workflow "${existing.name}"`,
      before: { name: existing.name, status: existing.status },
    }).catch(() => { /* audit failure non-blocking */ });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Workflow DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete workflow' }, { status: 500 });
  }
}
