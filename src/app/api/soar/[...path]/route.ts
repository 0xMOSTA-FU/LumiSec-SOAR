import { NextRequest } from 'next/server';
import { handleSoarRequest } from '@/lib/soar-api/router';
import { proxyToNodeBackend, useNodeSoarBackend } from '@/lib/soar-api/node-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ path: string[] }> };

async function dispatch(req: NextRequest, ctx: RouteCtx) {
  const segments = (await ctx.params).path;
  if (useNodeSoarBackend()) {
    return proxyToNodeBackend(req, segments);
  }
  return handleSoarRequest(req, segments);
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
