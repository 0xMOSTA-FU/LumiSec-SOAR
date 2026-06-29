// Health check endpoints
// - GET /api/health         → liveness (process is alive)
// - GET /api/health?check=ready → readiness (DB reachable, ready to serve)
//
// Kubernetes:
//   livenessProbe:  /api/health
//   readinessProbe: /api/health?check=ready

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Liveness — always returns 200 if the process can respond
export async function GET(req: Request) {
  const url = new URL(req.url);
  const check = url.searchParams.get('check') || 'live';

  if (check === 'live') {
    return NextResponse.json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime_sec: Math.round(process.uptime()),
      version: process.env.APP_VERSION || '1.0.0',
    });
  }

  if (check === 'ready') {
    const checks: Record<string, { ok: boolean; latency_ms?: number; error?: string }> = {};

    // DB check
    const dbStart = Date.now();
    try {
      await db.$queryRaw`SELECT 1`;
      checks.database = { ok: true, latency_ms: Date.now() - dbStart };
    } catch (err) {
      checks.database = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    // Encryption key check
    try {
      const { encrypt, decrypt } = await import('@/lib/crypto');
      const ct = encrypt({ check: 'ping' });
      const pt = decrypt<{ check?: string }>(ct);
      checks.encryption = { ok: pt?.check === 'ping' };
    } catch (err) {
      checks.encryption = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const allOk = Object.values(checks).every(c => c.ok);
    const status = allOk ? 'ready' : 'degraded';
    const httpStatus = allOk ? 200 : 503;

    if (!allOk) {
      logger.warn({ checks }, 'readiness check failed');
    }

    return NextResponse.json({
      status,
      checks,
      timestamp: new Date().toISOString(),
    }, { status: httpStatus });
  }

  return NextResponse.json({ error: 'unknown check' }, { status: 400 });
}
