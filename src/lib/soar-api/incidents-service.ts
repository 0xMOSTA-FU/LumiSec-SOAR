import { db } from '@/lib/db';
import { buildIncidentContext } from '@/lib/incidents/parse-context';
import { buildRecommendedActions, resolveConnectedIntegrations } from '@/lib/incidents/recommended-actions';
import { loadFullIncidentContext } from '@/lib/incidents/load-context';
import { syncArtifactsForIncident } from '@/lib/incidents/sync-artifacts';
import {
  executeGovernedIncidentRespond,
  type GovernedRespondBody,
} from '@/lib/incidents/governed-respond';
import type { AuthContext } from '@/lib/auth';
import type { ParsedArtifact } from '@/lib/incidents/types';
import { caseToIncident } from './mappers';
import { parseJson, paginated } from './envelope';

type TimelineEntry = {
  time?: string;
  event?: string;
  actor?: string;
  message?: string;
  actorType?: string;
  type?: string;
  body?: string;
};

export async function listIncidents(
  tenantWhere: Record<string, unknown>,
  page: number,
  limit: number,
  filters: {
    status?: string;
    severity?: string;
    assigned_to?: string;
    date_from?: string;
    date_to?: string;
  },
) {
  const where: Record<string, unknown> = { ...tenantWhere };
  if (filters.status) where.status = filters.status;
  if (filters.severity) where.severity = filters.severity;
  if (filters.assigned_to) where.assigneeId = filters.assigned_to;
  if (filters.date_from || filters.date_to) {
    const createdAt: Record<string, Date> = {};
    if (filters.date_from) createdAt.gte = new Date(filters.date_from);
    if (filters.date_to) createdAt.lte = new Date(filters.date_to);
    where.createdAt = createdAt;
  }

  const [total, rows] = await Promise.all([
    db.case.count({ where }),
    db.case.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { assignee: { select: { email: true } } },
    }),
  ]);

  const items = rows.map(caseToIncident);
  return paginated(items, page, limit, total, 'incidents');
}

export async function getIncidentById(id: string, tenantWhere: Record<string, unknown>) {
  const row = await db.case.findFirst({
    where: { id, ...tenantWhere },
    include: { assignee: { select: { email: true } } },
  });
  if (!row) return null;
  return caseToIncident(row);
}

export async function createIncident(
  tenantWhere: Record<string, unknown>,
  body: {
    title: string;
    description?: string;
    severity: string;
    assigned_to?: string | null;
    source?: string | null;
    source_alert_id?: string;
  },
) {
  const tenantId = (tenantWhere.tenantId as string) || null;
  const row = await db.case.create({
    data: {
      tenantId,
      title: body.title,
      description: body.description,
      severity: body.severity,
      status: 'open',
      assigneeId: body.assigned_to || null,
      tags: JSON.stringify([]),
      timeline: JSON.stringify([{
        time: new Date().toISOString(),
        event: 'Incident created',
        actor: 'System',
        actorType: 'system',
      }]),
    },
    include: { assignee: { select: { email: true } } },
  });

  if (body.source_alert_id) {
    await db.alert.updateMany({
      where: { id: body.source_alert_id, ...tenantWhere },
      data: { caseId: row.id, status: 'escalated' },
    });
  }

  await syncArtifactsForIncident(row.id, tenantWhere).catch(() => {});

  const { createSoarNotification } = await import('@/lib/soar/notifications/create-notification');
  await createSoarNotification({
    tenantId,
    title: `Incident opened: ${row.title}`,
    message: `${row.severity.toUpperCase()} incident created`,
  }).catch(() => {});

  return caseToIncident(row);
}

export async function patchIncident(
  id: string,
  tenantWhere: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  const existing = await db.case.findFirst({ where: { id, ...tenantWhere } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (patch.status) data.status = patch.status;
  if (patch.severity) data.severity = patch.severity;
  if (patch.title) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.assigned_to !== undefined) data.assigneeId = patch.assigned_to;

  if (patch.status && patch.status !== existing.status) {
    const timeline = parseJson<TimelineEntry[]>(existing.timeline, []);
    timeline.push({
      time: new Date().toISOString(),
      event: `Status changed to ${patch.status}`,
      actor: 'Analyst',
      actorType: 'user',
    });
    data.timeline = JSON.stringify(timeline);
  }

  const row = await db.case.update({
    where: { id },
    data,
    include: { assignee: { select: { email: true } } },
  });
  return caseToIncident(row);
}

export async function closeIncident(id: string, tenantWhere: Record<string, unknown>) {
  return patchIncident(id, tenantWhere, { status: 'closed' });
}

export async function deleteIncident(id: string, tenantWhere: Record<string, unknown>) {
  const existing = await db.case.findFirst({ where: { id, ...tenantWhere } });
  if (!existing) return false;
  await db.alert.updateMany({ where: { caseId: id }, data: { caseId: null } });
  await db.case.delete({ where: { id } });
  return true;
}

function normalizeTimeline(entries: TimelineEntry[]) {
  return entries.map((e, i) => ({
    id: `tl-${i}`,
    type: e.type || (e.body ? 'note' : 'event'),
    description: e.message || e.event || e.body || '',
    actor: e.actor || 'System',
    timestamp: e.time || new Date().toISOString(),
  }));
}

function extractNotes(entries: TimelineEntry[]) {
  return entries
    .filter(e => e.type === 'note' || e.body)
    .map((e, i) => ({
      id: `note-${i}`,
      author: e.actor || 'Analyst',
      body: e.body || e.message || e.event || '',
      created_at: e.time || new Date().toISOString(),
    }));
}

export async function getTimeline(id: string, tenantWhere: Record<string, unknown>) {
  const row = await db.case.findFirst({ where: { id, ...tenantWhere } });
  if (!row) return null;
  return normalizeTimeline(parseJson<TimelineEntry[]>(row.timeline, []));
}

export async function getNotes(id: string, tenantWhere: Record<string, unknown>) {
  const row = await db.case.findFirst({ where: { id, ...tenantWhere } });
  if (!row) return null;
  return extractNotes(parseJson<TimelineEntry[]>(row.timeline, []));
}

export async function addNote(
  id: string,
  tenantWhere: Record<string, unknown>,
  body: string,
  author: string,
) {
  const row = await db.case.findFirst({ where: { id, ...tenantWhere } });
  if (!row) return null;
  const timeline = parseJson<TimelineEntry[]>(row.timeline, []);
  timeline.push({
    time: new Date().toISOString(),
    type: 'note',
    body,
    actor: author,
    actorType: 'user',
  });
  await db.case.update({ where: { id }, data: { timeline: JSON.stringify(timeline) } });
  return extractNotes(timeline);
}

export async function getIncidentArtifacts(id: string, tenantWhere: Record<string, unknown>) {
  const row = await db.case.findFirst({ where: { id, ...tenantWhere } });
  if (!row) return null;

  await syncArtifactsForIncident(id, tenantWhere).catch(() => {});

  const dbArts = await db.soarArtifact.findMany({
    where: { incidentId: id, ...tenantWhere },
    orderBy: { createdAt: 'desc' },
  });

  const legacy = parseJson<{ type?: string; value?: string }[]>(row.artifacts, []);
  const merged = [
    ...dbArts.map(a => ({
      id: a.id,
      type: a.type,
      value: a.value,
      tlp: a.tlp,
      enriched: a.enriched,
      created_at: a.createdAt.toISOString(),
    })),
    ...legacy.filter(l => l.value).map((l, i) => ({
      id: `legacy-${i}`,
      type: l.type || 'file',
      value: String(l.value),
      tlp: 'amber',
      enriched: false,
      created_at: row.createdAt.toISOString(),
    })),
  ];
  return merged;
}

export async function addIncidentArtifact(
  id: string,
  tenantWhere: Record<string, unknown>,
  input: { type: string; value: string; description?: string },
) {
  const row = await db.case.findFirst({ where: { id, ...tenantWhere } });
  if (!row) return null;
  const art = await db.soarArtifact.create({
    data: {
      tenantId: row.tenantId,
      incidentId: id,
      type: input.type,
      value: input.value,
      description: input.description,
    },
  });
  return {
    id: art.id,
    type: art.type,
    value: art.value,
    tlp: art.tlp,
    enriched: art.enriched,
    created_at: art.createdAt.toISOString(),
  };
}

export async function getRelatedIncidents(id: string, tenantWhere: Record<string, unknown>) {
  const row = await db.case.findFirst({ where: { id, ...tenantWhere } });
  if (!row) return [];
  const tags = parseJson<string[]>(row.tags, []);
  const relatedIds = tags
    .filter((t) => typeof t === 'string' && t.startsWith('rel:'))
    .map((t) => t.slice(4))
    .filter(Boolean);
  if (!relatedIds.length) {
    const rows = await db.case.findMany({
      where: { id: { not: id }, ...tenantWhere },
      take: 10,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, severity: true, status: true },
    });
    return rows.map(r => ({ id: r.id, title: r.title, severity: r.severity, status: r.status }));
  }
  const rows = await db.case.findMany({
    where: { id: { in: relatedIds }, ...tenantWhere },
    select: { id: true, title: true, severity: true, status: true },
  });
  return rows.map(r => ({ id: r.id, title: r.title, severity: r.severity, status: r.status }));
}

export async function linkRelatedIncident(
  id: string,
  tenantWhere: Record<string, unknown>,
  relatedId: string,
  actor: string,
) {
  const [source, related] = await Promise.all([
    db.case.findFirst({ where: { id, ...tenantWhere } }),
    db.case.findFirst({ where: { id: relatedId, ...tenantWhere } }),
  ]);
  if (!source || !related) return null;

  const tagA = `rel:${relatedId}`;
  const tagB = `rel:${id}`;
  const tagsA = parseJson<string[]>(source.tags, []);
  const tagsB = parseJson<string[]>(related.tags, []);
  if (!tagsA.includes(tagA)) tagsA.push(tagA);
  if (!tagsB.includes(tagB)) tagsB.push(tagB);

  const timelineA = parseJson<TimelineEntry[]>(source.timeline, []);
  timelineA.push({
    time: new Date().toISOString(),
    type: 'related',
    actor,
    actorType: 'analyst',
    message: `Linked to incident: ${related.title}`,
  });

  await db.case.update({
    where: { id },
    data: { tags: JSON.stringify(tagsA), timeline: JSON.stringify(timelineA) },
  });
  await db.case.update({
    where: { id: relatedId },
    data: { tags: JSON.stringify(tagsB) },
  });

  return { id: related.id, title: related.title, severity: related.severity, status: related.status };
}

function toUiArtifacts(artifacts: ParsedArtifact[]) {
  return artifacts.map(a => ({
    type: (['ip', 'hash', 'domain', 'file'].includes(a.type) ? a.type : 'file'),
    value: a.value,
  }));
}

export async function getIncidentSummary(id: string, tenantWhere: Record<string, unknown>) {
  const integrations = await db.integration.findMany({
    where: tenantWhere,
    select: { type: true, status: true, name: true },
  });
  const connected = resolveConnectedIntegrations(integrations);
  const context = await loadFullIncidentContext(id, tenantWhere);
  if (!context) return null;

  const row = await db.case.findFirst({ where: { id, ...tenantWhere } });
  const linkedAlerts = await db.alert.findMany({
    where: { caseId: id, ...tenantWhere },
    select: { id: true, title: true, source: true, severity: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const related = await db.case.findMany({
    where: { id: { not: id }, ...tenantWhere },
    select: { id: true, title: true, createdAt: true },
    take: 5,
    orderBy: { updatedAt: 'desc' },
  });
  const timelineRaw = parseJson<TimelineEntry[]>(row?.timeline, []);
  const recommendations = buildRecommendedActions(context, connected);

  return {
    incident: {
      _id: context.id,
      id: context.id,
      title: context.title,
      description: context.description,
      severity: context.severity,
      status: context.status,
      source: context.source,
      tags: context.tags,
      caseId: context.caseId,
      createdAt: row?.createdAt,
      updatedAt: row?.updatedAt,
    },
    parsedContext: {
      ips: context.ips,
      hostnames: context.hostnames,
      hashes: context.hashes,
      domains: context.domains,
      users: context.users,
      emails: context.emails,
    },
    artifacts: toUiArtifacts(context.artifacts),
    timeline: timelineRaw.map(e => ({
      time: e.time || new Date().toISOString(),
      actor: e.actor || 'System',
      actorType: e.actorType || 'system',
      message: e.message || e.event || e.body || '',
    })),
    linkedAlerts: linkedAlerts.map(a => ({
      _id: a.id,
      title: a.title,
      severity: a.severity,
      source: a.source,
    })),
    relatedIncidents: related.map(r => ({
      _id: r.id,
      title: r.title,
      date: r.createdAt.toISOString(),
    })),
    recommendations,
    connectedIntegrations: connected,
  };
}

export async function getRecommendations(id: string, tenantWhere: Record<string, unknown>) {
  const integrations = await db.integration.findMany({
    where: tenantWhere,
    select: { type: true, status: true, name: true },
  });
  const connected = resolveConnectedIntegrations(integrations);
  const context = await loadFullIncidentContext(id, tenantWhere);
  if (!context) return null;
  return {
    recommendations: buildRecommendedActions(context, connected),
    connectedIntegrations: connected,
  };
}

export async function respondToIncident(
  id: string,
  tenantWhere: Record<string, unknown>,
  body: GovernedRespondBody,
  ctx: AuthContext,
) {
  const outcome = await executeGovernedIncidentRespond(id, body, ctx, tenantWhere);
  if (outcome.kind === 'not_found') return null;
  if (outcome.kind === 'error') {
    return {
      ok: false,
      message: outcome.message,
      error: outcome.error,
      status: outcome.status,
      approvalId: outcome.approvalId,
    };
  }

  const result = outcome.result;
  if (result.statusUpdated) {
    const incident = await loadFullIncidentContext(id, tenantWhere);
    if (incident?.kind === 'case') {
      await patchIncident(id, tenantWhere, { status: result.statusUpdated });
    }
  }

  return result;
}

export async function runPlaybookOnIncident(
  incidentId: string,
  tenantWhere: Record<string, unknown>,
  body: { playbook_id?: string; playbookId?: string },
  userId: string,
  requestId?: string,
) {
  const playbookId = body.playbook_id || body.playbookId;
  if (!playbookId) return { ok: false, message: 'playbook_id required' };

  const pb = await db.playbook.findFirst({ where: { id: playbookId, ...tenantWhere } });
  if (!pb?.workflowId) return { ok: false, message: 'Playbook has no linked workflow' };

  const workflow = await db.workflow.findUnique({ where: { id: pb.workflowId } });
  if (!workflow) return { ok: false, message: 'Linked workflow not found' };

  const fullTrigger = {
    incidentId,
    playbook_id: pb.id,
    playbook_name: pb.name,
    type: 'playbook',
  };

  const execution = await db.workflowExecution.create({
    data: {
      workflowId: workflow.id,
      tenantId: (tenantWhere.tenantId as string) || workflow.tenantId,
      status: 'running',
      trigger: JSON.stringify(fullTrigger),
      triggerType: 'api',
      startedBy: userId,
      requestId: requestId || null,
      result: JSON.stringify({ playbookId: pb.id, incidentId }),
      logs: JSON.stringify([{
        time: new Date().toISOString(),
        message: `Playbook "${pb.name}" on incident ${incidentId}`,
        level: 'info',
      }]),
    },
  });

  const { runWorkflow } = await import('@/lib/executors/engine');
  runWorkflow({
    executionId: execution.id,
    workflowId: workflow.id,
    triggerPayload: fullTrigger,
    tenantId: (tenantWhere.tenantId as string) || workflow.tenantId,
    startedBy: userId,
    requestId,
  }).catch(() => {});

  return {
    ok: true,
    message: 'Playbook run started',
    runId: execution.id,
  };
}
