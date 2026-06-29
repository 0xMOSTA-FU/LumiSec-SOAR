import { NextRequest, NextResponse } from 'next/server';
import { extractAuthContext } from '@/lib/auth';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

export const SOAR_BACKEND_URL =
  process.env.SOAR_BACKEND_URL ||
  process.env.NEXT_PUBLIC_SOAR_BACKEND_URL ||
  'http://localhost:4000';

export const SOAR_INTERNAL_API_KEY =
  process.env.SOAR_INTERNAL_API_KEY ||
  process.env.EXTERNAL_API_KEY ||
  process.env.LUMISEC_INTERNAL_API_KEY ||
  '';

/** Proxy /api/soar/* to Node + Mongo backend (mini-services/soar-backend) */
export function useNodeSoarBackend(): boolean {
  return process.env.SOAR_USE_NODE_BACKEND === '1';
}

export async function proxyToNodeBackend(req: NextRequest, pathSegments: string[]) {
  const upstreamPath = '/api/soar/' + pathSegments.join('/');
  const url = new URL(upstreamPath, SOAR_BACKEND_URL.replace(/\/$/, ''));
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  if (SOAR_INTERNAL_API_KEY) {
    headers.set('X-API-Key', SOAR_INTERNAL_API_KEY);
    headers.set('X-Internal-Api-Key', SOAR_INTERNAL_API_KEY);
  }

  const ctx = await extractAuthContext(req);
  const bearer = req.headers.get('authorization');
  if (bearer) headers.set('Authorization', bearer);
  if (ctx.userId) headers.set('X-SOAR-User-Id', ctx.userId);
  if (ctx.email) headers.set('X-SOAR-User-Email', ctx.email);
  if (ctx.tenantId) headers.set('X-Tenant-Id', ctx.tenantId);

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
    return NextResponse.json(
      { success: false, error: 'SOAR backend unreachable', message },
      { status: 502 },
    );
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
