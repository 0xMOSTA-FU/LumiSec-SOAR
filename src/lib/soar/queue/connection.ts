/**
 * Shared Redis connection for BullMQ queues and pub/sub event bus.
 */
import Redis from 'ioredis';
import { isRedisEnabled } from '../config';

let sharedClient: Redis | null = null;

export function getRedisUrl(): string {
  return process.env.REDIS_URL || 'redis://127.0.0.1:6379';
}

export function getRedisConnection(): Redis {
  if (!isRedisEnabled()) {
    throw new Error('REDIS_URL is not configured');
  }
  if (!sharedClient) {
    sharedClient = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return sharedClient;
}

/** Dedicated subscriber connection (Redis pub/sub requirement). */
export function createRedisSubscriber(): Redis {
  if (!isRedisEnabled()) {
    throw new Error('REDIS_URL is not configured');
  }
  return new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export async function closeRedisConnection(): Promise<void> {
  if (sharedClient) {
    await sharedClient.quit().catch(() => {});
    sharedClient = null;
  }
}
