// GET /api/system/status
// Returns the status of all backing services:
//   - Prisma DB (always)
//   - MongoDB (optional, lib/mongo.ts)
//   - External Node.js backend (optional, lib/external-api.ts)
//
// SECURITY FIX (AUDIT-2 finding #1 — CRITICAL):
// Previously this route had ZERO authentication. Anyone with network access
// could see the full service topology: DB type/version, MongoDB connection
// status, external backend URL/info, latencies. This is reconnaissance gold
// for an attacker — they learn which services to target, what versions to
// exploit, and whether optional hardening is enabled.
//
// Now enforces:
//   1. extractAuthContext() — must be authenticated
//   2. requirePermission(INTEGRATION_READ) — admin/analyst only (not viewer)
//   3. Per-caller rate limit
//   4. Error messages redacted (no DB version strings, no connection strings)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isMongoEnabled, checkMongoHealth } from '@/lib/mongo';
import { isExternalBackendEnabled, pingExternalBackend, getExternalBackendInfo } from '@/lib/external-api';
import {
  extractAuthContext,
  requirePermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Redact internal details from error messages before returning to client. */
function redact(msg: string): string {
  return msg
    .replace(/postgresql:\/\/[^\s]+/gi, 'postgresql://[REDACTED]')
    .replace(/mongodb(\+srv)?:\/\/[^\s]+/gi, 'mongodb://[REDACTED]')
    .replace(/redis:\/\/[^\s]+/gi, 'redis://[REDACTED]')
    .replace(/\b(\d{1,3}\.){3}\d{1,3}\b/g, '[IP-REDACTED]')
    .slice(0, 200);
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, PERMISSIONS.INTEGRATION_READ);

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const start = Date.now();
  const status: {
    ok: boolean;
    uptime_sec: number;
    services: Record<string, { ok: boolean; configured: boolean; latencyMs?: number; detail?: unknown }>;
  } = {
    ok: true,
    uptime_sec: Math.round(process.uptime()),
    services: {},
  };

  // Prisma
  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    status.services.database = { ok: true, configured: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    status.services.database = {
      ok: false,
      configured: true,
      detail: redact(e instanceof Error ? e.message : String(e)),
    };
    status.ok = false;
  }

  // MongoDB
  if (isMongoEnabled()) {
    const mongoHealth = await checkMongoHealth();
    status.services.mongodb = {
      ok: mongoHealth.connected,
      configured: mongoHealth.configured,
      latencyMs: mongoHealth.latencyMs,
      detail: mongoHealth.connected ? undefined : redact(mongoHealth.lastError || 'Not connected'),
    };
    if (!mongoHealth.connected) status.ok = false;
  } else {
    status.services.mongodb = { ok: false, configured: false, detail: 'MONGODB_URI not set (optional)' };
  }

  // External backend
  if (isExternalBackendEnabled()) {
    const ping = await pingExternalBackend();
    status.services.external_backend = {
      ok: ping.ok,
      configured: true,
      latencyMs: ping.latencyMs,
      detail: ping.error ? redact(ping.error) : undefined,
    };
    if (!ping.ok) status.ok = false;

    // Also fetch backend info if reachable
    if (ping.ok) {
      const info = await getExternalBackendInfo();
      if (info) status.services.external_backend.detail = info;
    }
  } else {
    status.services.external_backend = { ok: false, configured: false, detail: 'NEXT_PUBLIC_EXTERNAL_API_URL not set (optional)' };
  }

  return NextResponse.json({
    ...status,
    latency_ms: Date.now() - start,
  });
}
