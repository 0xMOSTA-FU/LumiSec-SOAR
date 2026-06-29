import { describe, it, expect } from 'vitest';
import { resolveShuffleRefs, resolveUnifiedTemplate } from '@/lib/shuffle/parameter-resolver';
import type { ExecutionContext } from '@/lib/executors/types';

describe('shuffle parameter resolver', () => {
  it('resolves $exec.field', () => {
    const out = resolveShuffleRefs('IP=$exec.ip', { exec: { ip: '8.8.8.8' } });
    expect(out).toBe('IP=8.8.8.8');
  });

  it('resolves $action_name.field', () => {
    const out = resolveShuffleRefs('score=$virustotal.score', {
      exec: {},
      actions: { virustotal: { score: 42 } },
    });
    expect(out).toBe('score=42');
  });

  it('resolves $action_name# as full JSON', () => {
    const out = resolveShuffleRefs('data=$vt#', {
      exec: {},
      actions: { vt: { ok: true } },
    });
    expect(out).toBe('data={"ok":true}');
  });

  it('unifies {{trigger.ip}} and $exec.ip', () => {
    const ctx: ExecutionContext = {
      trigger: { ip: '1.2.3.4' },
      outputs: {},
      result: {},
      getIntegration: () => null,
    };
    expect(resolveUnifiedTemplate('{{trigger.ip}}', ctx)).toBe('1.2.3.4');
    expect(resolveUnifiedTemplate('$exec.ip', ctx, { exec: ctx.trigger })).toBe('1.2.3.4');
  });
});
