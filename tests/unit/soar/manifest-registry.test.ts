import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrapNodes } from '@/lib/soar/nodes/bootstrap';
import { nodeRegistry } from '@/lib/soar/nodes/registry';
import { OSS_PRIORITY_CATALOG } from '@/lib/soar/connectors/catalog';

describe('connector registry', () => {
  beforeAll(() => {
    nodeRegistry.clear();
    bootstrapNodes();
  });

  it('registers Microsoft Sentinel with full manifest', () => {
    const executor = nodeRegistry.get('sentinel');
    expect(executor).not.toBeNull();
    expect(executor?.manifest.docsUrl).toContain('securityinsights');
  });

  it('registers all Wave 2 connectors', () => {
    for (const id of ['crowdstrike', 'greynoise', 'shodan', 'teams']) {
      expect(nodeRegistry.get(id), id).not.toBeNull();
    }
  });

  it('registers all Wave 3 connectors', () => {
    for (const id of ['entra_id', 'aws_securityhub', 'gcp_scc']) {
      expect(nodeRegistry.get(id), id).not.toBeNull();
    }
  });

  it('registers OSS extended connectors', () => {
    for (const id of ['pfsense', 'cuckoo', 'clamav', 'arkime']) {
      const ex = nodeRegistry.get(id);
      expect(ex, id).not.toBeNull();
      expect(ex?.manifest.credentials.length).toBeGreaterThan(0);
    }
  });

  it('Wave 1 nodes use certified manifests (not legacy-bridge stubs)', () => {
    for (const id of ['elastic', 'wazuh', 'misp', 'http', 'webhook']) {
      const ex = nodeRegistry.get(id);
      expect(ex, id).not.toBeNull();
      expect(ex?.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(ex?.manifest.errors.length).toBeGreaterThan(0);
    }
  });

  it('resolves common aliases', () => {
    expect(nodeRegistry.get('falcon')?.manifest.id).toBe('crowdstrike');
    expect(nodeRegistry.get('msteams')?.manifest.id).toBe('teams');
    expect(nodeRegistry.get('entra')?.manifest.id).toBe('entra_id');
    expect(nodeRegistry.get('securityhub')?.manifest.id).toBe('aws_securityhub');
    expect(nodeRegistry.get('elasticsearch')?.manifest.id).toBe('elastic');
    expect(nodeRegistry.get('moloch')?.manifest.id).toBe('arkime');
  });

  it('registers communication connectors', () => {
    expect(nodeRegistry.get('telegram')).not.toBeNull();
    expect(nodeRegistry.get('tg')?.manifest.id).toBe('telegram');
  });

  it('OSS catalog entries are registered when shipped', () => {
    const shippedOss = OSS_PRIORITY_CATALOG.filter(c => c.tier === 'oss' || c.tier === 'free_tier');
    const missing = shippedOss.filter(c => !nodeRegistry.has(c.id)).map(c => c.id);
    expect(missing, `missing OSS connectors: ${missing.join(', ')}`).toEqual([]);
  });

  it('bootstraps at least 44 production nodes', () => {
    expect(nodeRegistry.size()).toBeGreaterThanOrEqual(44);
  });
});
