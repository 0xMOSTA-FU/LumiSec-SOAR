import { db } from '@/lib/db';
import { parseJson } from '@/lib/soar-api/envelope';
import { caseToIncident } from '@/lib/soar-api/mappers';

type TimelineEntry = {
  time?: string;
  event?: string;
  actor?: string;
  message?: string;
  actorType?: string;
};

export async function bulkIncidentAction(
  tenantWhere: Record<string, unknown>,
  body: {
    ids: string[];
    action: 'close' | 'assign' | 'status';
    status?: string;
    assigned_to?: string | null;
  },
  actorId: string | null,
) {
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) {
    return { ok: false, processed: 0, results: [], errors: ['ids required'] };
  }

  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  for (const id of ids) {
    const row = await db.case.findFirst({ where: { id, ...tenantWhere } });
    if (!row) {
      errors.push(`${id}: not found`);
      continue;
    }

    const timeline = parseJson<TimelineEntry[]>(row.timeline, []);
    let update: Record<string, unknown> = {};

    if (body.action === 'close') {
      update = { status: 'closed', closedAt: new Date() };
      timeline.push({
        time: new Date().toISOString(),
        actor: actorId || 'System',
        actorType: 'analyst',
        message: 'Bulk close',
        event: 'status',
      });
    } else if (body.action === 'assign') {
      update = { assigneeId: body.assigned_to || null };
      timeline.push({
        time: new Date().toISOString(),
        actor: actorId || 'System',
        actorType: 'analyst',
        message: `Assigned to ${body.assigned_to || 'unassigned'}`,
        event: 'assign',
      });
    } else if (body.action === 'status' && body.status) {
      update = { status: body.status };
      timeline.push({
        time: new Date().toISOString(),
        actor: actorId || 'System',
        actorType: 'analyst',
        message: `Status → ${body.status}`,
        event: 'status',
      });
    } else {
      errors.push(`${id}: invalid action`);
      continue;
    }

    const updated = await db.case.update({
      where: { id },
      data: { ...update, timeline: JSON.stringify(timeline) },
      include: { assignee: { select: { email: true } } },
    });
    results.push({ id, action: body.action, incident: caseToIncident(updated) });
  }

  return { ok: errors.length === 0, processed: results.length, results, errors };
}
