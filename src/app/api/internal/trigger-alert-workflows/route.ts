/**
 * Internal endpoint — alert event processor triggers matching workflows.
 * Auth: Authorization: Bearer WORKER_API_KEY
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { triggerWorkflowsForAlert } from '@/lib/soar/execution/alert-trigger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKER_API_KEY = process.env.WORKER_API_KEY || '';

function authorize(req: NextRequest): boolean {
  if (!WORKER_API_KEY) return process.env.NODE_ENV !== 'production';
  const auth = req.headers.get('authorization') || '';
  return auth.replace(/^Bearer\s+/i, '') === WORKER_API_KEY;
}

const BodySchema = z.object({
  alertId: z.string().min(1),
  title: z.string(),
  description: z.string().optional(),
  severity: z.string(),
  source: z.string(),
  status: z.string().optional(),
  tenantId: z.string().nullable().optional(),
  raw: z.unknown().optional(),
  iocs: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ success: false, reason: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = BodySchema.parse(await request.json());
    const result = await triggerWorkflowsForAlert(body);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, reason: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, reason: error instanceof Error ? error.message : 'Trigger failed' },
      { status: 500 },
    );
  }
}
