import { describe, it, expect } from 'vitest';
import { lumiSecToShuffleWorkflow, shuffleToLumiSecWorkflow } from '@/lib/shuffle/adapter';
import type { WFNode, WFEdge } from '@/lib/executors/types';

describe('shuffle workflow adapter', () => {
  const nodes: WFNode[] = [
    {
      id: 't1',
      type: 'trigger',
      subtype: 'webhook',
      position: { x: 0, y: 0 },
      data: { label: 'Webhook', config: { subtype: 'webhook' } },
    },
    {
      id: 'a1',
      type: 'action',
      subtype: 'virustotal',
      position: { x: 200, y: 0 },
      data: {
        label: 'VT',
        config: { subtype: 'virustotal', ioc_type: 'ip', ioc_value: '{{trigger.ip}}' },
      },
    },
  ];
  const edges: WFEdge[] = [{ id: 'e1', source: 't1', target: 'a1' }];

  it('converts LumiSec → Shuffle', () => {
    const sw = lumiSecToShuffleWorkflow({
      id: 'wf-1',
      name: 'Test',
      nodes,
      edges,
    });
    expect(sw.id_).toBe('wf-1');
    expect(sw.triggers).toHaveLength(1);
    expect(sw.actions).toHaveLength(1);
    expect(sw.branches).toHaveLength(1);
    expect(sw.start).toBe('t1');
    expect(sw.actions[0].parameters.find(p => p.name === 'ioc_value')?.value).toBe('$exec.ip');
  });

  it('round-trips Shuffle → LumiSec', () => {
    const sw = lumiSecToShuffleWorkflow({ id: 'wf-2', name: 'RT', nodes, edges });
    const { nodes: n2, edges: e2 } = shuffleToLumiSecWorkflow(sw);
    expect(n2.length).toBeGreaterThanOrEqual(2);
    expect(e2).toHaveLength(1);
  });
});
