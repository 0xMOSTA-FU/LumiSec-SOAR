import { NextRequest, NextResponse } from 'next/server';
import { LUMISEC_API_URL, LUMISEC_INTERNAL_API_KEY } from '@/lib/lumisec-api/config';
import { extractAuthContext } from '@/lib/auth';

export const runtime = 'nodejs';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

async function proxyToGateway(req: NextRequest, pathSegments: string[]) {
  if (!LUMISEC_API_URL) {
    return NextResponse.json(
      { error: 'LUMISEC_API_URL not configured', message: 'Set LUMISEC_API_URL in .env to use gateway mode' },
      { status: 503 },
    );
  }

  const upstreamPath = '/' + pathSegments.join('/');
  const url = new URL(upstreamPath, LUMISEC_API_URL.replace(/\/$/, ''));
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  if (LUMISEC_INTERNAL_API_KEY) {
    headers.set('X-Internal-Api-Key', LUMISEC_INTERNAL_API_KEY);
    headers.set('x-service-key', LUMISEC_INTERNAL_API_KEY);
  }

  const ctx = await extractAuthContext(req);
  const bearer = req.headers.get('authorization');
  if (bearer) {
    headers.set('Authorization', bearer);
  } else if (ctx.email) {
    headers.set('X-SOAR-User-Email', ctx.email);
    if (ctx.userId) headers.set('X-SOAR-User-Id', ctx.userId);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: 'no-store',
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Gateway unreachable', message }, { status: 502 });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

type RouteCtx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  return proxyToGateway(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: RouteCtx) {
  return proxyToGateway(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: RouteCtx) {
  return proxyToGateway(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  return proxyToGateway(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  return proxyToGateway(req, (await ctx.params).path);
}
