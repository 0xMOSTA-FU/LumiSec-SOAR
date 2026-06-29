/**
 * Unified parameter templating — LumiSec {{trigger.x}} + Shuffle $exec.x / $action.field
 */

import type { ExecutionContext } from '@/lib/executors/types';
import { readPath } from '@/lib/executors/types';

/** Map action label/name → output object for $action_name.field resolution */
export type ActionOutputMap = Record<string, Record<string, unknown>>;

export interface ShuffleResolveContext {
  exec?: Record<string, unknown>;
  actions?: ActionOutputMap;
}

function readNested(obj: unknown, path: string): unknown {
  if (!path || obj == null) return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function formatValue(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Resolve Shuffle-style references in a string.
 * - $exec.field → trigger/execution argument
 * - $action_name.field → prior action output
 * - $action_name# → full JSON of action output
 */
export function resolveShuffleRefs(
  template: string,
  shuffleCtx: ShuffleResolveContext,
): string {
  if (!template || !template.includes('$')) return template;

  const exec = shuffleCtx.exec ?? {};

  return template.replace(/\$([a-zA-Z0-9_-]+)([#.]?)([a-zA-Z0-9_.-]*)/g, (match, name, sep, rest) => {
    if (name === 'exec') {
      if (sep === '#') return formatValue(exec);
      return formatValue(readNested(exec, rest));
    }
    const actions = shuffleCtx.actions ?? {};
    const actionOut = actions[name];
    if (!actionOut) return match;
    if (sep === '#') return formatValue(actionOut);
    if (sep === '.') return formatValue(readNested(actionOut, rest));
    return match;
  });
}

/**
 * Resolve LumiSec {{path}} and Shuffle $refs in one pass.
 */
export function resolveUnifiedTemplate(
  template: string,
  ctx: ExecutionContext,
  shuffleCtx?: ShuffleResolveContext,
): string {
  if (!template) return '';

  let out = template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = key.trim();
    // {{trigger.ip}} aliases to exec for Shuffle parity
    const path = trimmed.startsWith('trigger.') ? trimmed : trimmed;
    const val = readPath(ctx, path);
    return formatValue(val);
  });

  if (shuffleCtx) {
    const exec = shuffleCtx.exec ?? ctx.trigger;
    const actions: ActionOutputMap = shuffleCtx.actions ?? {};
    // Build action map from ctx.outputs keyed by node label / subtype
    if (Object.keys(actions).length === 0 && ctx.outputs) {
      for (const [nodeId, output] of Object.entries(ctx.outputs)) {
        if (output && typeof output === 'object') {
          const o = output as Record<string, unknown>;
          const keys = Object.keys(o);
          for (const k of keys) {
            if (k !== 'nodeId' && typeof o[k] === 'object') {
              actions[k] = o[k] as Record<string, unknown>;
            }
          }
          actions[nodeId] = o;
        }
      }
    }
    out = resolveShuffleRefs(out, { exec, actions });
  }

  return out;
}

/** Convert Shuffle $exec.url → LumiSec {{trigger.url}} for UI display */
export function shuffleRefToLumiSec(template: string): string {
  return template.replace(/\$exec\.([a-zA-Z0-9_.-]+)/g, '{{trigger.$1}}');
}

/** Convert LumiSec {{trigger.url}} → Shuffle $exec.url */
export function lumiSecToShuffleRef(template: string): string {
  return template.replace(/\{\{trigger\.([^}]+)\}\}/g, '$exec.$1');
}
