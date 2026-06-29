import { describe, it, expect } from 'vitest';
import { parseAwsCredsFromConfig } from '@/lib/executors/nodes/aws-securityhub';
import { parseGcpServiceAccountJson } from '@/lib/executors/nodes/gcp-scc';
import { parseAzureAppCredsFromConfig } from '@/lib/executors/nodes/azure-auth';

describe('wave3 connector helpers', () => {
  it('parses Azure app credentials', () => {
    const creds = parseAzureAppCredsFromConfig({
      tenant_id: 't1',
      client_id: 'c1',
      client_secret: 's1',
    });
    expect(creds?.tenantId).toBe('t1');
  });

  it('parses AWS credentials', () => {
    const creds = parseAwsCredsFromConfig({
      access_key_id: 'AKIA',
      secret_access_key: 'secret',
      region: 'eu-west-1',
    });
    expect(creds?.region).toBe('eu-west-1');
  });

  it('parses GCP service account JSON string', () => {
    const sa = parseGcpServiceAccountJson(JSON.stringify({
      client_email: 'sa@test.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    }));
    expect(sa?.client_email).toContain('gserviceaccount.com');
  });
});
