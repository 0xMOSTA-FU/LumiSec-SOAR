// SOAR internal utilities executor - delay, set_var, transform, parse_json, build_payload
// These are pure-local executors that don't require any external integration.

import { NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate, readPath } from '../types';

export async function executeSoarUtils(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'set_var';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  if (action === 'delay' || action === 'sleep') {
    const ms = Math.min(Number(cfg.ms) || 1000, 30000); // cap 30s
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `SOAR utils: sleeping ${ms}ms...`, level: 'info' });
    await new Promise(r => setTimeout(r, ms));
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `SOAR utils: delay completed`, level: 'success', duration: ms });
    return { success: true, output: { delay_ms: ms }, logs };
  }

  if (action === 'set_var') {
    const name = (cfg.name as string) || (cfg.var as string) || '';
    const raw_value = (cfg.value as string) ?? '';
    if (!name) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'SOAR utils: var name required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const value = raw_value.includes('{{') ? resolveTemplate(raw_value, ctx) : raw_value;
    // Write into trigger context as var
    (ctx.trigger as Record<string, unknown>)[`var_${name}`] = value;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `SOAR utils: var "${name}" set`, level: 'success', duration: Date.now() - start, data: { name, value: typeof value === 'string' ? value.slice(0, 200) : value } });
    return { success: true, output: { var: { name, value } }, logs };
  }

  if (action === 'parse_json') {
    const input = (cfg.input as string) || '';
    const resolved = input.includes('{{') ? resolveTemplate(input, ctx) : input;
    try {
      const parsed = JSON.parse(resolved);
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `SOAR utils: parsed JSON (keys=${Object.keys(parsed).length})`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { parsed }, logs };
    } catch (err: unknown) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `SOAR utils: parse JSON failed: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
  }

  if (action === 'transform' || action === 'jq') {
    // Lightweight transform: support simple field selection like "output.virustotal.malicious"
    const path = (cfg.path as string) || '';
    const value = readPath(ctx, path);
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `SOAR utils: transform "${path}" → ${typeof value}`, level: 'success', duration: Date.now() - start, data: { value: typeof value === 'object' ? undefined : value } });
    return { success: true, output: { transformed: value }, logs };
  }

  if (action === 'build_payload') {
    // Build a custom payload from template fields
    const fields = (cfg.fields as Record<string, string>) || {};
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      payload[k] = v.includes('{{') ? resolveTemplate(v, ctx) : v;
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `SOAR utils: built payload (${Object.keys(payload).length} fields)`, level: 'success', duration: Date.now() - start });
    return { success: true, output: { payload }, logs };
  }

  if (action === 'condition_eval') {
    // Evaluate a simple expression (== != > < >= <=)
    const left_raw = (cfg.left as string) || '';
    const op = (cfg.op as string) || '==';
    const right_raw = (cfg.right as string) || '';
    const left = left_raw.includes('{{') ? resolveTemplate(left_raw, ctx) : readPath(ctx, left_raw) ?? left_raw;
    const right = right_raw.includes('{{') ? resolveTemplate(right_raw, ctx) : right_raw;
    let result = false;
    const lnum = Number(left);
    const rnum = Number(right);
    if (!isNaN(lnum) && !isNaN(rnum)) {
      switch (op) {
        case '==': result = lnum === rnum; break;
        case '!=': result = lnum !== rnum; break;
        case '>': result = lnum > rnum; break;
        case '<': result = lnum < rnum; break;
        case '>=': result = lnum >= rnum; break;
        case '<=': result = lnum <= rnum; break;
      }
    } else {
      switch (op) {
        case '==': result = String(left) === String(right); break;
        case '!=': result = String(left) !== String(right); break;
        case 'contains': result = String(left).includes(String(right)); break;
        case 'starts_with': result = String(left).startsWith(String(right)); break;
        case 'ends_with': result = String(left).endsWith(String(right)); break;
      }
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `SOAR utils: "${left}" ${op} "${right}" → ${result}`, level: 'success', duration: Date.now() - start, data: { left, op, right, result } });
    return { success: true, output: { condition: { result } }, branch: result ? 'yes' : 'no', logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `SOAR utils: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
