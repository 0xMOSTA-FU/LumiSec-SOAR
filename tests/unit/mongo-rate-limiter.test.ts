import { describe, it, expect, beforeEach } from 'vitest';
import { acquireToken, resetMemoryRateLimits } from '@/lib/soar/security/rate-limiter';

describe('rate-limiter memory fallback', () => {
  beforeEach(() => {
    resetMemoryRateLimits();
  });

  it('allows requests within the limit when Mongo is not configured', async () => {
    const key = 'integration:vt:test';
    const r1 = await acquireToken(key, 3, 60_000);
    const r2 = await acquireToken(key, 3, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });

  it('blocks when the in-memory limit is exceeded', async () => {
    const key = 'integration:abuseipdb:test';
    for (let i = 0; i < 2; i++) {
      const r = await acquireToken(key, 2, 60_000);
      expect(r.allowed).toBe(true);
    }
    const blocked = await acquireToken(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
