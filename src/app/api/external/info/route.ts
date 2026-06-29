// Proxy: GET /api/external/info
// Returns metadata about the external Node.js backend.
//
// SECURITY FIX (AUDIT-2 finding #1): Added authentication + rate limit.
// Previously this route had ZERO auth — leaked backend version, MongoDB
// version, hostnames, and configuration to anonymous callers.

import { NextRequest, NextResponse } from 'next/server';
import { getExternalBackendInfo, isExternalBackendEnabled } from '@/lib/external-api';
import { requireAuth, internalErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authed = await requireAuth(req, PERMISSIONS.INTEGRATION_READ);
  if (authed instanceof NextResponse) return authed;

  if (!isExternalBackendEnabled()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      message: 'External backend not configured. Set NEXT_PUBLIC_EXTERNAL_API_URL to enable.',
    });
  }
  try {
    const info = await getExternalBackendInfo();
    return NextResponse.json({
      ok: !!info,
      configured: true,
      info,
    });
  } catch (err) {
    return internalErrorResponse(err, 'Failed to fetch external backend info');
  }
}
