// Proxy: GET /api/external/health
// Pings the external backend and returns latency + status.
//
// SECURITY FIX (AUDIT-2 finding #1): Added authentication + rate limit.
// Previously this route had ZERO auth — anonymous attackers could probe
// the external backend, learn its URL, and use the proxy to bypass
// network ACLs (SSRF-ish).

import { NextRequest, NextResponse } from 'next/server';
import { pingExternalBackend, isExternalBackendEnabled } from '@/lib/external-api';
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
      message: 'External backend not configured.',
    });
  }
  try {
    const result = await pingExternalBackend();
    return NextResponse.json({
      ok: result.ok,
      latencyMs: result.latencyMs,
      error: result.error,
    });
  } catch (err) {
    return internalErrorResponse(err, 'Failed to ping external backend');
  }
}
