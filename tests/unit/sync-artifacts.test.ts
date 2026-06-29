import { describe, it, expect } from 'vitest';
import { normalizeSoarArtifactType } from '@/lib/incidents/sync-artifacts';
import { buildIncidentContext } from '@/lib/incidents/parse-context';

describe('artifact sync helpers', () => {
  it('normalizes artifact types for SoarArtifact storage', () => {
    expect(normalizeSoarArtifactType('IP')).toBe('ip');
    expect(normalizeSoarArtifactType('hostname')).toBe('hostname');
    expect(normalizeSoarArtifactType('custom')).toBe('unknown');
  });

  it('extracts IOCs from alert raw payload for persistence', () => {
    const context = buildIncidentContext('alert', {
      id: 'alert-test',
      title: 'Port Scan Detected',
      description: 'External IP scanning internal network',
      severity: 'high',
      status: 'new',
      source: 'firewall',
      tags: '[]',
      raw: JSON.stringify({ source_ip: '203.0.113.42', ports_scanned: '1-1024' }),
      artifacts: [],
      timeline: '[]',
      caseId: null,
    });

    expect(context.ips).toContain('203.0.113.42');
    expect(context.artifacts.some(a => a.type === 'ip' && a.value === '203.0.113.42')).toBe(true);
  });

  it('merges structured iocs on alerts into parsed artifacts', () => {
    const context = buildIncidentContext('alert', {
      id: 'alert-ioc',
      title: 'Malware hash',
      description: '',
      severity: 'critical',
      status: 'new',
      source: 'edr',
      tags: '[]',
      raw: '{}',
      artifacts: [{ type: 'hash', value: 'abc123def4567890abc123def4567890' }],
      timeline: '[]',
      caseId: 'case-1',
    });

    expect(context.hashes).toContain('abc123def4567890abc123def4567890');
  });
});
