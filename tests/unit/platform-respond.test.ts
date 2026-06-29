import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/lumisec-api/platform-outbound', () => ({
  isPlatformOutboundConfigured: vi.fn(() => false),
  callPlatformOutbound: vi.fn(),
  platformFetch: vi.fn(),
}));

import { isPlatformActionId, PLATFORM_ACTION_IDS } from '@/lib/incidents/platform-respond';
import { runPlatformIncidentAction } from '@/lib/incidents/platform-respond';

describe('platform-respond', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recognizes platform action ids', () => {
    for (const id of PLATFORM_ACTION_IDS) {
      expect(isPlatformActionId(id)).toBe(true);
    }
    expect(isPlatformActionId('block_ip')).toBe(false);
  });

  it('fails when platform URL not configured', async () => {
    const result = await runPlatformIncidentAction('platform_grc_finding', {
      id: 'inc-1',
      kind: 'case',
      title: 'Test',
      description: '',
      severity: 'high',
      status: 'open',
      source: 'manual',
      tags: [],
      artifacts: [],
      raw: {},
      timeline: [],
      ips: [],
      hostnames: [],
      hashes: [],
      domains: [],
      users: [],
      emails: [],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/LUMISEC_PLATFORM_URL/);
  });
});
