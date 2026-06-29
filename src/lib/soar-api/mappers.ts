import type { Case, Alert, Integration, Playbook, WorkflowExecution } from '@prisma/client';

import { integrationHasSecrets } from '@/lib/integrations/catalog';

import { buildExecutionView } from '@/lib/platform/execution-view';

import { parseJson } from './envelope';



export function caseToIncident(c: Case & { assignee?: { email?: string | null } | null }) {

  return {

    id: c.id,

    _id: c.id,

    title: c.title,

    description: c.description,

    severity: c.severity,

    status: c.status,

    assigned_to: c.assignee?.email ?? c.assigneeId,

    assignee: c.assignee?.email ?? c.assigneeId,

    source: 'case',

    tags: parseJson<string[]>(c.tags, []),

    created_at: c.createdAt.toISOString(),

    updated_at: c.updatedAt.toISOString(),

    createdAt: c.createdAt.toISOString(),

    updatedAt: c.updatedAt.toISOString(),

  };

}



export function alertToSoar(a: Alert, extras?: { related_incidents?: unknown[] }) {

  const raw = parseJson<Record<string, unknown>>(a.raw, {});

  const iocs = parseJson<Array<{ type?: string; value?: string }>>(a.iocs, []);



  return {

    id: a.id,

    _id: a.id,

    title: a.title,

    description: a.description,

    severity: a.severity,

    status: a.status,

    source: a.source,

    source_id: a.sourceId,

    confidence: a.confidence,

    incident_id: a.caseId,

    case_id: a.caseId,

    dedup_key: a.dedupKey,

    occurrence_count: a.occurrenceCount,

    first_seen_at: a.firstSeenAt.toISOString(),

    last_seen_at: a.lastSeenAt.toISOString(),

    matched_at: a.lastSeenAt.toISOString(),

    iocs,

    raw,

    raw_event: raw,

    rule_name:

      (raw.rule_name as string) ||

      (raw.ruleName as string) ||

      (raw.rule as string) ||

      a.title,

    related_incidents: extras?.related_incidents ?? (a.caseId ? [{ id: a.caseId }] : []),

    created_at: a.createdAt.toISOString(),

    updated_at: a.updatedAt.toISOString(),

    createdAt: a.createdAt.toISOString(),

    updatedAt: a.updatedAt.toISOString(),

  };

}



export function integrationToConnector(i: Integration) {

  const status =

    i.status === 'connected' ? 'active' :

    i.status === 'error' ? 'error' : 'inactive';

  const testResult = typeof i.lastTestResult === 'string'

    ? parseJson<{ message?: string }>(i.lastTestResult, {})

    : (i.lastTestResult as { message?: string } | null);

  return {

    id: i.id,

    _id: i.id,

    name: i.name,

    type: i.type,

    status,

    description: i.description,

    last_tested_at: i.lastTestedAt?.toISOString() ?? null,

    last_error: i.status === 'error' ? String(testResult?.message || '') : null,

    has_config: integrationHasSecrets(i.config),

    created_at: i.createdAt.toISOString(),

    updated_at: i.updatedAt.toISOString(),

  };

}



export function playbookToSoar(p: Playbook) {

  const steps = parseJson<unknown[]>(p.steps, []);

  const triggers = parseJson<unknown[]>(p.triggers, []);

  const primaryTrigger = triggers[0];

  const triggerType =

    typeof primaryTrigger === 'object' && primaryTrigger && 'type' in primaryTrigger

      ? String((primaryTrigger as { type?: string }).type || 'manual')

      : 'manual';



  return {

    id: p.id,

    _id: p.id,

    name: p.name,

    description: p.description,

    category: p.category,

    status: p.status,

    version: p.version,

    tags: parseJson<string[]>(p.tags, []),

    workflow_id: p.workflowId,

    workflowId: p.workflowId,

    steps,

    triggers,

    trigger_type: triggerType,

    step_count: steps.length,

    created_at: p.createdAt.toISOString(),

    updated_at: p.updatedAt.toISOString(),

  };

}



export function executionToPlaybookRun(

  e: WorkflowExecution,

  playbookName?: string,

) {

  const result = parseJson<Record<string, unknown>>(e.result, {});

  const logs = parseJson<{ time?: string; message?: string; level?: string; nodeLabel?: string; nodeId?: string; data?: unknown }[]>(e.logs, []);

  const trigger = parseJson<Record<string, unknown>>(e.trigger, {});

  const status =

    e.status === 'success' ? 'completed' :

    e.status === 'failed' ? 'failed' :

    e.status === 'running' ? 'in_progress' :

    e.status === 'awaiting_approval' ? 'awaiting_approval' :

    e.status;



  const durationMs = e.durationMs ?? (

    e.endedAt && e.startedAt

      ? e.endedAt.getTime() - e.startedAt.getTime()

      : null

  );



  const view = buildExecutionView(result, trigger);

  const outputs = result.outputs && typeof result.outputs === 'object'

    ? (result.outputs as Record<string, unknown>)

    : {};



  const nodeSteps = view.nodeSummaries.map((node, index) => ({

    id: `${e.id}-node-${node.nodeId}`,

    name: node.label || node.subtype || node.nodeId,

    status: node.skipped ? 'skipped' : node.ok ? 'completed' : 'failed',

    output: node.preview || null,

    logs: node.output ? JSON.stringify(node.output, null, 2) : null,

    order: index,

  }));



  const steps = nodeSteps.length > 0

    ? nodeSteps

    : logs.map((log, index) => ({

      id: `${e.id}-step-${index}`,

      name: log.nodeLabel || log.message || `Step ${index + 1}`,

      status: log.level === 'error' ? 'failed' : log.level === 'warning' ? 'skipped' : 'completed',

      output: log.message || null,

      logs: log.data ? JSON.stringify(log.data) : log.message || null,

      order: index,

    }));



  return {

    id: e.id,

    _id: e.id,

    playbook_id: (trigger.playbook_id as string) || (result.playbookId as string) || null,

    playbook_name: playbookName || (trigger.playbook_name as string) || (result.playbookName as string) || null,

    workflow_id: e.workflowId,

    incident_id: (result.incidentId as string) || (trigger.incident_id as string) || null,

    status,

    started_at: e.startedAt.toISOString(),

    completed_at: e.endedAt?.toISOString() ?? null,

    ended_at: e.endedAt?.toISOString() ?? null,

    triggered_by: (trigger.startedBy as string) || e.startedBy || (trigger._meta as { triggeredByEmail?: string } | undefined)?.triggeredByEmail || 'System',

    duration: durationMs != null ? `${Math.round(durationMs / 1000)}s` : null,

    duration_ms: durationMs,

    display_ip: view.displayIp,

    partial_success: view.partialSuccess,

    enrichment: view.enrichment,

    outputs,

    steps,

  };

}


