import { describe, expect, it } from 'vitest';
import {
  normalizeInboundAlert,
  pickHigherSeverity,
} from '@/lib/soar/alerts/normalize-alert';
import { DESTRUCTIVE_ACTIONS } from '@/lib/soar/governance/approval-gate';

describe('normalize-alert', () => {
  it('normalizes splunk-style payload', () => {
    const n = normalizeInboundAlert({
      title: 'Brute force detected',
      source: 'splunk',
      severity: 'high',
      src_ip: '10.0.0.5',
      rule_id: 'T1110',
      external_id: 'evt-99',
    });
    expect(n.title).toBe('Brute force detected');
    expect(n.severity).toBe('high');
    expect(n.dedupKey).toContain('splunk');
    expect(n.iocs.some(i => i.value === '10.0.0.5')).toBe(true);
  });

  it('picks higher severity on dedup merge', () => {
    expect(pickHigherSeverity('medium', 'critical')).toBe('critical');
  });
});

describe('approval-gate constants', () => {
  it('marks containment actions destructive', () => {
    expect(DESTRUCTIVE_ACTIONS.has('block_ip')).toBe(true);
    expect(DESTRUCTIVE_ACTIONS.has('isolate_host')).toBe(true);
    expect(DESTRUCTIVE_ACTIONS.has('enrich_ip')).toBe(false);
  });
});
