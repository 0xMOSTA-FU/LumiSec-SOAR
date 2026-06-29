// Shuffle-style parameter resolver ($exec.field, $action_name.field, $action_name#)

export function readNested(obj, path) {
  if (!path || obj == null) return undefined;
  return path.split('.').reduce((cur, p) => {
    if (cur == null || typeof cur !== 'object') return undefined;
    return cur[p];
  }, obj);
}

function formatValue(val) {
  if (val == null) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function resolveShuffleRefs(template, { exec = {}, actions = {} } = {}) {
  if (!template || !template.includes('$')) return template;

  return template.replace(/\$([a-zA-Z0-9_-]+)([#.]?)([a-zA-Z0-9_.-]*)/g, (match, name, sep, rest) => {
    if (name === 'exec') {
      if (sep === '#') return formatValue(exec);
      if (sep === '.') return formatValue(readNested(exec, rest));
      return match;
    }
    const actionOut = actions[name];
    if (!actionOut) return match;
    if (sep === '#') return formatValue(actionOut);
    if (sep === '.') return formatValue(readNested(actionOut, rest));
    return match;
  });
}

export function resolveParameterValue(value, exec, actions) {
  if (typeof value !== 'string') return value;
  let out = value.replace(/\{\{trigger\.([^}]+)\}\}/g, (_, f) => formatValue(readNested(exec, f)));
  out = resolveShuffleRefs(out, { exec, actions });
  return out;
}

export function resolveActionParameters(parameters, exec, actions) {
  const resolved = {};
  for (const p of parameters || []) {
    resolved[p.name] = resolveParameterValue(p.value, exec, actions);
  }
  return resolved;
}
