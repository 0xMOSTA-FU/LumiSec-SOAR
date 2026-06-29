/** Extract tenant + user context from BFF headers (Next.js proxy). */

export function getRequestContext(req) {
  const tenantId = req.headers['x-tenant-id']
    || req.headers['org-id']
    || req.headers['org']
    || 'default';
  const userId = req.headers['x-soar-user-id'] || 'system';
  const userEmail = req.headers['x-soar-user-email'] || null;
  return {
    tenantId: String(tenantId),
    tenantWhere: { tenantId: String(tenantId) },
    userId: String(userId),
    userEmail,
  };
}

export function tenantFilter(ctx) {
  return { tenantId: ctx.tenantId };
}
