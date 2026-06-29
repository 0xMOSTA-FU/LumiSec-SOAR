/**
 * Internal job — poll connected Elasticsearch for security alerts.
 * Auth: Authorization: Bearer SOAR_INTERNAL_API_KEY (or WORKER_API_KEY)
 */
import { NextRequest, NextResponse } from 'next/server';
import { pollElasticIntegrations } from '@/lib/integrations/elastic-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorize(req: NextRequest): boolean {
  const keys = [
    process.env.SOAR_INTERNAL_API_KEY,
    process.env.WORKER_API_KEY,
    process.env.EXTERNAL_API_KEY,
  ].filter(Boolean);
  if (!keys.length) return process.env.NODE_ENV !== 'production';
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const headerKey = req.headers.get('x-internal-api-key') || req.headers.get('x-api-key') || '';
  return keys.some((k) => token === k || headerKey === k);
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { minutes?: number; limit?: number };
    const result = await pollElasticIntegrations({}, body);
    return NextResponse.json({
      success: result.ok || result.ingested > 0,
      data: result,
      message: `Polled ${result.polled} Elastic integration(s); ${result.ingested} new, ${result.deduplicated} deduped`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Elastic poll failed',
      },
      { status: 500 },
    );
  }
}
