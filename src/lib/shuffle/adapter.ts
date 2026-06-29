/**
 * Bidirectional adapter: LumiSec WorkflowBuilder (nodes/edges) ↔ Shuffle workflow document
 */

import { randomUUID } from 'crypto';
import type { WFEdge, WFNode } from '@/lib/executors/types';
import type {
  ShuffleAction,
  ShuffleBranch,
  ShuffleCondition,
  ShuffleParameter,
  ShuffleTrigger,
  ShuffleWorkflow,
} from './types';
import { lumiSecToShuffleRef } from './parameter-resolver';

const TRIGGER_SUBTYPES = new Set(['webhook', 'schedule', 'alert', 'manual']);

function configToParameters(config: Record<string, unknown>): ShuffleParameter[] {
  return Object.entries(config)
    .filter(([k]) => k !== 'subtype')
    .map(([name, value]) => ({
      name,
      value: typeof value === 'string' ? lumiSecToShuffleRef(value) : JSON.stringify(value),
      configuration: false,
    }));
}

function subtypeToAppName(subtype: string): string {
  const map: Record<string, string> = {
    virustotal: 'virustotal',
    abuseipdb: 'abuseipdb',
    ipinfo: 'ipinfo',
    http: 'http',
    slack: 'slack',
    email: 'email',
    sentinel: 'sentinel',
    splunk: 'splunk',
    crowdstrike: 'crowdstrike',
    greynoise: 'greynoise',
    shodan: 'shodan',
    teams: 'teams',
    entra_id: 'entra_id',
    aws_securityhub: 'aws_securityhub',
    gcp_scc: 'gcp_scc',
    pfsense: 'pfsense',
    cuckoo: 'cuckoo',
    clamav: 'clamav',
    arkime: 'arkime',
    telegram: 'telegram',
    condition: 'Builtin',
    if_condition: 'Builtin',
    switch: 'Builtin',
    severity_check: 'Builtin',
    webhook: 'Webhook',
    schedule: 'Schedule',
    log: 'Shuffle Tools',
    block: 'fortigate',
    create_case: 'Shuffle Tools',
    create_alert: 'Shuffle Tools',
  };
  return map[subtype] ?? subtype;
}

function appNameToSubtype(appName: string, actionName: string): string {
  if (appName === 'Builtin') return 'condition';
  if (appName === 'Webhook') return 'webhook';
  if (appName === 'Schedule') return 'schedule';
  if (appName === 'Shuffle Tools') {
    if (actionName === 'create_case') return 'create_case';
    if (actionName === 'create_alert') return 'create_alert';
    return 'log';
  }
  return appName.toLowerCase().replace(/\s+/g, '_');
}

function parametersToConfig(params: ShuffleParameter[]): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const p of params) {
    let v: unknown = p.value;
    if (typeof v === 'string' && v.startsWith('{')) {
      try { v = JSON.parse(v); } catch { /* keep string */ }
    }
    config[p.name] = v;
  }
  return config;
}

/** LumiSec nodes/edges → Shuffle workflow document */
export function lumiSecToShuffleWorkflow(input: {
  id: string;
  name: string;
  description?: string;
  orgId?: string;
  nodes: WFNode[];
  edges: WFEdge[];
  tags?: string[] | Record<string, unknown>;
}): ShuffleWorkflow {
  const actions: ShuffleAction[] = [];
  const triggers: ShuffleTrigger[] = [];
  const conditions: ShuffleCondition[] = [];
  const branches: ShuffleBranch[] = [];
  let start = '';

  for (const node of input.nodes) {
    const subtype = node.subtype ?? node.data?.config?.subtype as string ?? 'http';
    const config = { ...(node.data?.config ?? {}), subtype } as Record<string, unknown>;
    const params = configToParameters(config);

    if (node.type === 'trigger' || TRIGGER_SUBTYPES.has(subtype)) {
      const trigger: ShuffleTrigger = {
        id_: node.id,
        app_name: subtypeToAppName(subtype),
        name: subtype === 'webhook' ? 'Webhook' : subtype,
        label: node.data.label,
        triggerType: subtype.toUpperCase(),
        parameters: params,
        position: node.position,
      };
      triggers.push(trigger);
      if (!start) start = node.id;
    } else if (node.type === 'condition' || subtype.includes('condition') || subtype === 'switch') {
      const field = String(config.field ?? 'success');
      const op = String(config.operator ?? 'eq');
      const val = String(config.value ?? 'true');
      conditions.push({
        id_: node.id,
        app_name: 'Builtin',
        name: 'Condition',
        label: node.data.label,
        conditional: `$${field} ${op} ${val}`,
        position: node.position,
      });
      if (!start) start = node.id;
    } else {
      actions.push({
        id_: node.id,
        app_name: subtypeToAppName(subtype),
        app_version: '1.0.0',
        name: subtype,
        label: node.data.label,
        environment: 'default',
        parameters: params,
        position: node.position,
      });
    }
  }

  if (!start && triggers.length) start = triggers[0].id_;
  if (!start && actions.length) start = actions[0].id_;
  if (!start && conditions.length) start = conditions[0].id_;

  for (const edge of input.edges) {
    branches.push({
      id_: edge.id || randomUUID(),
      source_id: edge.source,
      destination_id: edge.target,
      label: edge.label,
      conditions: [],
    });
  }

  const tagList = Array.isArray(input.tags)
    ? input.tags
    : typeof input.tags === 'object' && input.tags
      ? Object.keys(input.tags)
      : [];

  return {
    id_: input.id,
    org_id: input.orgId,
    name: input.name,
    description: input.description,
    start,
    is_valid: Boolean(start && (actions.length + triggers.length + conditions.length) > 0),
    actions,
    branches,
    conditions,
    triggers,
    transforms: [],
    workflow_variables: [],
    tags: tagList,
    updated_at: new Date().toISOString(),
  };
}

/** Shuffle workflow → LumiSec nodes/edges for WorkflowBuilder + engine */
export function shuffleToLumiSecWorkflow(sw: ShuffleWorkflow): {
  nodes: WFNode[];
  edges: WFEdge[];
} {
  const nodes: WFNode[] = [];
  const edges: WFEdge[] = [];

  for (const t of sw.triggers ?? []) {
    const subtype = appNameToSubtype(t.app_name, t.name);
    nodes.push({
      id: t.id_,
      type: 'trigger',
      subtype,
      position: t.position ?? { x: 100, y: 200 },
      data: {
        label: t.label ?? t.name,
        config: { subtype, ...parametersToConfig(t.parameters) },
      },
    });
  }

  for (const c of sw.conditions ?? []) {
    nodes.push({
      id: c.id_,
      type: 'condition',
      subtype: 'condition',
      position: c.position ?? { x: 400, y: 200 },
      data: {
        label: c.label ?? 'Condition',
        config: {
          subtype: 'condition',
          expression: c.conditional,
        },
      },
    });
  }

  for (const a of sw.actions ?? []) {
    const subtype = appNameToSubtype(a.app_name, a.name);
    nodes.push({
      id: a.id_,
      type: subtype === 'log' ? 'output' : 'action',
      subtype,
      position: a.position ?? { x: 400, y: 200 },
      data: {
        label: a.label ?? a.name,
        config: { subtype, ...parametersToConfig(a.parameters) },
      },
    });
  }

  for (const b of sw.branches ?? []) {
    edges.push({
      id: b.id_,
      source: b.source_id,
      target: b.destination_id,
      label: b.label,
    });
  }

  return { nodes, edges };
}
