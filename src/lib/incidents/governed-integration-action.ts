import { writeAudit } from '@/lib/audit';
import type { AuthContext } from '@/lib/auth';
import { loadFullIncidentContext } from '@/lib/incidents/load-context';
import { runIncidentAction } from '@/lib/incidents/run-action';
import { mirrorIncidentActionToExternal } from '@/lib/incidents/sync-external';
import type { IncidentContext, ResponseActionId } from '@/lib/incidents/types';
import {
  DESTRUCTIVE_ACTIONS,
  requireDestructiveApproval,
} from '@/lib/soar/governance/approval-gate';
import { checkBlastRadius } from '@/lib/soar/governance/blast-radius';

export type GovernedIntegrationOutcome =
  | {
      kind: 'error';
      status: number;
      error: string;
      message: string;
      approvalId?: string;
      count?: number;
      limit?: number;
    }
  | {
      kind: 'success';
      result: Awaited<ReturnType<typeof runIncidentAction>>;
    };

function syntheticIncident(
  actionId: ResponseActionId,
  body: Record<string, unknown>,
): IncidentContext {
  const ip = body.ip ? String(body.ip) : undefined;
  const host = body.host || body.hostname ? String(body.host || body.hostname) : undefined;
  const hash = body.hash ? String(body.hash) : undefined;

  return {
    id: String(body.incidentId || 'integration-action'),
    kind: 'case',
    title: actionId,
    description: '',
    severity: 'high',
    status: 'open',
    source: 'api',
    tags: [],
    artifacts: [],
    ips: ip ? [ip] : [],
    hostnames: host ? [host] : [],
    hashes: hash ? [hash] : [],
    domains: [],
    users: [],
    emails: [],
    raw: body,
    timeline: [],
    caseId: body.incidentId ? String(body.incidentId) : null,
  };
}

function resolveTarget(actionId: ResponseActionId, incident: IncidentContext, body: Record<string, unknown>): string {
  if (actionId === 'block_ip') {
    return String(body.ip ?? incident.ips[0] ?? incident.id);
  }
  if (actionId === 'isolate_host') {
    return String(body.hostname ?? body.host ?? incident.hostnames[0] ?? incident.id);
  }
  if (actionId === 'scan_hash') {
    return String(body.hash ?? incident.hashes[0] ?? incident.id);
  }
  return incident.id;
}

export async function executeGovernedIntegrationAction(
  actionId: ResponseActionId,
  body: Record<string, unknown>,
  ctx: AuthContext,
  tenantWhere: Record<string, unknown>,
): Promise<GovernedIntegrationOutcome> {
  const incidentId = body.incidentId ? String(body.incidentId) : undefined;
  const incident =
    incidentId ? await loadFullIncidentContext(incidentId, tenantWhere) : null;
  const context = incident ?? syntheticIncident(actionId, body);

  const approvalId =
    (body.approvalId as string | undefined) ||
    (body.approval_id as string | undefined);

  if (DESTRUCTIVE_ACTIONS.has(actionId)) {
    const targetValue = resolveTarget(actionId, context, body);
    const approval = await requireDestructiveApproval({
      ctx,
      action: actionId,
      targetType: context.kind,
      targetValue,
      approvalId,
      reason: `Integration action: ${actionId}`,
      metadata: { incidentId: context.id, source: 'integrations' },
    });
    if (!approval.allowed) {
      return {
        kind: 'error',
        status: 428,
        error: 'APPROVAL_REQUIRED',
        message: approval.reason || 'Destructive action requires human approval',
        approvalId: approval.approvalId,
      };
    }

    const blast = await checkBlastRadius(`incident.respond.${actionId}`, ctx.tenantId);
    if (!blast.allowed) {
      return {
        kind: 'error',
        status: 429,
        error: 'BLAST_RADIUS_EXCEEDED',
        message: blast.reason || 'Blast radius limit exceeded',
        count: blast.count,
        limit: blast.limit,
      };
    }
  }

  const result = await runIncidentAction(actionId, context, {
    userId: ctx.userId,
    params: body,
  });

  await writeAudit(ctx, {
    action: `integration.${actionId}`,
    resource: context.kind,
    resourceId: context.id,
    description: result.message,
    metadata: { ok: result.ok, actionId, source: 'integrations' },
  });

  if (result.ok || result.logs.length > 0) {
    await mirrorIncidentActionToExternal(context, actionId, result, {
      userId: ctx.userId,
      email: ctx.email,
    });
  }

  return { kind: 'success', result };
}
