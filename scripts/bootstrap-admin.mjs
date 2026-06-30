#!/usr/bin/env node
/**
 * Bootstrap default tenant, RBAC roles, and admin user (no demo operational data).
 * Usage: npm run db:bootstrap
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SOAR_ADMIN_EMAIL || 'admin@soar.local';
const ADMIN_PASSWORD = process.env.SOAR_ADMIN_PASSWORD || 'admin123';
const ADMIN_NAME = process.env.SOAR_ADMIN_NAME || 'SOAR Administrator';
const TENANT_SLUG = process.env.SOAR_TENANT_SLUG || 'default';

const ROLE_PERMISSIONS = {
  superadmin: null, // all permissions
  admin: [
    'case:read', 'case:write', 'case:assign', 'case:close', 'case:delete',
    'alert:read', 'alert:write', 'alert:escalate',
    'workflow:read', 'workflow:write', 'workflow:execute', 'workflow:delete',
    'integration:read', 'integration:write', 'integration:test', 'integration:delete',
    'approval:request', 'approval:approve', 'approval:reject',
    'evidence:read', 'evidence:write', 'audit:read',
    'user:read', 'user:write', 'user:delete',
    'contain:block_ip', 'contain:isolate_host', 'contain:disable_user',
    'contain:reset_password', 'contain:firewall_rule',
  ],
  analyst: [
    'case:read', 'case:write', 'case:assign',
    'alert:read', 'alert:write',
    'workflow:read', 'workflow:execute',
    'integration:read', 'approval:request',
    'evidence:read', 'evidence:write', 'audit:read',
  ],
  responder: [
    'case:read', 'alert:read',
    'workflow:read', 'workflow:execute',
    'integration:read', 'approval:request',
    'evidence:read', 'evidence:write',
    'contain:block_ip', 'contain:isolate_host', 'contain:disable_user',
  ],
  viewer: [
    'case:read', 'alert:read', 'workflow:read',
    'integration:read', 'evidence:read', 'audit:read',
  ],
};

async function ensurePermission(name) {
  const [resource, action] = name.split(':');
  return prisma.permission.upsert({
    where: { name },
    create: { name, resource, action, description: name },
    update: {},
  });
}

async function ensureRole(name, description, isSystem = true) {
  return prisma.role.upsert({
    where: { name },
    create: { name, description, isSystem },
    update: { description },
  });
}

async function linkRolePermissions(roleId, permNames) {
  for (const permName of permNames) {
    const perm = await ensurePermission(permName);
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: perm.id } },
      create: { roleId, permissionId: perm.id },
      update: {},
    });
  }
}

async function main() {
  console.log('=== SOAR Admin Bootstrap ===\n');

  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    create: { name: 'Default Tenant', slug: TENANT_SLUG, status: 'active' },
    update: {},
  });
  console.log(`✓ Tenant: ${tenant.slug} (${tenant.id})`);

  const allPerms = new Set();
  for (const perms of Object.values(ROLE_PERMISSIONS)) {
    if (perms) perms.forEach((p) => allPerms.add(p));
  }
  for (const p of allPerms) await ensurePermission(p);

  const superRole = await ensureRole('superadmin', 'Full platform access');
  const allPermissionRows = await prisma.permission.findMany();
  for (const perm of allPermissionRows) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: superRole.id, permissionId: perm.id } },
      create: { roleId: superRole.id, permissionId: perm.id },
      update: {},
    });
  }

  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    if (roleName === 'superadmin' || !perms) continue;
    const role = await ensureRole(roleName, `${roleName} role`);
    await linkRolePermissions(role.id, perms);
    console.log(`✓ Role: ${roleName} (${perms.length} permissions)`);
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const username = ADMIN_EMAIL.split('@')[0];

  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      tenantId: tenant.id,
      email: ADMIN_EMAIL,
      username,
      fullName: ADMIN_NAME,
      passwordHash,
      status: 'active',
    },
    update: {
      passwordHash,
      status: 'active',
      fullName: ADMIN_NAME,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: superRole.id } },
    create: { userId: user.id, roleId: superRole.id, assignedBy: 'bootstrap' },
    update: {},
  });

  console.log(`✓ Admin user: ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD} (change after first login in production)`);
  console.log('\nBootstrap complete — no operational/demo alerts or incidents were created.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
