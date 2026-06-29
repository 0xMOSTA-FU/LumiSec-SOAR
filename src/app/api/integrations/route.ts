// Integration CRUD API
// All `config` fields are AES-256-GCM encrypted at write and decrypted at read.
// Decrypted values are only returned for `GET /api/integrations/[id]` (used by the
// config modal); list endpoints return redacted configs.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import { mergeIntegrationConfig, decryptIntegrationConfig, encryptIntegrationConfig } from '@/lib/integrations/config-secrets';
import { extractAuthContext, requirePermission, PERMISSIONS, AuthorizationError } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_PUBLIC_KEYS = ['default_to', 'test_to', 'from', 'service'] as const;

function emailPublicHints(configEnc: string): Record<string, string> {
  try {
    const config = decryptIntegrationConfig(configEnc);
    const hints: Record<string, string> = {};
    for (const key of EMAIL_PUBLIC_KEYS) {
      const val = config[key];
      if (typeof val === 'string' && val.trim()) hints[key] = val.trim();
    }
    return hints;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const ctx = await extractAuthContext(req);
  try {
    requirePermission(ctx, PERMISSIONS.INTEGRATION_READ);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const integrations = await db.integration.findMany({
    where: ctx.tenantId ? { tenantId: ctx.tenantId } : {},
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, type: true, category: true, description: true,
      status: true, icon: true, lastTestedAt: true, lastTestResult: true,
      config: true,
      createdAt: true, updatedAt: true,
    },
  });

  return NextResponse.json(
    integrations.map((row) => {
      const { config, ...rest } = row;
      const type = String(row.type || '').toLowerCase();
      const isEmail = type === 'email' || String(row.name || '').toLowerCase().includes('smtp');
      return {
        ...rest,
        public_config: isEmail ? emailPublicHints(config) : undefined,
      };
    }),
  );
}

export async function POST(req: NextRequest) {
  const ctx = await extractAuthContext(req);
  try {
    requirePermission(ctx, PERMISSIONS.INTEGRATION_WRITE);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const body = await req.json();
  const integration = await db.integration.create({
    data: {
      tenantId: ctx.tenantId,
      name: body.name || 'New Integration',
      type: body.type || 'api',
      category: body.category || 'security',
      description: body.description || '',
      config: encryptIntegrationConfig((body.config || {}) as Record<string, unknown>),
      status: body.status || 'disconnected',
      icon: body.icon || 'shield',
    },
  });

  await writeAudit(ctx, {
    action: 'integration.create',
    resource: 'integration',
    resourceId: integration.id,
    description: `Created integration "${integration.name}" (type=${integration.type})`,
    after: { name: integration.name, type: integration.type, category: integration.category },
  });

  return NextResponse.json(integration, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const ctx = await extractAuthContext(req);
  try {
    requirePermission(ctx, PERMISSIONS.INTEGRATION_WRITE);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  const before = await db.integration.findUnique({ where: { id } });

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.config !== undefined) {
    const existing = before ? decryptIntegrationConfig(before.config) : {};
    updateData.config = encryptIntegrationConfig(
      mergeIntegrationConfig(existing, data.config as Record<string, unknown>),
    );
  }
  if (data.status !== undefined) updateData.status = data.status;
  if (data.icon !== undefined) updateData.icon = data.icon;
  if (data.rateLimitPerMin !== undefined) updateData.rateLimitPerMin = data.rateLimitPerMin;
  if (data.timeoutMs !== undefined) updateData.timeoutMs = data.timeoutMs;
  if (data.retryCount !== undefined) updateData.retryCount = data.retryCount;

  const integration = await db.integration.update({ where: { id }, data: updateData });

  await writeAudit(ctx, {
    action: 'integration.update',
    resource: 'integration',
    resourceId: id,
    description: `Updated integration "${integration.name}" (fields: ${Object.keys(updateData).join(', ')})`,
    before: before ? { name: before.name, type: before.type, status: before.status } : null,
    after: { name: integration.name, type: integration.type, status: integration.status, updatedFields: Object.keys(updateData) },
  });

  return NextResponse.json(integration);
}

export async function DELETE(req: NextRequest) {
  const ctx = await extractAuthContext(req);
  try {
    requirePermission(ctx, PERMISSIONS.INTEGRATION_DELETE);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  const before = await db.integration.findUnique({ where: { id } });
  await db.integration.delete({ where: { id } });

  await writeAudit(ctx, {
    action: 'integration.delete',
    resource: 'integration',
    resourceId: id,
    description: `Deleted integration "${before?.name || id}"`,
    before: before ? { name: before.name, type: before.type } : null,
  });

  return NextResponse.json({ success: true });
}
