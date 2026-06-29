// MongoDB connection singleton (Mongoose).
// Reads MONGODB_URI from env. Falls back to in-memory mode if not set
// (so the backend can be smoke-tested without a real Mongo instance).

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'soar_backend';

let isConnected = false;
let connectionPromise = null;

export function isMongoConfigured() {
  return !!MONGODB_URI;
}

export function isMongoConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

export async function connectMongo() {
  if (!MONGODB_URI) {
    console.warn('[mongo] MONGODB_URI not set — running in memory-only mode');
    return null;
  }
  if (isConnected && mongoose.connection.readyState === 1) return mongoose;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      mongoose.set('strictQuery', true);
      await mongoose.connect(MONGODB_URI, {
        dbName: MONGODB_DB,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      isConnected = true;
      console.log(`[mongo] Connected to ${MONGODB_DB}`);
      return mongoose;
    } catch (err) {
      console.error('[mongo] Connection failed:', err instanceof Error ? err.message : err);
      connectionPromise = null;
      throw err;
    }
  })();

  return connectionPromise;
}

export async function disconnectMongo() {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
    connectionPromise = null;
    console.log('[mongo] Disconnected');
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await disconnectMongo();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await disconnectMongo();
  process.exit(0);
});
