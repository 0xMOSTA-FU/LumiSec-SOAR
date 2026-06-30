import { db } from '@/lib/db';
import { afterAlertIngested } from '@/lib/soar/alerts/ingest-alert';
import { createIncident } from '@/lib/soar-api/incidents-service';
import { alertToSoar } from '@/lib/soar-api/mappers';

export async function escalateAlert(
  alertId: string,
  tenantWhere: Record<string, unknown>,
  body: { title?: string; severity?: string; assigned_to?: string | null } = {},
) {
  const alert = await db.alert.findFirst({ where: { id: alertId, ...tenantWhere } });
  if (!alert) return null;

  if (alert.caseId) {
    const existing = await db.case.findFirst({ where: { id: alert.caseId, ...tenantWhere } });
    if (existing) {
      return {
        alert: alertToSoar(alert),
        incident: { id: existing.id, title: existing.title, status: existing.status },
        deduplicated: true,
      };
    }
  }

  const incident = await createIncident(tenantWhere, {
    title: body.title || alert.title,
    description: alert.description || undefined,
    severity: body.severity || alert.severity,
    assigned_to: body.assigned_to ?? alert.assigneeId,
    source: alert.source,
    source_alert_id: alert.id,
  });

  const updated = await db.alert.findUnique({ where: { id: alertId } });
  return {
    alert: alertToSoar(updated!),
    incident,
    deduplicated: false,
  };
}

export async function bulkAlertAction(
  tenantWhere: Record<string, unknown>,
  body: {
    ids: string[];
    action: 'escalate' | 'dismiss' | 'assign';
    assigned_to?: string | null;
    severity?: string;
  },
) {
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) {
    return { ok: false, processed: 0, results: [], errors: ['ids required'] };
  }

  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  for (const id of ids) {
    try {
      if (body.action === 'escalate') {
        const r = await escalateAlert(id, tenantWhere, {
          severity: body.severity,
          assigned_to: body.assigned_to,
        });
        if (!r) errors.push(`${id}: not found`);
        else results.push({ id, action: 'escalate', incidentId: r.incident.id, deduplicated: r.deduplicated });
      } else if (body.action === 'dismiss') {
        const row = await db.alert.updateMany({
          where: { id, ...tenantWhere },
          data: { status: 'dismissed' },
        });
        if (!row.count) errors.push(`${id}: not found`);
        else results.push({ id, action: 'dismiss' });
      } else if (body.action === 'assign') {
        const row = await db.alert.updateMany({
          where: { id, ...tenantWhere },
          data: { assigneeId: body.assigned_to || null },
        });
        if (!row.count) errors.push(`${id}: not found`);
        else results.push({ id, action: 'assign' });
      }
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ok: errors.length === 0, processed: results.length, results, errors };
}

export async function createAlertManual(
  tenantWhere: Record<string, unknown>,
  body: Record<string, unknown>,
  tenantId: string | null,
) {
  const row = await db.alert.create({
    data: {
      tenantId,
      title: String(body.title || 'Manual alert'),
      description: body.description ? String(body.description) : null,
      source: String(body.source || 'manual'),
      severity: String(body.severity || 'medium'),
      status: String(body.status || 'new'),
      assigneeId: body.assigned_to ? String(body.assigned_to) : null,
      caseId: body.case_id ? String(body.case_id) : null,
      raw: JSON.stringify(body.raw || {}),
      iocs: JSON.stringify(body.iocs || []),
    },
  });
  await afterAlertIngested(row, tenantWhere);
  return alertToSoar(row);
}
