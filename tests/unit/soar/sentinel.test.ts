import { describe, it, expect } from 'vitest';
import {
  buildSentinelBaseUrl,
  parseSentinelCreds,
  SENTINEL_API_VERSION,
} from '@/lib/executors/nodes/sentinel';

describe('sentinel connector', () => {
  const config = {
    tenant_id: 'tenant-1',
    client_id: 'client-1',
    client_secret: 'secret',
    subscription_id: 'sub-1',
    resource_group: 'rg-soc',
    workspace_name: 'sentinel-ws',
    workspace_id: 'ws-id-1',
  };

  it('parses integration credentials', () => {
    const creds = parseSentinelCreds({
      id: 'i1',
      name: 'Sentinel',
      type: 'sentinel',
      category: 'siem',
      config,
      status: 'connected',
    });
    expect(creds?.workspaceName).toBe('sentinel-ws');
    expect(creds?.subscriptionId).toBe('sub-1');
  });

  it('returns null when required fields missing', () => {
    expect(parseSentinelCreds({
      id: 'i1',
      name: 'Sentinel',
      type: 'sentinel',
      category: 'siem',
      config: { tenant_id: 'x' },
      status: 'connected',
    })).toBeNull();
  });

  it('builds ARM incidents base URL', () => {
    const creds = parseSentinelCreds({
      id: 'i1',
      name: 'Sentinel',
      type: 'sentinel',
      category: 'siem',
      config,
      status: 'connected',
    })!;
    const url = buildSentinelBaseUrl(creds);
    expect(url).toContain('/subscriptions/sub-1/');
    expect(url).toContain('/Microsoft.SecurityInsights');
    expect(SENTINEL_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
