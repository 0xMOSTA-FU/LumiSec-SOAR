import { describe, expect, it } from 'vitest';
import {
  integrationConfigReady,
  resolveRuntimeIntegrationStatus,
} from '@/lib/integrations/integration-runtime';

describe('integration-runtime', () => {
  it('treats ipinfo as ready without credentials', () => {
    expect(integrationConfigReady('ipinfo', {})).toBe(true);
    expect(resolveRuntimeIntegrationStatus('disconnected', 'ipinfo', {})).toBe('connected');
  });

  it('requires api_key for virustotal', () => {
    expect(integrationConfigReady('virustotal', {})).toBe(false);
    expect(integrationConfigReady('virustotal', { api_key: 'abc' })).toBe(true);
    expect(resolveRuntimeIntegrationStatus('disconnected', 'virustotal', { api_key: 'x' })).toBe(
      'connected',
    );
  });

  it('keeps db connected status', () => {
    expect(resolveRuntimeIntegrationStatus('connected', 'virustotal', {})).toBe('connected');
  });

  it('stays disconnected when credentials missing', () => {
    expect(resolveRuntimeIntegrationStatus('disconnected', 'abuseipdb', {})).toBe('disconnected');
  });
});
