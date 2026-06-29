import { describe, it, expect } from 'vitest';
import type { WFNode } from '@/lib/executors/types';
import {
  findAlertTriggerNode,
  matchesAlertTriggerConfig,
} from '@/lib/soar/events/alert-matcher';

function alertTriggerNode(severity = 'low', source = ''): WFNode {
  return {
    id: 't1',
    type: 'trigger',
    subtype: 'alert',
    position: { x: 0, y: 0 },
    data: { label: 'Alert', config: { severity, source } },
  };
}

describe('alert-matcher', () => {
  it('finds alert trigger node', () => {
    const nodes = [alertTriggerNode(), { id: 'a1', type: 'action' as const, subtype: 'http', position: { x: 0, y: 0 }, data: { label: 'x', config: {} } }];
    expect(findAlertTriggerNode(nodes)?.id).toBe('t1');
  });

  it('matches severity threshold', () => {
    const node = alertTriggerNode('high');
    expect(matchesAlertTriggerConfig(node, { severity: 'critical', source: 'siem' })).toBe(true);
    expect(matchesAlertTriggerConfig(node, { severity: 'medium', source: 'siem' })).toBe(false);
  });

  it('filters by source when configured', () => {
    const node = alertTriggerNode('low', 'sentinel');
    expect(matchesAlertTriggerConfig(node, { severity: 'high', source: 'microsoft-sentinel' })).toBe(true);
    expect(matchesAlertTriggerConfig(node, { severity: 'high', source: 'crowdstrike' })).toBe(false);
  });

  it('allows any source when filter empty', () => {
    const node = alertTriggerNode('low', '');
    expect(matchesAlertTriggerConfig(node, { severity: 'low', source: 'anything' })).toBe(true);
  });
});
