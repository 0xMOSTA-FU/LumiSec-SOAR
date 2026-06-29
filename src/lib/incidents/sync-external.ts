/**
 * Bridge between Next.js incident response and the external Node.js backend.
 *
 * MERGE NOTE:
 *   Execution + RBAC stay in Next.js until folders are merged.
 *   This module mirrors outcomes to Mongo (external backend) via soar-events
 *   and optional PUT /api/incidents/:id — so the deployed backend stays in sync.
 */
import {
  forwardSoarEvent,
  isExternalBackendEnabled,
  proxyExternalPost,
  type ExternalIncident,
} from '@/lib/external-api';
import type { IncidentActionResult, IncidentContext } from './types';

export async function mirrorIncidentActionToExternal(
  incident: IncidentContext,
  actionId: string,
  result: IncidentActionResult,
  actor?: { userId?: string | null; email?: string | null },
): Promise<void> {
  if (!isExternalBackendEnabled()) return;

  const payload = {
    soarIncidentId: incident.id,
    soarKind: incident.kind,
    soarCaseId: incident.caseId || (incident.kind === 'case' ? incident.id : null),
    actionId,
    ok: result.ok,
    message: result.message,
    statusUpdated: result.statusUpdated,
    executionId: result.executionId,
    logs: result.logs,
    actor: actor?.email || actor?.userId || 'soar',
    ts: new Date().toISOString(),
  };

  await forwardSoarEvent({
    type: 'incident_action_executed',
    payload,
    ts: payload.ts,
  }).catch(() => undefined);

  // Best-effort: update mirrored incident document if external id == soar id or soarCaseId
  const externalId = incident.kind === 'case' ? incident.id : incident.caseId;
  if (!externalId || !result.statusUpdated) return;

  await proxyExternalPost<ExternalIncident>(`/api/incidents/${encodeURIComponent(externalId)}/mirror`, {
    status: result.statusUpdated,
    timelineEvent: result.message,
    lastAction: actionId,
    soarCaseId: incident.caseId || incident.id,
  }).catch(() => undefined);
}
