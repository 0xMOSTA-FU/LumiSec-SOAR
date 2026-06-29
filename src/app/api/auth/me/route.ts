import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { anonymousContext, extractAuthContext, type AuthContext } from '@/lib/auth';

const SESSION_COOKIE = 'soar_session';

async function ctxFromSessionCookie(req: NextRequest): Promise<AuthContext | null> {
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionToken) return null;

  try {
    const user = await db.user.findFirst({
      where: { OR: [{ id: sessionToken }, { email: sessionToken }], status: 'active' },
      include: {
        userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    if (!user) return null;
    if (user.lockedUntil && user.lockedUntil > new Date()) return null;

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = new Set<string>();
    for (const ur of user.userRoles) {
      for (const rp of ur.role.permissions) {
        permissions.add(rp.permission.name);
      }
    }

    return {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      username: user.username,
      roles,
      permissions: Array.from(permissions) as AuthContext['permissions'],
      authMethod: 'session',
      requestId: req.headers.get('x-request-id') || 'me',
      actorIp: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const sessionOnly = req.nextUrl.searchParams.get('sessionOnly') === '1';
  const ctx = sessionOnly ? (await ctxFromSessionCookie(req)) ?? anonymousContext() : await extractAuthContext(req);

  if (ctx.authMethod === 'anonymous' || !ctx.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const devAuth = !sessionOnly && ctx.authMethod === 'system' && ctx.userId === 'local-admin';

  let fullName = ctx.username;
  if (ctx.authMethod === 'session' && ctx.userId) {
    const row = await db.user.findUnique({ where: { id: ctx.userId }, select: { fullName: true } });
    if (row?.fullName) fullName = row.fullName;
  }

  return NextResponse.json({
    user: {
      id: ctx.userId,
      email: ctx.email,
      username: ctx.username,
      fullName,
      roles: ctx.roles,
      authMethod: ctx.authMethod,
      devAuth,
    },
  });
}
