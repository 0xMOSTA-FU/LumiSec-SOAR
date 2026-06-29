// Condition executor - evaluates boolean logic against context
// Supports: ==, !=, >, <, >=, <=, contains, starts_with, ends_with, in, not_in, is_empty, is_set

import { NodeExecutorResult, WFNode, ExecutionContext, readPath } from '../types';

function compare(a: unknown, operator: string, b: unknown): boolean {
  switch (operator) {
    case '==':
    case 'eq':
      return String(a) === String(b);
    case '!=':
    case 'ne':
      return String(a) !== String(b);
    case '>':
    case 'gt': {
      const na = parseFloat(String(a)), nb = parseFloat(String(b));
      return !isNaN(na) && !isNaN(nb) && na > nb;
    }
    case '<':
    case 'lt': {
      const na = parseFloat(String(a)), nb = parseFloat(String(b));
      return !isNaN(na) && !isNaN(nb) && na < nb;
    }
    case '>=':
    case 'gte': {
      const na = parseFloat(String(a)), nb = parseFloat(String(b));
      return !isNaN(na) && !isNaN(nb) && na >= nb;
    }
    case '<=':
    case 'lte': {
      const na = parseFloat(String(a)), nb = parseFloat(String(b));
      return !isNaN(na) && !isNaN(nb) && na <= nb;
    }
    case 'contains':
      return String(a).toLowerCase().includes(String(b).toLowerCase());
    case 'not_contains':
      return !String(a).toLowerCase().includes(String(b).toLowerCase());
    case 'starts_with':
      return String(a).toLowerCase().startsWith(String(b).toLowerCase());
    case 'ends_with':
      return String(a).toLowerCase().endsWith(String(b).toLowerCase());
    case 'in': {
      const arr = Array.isArray(b) ? b : String(b).split(',').map(s => s.trim());
      return arr.some(x => String(x) === String(a));
    }
    case 'not_in': {
      const arr = Array.isArray(b) ? b : String(b).split(',').map(s => s.trim());
      return !arr.some(x => String(x) === String(a));
    }
    case 'is_empty':
      return a == null || a === '' || (Array.isArray(a) && a.length === 0) || (typeof a === 'object' && Object.keys(a as object).length === 0);
    case 'is_set':
      return a != null && a !== '';
    default:
      return false;
  }
}

export async function executeCondition(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const fieldPath = (cfg.field as string) || '';
  const operator = (cfg.operator as string) || '==';
  const value = cfg.value;

  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  // Read field value from context
  const actualValue: unknown = readPath(ctx, fieldPath);

  // Resolve template if value contains {{ }}
  let expectedValue: unknown = value;
  if (typeof value === 'string' && value.includes('{{')) {
    expectedValue = readPath(ctx, value.replace(/[{}]/g, '').trim());
  }

  const result = compare(actualValue, operator, expectedValue);
  const branch = result ? 'Yes' : 'No';

  logs.push({
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: `Condition: ${fieldPath} ${operator} ${typeof expectedValue === 'string' ? `"${expectedValue}"` : expectedValue} → ${branch} (actual=${JSON.stringify(actualValue)})`,
    level: 'success',
    duration: Date.now() - start,
    data: { field: fieldPath, operator, expected: expectedValue, actual: actualValue, result },
  });

  return {
    success: true,
    branch,
    output: { condition: { field: fieldPath, operator, expected: expectedValue, actual: actualValue, result, branch } },
    logs,
  };
}
