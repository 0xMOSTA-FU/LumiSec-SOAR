/**
 * Proxy to soar-backend Shuffle-compatible API (/api/v1/*)
 */

import { NextRequest, NextResponse } from 'next/server';
import { shuffleBackendUrl } from '@/lib/shuffle-backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_KEY = process.env.EXTERNAL_API_KEY || '';

async function proxy(req: NextRequest, segments: string[]) {
  const path = `/api/v1/${segments.join('/')}`;
  const url = new URL(req.url);
  const target = `${shuffleBackendUrl}${path}${url.search}`;

  const headers: Record<string, string> = {
    'Content-Type': req.headers.get('content-type') || 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
  };
  const orgId = req.headers.get('org-id');
  if (orgId) headers['Org-Id'] = orgId;
  const auth = req.headers.get('authorization');
  if (auth) headers.Authorization = auth;

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
  }

  const res = await fetch(target, init);
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
