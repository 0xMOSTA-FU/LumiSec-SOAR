// Shared auth + error helpers for API route handlers.
//
// Every authenticated route in this app follows the same pattern:
//   1. extractAuthContext(req)
//   2. reject anonymous if authMethod === 'anonymous'
//   3. requirePermission(ctx, PERMISSIONS.X)
//   4. rate-limit per caller
//   5. tenant-scope all DB queries
//   6. audit-log mutations
//
// This module consolidates the boilerplate so route files stay focused on
// business logic. It also guarantees that every authenticated route
// returns the same error shape for 401/403/429 — important for client-side
// error handling.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  extractAuthContext,
  requirePermission,
  type AuthContext,
  type Permission,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { rateLimit, type RateLimitResult } from '@/lib/rate-limit';

/**
 * Authenticated request context — returned when auth succeeds.
 * Contains the auth context + a flag indicating whether the caller
 * is superadmin (tenantId=null, can see all tenants).
 */
export interface AuthedRequest {
  ctx: AuthContext;
  isSuperadmin: boolean;
  /** Tenant scoping filter for Prisma `where` clauses. Empty = see all. */
  tenantWhere: Record<string, unknown>;
}

/**
 * Authenticate a request and check a permission. Returns either an
 * AuthedRequest or a NextResponse (error) — caller must propagate the
 * error response.
 *
 * Usage:
 *   const authed = await requireAuth(req, PERMISSIONS.CASE_READ);
 *   if (authed instanceof NextResponse) return authed;
 *   const { ctx, tenantWhere } = authed;
 */
export async function requireAuth(
  req: NextRequest,
  permission: Permission,
  opts: { rateLimitKey?: string } = {},
): Promise<AuthedRequest | NextResponse> {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    requirePermission(ctx, permission);

    // Per-caller rate limit
    const rlKey = opts.rateLimitKey || 'default';
    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', rlKey);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'RATE_LIMITED', message: 'Too many requests' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(rl.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(rl.resetInMs / 1000)),
            'Retry-After': String(Math.ceil(rl.resetInMs / 1000)),
          },
        },
      );
    }

    const isSuperadmin = ctx.roles.includes('superadmin');
    const tenantWhere = ctx.tenantId ? { tenantId: ctx.tenantId } : {};
    return { ctx, isSuperadmin, tenantWhere };
  } catch (err) {
    if (err instanceof AuthenticationError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}

/**
 * Verify that a resource with `resourceTenantId` belongs to the caller's
 * tenant. Returns true if access is allowed, false if the resource should
 * be reported as "not found" (avoid confirming existence to cross-tenant
 * callers).
 */
export function canAccessTenant(ctx: AuthContext, resourceTenantId: string | null | undefined): boolean {
  if (!ctx.tenantId) return true; // superadmin
  if (!resourceTenantId) return true; // legacy/global resource
  return ctx.tenantId === resourceTenantId;
}

/**
 * Standard error response for internal errors. Never leaks error details
 * to the client (which could include stack traces, SQL fragments, etc).
 */
export function internalErrorResponse(err: unknown, message = 'Internal server error'): NextResponse {
  // Log the full error server-side
  // (use console.error to avoid circular import with logger)
  console.error('[internal-error]', err);
  return NextResponse.json({ error: message }, { status: 500 });
}

export { AuthenticationError, AuthorizationError };
export type { RateLimitResult };
