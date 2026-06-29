/**
 * Shared alert ingestion side-effects — DB-linked automation pipeline.
 */
import { logger } from '@/lib/logger';
import { publishSoarEvent } from '@/lib/soar/events/event-bus';
import { triggerWorkflowsForAlert } from '@/lib/soar/execution/alert-trigger';
import {
  enrichAlertIocsFromRaw,
  syncArtifactsForIncident,
} from '@/lib/incidents/sync-artifacts';
import { archiveRawAlert, isMongoEnabled } from '@/lib/mongo';

export interface AlertRecord {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  source: string;
  status: string;
  caseId: string | null;
  raw: string;
  iocs: string;
  tenantId: string | null;
}

function parseJsonField<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value || JSON.stringify(fallback)) as T;
  } catch {
    return fallback;
  }
}

export async function afterAlertIngested(
  alert: AlertRecord,
  tenantWhere: Record<string, unknown> = {},
) {
  await enrichAlertIocsFromRaw(alert.id, tenantWhere).catch(err =>
    logger.warn({ err, alertId: alert.id }, 'alert IOC enrichment failed'),
  );

  if (alert.caseId) {
    await syncArtifactsForIncident(alert.caseId, tenantWhere).catch(err =>
      logger.warn({ err, caseId: alert.caseId }, 'artifact sync on alert ingest failed'),
    );
  }

  const raw = parseJsonField<Record<string, unknown>>(alert.raw, {});
  const iocs = parseJsonField<unknown[]>(alert.iocs, []);

  if (isMongoEnabled()) {
    archiveRawAlert({
      alertId: alert.id,
      source: alert.source,
      ts: new Date(),
      payload: raw,
    }).catch(err => logger.warn({ err, alertId: alert.id }, 'mongo raw alert archive failed'));
  }

  const payload = {
    alertId: alert.id,
    title: alert.title,
    description: alert.description || undefined,
    severity: alert.severity,
    source: alert.source,
    status: alert.status,
    raw,
    iocs,
    tenantId: alert.tenantId,
  };

  await publishSoarEvent({
    type: 'alert.created',
    tenantId: alert.tenantId,
    payload,
    ts: new Date().toISOString(),
  }).catch(err => logger.warn({ err, alertId: alert.id }, 'alert event publish failed'));

  // Always run inline workflow matching — Redis worker is additive, not a hard dependency.
  return triggerWorkflowsForAlert(payload).catch(err => {
    logger.warn({ err, alertId: alert.id }, 'inline alert workflow trigger failed');
    return { matched: 0, started: [] as string[] };
  });
}
