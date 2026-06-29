// GET /api/integrations/[id]   — fetch single integration (config masked)
// PUT /api/integrations/[id]   — update integration config (encrypts at rest)
// The config is encrypted via AES-256-GCM in src/lib/crypto.ts.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto';
import { extractAuthContext, requirePermission, PERMISSIONS, AuthorizationError } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { saveIntegrationConfig } from '@/lib/integrations/integration-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await extractAuthContext(req);
  try {
    requirePermission(ctx, PERMISSIONS.INTEGRATION_READ);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { id } = await params;
  const int = await db.integration.findUnique({ where: { id } });
  if (!int) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Decrypt the config in-memory for the modal
  const config: Record<string, unknown> = decrypt(int.config) || {};

  // Mask sensitive fields before sending to client
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string' && (
      k.toLowerCase().includes('key') ||
      k.toLowerCase().includes('token') ||
      k.toLowerCase().includes('secret') ||
      k.toLowerCase().includes('password') ||
      k.toLowerCase().includes('webhook')
    ) && v.length > 0) {
      masked[k] = v.slice(0, 4) + '••••••' + (v.length > 10 ? v.slice(-2) : '');
    } else {
      masked[k] = v;
    }
  }

  return NextResponse.json({
    ...int,
    config: masked,
    _hasRealConfig: Object.values(config).some(v => typeof v === 'string' && v.length > 0),
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await extractAuthContext(req);
  try {
    requirePermission(ctx, PERMISSIONS.INTEGRATION_WRITE);
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { id } = await params;
  const body = await req.json();
  const int = await db.integration.findUnique({ where: { id } });
  if (!int) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.config && typeof body.config === 'object') {
    const result = await saveIntegrationConfig(id, body.config as Record<string, unknown>);

    const meta: Record<string, unknown> = {};
    if (body.name !== undefined) meta.name = body.name;
    if (body.description !== undefined) meta.description = body.description;
    if (body.category !== undefined) meta.category = body.category;
    if (body.type !== undefined) meta.type = body.type;
    if (body.rateLimitPerMin !== undefined) meta.rateLimitPerMin = body.rateLimitPerMin;
    if (body.timeoutMs !== undefined) meta.timeoutMs = body.timeoutMs;
    if (body.retryCount !== undefined) meta.retryCount = body.retryCount;

    let updated = int;
    if (Object.keys(meta).length > 0) {
      updated = await db.integration.update({ where: { id }, data: meta });
    } else {
      updated = (await db.integration.findUnique({ where: { id } })) ?? int;
    }

    await writeAudit(ctx, {
      action: 'integration.update_config',
      resource: 'integration',
      resourceId: id,
      description: `Updated config for integration "${updated.name}"`,
      metadata: { autoTest: result.test },
    });

    return NextResponse.json({
      ok: true,
      id: updated.id,
      status: result.status,
      test: result.test,
      connected: result.test.ok,
      message: result.test.message,
    });
  }

  // Decrypt existing config (so we can merge) — legacy path without config body
  const existing: Record<string, unknown> = decrypt(int.config) || {};

  // Merge: if a field is "••••" (masked sentinel from the modal), keep existing
  const newConfig: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(body.config || {})) {
    if (typeof v === 'string' && v.includes('••••')) {
      // Keep existing
      continue;
    }
    newConfig[k] = v;
  }

  const updateData: Record<string, unknown> = { config: encrypt(newConfig) };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.type !== undefined) updateData.type = body.type;
  if (body.rateLimitPerMin !== undefined) updateData.rateLimitPerMin = body.rateLimitPerMin;
  if (body.timeoutMs !== undefined) updateData.timeoutMs = body.timeoutMs;
  if (body.retryCount !== undefined) updateData.retryCount = body.retryCount;

  const updated = await db.integration.update({ where: { id }, data: updateData });

  await writeAudit(ctx, {
    action: 'integration.update_config',
    resource: 'integration',
    resourceId: id,
    description: `Updated config for integration "${updated.name}"`,
    metadata: { updatedFields: Object.keys(updateData) },
  });

  return NextResponse.json({ ok: true, id: updated.id, status: updated.status });
}
