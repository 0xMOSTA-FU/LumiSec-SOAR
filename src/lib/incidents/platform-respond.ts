/**
 * Real outbound actions to LumiSec platform modules (GRC / UCTC / Phishing / LumiNet).
 */
import {
  callPlatformOutbound,
  platformFetch,
  isPlatformOutboundConfigured,
} from '@/lib/lumisec-api/platform-outbound';
import type { IncidentContext, IncidentActionResult, ResponseActionId } from './types';

export const PLATFORM_ACTION_IDS = [
  'platform_grc_finding',
  'platform_grc_risk',
  'platform_uctc_rule',
  'platform_phishing_campaign',
  'platform_luminet_context',
] as const;

export type PlatformActionId = (typeof PLATFORM_ACTION_IDS)[number];

export function isPlatformActionId(id: string): id is PlatformActionId {
  return (PLATFORM_ACTION_IDS as readonly string[]).includes(id);
}

function basePayload(incident: IncidentContext, params: Record<string, unknown>) {
  return {
    incidentId: incident.id,
    title: String(params.title || incident.title),
    description: String(params.description || incident.description),
    severity: String(params.severity || incident.severity),
    asset: String(params.asset || incident.ips[0] || incident.hostnames[0] || ''),
    sourceModule: 'soar',
    ...params,
  };
}

export async function runPlatformIncidentAction(
  actionId: PlatformActionId,
  incident: IncidentContext,
  params: Record<string, unknown> = {},
): Promise<IncidentActionResult> {
  if (!isPlatformOutboundConfigured()) {
    return {
      ok: false,
      message: 'LUMISEC_PLATFORM_URL not configured — set it to the full LumiSec monolith.',
      actionId: actionId as ResponseActionId,
      logs: [],
    };
  }

  const body = basePayload(incident, params);
  const ts = new Date().toISOString();

  if (actionId === 'platform_grc_finding') {
    const result = await callPlatformOutbound('grc', 'finding', body);
    return {
      ok: result.ok,
      message: result.message,
      actionId: actionId as ResponseActionId,
      logs: [{ time: ts, message: result.message, level: result.ok ? 'success' : 'error' }],
    };
  }

  if (actionId === 'platform_grc_risk') {
    const result = await callPlatformOutbound('grc', 'risk', body);
    return {
      ok: result.ok,
      message: result.message,
      actionId: actionId as ResponseActionId,
      logs: [{ time: ts, message: result.message, level: result.ok ? 'success' : 'error' }],
    };
  }

  if (actionId === 'platform_uctc_rule') {
    const result = await callPlatformOutbound('uctc', 'rule', {
      ...body,
      ruleId: params.ruleId || params.rule_id,
      yaml: params.yaml || params.sigma_yaml,
      name: params.name || `SOAR rule — ${incident.title}`,
    });
    return {
      ok: result.ok,
      message: result.message,
      actionId: actionId as ResponseActionId,
      logs: [{ time: ts, message: result.message, level: result.ok ? 'success' : 'error' }],
    };
  }

  if (actionId === 'platform_phishing_campaign') {
    const result = await callPlatformOutbound('phishing', 'campaign', {
      ...body,
      name: params.name || `Awareness — ${incident.title}`,
      templateId: params.templateId || params.template_id,
      landingPageId: params.landingPageId || params.landing_page_id,
      autoLaunch: params.autoLaunch === true || params.auto_launch === true,
    });
    return {
      ok: result.ok,
      message: result.message,
      actionId: actionId as ResponseActionId,
      logs: [{ time: ts, message: result.message, level: result.ok ? 'success' : 'error' }],
    };
  }

  if (actionId === 'platform_luminet_context') {
    const asset = String(params.asset || incident.ips[0] || incident.hostnames[0] || '');
    if (!asset) {
      return {
        ok: false,
        message: 'No IP or hostname to lookup in LumiNet',
        actionId: actionId as ResponseActionId,
        logs: [],
      };
    }
    const result = await platformFetch(`/api/luminet/assets/context/${encodeURIComponent(asset)}`, {
      audit: { module: 'luminet', action: 'context', incidentId: incident.id },
    });
    return {
      ok: result.ok,
      message: result.ok ? `LumiNet context for ${asset}` : result.message,
      actionId: actionId as ResponseActionId,
      logs: [{ time: ts, message: result.message, level: result.ok ? 'success' : 'error' }],
    };
  }

  return {
    ok: false,
    message: `Unknown platform action: ${actionId}`,
    actionId: actionId as ResponseActionId,
    logs: [],
  };
}
