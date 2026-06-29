import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  extractAuthContext,
  requirePermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function serializePlaybook(row: {
  id: string;
  name: string;
  description: string | null;
  category: string;
  steps: string;
  triggers: string;
  status: string;
  version: number;
  tags: string;
  workflowId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    steps: parseJsonField(row.steps, []),
    triggers: parseJsonField(row.triggers, []),
    tags: parseJsonField(row.tags, []),
  };
}

const PlaybookCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(''),
  category: z.string().max(100).optional().default('incident_response'),
  steps: z.array(z.unknown()).optional().default([]),
  triggers: z.array(z.unknown()).optional().default([]),
  tags: z.array(z.unknown()).optional().default([]),
  status: z.enum(['active', 'draft', 'archived']).optional().default('active'),
  workflowId: z.string().nullable().optional(),
});

const PlaybookUpdateSchema = PlaybookCreateSchema.partial().extend({
  id: z.string().min(1),
});

function tenantWhere(ctx: Awaited<ReturnType<typeof extractAuthContext>>) {
  return ctx.tenantId ? { tenantId: ctx.tenantId } : {};
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') throw new AuthenticationError('Authentication required');
    requirePermission(ctx, PERMISSIONS.WORKFLOW_READ);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (id) {
      const playbook = await db.playbook.findFirst({ where: { id, ...tenantWhere(ctx) } });
      if (!playbook) return NextResponse.json({ error: 'Playbook not found' }, { status: 404 });
      return NextResponse.json(serializePlaybook(playbook));
    }

    const playbooks = await db.playbook.findMany({
      where: tenantWhere(ctx),
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json(playbooks.map(serializePlaybook));
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Playbooks GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch playbooks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') throw new AuthenticationError('Authentication required');
    requirePermission(ctx, PERMISSIONS.WORKFLOW_WRITE);

    const body = await request.json();
    const parsed = PlaybookCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }
    const data = parsed.data;

    const playbook = await db.playbook.create({
      data: {
        tenantId: ctx.tenantId,
        name: data.name,
        description: data.description,
        category: data.category,
        steps: JSON.stringify(data.steps),
        triggers: JSON.stringify(data.triggers),
        status: data.status,
        tags: JSON.stringify(data.tags),
        workflowId: data.workflowId || null,
      },
    });

    await writeAudit(ctx, {
      action: 'playbook.create',
      resource: 'playbook',
      resourceId: playbook.id,
      description: `Created playbook "${playbook.name}"`,
    });

    return NextResponse.json(serializePlaybook(playbook), { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Playbook POST error:', error);
    return NextResponse.json({ error: 'Failed to create playbook' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') throw new AuthenticationError('Authentication required');
    requirePermission(ctx, PERMISSIONS.WORKFLOW_WRITE);

    const body = await request.json();
    const parsed = PlaybookUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }
    const { id, ...data } = parsed.data;

    const existing = await db.playbook.findFirst({ where: { id, ...tenantWhere(ctx) } });
    if (!existing) return NextResponse.json({ error: 'Playbook not found' }, { status: 404 });

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.steps !== undefined) updateData.steps = JSON.stringify(data.steps);
    if (data.triggers !== undefined) updateData.triggers = JSON.stringify(data.triggers);
    if (data.status !== undefined) updateData.status = data.status;
    if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags);
    if (data.workflowId !== undefined) updateData.workflowId = data.workflowId || null;

    const playbook = await db.playbook.update({ where: { id }, data: updateData });

    await writeAudit(ctx, {
      action: 'playbook.update',
      resource: 'playbook',
      resourceId: playbook.id,
      description: `Updated playbook "${playbook.name}"`,
    });

    return NextResponse.json(serializePlaybook(playbook));
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Playbook PUT error:', error);
    return NextResponse.json({ error: 'Failed to update playbook' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await extractAuthContext(request);
    if (ctx.authMethod === 'anonymous') throw new AuthenticationError('Authentication required');
    requirePermission(ctx, PERMISSIONS.WORKFLOW_DELETE);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const existing = await db.playbook.findFirst({ where: { id, ...tenantWhere(ctx) } });
    if (!existing) return NextResponse.json({ error: 'Playbook not found' }, { status: 404 });

    await db.playbook.delete({ where: { id } });

    await writeAudit(ctx, {
      action: 'playbook.delete',
      resource: 'playbook',
      resourceId: id,
      description: `Deleted playbook "${existing.name}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Playbook DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete playbook' }, { status: 500 });
  }
}
