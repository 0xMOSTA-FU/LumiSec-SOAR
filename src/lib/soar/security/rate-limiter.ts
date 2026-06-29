/**
 * Rate Limiter — token bucket per integration
 * ---------------------------------------------------------------------------
 * Uses MongoDB sliding-window counters when MONGODB_URI is set (cluster-wide).
 * Falls back to in-process memory when Mongo is unavailable (dev / single node).
 */
import { getMongo, isMongoEnabled } from '@/lib/mongo';
import { Logger } from '../observability/logger';

const log = new Logger({ component: 'rate-limiter' });

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterMs?: number;
}

interface MemoryWindow {
  windowStart: number;
  windowEnd: number;
  count: number;
}

const memoryWindows = new Map<string, MemoryWindow>();

function memoryAcquire(
  key: string,
  requestsPerWindow: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const prevWindowStart = windowStart - windowMs;

  const currentKey = `${key}:${windowStart}`;
  const prevKey = `${key}:${prevWindowStart}`;

  const current = memoryWindows.get(currentKey) || { windowStart, windowEnd, count: 0 };
  current.count += 1;
  memoryWindows.set(currentKey, current);

  const prev = memoryWindows.get(prevKey);
  const prevCount = prev?.count || 0;
  const elapsedInWindow = now - windowStart;
  const prevWindowWeight = Math.max(0, 1 - elapsedInWindow / windowMs);
  const effectiveCount = prevCount * prevWindowWeight + current.count;

  if (effectiveCount > requestsPerWindow) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(windowEnd),
      retryAfterMs: Math.ceil(windowEnd - now),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, requestsPerWindow - Math.ceil(effectiveCount)),
    resetAt: new Date(windowEnd),
  };
}

function memoryCheck(
  key: string,
  requestsPerWindow: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const prevWindowStart = windowStart - windowMs;

  const current = memoryWindows.get(`${key}:${windowStart}`);
  const prev = memoryWindows.get(`${key}:${prevWindowStart}`);
  const currentCount = current?.count || 0;
  const prevCount = prev?.count || 0;

  const elapsedInWindow = now - windowStart;
  const prevWindowWeight = Math.max(0, 1 - elapsedInWindow / windowMs);
  const effectiveCount = prevCount * prevWindowWeight + currentCount;

  if (effectiveCount >= requestsPerWindow) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(windowEnd),
      retryAfterMs: Math.ceil(windowEnd - now),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, requestsPerWindow - Math.ceil(effectiveCount)),
    resetAt: new Date(windowEnd),
  };
}

export async function acquireToken(
  key: string,
  requestsPerWindow: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (!isMongoEnabled()) {
    return memoryAcquire(key, requestsPerWindow, windowMs);
  }

  const db = await getMongo();
  if (!db) {
    return memoryAcquire(key, requestsPerWindow, windowMs);
  }

  const coll = db.collection('rate_limits');
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const prevWindowStart = windowStart - windowMs;

  const result = await coll.findOneAndUpdate(
    { key, windowStart },
    { $inc: { count: 1 }, $setOnInsert: { windowStart, windowEnd } },
    { upsert: true, returnDocument: 'after' },
  );
  const currentCount = (result?.value as { count?: number } | null)?.count || 1;
  const prev = await coll.findOne({ key, windowStart: prevWindowStart });
  const prevCount = (prev as { count?: number } | null)?.count || 0;

  const elapsedInWindow = now - windowStart;
  const prevWindowWeight = Math.max(0, 1 - elapsedInWindow / windowMs);
  const effectiveCount = prevCount * prevWindowWeight + currentCount;

  if (effectiveCount > requestsPerWindow) {
    const retryAfterMs = Math.ceil(windowEnd - now);
    log.warn(`Rate limited: ${key} (count=${effectiveCount.toFixed(2)}, limit=${requestsPerWindow})`);
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(windowEnd),
      retryAfterMs,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, requestsPerWindow - Math.ceil(effectiveCount)),
    resetAt: new Date(windowEnd),
  };
}

export async function checkRateLimit(
  key: string,
  requestsPerWindow: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (!isMongoEnabled()) {
    return memoryCheck(key, requestsPerWindow, windowMs);
  }

  const db = await getMongo();
  if (!db) {
    return memoryCheck(key, requestsPerWindow, windowMs);
  }

  const coll = db.collection('rate_limits');
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const prevWindowStart = windowStart - windowMs;

  const [current, prev] = await Promise.all([
    coll.findOne({ key, windowStart }),
    coll.findOne({ key, windowStart: prevWindowStart }),
  ]);
  const currentCount = (current as { count?: number } | null)?.count || 0;
  const prevCount = (prev as { count?: number } | null)?.count || 0;

  const elapsedInWindow = now - windowStart;
  const prevWindowWeight = Math.max(0, 1 - elapsedInWindow / windowMs);
  const effectiveCount = prevCount * prevWindowWeight + currentCount;

  if (effectiveCount >= requestsPerWindow) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(windowEnd),
      retryAfterMs: Math.ceil(windowEnd - now),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, requestsPerWindow - Math.ceil(effectiveCount)),
    resetAt: new Date(windowEnd),
  };
}

/** Test helper — reset in-memory buckets. */
export function resetMemoryRateLimits(): void {
  memoryWindows.clear();
}
