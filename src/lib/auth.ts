// RBAC + Auth context
// - Session/JWT-based authentication
// - Role + permission checks (RBAC)
// - ABAC condition evaluation (extensible)
// - API key authentication for programmatic access
//
// In production, replace the JWT verification with OIDC token verification
// (Azure AD, Okta, Keycloak). The AuthContext interface is stable.

import { db } from '@/lib/db';
import { ulid } from 'ulid';
import { randomToken } from '@/lib/crypto';

// ============================================================================
// ROLES & PERMISSIONS (system-defined, immutable)
// ============================================================================

export const SYSTEM_ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  ANALYST: 'analyst',
  RESPONDER: 'responder',
  VIEWER: 'viewer',
  API: 'api',
} as const;

export type SystemRole = typeof SYSTEM_ROLES[keyof typeof SYSTEM_ROLES];

// Permission catalogue: resource:action
export const PERMISSIONS = {
  // Cases
  CASE_READ: 'case:read',
  CASE_WRITE: 'case:write',
  CASE_DELETE: 'case:delete',
  CASE_ASSIGN: 'case:assign',
  CASE_CLOSE: 'case:close',
  // Alerts
  ALERT_READ: 'alert:read',
  ALERT_WRITE: 'alert:write',
  ALERT_ESCALATE: 'alert:escalate',
  // Workflows
  WORKFLOW_READ: 'workflow:read',
  WORKFLOW_WRITE: 'workflow:write',
  WORKFLOW_EXECUTE: 'workflow:execute',
  WORKFLOW_DELETE: 'workflow:delete',
  // Integrations
  INTEGRATION_READ: 'integration:read',
  INTEGRATION_WRITE: 'integration:write',
  INTEGRATION_TEST: 'integration:test',
  INTEGRATION_DELETE: 'integration:delete',
  // Approvals
  APPROVAL_REQUEST: 'approval:request',
  APPROVAL_APPROVE: 'approval:approve',
  APPROVAL_REJECT: 'approval:reject',
  // Evidence
  EVIDENCE_READ: 'evidence:read',
  EVIDENCE_WRITE: 'evidence:write',
  // Audit
  AUDIT_READ: 'audit:read',
  // Users
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  USER_DELETE: 'user:delete',
  // Containment (high-impact)
  CONTAIN_BLOCK_IP: 'contain:block_ip',
  CONTAIN_ISOLATE_HOST: 'contain:isolate_host',
  CONTAIN_DISABLE_USER: 'contain:disable_user',
  CONTAIN_RESET_PASSWORD: 'contain:reset_password',
  CONTAIN_FIREWALL_RULE: 'contain:firewall_rule',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// Role → permissions mapping
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  [SYSTEM_ROLES.SUPERADMIN]: Object.values(PERMISSIONS), // all
  [SYSTEM_ROLES.ADMIN]: [
    PERMISSIONS.CASE_READ, PERMISSIONS.CASE_WRITE, PERMISSIONS.CASE_ASSIGN, PERMISSIONS.CASE_CLOSE,
    PERMISSIONS.ALERT_READ, PERMISSIONS.ALERT_WRITE, PERMISSIONS.ALERT_ESCALATE,
    PERMISSIONS.WORKFLOW_READ, PERMISSIONS.WORKFLOW_WRITE, PERMISSIONS.WORKFLOW_EXECUTE, PERMISSIONS.WORKFLOW_DELETE,
    PERMISSIONS.INTEGRATION_READ, PERMISSIONS.INTEGRATION_WRITE, PERMISSIONS.INTEGRATION_TEST, PERMISSIONS.INTEGRATION_DELETE,
    PERMISSIONS.APPROVAL_REQUEST, PERMISSIONS.APPROVAL_APPROVE, PERMISSIONS.APPROVAL_REJECT,
    PERMISSIONS.EVIDENCE_READ, PERMISSIONS.EVIDENCE_WRITE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.USER_READ, PERMISSIONS.USER_WRITE,
    PERMISSIONS.CONTAIN_BLOCK_IP, PERMISSIONS.CONTAIN_ISOLATE_HOST, PERMISSIONS.CONTAIN_DISABLE_USER,
    PERMISSIONS.CONTAIN_RESET_PASSWORD, PERMISSIONS.CONTAIN_FIREWALL_RULE,
  ],
  [SYSTEM_ROLES.ANALYST]: [
    PERMISSIONS.CASE_READ, PERMISSIONS.CASE_WRITE, PERMISSIONS.CASE_ASSIGN,
    PERMISSIONS.ALERT_READ, PERMISSIONS.ALERT_WRITE,
    PERMISSIONS.WORKFLOW_READ, PERMISSIONS.WORKFLOW_EXECUTE,
    PERMISSIONS.INTEGRATION_READ,
    PERMISSIONS.APPROVAL_REQUEST,
    PERMISSIONS.EVIDENCE_READ, PERMISSIONS.EVIDENCE_WRITE,
    PERMISSIONS.AUDIT_READ,
  ],
  [SYSTEM_ROLES.RESPONDER]: [
    PERMISSIONS.CASE_READ,
    PERMISSIONS.ALERT_READ,
    PERMISSIONS.WORKFLOW_READ, PERMISSIONS.WORKFLOW_EXECUTE,
    PERMISSIONS.INTEGRATION_READ,
    PERMISSIONS.APPROVAL_REQUEST,
    PERMISSIONS.EVIDENCE_READ, PERMISSIONS.EVIDENCE_WRITE,
    // Containment actions require approval — see ApprovalWorkflow
    PERMISSIONS.CONTAIN_BLOCK_IP, PERMISSIONS.CONTAIN_ISOLATE_HOST, PERMISSIONS.CONTAIN_DISABLE_USER,
  ],
  [SYSTEM_ROLES.VIEWER]: [
    PERMISSIONS.CASE_READ, PERMISSIONS.ALERT_READ, PERMISSIONS.WORKFLOW_READ,
    PERMISSIONS.INTEGRATION_READ, PERMISSIONS.EVIDENCE_READ, PERMISSIONS.AUDIT_READ,
  ],
  [SYSTEM_ROLES.API]: [], // scoped per API key
};

// ============================================================================
// AUTH CONTEXT
// ============================================================================

export interface AuthContext {
  userId: string | null;
  tenantId: string | null;
  email: string | null;
  username: string | null;
  roles: string[];
  permissions: Permission[];
  authMethod: 'session' | 'api_key' | 'oidc' | 'system' | 'anonymous';
  requestId: string;
  actorIp: string | null;
  apiKeyId?: string;
}

// Build a system auth context (for internal jobs like workflow executor)
export function systemContext(requestId?: string): AuthContext {
  return {
    userId: null,
    tenantId: null,
    email: 'system',
    username: 'system',
    roles: [SYSTEM_ROLES.SUPERADMIN],
    permissions: Object.values(PERMISSIONS),
    authMethod: 'system',
    requestId: requestId || ulid(),
    actorIp: null,
  };
}

// Build an anonymous context (for /api/health and other public endpoints)
export function anonymousContext(): AuthContext {
  return {
    userId: null, tenantId: null, email: null, username: null,
    roles: [], permissions: [],
    authMethod: 'anonymous',
    requestId: ulid(),
    actorIp: null,
  };
}

// ============================================================================
// PERMISSION CHECKS
// ============================================================================

export function hasPermission(ctx: AuthContext, permission: Permission): boolean {
  if (ctx.roles.includes(SYSTEM_ROLES.SUPERADMIN)) return true;
  return ctx.permissions.includes(permission);
}

export function hasAnyPermission(ctx: AuthContext, permissions: Permission[]): boolean {
  if (ctx.roles.includes(SYSTEM_ROLES.SUPERADMIN)) return true;
  return permissions.some(p => ctx.permissions.includes(p));
}

export function requirePermission(ctx: AuthContext, permission: Permission): void {
  if (!hasPermission(ctx, permission)) {
    throw new AuthorizationError(`Missing permission: ${permission}`);
  }
}

export class AuthorizationError extends Error {
  status = 403;
  code = 'FORBIDDEN';
  constructor(msg: string) { super(msg); this.name = 'AuthorizationError'; }
}

export class AuthenticationError extends Error {
  status = 401;
  code = 'UNAUTHORIZED';
  constructor(msg: string) { super(msg); this.name = 'AuthenticationError'; }
}

// ============================================================================
// AUTHENTICATION (from Next.js request)
// ============================================================================

import { NextRequest } from 'next/server';

/**
 * Extract auth context from a Next.js request.
 * Tries in order: Bearer API key → session cookie → local admin (dev) → anonymous.
 *
 * In production, replace this with OIDC token verification:
 *   const token = extractBearer(req);
 *   const claims = await verifyJwt(token, JWKS_URL);
 *   return ctxFromClaims(claims);
 *
 * DEV MODE: When SOAR_DEV_MODE=1 (or NODE_ENV !== "production" and no
 * SOAR_DISABLE_DEV_AUTH=1), requests with no credentials are auto-elevated
 * to a local "superadmin" context so the UI works out of the box. Set
 * SOAR_DISABLE_DEV_AUTH=1 in production to enforce strict auth.
 */
export async function extractAuthContext(req: NextRequest): Promise<AuthContext> {
  const requestId = req.headers.get('x-request-id') || ulid();
  const actorIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;

  // 1. Try API key (Authorization: Bearer soar_xxx OR X-API-Key: soar_xxx)
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const xApiKey = req.headers.get('x-api-key');
  const apiKey = bearer?.startsWith('soar_') ? bearer : xApiKey?.startsWith('soar_') ? xApiKey : null;

  if (apiKey) {
    const ctx = await authenticateApiKey(apiKey, requestId, actorIp);
    if (ctx) return ctx;
  }

  // 2. Try session cookie (simplified — production uses signed JWT in httpOnly cookie)
  const sessionCookie = req.cookies.get('soar_session')?.value;
  if (sessionCookie) {
    const ctx = await authenticateSession(sessionCookie, requestId, actorIp);
    if (ctx) return ctx;
  }

  // 3. DEV MODE: auto-elevate in non-production unless hard-disabled.
  // Pilot / local installs work without wiring OIDC on day one.
  // Production: set SOAR_DISABLE_DEV_AUTH=1 and use API keys or SSO.
  const isProd = process.env.NODE_ENV === 'production';
  const devAuthHardDisabled = process.env.SOAR_DISABLE_DEV_AUTH === '1';
  const devAuthExplicitlyDisabled = process.env.SOAR_ENABLE_DEV_AUTH === '0';
  const devAuthEnabled = !isProd && !devAuthHardDisabled && !devAuthExplicitlyDisabled;

  if (devAuthEnabled) {
    // Log a loud warning so this is never accidentally left on.
    console.warn(
      '⚠️  SOAR DEV AUTH IS ENABLED — requests without credentials are auto-elevated to superadmin. ' +
      'Set SOAR_ENABLE_DEV_AUTH=0 (or remove it) and SOAR_DISABLE_DEV_AUTH=1 before any production deploy.'
    );
    return {
      userId: 'local-admin',
      tenantId: null,
      email: 'admin@local',
      username: 'Local Admin',
      roles: [SYSTEM_ROLES.SUPERADMIN],
      permissions: Object.values(PERMISSIONS),
      authMethod: 'system',
      requestId,
      actorIp,
    };
  }

  // 4. Anonymous (for public endpoints like /api/health)
  return anonymousContext();
}

async function authenticateApiKey(key: string, requestId: string, actorIp: string | null): Promise<AuthContext | null> {
  // Key format: soar_<prefix>_<secret>
  const parts = key.split('_');
  if (parts.length !== 3 || parts[0] !== 'soar') return null;
  const prefix = parts[1];

  // Find by prefix (indexed)
  const apiKeyRow = await db.apiKey.findFirst({
    where: { keyPrefix: `soar_${prefix}`, revokedAt: null },
    include: { user: { include: { userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } },
  });
  if (!apiKeyRow) return null;
  if (apiKeyRow.expiresAt && apiKeyRow.expiresAt < new Date()) return null;

  // Verify secret (bcrypt)
  const bcrypt = await import('bcryptjs');
  const valid = await bcrypt.compare(key, apiKeyRow.keyHash);
  if (!valid) return null;

  // Update last-used
  await db.apiKey.update({
    where: { id: apiKeyRow.id },
    data: { lastUsedAt: new Date(), lastUsedIp: actorIp },
  }).catch(() => { /* non-critical */ });

  // Resolve permissions from scopes (API keys use explicit scopes, not roles)
  const scopes = (apiKeyRow.scopes as unknown as string[]) || [];
  const permissions = scopes.filter((s): s is Permission => Object.values(PERMISSIONS).includes(s as Permission));

  return {
    userId: apiKeyRow.userId,
    tenantId: apiKeyRow.tenantId,
    email: apiKeyRow.user.email,
    username: apiKeyRow.user.username,
    roles: [SYSTEM_ROLES.API],
    permissions,
    authMethod: 'api_key',
    requestId,
    actorIp,
    apiKeyId: apiKeyRow.id,
  };
}

async function authenticateSession(sessionToken: string, requestId: string, actorIp: string | null): Promise<AuthContext | null> {
  // Session token resolves to user id or email in the local auth store.
  try {
    const user = await db.user.findFirst({
      where: { OR: [{ id: sessionToken }, { email: sessionToken }], status: 'active' },
      include: { userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!user) return null;
    if (user.lockedUntil && user.lockedUntil > new Date()) return null;

    const roles = user.userRoles.map(ur => ur.role.name);
    const permissions = new Set<Permission>();
    for (const ur of user.userRoles) {
      for (const rp of ur.role.permissions) {
        permissions.add(rp.permission.name as Permission);
      }
    }

    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      username: user.username,
      roles,
      permissions: Array.from(permissions),
      authMethod: 'session',
      requestId,
      actorIp,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// API KEY GENERATION (for programmatic access)
// ============================================================================

export interface GeneratedApiKey {
  key: string;        // shown ONCE to the user
  keyHash: string;    // stored in DB
  keyPrefix: string;  // stored in DB for lookup
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function generateApiKey(userId: string, tenantId: string, name: string, scopes: string[]): Promise<GeneratedApiKey> {
  const secret = randomToken(24);
  const key = `soar_${ulid().toLowerCase().slice(0, 8)}_${secret}`;
  const keyPrefix = key.slice(0, 13); // soar_xxxxxxxx
  const bcrypt = await import('bcryptjs');
  const keyHash = await bcrypt.hash(key, 12);
  return { key, keyHash, keyPrefix };
}
