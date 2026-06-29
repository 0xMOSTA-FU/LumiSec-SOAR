import { describe, expect, it } from 'vitest';
import { resolveTemplate } from '@/lib/soar/nodes/manifest';

describe('manifest resolveTemplate', () => {
  const ctx = {
    trigger: { ip: '8.8.8.8', title: 'test' },
    outputs: { n2: { virustotal: { score: 5 } } },
    getIntegration: () => null,
  };

  it('resolves {{trigger.ip}}', () => {
    expect(resolveTemplate('{{trigger.ip}}', ctx as never)).toBe('8.8.8.8');
  });

  it('resolves {{outputs.n2.virustotal.score}}', () => {
    expect(resolveTemplate('{{outputs.n2.virustotal.score}}', ctx as never)).toBe('5');
  });
});
