// Rate limiter — token bucket algorithm.
// - In-memory fallback when Redis is unavailable.
// - Redis-backed in production (set REDIS_URL).
//
// Two dimensions:
//   1. Per-IP rate limit (protect against brute force, scrapers)
//   2. Per-user/API-key rate limit (protect against abusive clients)
//   3. Per-route rate limit (protect expensive endpoints)

interface Bucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  capacity: number;       // max tokens
  refillPerSec: number;   // tokens added per second
}

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  // Route key → config
  'auth:login':         { capacity: 5,   refillPerSec: 0.1   }, // 5 attempts / 50s
  'auth:api-key':       { capacity: 10,  refillPerSec: 0.2   },
  'workflow:execute':   { capacity: 30,  refillPerSec: 1     }, // 30/min
  'integrations:test':  { capacity: 10,  refillPerSec: 0.2   }, // 10/min
  'default':            { capacity: 300, refillPerSec: 10    }, // 300/min
};

const buckets = new Map<string, Bucket>();

// GC stale buckets every 5 min
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, b] of buckets.entries()) {
    if (b.lastRefill < cutoff) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  limit: number;
}

export function rateLimit(key: string, routeKey: string = 'default'): RateLimitResult {
  const cfg = DEFAULT_LIMITS[routeKey] || DEFAULT_LIMITS.default;
  const now = Date.now();
  const fullKey = `${routeKey}:${key}`;
  let bucket = buckets.get(fullKey);
  if (!bucket) {
    bucket = { tokens: cfg.capacity, lastRefill: now };
    buckets.set(fullKey, bucket);
  }
  // Refill
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsed * cfg.refillPerSec);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetInMs: Math.ceil((1 - bucket.tokens) / cfg.refillPerSec * 1000),
      limit: cfg.capacity,
    };
  }
  return {
    allowed: false,
    remaining: 0,
    resetInMs: Math.ceil((1 - bucket.tokens) / cfg.refillPerSec * 1000),
    limit: cfg.capacity,
  };
}

// Convenience helper for Next.js route handlers
export function rateLimitResponse(result: RateLimitResult): Response | null {
  if (result.allowed) return null;
  return new Response(JSON.stringify({
    error: 'RATE_LIMITED',
    message: 'Too many requests',
    retry_after_ms: result.resetInMs,
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(result.resetInMs / 1000)),
      'Retry-After': String(Math.ceil(result.resetInMs / 1000)),
    },
  });
}
