import { z } from 'zod';
import { db } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import type { AuthContext } from '@/lib/auth';
import { PERMISSIONS, type Permission } from '@/lib/auth';
import { buildRecommendedActions, resolveConnectedIntegrations } from '@/lib/incidents/recommended-actions';
import { loadFullIncidentContext } from '@/lib/incidents/load-context';
import { runIncidentAction } from '@/lib/incidents/run-action';
import { mirrorIncidentActionToExternal } from '@/lib/incidents/sync-external';
import {
  DESTRUCTIVE_ACTIONS,
  requireDestructiveApproval,
} from '@/lib/soar/governance/approval-gate';
import { checkBlastRadius } from '@/lib/soar/governance/blast-radius';
import type { RecommendedAction, ResponseActionId } from '@/lib/incidents/types';

export const RespondSchema = z.object({
  actionId: z.enum([
    'block_ip',
    'isolate_host',
    'enrich_ip',
    'scan_hash',
    'disable_user',
    'notify_soc_slack',
    'notify_email',
    'notify_telegram',
    'run_enrichment_playbook',
    'mark_investigating',
    'mark_contained',
    'platform_grc_finding',
    'platform_grc_risk',
    'platform_uctc_rule',
    'platform_phishing_campaign',
    'platform_luminet_context',
  ]),
  params: z.record(z.string(), z.unknown()).optional(),
  approvalId: z.string().optional(),
});

export const ACTION_PERMISSIONS: Record<ResponseActionId, Permission> = {
  block_ip: PERMISSIONS.CONTAIN_BLOCK_IP,
  isolate_host: PERMISSIONS.CONTAIN_ISOLATE_HOST,
  enrich_ip: PERMISSIONS.WORKFLOW_EXECUTE,
  scan_hash: PERMISSIONS.WORKFLOW_EXECUTE,
  disable_user: PERMISSIONS.CONTAIN_DISABLE_USER,
  notify_soc_slack: PERMISSIONS.INTEGRATION_WRITE,
  notify_email: PERMISSIONS.INTEGRATION_WRITE,
  notify_telegram: PERMISSIONS.INTEGRATION_WRITE,
  run_enrichment_playbook: PERMISSIONS.WORKFLOW_EXECUTE,
  mark_investigating: PERMISSIONS.CASE_WRITE,
  mark_contained: PERMISSIONS.CASE_WRITE,
  platform_grc_finding: PERMISSIONS.INTEGRATION_WRITE,
  platform_grc_risk: PERMISSIONS.INTEGRATION_WRITE,
  platform_uctc_rule: PERMISSIONS.INTEGRATION_WRITE,
  platform_phishing_campaign: PERMISSIONS.INTEGRATION_WRITE,
  platform_luminet_context: PERMISSIONS.INTEGRATION_READ,
};

function resolveActionTarget(
  actionId: ResponseActionId,
  incident: Awaited<ReturnType<typeof loadFullIncidentContext>>,
  params?: Record<string, unknown>,
): string {
  if (!incident) return 'unknown';
  if (actionId === 'block_ip') {
    return String(params?.ip ?? incident.ips[0] ?? incident.id);
  }
  if (actionId === 'isolate_host') {
    return String(params?.hostname ?? params?.host ?? incident.hostnames[0] ?? incident.id);
  }
  if (actionId === 'disable_user') {
    return String(params?.user ?? params?.upn ?? incident.users[0] ?? incident.emails[0] ?? incident.id);
  }
  return incident.id;
}

export type GovernedRespondBody = z.infer<typeof RespondSchema>;

export type GovernedRespondOutcome =
  | { kind: 'not_found' }
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

export async function executeGovernedIncidentRespond(
  incidentId: string,
  body: GovernedRespondBody,
  ctx: AuthContext,
  tenantWhere: Record<string, unknown>,
): Promise<GovernedRespondOutcome> {
  const incident = await loadFullIncidentContext(incidentId, tenantWhere);
  if (!incident) return { kind: 'not_found' };

  const integrations = await db.integration.findMany({
    where: tenantWhere,
    select: { type: true, status: true },
  });
  const connected = resolveConnectedIntegrations(integrations);
  const recommendations = buildRecommendedActions(incident, connected);
  let action: RecommendedAction | undefined = recommendations.find(a => a.id === body.actionId);

  if (!action && body.actionId === 'scan_hash' && body.params?.hash) {
    if (!connected.virustotal) {
      return {
        kind: 'error',
        status: 422,
        error: 'INTEGRATION_REQUIRED',
        message: 'Connect VirusTotal on Integrations',
      };
    }
    action = {
      id: 'scan_hash',
      label: 'Scan file hash',
      description: 'Manual hash scan',
      category: 'investigate',
      destructive: false,
      score: 100,
      requiresIntegrations: ['virustotal'],
      available: true,
      params: { hash: body.params.hash },
    };
  }

  if (!action) {
    return {
      kind: 'error',
      status: 400,
      error: 'ACTION_NOT_APPLICABLE',
      message: 'This action is not recommended for this incident',
    };
  }
  if (!action.available) {
    return {
      kind: 'error',
      status: 422,
      error: 'INTEGRATION_REQUIRED',
      message: action.unavailableReason || 'Required integration not connected',
    };
  }

  const targetValue = resolveActionTarget(body.actionId, incident, body.params);
  const approvalId = body.approvalId || (body.params?.approvalId as string | undefined);

  if (DESTRUCTIVE_ACTIONS.has(body.actionId)) {
    const approval = await requireDestructiveApproval({
      ctx,
      action: body.actionId,
      targetType: incident.kind,
      targetValue,
      approvalId,
      reason: `Incident respond: ${body.actionId}`,
      metadata: { incidentId: incident.id },
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

    const blast = await checkBlastRadius(`incident.respond.${body.actionId}`, ctx.tenantId);
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

  const result = await runIncidentAction(body.actionId, incident, {
    userId: ctx.userId,
    params: { ...action.params, ...body.params },
  });

  await writeAudit(ctx, {
    action: `incident.respond.${body.actionId}`,
    resource: incident.kind,
    resourceId: incident.id,
    description: result.message,
    metadata: { ok: result.ok, actionId: body.actionId },
  });

  if (result.ok || result.logs.length > 0) {
    await mirrorIncidentActionToExternal(incident, body.actionId, result, {
      userId: ctx.userId,
      email: ctx.email,
    });
  }

  return { kind: 'success', result };
}
