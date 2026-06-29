/**
 * Sync a Prisma workflow to Shuffle format on soar-backend (MongoDB)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  extractAuthContext,
  requirePermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { syncWorkflowToShuffle, isShuffleBackendEnabled } from '@/lib/shuffle-backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const authCtx = await extractAuthContext(_req);
    if (authCtx.authMethod === 'anonymous') throw new AuthenticationError('Authentication required');
    requirePermission(authCtx, PERMISSIONS.WORKFLOW_WRITE);

    if (!isShuffleBackendEnabled()) {
      return NextResponse.json(
        { error: 'Shuffle backend not configured (set SHUFFLE_BACKEND_URL or NEXT_PUBLIC_EXTERNAL_API_URL)' },
        { status: 503 },
      );
    }

    const { id } = await ctx.params;
    const wf = await db.workflow.findUnique({ where: { id } });
    if (!wf) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    if (authCtx.tenantId && wf.tenantId && wf.tenantId !== authCtx.tenantId) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    let nodes: unknown[] = [];
    let edges: unknown[] = [];
    let tags: unknown = [];
    try { nodes = JSON.parse(wf.nodes || '[]'); } catch { /* empty */ }
    try { edges = JSON.parse(wf.edges || '[]'); } catch { /* empty */ }
    try { tags = JSON.parse(wf.tags || '[]'); } catch { /* empty */ }

    const result = await syncWorkflowToShuffle({
      id: wf.id,
      name: wf.name,
      description: wf.description || undefined,
      tenantId: wf.tenantId,
      nodes,
      edges,
      tags,
    });

    return NextResponse.json({ success: true, shuffle: result.data });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('shuffle sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
