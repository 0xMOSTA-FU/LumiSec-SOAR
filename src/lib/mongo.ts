// MongoDB connector — optional secondary datastore alongside Prisma/SQLite.
//
// WHY BOTH:
//   Prisma + SQLite/Postgres holds the authoritative relational state
//   (workflows, cases, integrations, audit, RBAC, etc.).
//
//   MongoDB is used for high-volume, schema-flexible stores that fit
//   document-style access patterns:
//     • Raw execution traces (one document per node call)
//     • Raw alerts payload archive (SIEM/syslog/webhook bodies)
//     • Connector call samples (request/response pairs for forensics)
//     • External backend sync mirror (see lib/external-api.ts)
//
// GRACEFUL DEGRADATION:
//   If MONGODB_URI is not set, every function below becomes a no-op
//   (returns null / empty arrays). The main Prisma path is unaffected.
//   This keeps dev environments simple and lets ops enable Mongo only
//   on production nodes that need it.

import { MongoClient, Db, Collection, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'soar';
const POOL_SIZE = Number(process.env.MONGO_POOL_SIZE || 20);

let client: MongoClient | null = null;
let db: Db | null = null;
let connectionPromise: Promise<Db | null> | null = null;

export interface MongoHealth {
  connected: boolean;
  configured: boolean;
  db: string;
  poolSize: number;
  serverStatus?: 'ok' | 'down';
  latencyMs?: number;
  lastError?: string;
}

export function isMongoEnabled(): boolean {
  return !!MONGODB_URI;
}

async function ensureIndexes(m: Db): Promise<void> {
  await Promise.all([
    // High-volume forensic stores
    m.collection('execution_traces').createIndex({ executionId: 1, startedAt: 1 }),
    m.collection('execution_traces').createIndex({ workflowId: 1, startedAt: -1 }),
    m.collection('execution_traces').createIndex({ nodeId: 1, startedAt: -1 }),
    m.collection('raw_alerts').createIndex({ alertId: 1 }, { unique: true }),
    m.collection('raw_alerts').createIndex({ source: 1, ts: -1 }),
    m.collection('connector_calls').createIndex({ executionId: 1, ts: 1 }),
    m.collection('connector_calls').createIndex({ integrationType: 1, ts: -1 }),
    m.collection('platform_integration_calls').createIndex({ module: 1, ts: -1 }),
    m.collection('platform_integration_calls').createIndex({ incidentId: 1, ts: -1 }),
    m.collection('platform_integration_calls').createIndex({ module: 1, ts: -1 }),
    m.collection('platform_integration_calls').createIndex({ incidentId: 1, ts: -1 }),
    m.collection('external_sync').createIndex({ resource: 1, externalId: 1 }, { unique: true }),
    // Enterprise SOAR collections (Node backend mirror / analytics)
    m.collection('workflows').createIndex({ id: 1 }, { unique: true }),
    m.collection('workflows').createIndex({ tenantId: 1, status: 1, updatedAt: -1 }),
    m.collection('workflow_executions').createIndex({ id: 1 }, { unique: true }),
    m.collection('workflow_executions').createIndex({ workflowId: 1, startedAt: -1 }),
    m.collection('workflow_executions').createIndex({ status: 1, startedAt: -1 }),
    m.collection('integrations').createIndex({ id: 1 }, { unique: true }),
    m.collection('integrations').createIndex({ tenantId: 1, type: 1 }),
    m.collection('cases').createIndex({ id: 1 }, { unique: true }),
    m.collection('cases').createIndex({ tenantId: 1, status: 1, severity: -1, createdAt: -1 }),
    m.collection('alerts').createIndex({ id: 1 }, { unique: true }),
    m.collection('alerts').createIndex({ tenantId: 1, status: 1, severity: -1, createdAt: -1 }),
    m.collection('audit_logs').createIndex({ id: 1 }, { unique: true }),
    m.collection('audit_logs').createIndex({ tenantId: 1, createdAt: -1 }),
    m.collection('audit_logs').createIndex({ hash: 1 }, { unique: true }),
    m.collection('rate_limits').createIndex({ key: 1, windowStart: 1 }, { expireAfterSeconds: 120 }),
    m.collection('raw_payloads').createIndex({ executionId: 1 }, { expireAfterSeconds: 86400 * 30 }),
    m.collection('raw_payloads').createIndex({ source: 1, ts: -1 }),
  ]);
}

// Singleton connection — survives HMR in dev
export async function getMongo(): Promise<Db | null> {
  if (!MONGODB_URI) return null;
  if (db) return db;
  if (connectionPromise) return connectionPromise;
  connectionPromise = (async () => {
    try {
      client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        maxPoolSize: POOL_SIZE,
        minPoolSize: 2,
        retryWrites: true,
        retryReads: true,
      });
      await client.connect();
      db = client.db(MONGODB_DB);
      await ensureIndexes(db);
      console.log('[mongo] Connected to', MONGODB_DB);
      return db;
    } catch (err) {
      console.error('[mongo] Connection failed:', err instanceof Error ? err.message : err);
      connectionPromise = null;
      return null;
    }
  })();
  return connectionPromise;
}

/** Health check for /api/system/status and ops probes. */
export async function checkMongoHealth(): Promise<MongoHealth> {
  if (!MONGODB_URI) {
    return {
      connected: false,
      configured: false,
      db: MONGODB_DB,
      poolSize: 0,
      serverStatus: 'down',
      lastError: 'MONGODB_URI not set',
    };
  }
  const start = Date.now();
  try {
    const m = await getMongo();
    if (!m || !client) {
      return {
        connected: false,
        configured: true,
        db: MONGODB_DB,
        poolSize: POOL_SIZE,
        serverStatus: 'down',
        latencyMs: Date.now() - start,
        lastError: 'Connection failed',
      };
    }
    await client.db().admin().ping();
    return {
      connected: true,
      configured: true,
      db: MONGODB_DB,
      poolSize: POOL_SIZE,
      serverStatus: 'ok',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      connected: false,
      configured: true,
      db: MONGODB_DB,
      poolSize: POOL_SIZE,
      serverStatus: 'down',
      latencyMs: Date.now() - start,
      lastError: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================================
// EXECUTION TRACES (per-node call)
// ============================================================================

export interface ExecutionTrace {
  _id?: ObjectId;
  executionId: string;
  workflowId: string;
  nodeId: string;
  nodeLabel?: string;
  nodeSubtype?: string;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  success: boolean;
  branch?: string;
  logs?: unknown[];
  output?: unknown;
  error?: string;
}

export async function insertExecutionTrace(trace: Omit<ExecutionTrace, '_id'>): Promise<void> {
  const m = await getMongo();
  if (!m) return;
  try {
    await m.collection<ExecutionTrace>('execution_traces').insertOne({
      ...trace,
      _id: new ObjectId(),
    });
  } catch (e) {
    console.error('[mongo] insertExecutionTrace failed:', e instanceof Error ? e.message : e);
  }
}

export async function getExecutionTraces(executionId: string): Promise<ExecutionTrace[]> {
  const m = await getMongo();
  if (!m) return [];
  try {
    return await m
      .collection<ExecutionTrace>('execution_traces')
      .find({ executionId })
      .sort({ startedAt: 1 })
      .toArray();
  } catch {
    return [];
  }
}

// ============================================================================
// RAW ALERTS ARCHIVE
// ============================================================================

export interface RawAlert {
  _id?: ObjectId;
  alertId: string; // links to Prisma Alert.id
  source: string;
  ts: Date;
  payload: unknown; // the full original JSON from SIEM/webhook/syslog
  signature?: string; // sha256 of canonical payload for dedup
}

export async function archiveRawAlert(alert: Omit<RawAlert, '_id'>): Promise<void> {
  const m = await getMongo();
  if (!m) return;
  try {
    await m
      .collection<RawAlert>('raw_alerts')
      .updateOne({ alertId: alert.alertId }, { $set: alert }, { upsert: true });
  } catch (e) {
    console.error('[mongo] archiveRawAlert failed:', e instanceof Error ? e.message : e);
  }
}

export async function getRawAlert(alertId: string): Promise<RawAlert | null> {
  const m = await getMongo();
  if (!m) return null;
  return m.collection<RawAlert>('raw_alerts').findOne({ alertId });
}

// ============================================================================
// CONNECTOR CALL SAMPLES (request/response pairs for forensics)
// ============================================================================

export interface ConnectorCall {
  _id?: ObjectId;
  executionId: string;
  integrationType: string;
  integrationId?: string;
  ts: Date;
  request: { method: string; url: string; headers?: Record<string, string>; body?: unknown };
  response: { status: number; statusText: string; body?: unknown };
  durationMs: number;
  success: boolean;
}

// ============================================================================
// PLATFORM INTEGRATION AUDIT (GRC / UCTC / Phishing / LumiNet outbound)
// ============================================================================

export interface PlatformIntegrationCall {
  _id?: ObjectId;
  module: string;
  action: string;
  incidentId?: string;
  ts: Date;
  method: string;
  path: string;
  status: number;
  success: boolean;
  durationMs: number;
  requestBody?: unknown;
  responseBody?: unknown;
}

export async function recordPlatformIntegrationCall(
  call: Omit<PlatformIntegrationCall, '_id' | 'ts'>,
): Promise<void> {
  const m = await getMongo();
  if (!m) return;
  try {
    await m.collection<PlatformIntegrationCall>('platform_integration_calls').insertOne({
      ...call,
      _id: new ObjectId(),
      ts: new Date(),
    });
  } catch (e) {
    console.error('[mongo] recordPlatformIntegrationCall failed:', e instanceof Error ? e.message : e);
  }
}

export async function recordConnectorCall(call: Omit<ConnectorCall, '_id'>): Promise<void> {
  const m = await getMongo();
  if (!m) return;
  try {
    await m.collection<ConnectorCall>('connector_calls').insertOne({
      ...call,
      _id: new ObjectId(),
    });
  } catch (e) {
    console.error('[mongo] recordConnectorCall failed:', e instanceof Error ? e.message : e);
  }
}

export async function getConnectorCalls(executionId: string): Promise<ConnectorCall[]> {
  const m = await getMongo();
  if (!m) return [];
  try {
    return await m
      .collection<ConnectorCall>('connector_calls')
      .find({ executionId })
      .sort({ ts: 1 })
      .toArray();
  } catch {
    return [];
  }
}

// ============================================================================
// EXTERNAL BACKEND SYNC MIRROR
// Tracks the last-seen state of resources mirrored from the external
// Node.js backend (lib/external-api.ts) so we can do incremental sync.
// ============================================================================

export interface ExternalSyncRecord {
  _id?: ObjectId;
  resource: string; // e.g. "incidents", "assets", "threats"
  externalId: string;
  data: unknown;
  lastSyncedAt: Date;
  checksum: string; // sha256 of canonical JSON for change detection
}

export async function upsertExternalSync(
  resource: string,
  externalId: string,
  data: unknown,
  checksum: string
): Promise<void> {
  const m = await getMongo();
  if (!m) return;
  try {
    await m
      .collection<ExternalSyncRecord>('external_sync')
      .updateOne(
        { resource, externalId },
        { $set: { data, lastSyncedAt: new Date(), checksum } },
        { upsert: true }
      );
  } catch (e) {
    console.error('[mongo] upsertExternalSync failed:', e instanceof Error ? e.message : e);
  }
}

export async function getExternalSync(
  resource: string,
  externalId: string
): Promise<ExternalSyncRecord | null> {
  const m = await getMongo();
  if (!m) return null;
  return m.collection<ExternalSyncRecord>('external_sync').findOne({ resource, externalId });
}

export async function listExternalSync(resource: string, limit = 100): Promise<ExternalSyncRecord[]> {
  const m = await getMongo();
  if (!m) return [];
  return m
    .collection<ExternalSyncRecord>('external_sync')
    .find({ resource })
    .sort({ lastSyncedAt: -1 })
    .limit(limit)
    .toArray();
}

// Generic collection getter (for ad-hoc usage)
export async function getCollection<T extends Record<string, unknown> = Record<string, unknown>>(
  name: string
): Promise<Collection<T> | null> {
  const m = await getMongo();
  if (!m) return null;
  return m.collection<T>(name);
}

// Cleanly close the connection (used by tests / graceful shutdown)
export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    connectionPromise = null;
  }
}
