/**
 * SOAR MongoDB Client — delegates to the canonical optional connector in lib/mongo.ts.
 * All Mongo usage goes through lib/mongo.ts so MONGODB_URI gating is consistent.
 */
import type { Db } from 'mongodb';
import {
  checkMongoHealth,
  closeMongo,
  getMongo,
  isMongoEnabled,
  type MongoHealth,
} from '@/lib/mongo';

export type { MongoHealth };

export { isMongoEnabled, checkMongoHealth };

/** Returns Db when Mongo is configured and reachable; throws otherwise. */
export async function getDb(): Promise<Db> {
  const db = await getMongo();
  if (!db) {
    throw new Error('MongoDB not configured or unreachable — set MONGODB_URI');
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await closeMongo();
}
