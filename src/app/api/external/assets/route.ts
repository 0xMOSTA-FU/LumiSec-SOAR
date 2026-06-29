// Proxy: GET /api/external/assets
// Fetches asset inventory from the external backend.
//
// SECURITY FIX (AUDIT-2 finding #1): Added authentication + rate limit.
// Previously this route had ZERO auth — anyone could enumerate every asset
// in the customer's CMDB/inventory backend.

import { NextRequest, NextResponse } from 'next/server';
import { listExternalAssets, isExternalBackendEnabled } from '@/lib/external-api';
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
      data: [],
      message: 'External backend not configured.',
    });
  }

  try {
    const assets = await listExternalAssets();
    return NextResponse.json({
      ok: true,
      configured: true,
      data: assets,
      count: assets.length,
    });
  } catch (err) {
    return internalErrorResponse(err, 'Failed to fetch assets from external backend');
  }
}
