/**
 * Persist parsed IOCs from incidents/alerts into SoarArtifact (DB registry).
 */
import { db } from '@/lib/db';
import { buildIncidentContext } from './parse-context';
import { loadFullIncidentContext } from './load-context';
import type { ParsedArtifact } from './types';

const KNOWN_TYPES = new Set(['ip', 'domain', 'hash', 'hostname', 'email', 'url', 'user', 'file']);

export function normalizeSoarArtifactType(type: string): string {
  const normalized = type.toLowerCase();
  return KNOWN_TYPES.has(normalized) ? normalized : 'unknown';
}

function artifactKey(incidentId: string, type: string, value: string): string {
  return `${incidentId}:${type}:${value.toLowerCase()}`;
}

export interface SyncArtifactsResult {
  incidentId: string;
  created: number;
  skipped: number;
  total: number;
}

async function upsertParsedArtifacts(
  incidentId: string,
  tenantId: string | null,
  severity: string,
  sourceTitle: string,
  artifacts: ParsedArtifact[],
  tenantWhere: Record<string, unknown>,
): Promise<SyncArtifactsResult> {
  if (artifacts.length === 0) {
    return { incidentId, created: 0, skipped: 0, total: 0 };
  }

  const existing = await db.soarArtifact.findMany({
    where: { incidentId, ...tenantWhere },
    select: { id: true, type: true, value: true },
  });
  const existingKeys = new Set(
    existing.map(a => artifactKey(incidentId, a.type, a.value)),
  );

  let created = 0;
  let skipped = 0;
  const tlp = severity === 'critical' || severity === 'high' ? 'red' : 'amber';

  for (const art of artifacts) {
    const type = normalizeSoarArtifactType(art.type);
    const value = art.value.trim();
    if (!value) continue;

    const key = artifactKey(incidentId, type, value);
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }

    await db.soarArtifact.create({
      data: {
        tenantId,
        incidentId,
        type,
        value,
        tlp,
        description: art.label
          ? `Extracted (${art.label}) — ${sourceTitle}`
          : `Auto-extracted from incident — ${sourceTitle}`,
      },
    });
    existingKeys.add(key);
    created += 1;
  }

  return { incidentId, created, skipped, total: artifacts.length };
}

export async function syncArtifactsForIncident(
  incidentId: string,
  tenantWhere: Record<string, unknown> = {},
): Promise<SyncArtifactsResult | null> {
  const caseRow = await db.case.findFirst({ where: { id: incidentId, ...tenantWhere } });
  if (!caseRow) return null;

  const context = await loadFullIncidentContext(incidentId, tenantWhere);
  if (!context) return null;

  return upsertParsedArtifacts(
    incidentId,
    caseRow.tenantId,
    context.severity,
    context.title,
    context.artifacts,
    tenantWhere,
  );
}

export async function enrichAlertIocsFromRaw(
  alertId: string,
  tenantWhere: Record<string, unknown> = {},
): Promise<{ iocs: { type: string; value: string }[]; updated: boolean }> {
  const alert = await db.alert.findFirst({ where: { id: alertId, ...tenantWhere } });
  if (!alert) return { iocs: [], updated: false };

  let existing: { type: string; value: string }[] = [];
  try {
    existing = JSON.parse(alert.iocs || '[]') as { type: string; value: string }[];
  } catch {
    existing = [];
  }
  if (existing.length > 0) {
    return { iocs: existing, updated: false };
  }

  const context = buildIncidentContext('alert', {
    id: alert.id,
    title: alert.title,
    description: alert.description ?? '',
    severity: alert.severity,
    status: alert.status,
    source: alert.source,
    raw: alert.raw,
    artifacts: [],
    timeline: '[]',
    caseId: alert.caseId,
  });

  const iocs = context.artifacts.map(a => ({
    type: normalizeSoarArtifactType(a.type),
    value: a.value,
  }));

  if (iocs.length === 0) return { iocs: [], updated: false };

  await db.alert.update({
    where: { id: alertId },
    data: { iocs: JSON.stringify(iocs) },
  });

  return { iocs, updated: true };
}

export async function syncArtifactsForAlert(
  alertId: string,
  tenantWhere: Record<string, unknown> = {},
): Promise<SyncArtifactsResult | null> {
  await enrichAlertIocsFromRaw(alertId, tenantWhere);
  const alert = await db.alert.findFirst({ where: { id: alertId, ...tenantWhere } });
  if (!alert?.caseId) return null;
  return syncArtifactsForIncident(alert.caseId, tenantWhere);
}

export async function syncAllCaseArtifacts(
  tenantWhere: Record<string, unknown> = {},
): Promise<{ synced: number; created: number }> {
  const cases = await db.case.findMany({
    where: tenantWhere,
    select: { id: true },
  });

  let synced = 0;
  let created = 0;
  for (const c of cases) {
    const result = await syncArtifactsForIncident(c.id, tenantWhere);
    if (result) {
      synced += 1;
      created += result.created;
    }
  }
  return { synced, created };
}
