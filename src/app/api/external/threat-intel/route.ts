// Proxy: GET /api/external/threat-intel?ioc=8.8.8.8
// Looks up an IOC against the external backend's threat intel store.
//
// SECURITY FIX (AUDIT-2 finding #1): Added authentication + rate limit.
// Previously this route had ZERO auth — anonymous attackers could freely
// enumerate the threat-intel backend (burning API quota, revealing which
// IOCs the org is interested in).

import { NextRequest, NextResponse } from 'next/server';
import { lookupExternalThreatIntel, isExternalBackendEnabled } from '@/lib/external-api';
import { requireAuth, internalErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authed = await requireAuth(req, PERMISSIONS.ALERT_READ);
  if (authed instanceof NextResponse) return authed;

  if (!isExternalBackendEnabled()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      message: 'External backend not configured.',
    });
  }

  try {
    const { searchParams } = new URL(req.url);
    const ioc = searchParams.get('ioc');
    if (!ioc) {
      return NextResponse.json({ ok: false, error: 'ioc query parameter is required' }, { status: 400 });
    }

    const result = await lookupExternalThreatIntel(ioc);
    return NextResponse.json({
      ok: !!result,
      data: result,
    });
  } catch (err) {
    return internalErrorResponse(err, 'Failed to lookup threat intel');
  }
}
