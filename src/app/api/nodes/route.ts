/**
 * /api/nodes — Node registry introspection
 * ---------------------------------------------------------------------------
 * Returns all registered node manifests. Used by the UI palette and by
 * external tooling to discover available nodes.
 *
 * GET /api/nodes          → list all manifests
 * GET /api/nodes?id=vt    → single manifest
 * GET /api/nodes?category=threat_intel → filter
 *
 * SECURITY FIX (AUDIT-2 finding #1): Added authentication. Previously this
 * route leaked the entire node catalog (which integrations are wired, what
 * credential kinds are accepted, what actions are supported) to anonymous
 * callers — reconnaissance gold for an attacker.
 */
import { NextRequest, NextResponse } from 'next/server';
import { nodeRegistry } from '@/lib/soar/nodes/registry';
import { bootstrapNodes } from '@/lib/soar/nodes/bootstrap';
import { requireAuth, internalErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authed = await requireAuth(req, PERMISSIONS.WORKFLOW_READ);
  if (authed instanceof NextResponse) return authed;

  try {
    bootstrapNodes();
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const category = url.searchParams.get('category');

    if (id) {
      const executor = nodeRegistry.get(id);
      if (!executor) return NextResponse.json({ error: 'Node not found' }, { status: 404 });
      return NextResponse.json(executor.manifest);
    }

    let manifests = nodeRegistry.list();
    if (category) manifests = manifests.filter(m => m.category === category);
    return NextResponse.json({ nodes: manifests, count: manifests.length });
  } catch (err) {
    return internalErrorResponse(err, 'Failed to list node registry');
  }
}
