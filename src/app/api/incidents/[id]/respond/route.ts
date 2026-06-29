import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, internalErrorResponse } from '@/lib/api-auth';
import {
  ACTION_PERMISSIONS,
  RespondSchema,
  executeGovernedIncidentRespond,
} from '@/lib/incidents/governed-respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body;
  try {
    body = RespondSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const permission = ACTION_PERMISSIONS[body.actionId];
  const authed = await requireAuth(req, permission);
  if (authed instanceof NextResponse) return authed;

  try {
    const outcome = await executeGovernedIncidentRespond(
      id,
      body,
      authed.ctx,
      authed.tenantWhere,
    );

    if (outcome.kind === 'not_found') {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }
    if (outcome.kind === 'error') {
      return NextResponse.json(
        {
          error: outcome.error,
          message: outcome.message,
          ...(outcome.approvalId ? { approvalId: outcome.approvalId } : {}),
          ...(outcome.count !== undefined ? { count: outcome.count, limit: outcome.limit } : {}),
        },
        { status: outcome.status },
      );
    }

    return NextResponse.json(outcome.result, { status: outcome.result.ok ? 200 : 502 });
  } catch (err) {
    return internalErrorResponse(err, 'Failed to execute incident action');
  }
}
