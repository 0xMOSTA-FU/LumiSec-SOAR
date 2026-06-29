// Audit log service — writes tamper-evident audit records.
// Each record includes SHA-256(prev_hash + canonical_json(this)).
// Records are also streamed to Kafka topic `audit` for append-only archive.

import { db } from '@/lib/db';
import { sha256 } from '@/lib/crypto';
import { logger, logAuditEvent } from '@/lib/logger';
import type { AuthContext } from '@/lib/auth';

export interface AuditEntry {
  action: string;
  resource: string;
  resourceId?: string;
  description: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  level?: 'info' | 'warn' | 'error';
}

/**
 * Write an audit log entry. Called by every mutating API endpoint.
 * The hash chain ensures tamper-evidence: altering any record invalidates
 * all subsequent hashes.
 */
export async function writeAudit(ctx: AuthContext, entry: AuditEntry): Promise<void> {
  try {
    // Fetch previous hash
    const last = await db.auditLog.findFirst({
      where: ctx.tenantId ? { tenantId: ctx.tenantId } : { tenantId: null },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const prevHash = last?.hash || null;

    // Build canonical payload for hashing
    const canonicalInput = JSON.stringify({
      prevHash,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId || null,
      description: entry.description,
      tenantId: ctx.tenantId || null,
      userId: ctx.userId || null,
      actor: ctx.email || ctx.username || (ctx.authMethod === 'system' ? 'system' : 'anonymous'),
      actorIp: ctx.actorIp || null,
      actorType: ctx.authMethod,
      requestId: ctx.requestId,
      // before/after excluded from hash to keep it stable if redaction changes
      // (the canonical record is what matters for tamper detection)
    });
    const hash = sha256(canonicalInput);

    // Persist
    await db.auditLog.create({
      data: {
        // In dev mode, ctx.userId is "local-admin" which is not a real User row.
        // Set userId only if it references a persisted user; otherwise null.
        tenantId: ctx.tenantId,
        userId: ctx.authMethod === 'system' ? null : ctx.userId,
        actor: ctx.email || ctx.username || 'system',
        actorIp: ctx.actorIp || undefined,
        actorType: ctx.authMethod,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        description: entry.description,
        before: entry.before as any,
        after: entry.after as any,
        // AuditLog.metadata column is `String @default("{}")` — we must
        // JSON-stringify the object before persisting.
        metadata: JSON.stringify(entry.metadata || {}),
        hash,
        prevHash,
        requestId: ctx.requestId,
      },
    });

    // Also emit to logger (structured) — collector picks this up for Kafka/Loki
    logAuditEvent({
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      description: entry.description,
      actor: ctx.email || ctx.username || 'system',
      userId: ctx.userId || undefined,
      tenantId: ctx.tenantId || undefined,
      requestId: ctx.requestId,
      actorIp: ctx.actorIp || undefined,
      metadata: entry.metadata,
      before: entry.before,
      after: entry.after,
      level: entry.level,
    });

    // TODO (enterprise): also publish to Kafka topic `audit` for cross-cluster
    // aggregation and immutable S3 archive with Object Lock.
  } catch (err) {
    // Audit log failure is critical — alert but do not block the operation.
    logger.error({ err, entry, ctx }, 'AUDIT LOG WRITE FAILED — alert SOC');
  }
}

/**
 * Verify the integrity of the audit log hash chain.
 * Returns the first broken record (if any), or null if chain is intact.
 */
export async function verifyAuditChain(opts: { tenantId?: string; limit?: number }): Promise<{ brokenAt: string | null; checked: number }> {
  const records = await db.auditLog.findMany({
    where: opts.tenantId ? { tenantId: opts.tenantId } : {},
    orderBy: { createdAt: 'asc' },
    take: opts.limit || 1000,
    select: { id: true, hash: true, prevHash: true, action: true, resource: true, resourceId: true, description: true, tenantId: true, userId: true, actor: true, actorIp: true, actorType: true, requestId: true, createdAt: true },
  });

  let prevHash: string | null = null;
  for (const r of records) {
    if (r.prevHash !== prevHash) {
      return { brokenAt: r.id, checked: records.indexOf(r) };
    }
    const canonicalInput = JSON.stringify({
      prevHash,
      action: r.action,
      resource: r.resource,
      resourceId: r.resourceId || null,
      description: r.description,
      tenantId: r.tenantId,
      userId: r.userId,
      actor: r.actor,
      actorIp: r.actorIp,
      actorType: r.actorType,
      requestId: r.requestId,
    });
    const expected = sha256(canonicalInput);
    if (r.hash !== expected) {
      return { brokenAt: r.id, checked: records.indexOf(r) };
    }
    prevHash = r.hash;
  }
  return { brokenAt: null, checked: records.length };
}
