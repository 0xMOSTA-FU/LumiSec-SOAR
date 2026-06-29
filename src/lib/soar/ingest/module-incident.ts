/**
 * Ingest incidents pushed from LumiSec monolith modules (GRC, UCTC, Phishing, LumiNet).
 */
import { ingestAlertRecord } from '@/lib/soar/alerts/upsert-alert';
import { createIncident } from '@/lib/soar-api/incidents-service';
import { syncArtifactsForIncident } from '@/lib/incidents/sync-artifacts';
import { db } from '@/lib/db';

export interface ModuleIncidentInput {
  module: string;
  title: string;
  description?: string;
  severity?: string;
  sourceId?: string;
  sourceModule?: string;
  artifacts?: Array<{ type: string; value: string }>;
  escalate?: boolean;
  createCase?: boolean;
  assigned_to?: string | null;
  raw?: Record<string, unknown>;
}

export interface ModuleIncidentResult {
  alert_id: string;
  incident_id?: string;
  created: boolean;
  deduplicated: boolean;
}

export async function ingestModuleIncident(
  input: ModuleIncidentInput,
  tenantWhere: Record<string, unknown>,
): Promise<ModuleIncidentResult> {
  const tenantId = (tenantWhere.tenantId as string | null | undefined) ?? null;
  const module = String(input.module || input.sourceModule || 'platform').toLowerCase();
  const sourceId = input.sourceId ? String(input.sourceId) : undefined;

  const payload: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    severity: input.severity || 'medium',
    source: module,
    sourceModule: module,
    sourceId,
    module,
    ...(input.raw || {}),
  };

  if (Array.isArray(input.artifacts)) {
    payload.iocs = input.artifacts;
    payload.artifacts = input.artifacts;
  }

  const ingested = await ingestAlertRecord({
    payload,
    tenantId,
    source: module,
    skipTriggerOnDedup: false,
  });

  let incidentId: string | undefined;

  const shouldEscalate = input.escalate === true || input.createCase === true;
  if (shouldEscalate) {
    const existingCase = ingested.alert.caseId;
    if (existingCase) {
      incidentId = existingCase;
    } else {
      const row = await createIncident(tenantWhere, {
        title: input.title,
        description: input.description,
        severity: input.severity || 'medium',
        source: module,
        source_alert_id: ingested.alert.id,
        assigned_to: input.assigned_to ?? null,
      });
      incidentId = String(row.id);
    }
  }

  if (Array.isArray(input.artifacts) && incidentId) {
    for (const art of input.artifacts) {
      if (!art?.value) continue;
      await db.soarArtifact.create({
        data: {
          tenantId,
          incidentId,
          type: String(art.type || 'unknown'),
          value: String(art.value),
          enriched: false,
        },
      }).catch(() => undefined);
    }
    await syncArtifactsForIncident(incidentId, tenantWhere).catch(() => undefined);
  }

  return {
    alert_id: ingested.alert.id,
    incident_id: incidentId,
    created: ingested.created,
    deduplicated: ingested.deduplicated,
  };
}
