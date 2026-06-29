// Proxy: GET /api/external/incidents
// Fetches incidents from the external backend (merged with our Prisma cases
// on the client side).
//
// SECURITY FIX (AUDIT-2 finding #1): Added authentication + rate limit.
// Previously this route had ZERO auth — anyone could read every incident
// in the customer's incident backend (PII, IOCs, victim hosts).

import { NextRequest, NextResponse } from 'next/server';
import { listExternalIncidents, isExternalBackendEnabled } from '@/lib/external-api';
import { requireAuth, internalErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authed = await requireAuth(req, PERMISSIONS.CASE_READ);
  if (authed instanceof NextResponse) return authed;

  if (!isExternalBackendEnabled()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      data: [],
      message: 'External backend not configured.',
    });
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get('limit') || '50'), 200);
    const incidents = await listExternalIncidents(limit);
    return NextResponse.json({
      ok: true,
      configured: true,
      data: incidents,
      count: incidents.length,
    });
  } catch (err) {
    return internalErrorResponse(err, 'Failed to fetch incidents from external backend');
  }
}
