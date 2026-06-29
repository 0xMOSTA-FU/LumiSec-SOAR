import { NextRequest, NextResponse } from 'next/server';
import { extractAuthContext, AuthenticationError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Demo seed endpoint removed — platform uses live ingest only.
 * Configure connectors, webhooks, and integrations for real data.
 */
export async function POST(req: NextRequest) {
  try {
    await extractAuthContext(req);
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: 'DEMO_SEED_DISABLED',
      message:
        'Demo seeding is disabled. Add data via webhooks, SIEM ingest, manual incidents, or connector configuration.',
    },
    { status: 410 },
  );
}
