/**
 * Integration Repository — MongoDB implementation
 * ---------------------------------------------------------------------------
 * Stores encrypted integration configs. Plaintext secrets NEVER hit the
 * database — `encryptedConfig` is the only field that persists, and it's
 * AES-256-GCM ciphertext (see lib/crypto.ts).
 *
 * The `config` field on the returned entity is decrypted in-memory only
 * for the duration of a workflow execution. It is NEVER returned by list
 * endpoints (only by the masked single-get for the config modal).
 *
 * Compliance: SOC2 CC6.1, CC6.7 (logical access & transmission), ISO27001 A.9
 */
import { Db } from 'mongodb';
import { getDb } from './mongo-client';
import { Integration, IntegrationStatus } from '../domain/entities';
import { decrypt, encrypt } from '@/lib/crypto';

export interface IIntegrationRepository {
  findById(id: string, opts?: { decrypt?: boolean }): Promise<Integration | null>;
  findByType(type: string, opts?: { decrypt?: boolean }): Promise<Integration | null>;
  findMany(filters: { tenantId?: string; type?: string; status?: string }, opts?: { limit?: number }): Promise<Integration[]>;
  create(integration: Integration): Promise<Integration>;
  update(id: string, patch: Partial<Integration>): Promise<Integration | null>;
  delete(id: string): Promise<boolean>;
  /** Atomically flip status; used by health-check pollers. */
  setStatus(id: string, status: IntegrationStatus, lastTestResult?: 'success' | 'failed'): Promise<void>;
}

type IntegrationDoc = Integration & { _id?: string; encryptedConfig?: string };

export class IntegrationRepository implements IIntegrationRepository {
  private async coll() {
    const db: Db = await getDb();
    return db.collection<IntegrationDoc>('integrations');
  }

  async findById(id: string, opts: { decrypt?: boolean } = {}): Promise<Integration | null> {
    const c = await this.coll();
    const doc = await c.findOne({ id } as Record<string, unknown>, { projection: { _id: 0 } });
    if (!doc) return null;
    return this.deserialize(doc, opts.decrypt === true);
  }

  async findByType(type: string, opts: { decrypt?: boolean } = {}): Promise<Integration | null> {
    const c = await this.coll();
    const doc = await c.findOne({ type: type.toLowerCase() } as Record<string, unknown>, { projection: { _id: 0 } });
    if (!doc) return null;
    return this.deserialize(doc, opts.decrypt === true);
  }

  async findMany(filters: { tenantId?: string; type?: string; status?: string }, opts: { limit?: number } = {}): Promise<Integration[]> {
    const c = await this.coll();
    const query: Record<string, unknown> = {};
    if (filters.tenantId) query.tenantId = filters.tenantId;
    if (filters.type) query.type = filters.type.toLowerCase();
    if (filters.status) query.status = filters.status;
    const cursor = c.find(query, { projection: { _id: 0, encryptedConfig: 0 } }).sort({ name: 1 });
    if (opts.limit) cursor.limit(opts.limit);
    const docs = await cursor.toArray();
    // List endpoints NEVER return decrypted config — only metadata
    return docs.map(d => this.deserialize(d, false));
  }

  async create(integration: Integration): Promise<Integration> {
    const c = await this.coll();
    const encryptedConfig = encrypt(integration.config || {});
    await c.insertOne({
      ...integration,
      _id: integration.id,
      encryptedConfig,
      config: {} as Record<string, unknown>, // never persist plaintext
    } as Integration & { _id: string; encryptedConfig: string });
    return integration;
  }

  async update(id: string, patch: Partial<Integration>): Promise<Integration | null> {
    const c = await this.coll();
    const setFields: Record<string, unknown> = { ...patch, updatedAt: new Date() };
    if (patch.config) {
      // Re-encrypt on config change
      setFields.encryptedConfig = encrypt(patch.config);
      setFields.config = {}; // never persist plaintext
    }
    const update = { $set: setFields };
    const result = await c.findOneAndUpdate(
      { id } as Record<string, unknown>,
      update,
      { returnDocument: 'after', projection: { _id: 0, encryptedConfig: 0 } },
    );
    return result ? this.deserialize(result, false) : null;
  }

  async delete(id: string): Promise<boolean> {
    const c = await this.coll();
    const result = await c.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async setStatus(id: string, status: IntegrationStatus, lastTestResult?: 'success' | 'failed'): Promise<void> {
    const c = await this.coll();
    await c.updateOne(
      { id },
      { $set: { status, lastTestedAt: new Date(), lastTestResult, updatedAt: new Date() } },
    );
  }

  private deserialize(
    doc: Integration & { _id?: string; encryptedConfig?: string },
    decryptConfig: boolean,
  ): Integration {
    const { _id, encryptedConfig, ...rest } = doc;
    const integ = { ...rest } as Integration;
    if (decryptConfig && encryptedConfig) {
      try {
        const decrypted = decrypt<Record<string, unknown>>(encryptedConfig);
        if (decrypted && typeof decrypted === 'object') {
          integ.config = decrypted;
        } else if (typeof decrypted === 'string') {
          try { integ.config = JSON.parse(decrypted); } catch { /* */ }
        }
      } catch { /* bad ciphertext — leave config empty */ }
    } else {
      integ.config = {};
    }
    return integ;
  }
}
