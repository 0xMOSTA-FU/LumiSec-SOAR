/**
 * Audit Service — tamper-evident hash chain
 * ---------------------------------------------------------------------------
 * Every mutation (create/update/delete on any resource) is recorded as an
 * AuditLog entry. Each entry's hash = SHA-256(prev_hash + canonical_json(entry)).
 *
 * This produces an append-only ledger that can be verified by an external
 * auditor: any tampering with a historical entry breaks the chain.
 *
 * Compliance: SOC2 CC7.2, ISO27001 A.12.4 (event logging), NIST SP 800-92
 *
 * Storage: MongoDB `audit_logs` collection. Index on (tenantId, createdAt).
 * Retention: 1 year (configurable per tenant).
 */
import { createHash } from 'node:crypto';
import { getDb } from '../repositories/mongo-client';
import { AuditLog } from '../domain/entities';
import { Logger } from './logger';
import { redactSecrets } from '../security/sanitizer';

const log = new Logger({ component: 'audit-service' });

export interface AuditInput {
  tenantId?: string;
  userId?: string;
  actor: string;
  actorIp?: string;
  actorType?: 'user' | 'system' | 'api-key' | 'webhook';
  action: string;            // e.g., 'integration.update_config'
  resource: string;          // e.g., 'integration'
  resourceId?: string;
  description: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  requestId?: string;
  correlationId?: string;
}

let lastHash: string | null = null;

/** Load the most recent hash from the DB on boot — needed to continue the chain. */
async function loadLastHash(): Promise<string | null> {
  if (lastHash) return lastHash;
  try {
    const db = await getDb();
    const latest = await db.collection<AuditLog>('audit_logs')
      .find({})
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();
    lastHash = latest[0]?.hash || null;
    return lastHash;
  } catch (err) {
    log.error('Failed to load last audit hash', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Compute the next hash in the chain: SHA-256(prev_hash + canonical_json(entry)). */
function computeHash(entry: Omit<AuditLog, 'hash'>, prevHash: string | null): string {
  // Canonical JSON: keys sorted, no whitespace, deterministic
  const canonical = JSON.stringify(
    {
      ...(entry as Record<string, unknown>),
      prevHash: prevHash || '',
    },
    // Sort keys recursively
    (_, v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return Object.keys(v).sort().reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
      }
      return v;
    },
  );
  return createHash('sha256').update(canonical).digest('hex');
}

/** Append a new audit entry to the hash chain. */
export async function writeAudit(input: AuditInput): Promise<AuditLog> {
  const prevHash = await loadLastHash();
  // Redact secrets from before/after snapshots before persisting
  const safeBefore = input.before != null ? redactSecrets(input.before) : undefined;
  const safeAfter = input.after != null ? redactSecrets(input.after) : undefined;

  const entry: Omit<AuditLog, 'hash'> = {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    tenantId: input.tenantId,
    userId: input.userId,
    actor: input.actor,
    actorIp: input.actorIp,
    actorType: input.actorType || 'system',
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId,
    description: input.description,
    before: safeBefore,
    after: safeAfter,
    metadata: input.metadata || {},
    prevHash: prevHash || undefined,
    requestId: input.requestId,
    correlationId: input.correlationId,
    createdAt: new Date(),
  };

  const hash = computeHash(entry, prevHash);
  const auditLog: AuditLog = { ...entry, hash } as AuditLog;

  try {
    const db = await getDb();
    await db.collection<AuditLog>('audit_logs').insertOne(auditLog);
    lastHash = hash;
    log.audit(input.action, { actor: input.actor, resource: input.resource, resourceId: input.resourceId });
  } catch (err) {
    log.error('Failed to write audit log', { error: err instanceof Error ? err.message : String(err), action: input.action });
    // Don't throw — audit failures must NOT block business operations
    // (but we DO log loudly so ops can investigate)
  }
  return auditLog;
}

/** Verify the hash chain — returns the index of the first broken entry, or -1 if all valid. */
export async function verifyAuditChain(opts: { from?: Date; to?: Date; limit?: number } = {}): Promise<{ valid: boolean; brokenAtIndex?: number; totalChecked: number }> {
  const db = await getDb();
  const query: Record<string, unknown> = {};
  if (opts.from || opts.to) {
    query.createdAt = {};
    if (opts.from) (query.createdAt as Record<string, unknown>).$gte = opts.from;
    if (opts.to) (query.createdAt as Record<string, unknown>).$lte = opts.to;
  }
  const entries = await db.collection<AuditLog>('audit_logs')
    .find(query)
    .sort({ createdAt: 1 })
    .limit(opts.limit || 10000)
    .toArray();

  let prevHash: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { hash: _, ...entryWithoutHash } = entry;
    const recomputed = computeHash(entryWithoutHash, prevHash);
    if (recomputed !== entry.hash) {
      return { valid: false, brokenAtIndex: i, totalChecked: i + 1 };
    }
    prevHash = entry.hash;
  }
  return { valid: true, totalChecked: entries.length };
}

/** Query audit entries (for the UI's audit log viewer). */
export async function queryAudit(opts: {
  tenantId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  actor?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
} = {}): Promise<AuditLog[]> {
  const db = await getDb();
  const query: Record<string, unknown> = {};
  if (opts.tenantId) query.tenantId = opts.tenantId;
  if (opts.action) query.action = opts.action;
  if (opts.resource) query.resource = opts.resource;
  if (opts.resourceId) query.resourceId = opts.resourceId;
  if (opts.actor) query.actor = opts.actor;
  if (opts.from || opts.to) {
    query.createdAt = {};
    if (opts.from) (query.createdAt as Record<string, unknown>).$gte = opts.from;
    if (opts.to) (query.createdAt as Record<string, unknown>).$lte = opts.to;
  }
  const cursor = db.collection<AuditLog>('audit_logs')
    .find(query)
    .sort({ createdAt: -1 })
    .skip(opts.offset || 0)
    .limit(opts.limit || 100);
  return cursor.toArray();
}
