import type { IncidentContext, RecommendedAction, ResponseActionId } from './types';
import { normalizeTags } from './parse-context';
import { isLumisecBackendEnabled } from '@/lib/lumisec-api/client';
import { isPlatformOutboundConfigured } from '@/lib/lumisec-api/platform-outbound';

export interface ConnectedIntegrations {
  firewall: boolean;
  firewallTypes: string[];
  edr: boolean;
  edrTypes: string[];
  virustotal: boolean;
  abuseipdb: boolean;
  slack: boolean;
  entra: boolean;
  email: boolean;
  telegram: boolean;
  elastic: boolean;
  platform: boolean;
}

const FIREWALL_TYPES = ['fortigate', 'opnsense', 'pfsense', 'paloalto', 'firewall'];
const EDR_TYPES = ['crowdstrike', 'falcon', 'defender', 'edr', 'wazuh'];
const IDENTITY_TYPES = ['entra_id', 'entra', 'entraid', 'azure_ad', 'msgraph'];

function normType(t: string): string {
  return t.toLowerCase().replace(/[\s\-_]/g, '');
}

export function resolveConnectedIntegrations(
  integrations: { type: string; status: string }[],
): ConnectedIntegrations {
  const connected = integrations.filter(i => i.status === 'connected');
  const types = connected.map(i => normType(i.type));
  const match = (keys: string[]) => types.some(t => keys.some(k => t.includes(k) || k.includes(t)));

  const firewallTypes = connected
    .filter(i => FIREWALL_TYPES.some(f => normType(i.type).includes(f)))
    .map(i => i.type);
  const edrTypes = connected
    .filter(i => EDR_TYPES.some(e => normType(i.type).includes(e)))
    .map(i => i.type);

  return {
    firewall: firewallTypes.length > 0,
    firewallTypes,
    edr: edrTypes.length > 0,
    edrTypes,
    virustotal: match(['virustotal', 'vt']),
    abuseipdb: match(['abuseipdb', 'abuse']),
    slack: match(['slack']),
    entra: match(IDENTITY_TYPES),
    email: match(['email', 'smtp', 'mail']),
    telegram: match(['telegram', 'tg']),
    elastic: match(['elastic', 'elasticsearch', 'es']),
    platform: isPlatformOutboundConfigured(),
  };
}

function tagSet(ctx: IncidentContext): Set<string> {
  return new Set(normalizeTags(ctx.tags, ctx.title, ctx.description, ctx.source));
}

function textBlob(ctx: IncidentContext): string {
  return `${ctx.title} ${ctx.description} ${ctx.source}`.toLowerCase();
}

function scoreBlockIp(ctx: IncidentContext): number {
  const tags = tagSet(ctx);
  let s = 0;
  if (ctx.ips.length) s += 45;
  if (tags.has('brute-force') || tags.has('network') || tags.has('vpn') || tags.has('scan')) s += 35;
  if (/firewall|palo|vpn|forti|opnsense|pfsense|port scan|brute/i.test(ctx.source)) s += 30;
  if (/brute|scan|firewall|block|port|vpn|login attempt/i.test(textBlob(ctx))) s += 20;
  if (ctx.severity === 'critical' || ctx.severity === 'high') s += 10;
  return s;
}

function scoreIsolate(ctx: IncidentContext): number {
  const tags = tagSet(ctx);
  let s = 0;
  if (ctx.hostnames.length) s += 45;
  if (tags.has('malware') || tags.has('endpoint') || tags.has('ransomware')) s += 40;
  if (/crowdstrike|falcon|edr|defender|endpoint|workstation|wks-/i.test(textBlob(ctx))) s += 35;
  if (ctx.hashes.length) s += 15;
  return s;
}

function scoreDisableUser(ctx: IncidentContext): number {
  const tags = tagSet(ctx);
  let s = 0;
  if (ctx.users.length || ctx.emails.length) s += 40;
  if (tags.has('credential-access') || tags.has('privilege-escalation') || tags.has('insider-threat')) s += 35;
  if (/active directory|entra|azure|iam|privilege|escalat|compromised account/i.test(textBlob(ctx))) s += 30;
  return s;
}

function scoreEnrichIp(ctx: IncidentContext): number {
  const tags = tagSet(ctx);
  let s = 0;
  if (ctx.ips.length) s += 35;
  if (tags.has('phishing') || tags.has('exfiltration') || tags.has('data-exfil') || tags.has('network')) s += 25;
  if (/splunk|siem|unknown|external|c2|dest_ip/i.test(textBlob(ctx))) s += 20;
  return s;
}

function scoreScanHash(ctx: IncidentContext): number {
  const tags = tagSet(ctx);
  let s = 0;
  const validHash = ctx.hashes.some(h => h.length >= 32 && !h.includes('...'));
  if (validHash) s += 50;
  if (tags.has('malware') || tags.has('phishing')) s += 25;
  if (/trojan|malware|hash|sample|payload/i.test(textBlob(ctx))) s += 20;
  return s;
}

function scoreNotify(ctx: IncidentContext): number {
  let s = 0;
  if (ctx.severity === 'critical') s += 50;
  else if (ctx.severity === 'high') s += 35;
  else if (ctx.severity === 'medium') s += 15;
  if (scoreBlockIp(ctx) >= 40 || scoreIsolate(ctx) >= 40) s += 20;
  return s;
}

function scoreEnrichmentPlaybook(ctx: IncidentContext): number {
  let s = scoreEnrichIp(ctx);
  if (ctx.hashes.length) s += 15;
  if (ctx.domains.length) s += 10;
  return s;
}

function mkAction(
  id: ResponseActionId,
  label: string,
  description: string,
  category: RecommendedAction['category'],
  destructive: boolean,
  score: number,
  requires: string[],
  available: boolean,
  unavailableReason: string | undefined,
  params: Record<string, unknown>,
): RecommendedAction {
  return {
    id,
    label,
    description,
    category,
    destructive,
    score,
    requiresIntegrations: requires,
    available,
    unavailableReason,
    params,
  };
}

const MIN_SCORE = 35;

export function buildRecommendedActions(
  ctx: IncidentContext,
  connected: ConnectedIntegrations,
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const ip = ctx.ips[0];
  const hostname = ctx.hostnames[0];
  const hash = ctx.hashes.find(h => h.length >= 32 && !h.includes('...'));
  const user = ctx.emails[0] || ctx.users[0];

  const blockScore = scoreBlockIp(ctx);
  if (blockScore >= MIN_SCORE && ip) {
    const avail = isLumisecBackendEnabled() || connected.firewall;
    actions.push(mkAction(
      'block_ip',
      `Block IP ${ip}`,
      isLumisecBackendEnabled()
        ? `Block via LumiSec API (FortiGate/pfSense)`
        : `Add deny rule for ${ip} on ${connected.firewallTypes.join('/') || 'firewall'}`,
      'contain',
      true,
      blockScore,
      isLumisecBackendEnabled() ? ['lumisec-api'] : (connected.firewallTypes.length ? connected.firewallTypes : ['fortigate', 'opnsense', 'pfsense']),
      avail,
      avail ? undefined : isLumisecBackendEnabled() ? undefined : 'Connect FortiGate, OPNsense, or pfSense on Integrations',
      { ip, target: ip },
    ));
  }

  const isolateScore = scoreIsolate(ctx);
  if (isolateScore >= MIN_SCORE && (hostname || ip)) {
    const avail = isLumisecBackendEnabled() || connected.edr;
    actions.push(mkAction(
      'isolate_host',
      hostname ? `Isolate ${hostname}` : `Isolate host ${ip}`,
      isLumisecBackendEnabled()
        ? 'Network contain via LumiSec EDR/SSH API'
        : `Network contain host via ${connected.edrTypes.join('/') || 'CrowdStrike EDR'}`,
      'contain',
      true,
      isolateScore,
      isLumisecBackendEnabled() ? ['lumisec-api'] : (connected.edrTypes.length ? connected.edrTypes : ['crowdstrike']),
      avail,
      avail ? undefined : 'Connect CrowdStrike or set LUMISEC_API_URL',
      { hostname: hostname || ip, host: hostname || ip },
    ));
  }

  const enrichScore = scoreEnrichIp(ctx);
  if (enrichScore >= MIN_SCORE && ip) {
    const avail = connected.virustotal || connected.abuseipdb;
    const providers = [
      connected.virustotal ? 'VirusTotal' : null,
      connected.abuseipdb ? 'AbuseIPDB' : null,
    ].filter(Boolean).join(' + ');
    actions.push(mkAction(
      'enrich_ip',
      `Enrich IP ${ip}`,
      `Threat intel lookup (${providers || 'VirusTotal / AbuseIPDB'})`,
      'investigate',
      false,
      enrichScore,
      connected.virustotal ? ['virustotal'] : connected.abuseipdb ? ['abuseipdb'] : ['virustotal', 'abuseipdb'],
      avail,
      avail ? undefined : 'Connect VirusTotal or AbuseIPDB on Integrations',
      { ip, ioc_type: 'ip', ioc_value: ip },
    ));
  }

  const hashScore = scoreScanHash(ctx);
  if (hashScore >= MIN_SCORE && hash) {
    actions.push(mkAction(
      'scan_hash',
      'Scan file hash',
      `VirusTotal lookup for ${hash.slice(0, 12)}…`,
      'investigate',
      false,
      hashScore,
      ['virustotal'],
      connected.virustotal,
      connected.virustotal ? undefined : 'Connect VirusTotal on Integrations',
      { hash, ioc_type: 'hash', ioc_value: hash },
    ));
  }

  const userScore = scoreDisableUser(ctx);
  if (userScore >= MIN_SCORE && user) {
    actions.push(mkAction(
      'disable_user',
      `Disable account ${user}`,
      'Disable user in Microsoft Entra ID',
      'remediate',
      true,
      userScore,
      ['entra_id', 'msgraph'],
      connected.entra,
      connected.entra ? undefined : 'Connect Microsoft Entra ID / Graph on Integrations',
      { upn: user, user },
    ));
  }

  const playbookScore = scoreEnrichmentPlaybook(ctx);
  if (playbookScore >= MIN_SCORE && (ip || hash)) {
    actions.push(mkAction(
      'run_enrichment_playbook',
      'Run enrichment playbook',
      isLumisecBackendEnabled()
        ? 'POST /api/soar/incidents/:id/playbooks/run'
        : 'Execute IP/hash enrichment workflow (VT, AbuseIPDB, geo)',
      'investigate',
      false,
      playbookScore,
      isLumisecBackendEnabled() ? ['lumisec-api'] : [],
      true,
      undefined,
      { ip, hash },
    ));
  }

  const notifyScore = scoreNotify(ctx);
  if (notifyScore >= 40) {
    actions.push(mkAction(
      'notify_soc_slack',
      'Notify SOC (Slack)',
      `Post incident summary to #soc-alerts`,
      'notify',
      false,
      notifyScore,
      ['slack'],
      connected.slack,
      connected.slack ? undefined : 'Connect Slack webhook on Integrations',
      {
        channel: '#soc-alerts',
        message: `[${ctx.severity.toUpperCase()}] ${ctx.title} (#${ctx.id}) — review in SOAR`,
      },
    ));
    actions.push(mkAction(
      'notify_email',
      'Notify via Email',
      'Send incident summary to SOC mailbox',
      'notify',
      false,
      notifyScore + 5,
      ['email', 'smtp'],
      connected.email,
      connected.email ? undefined : 'Connect Email (SMTP) on Connectors',
      {
        subject: `[SOAR ${ctx.severity.toUpperCase()}] ${ctx.title}`,
        message: `Incident #${ctx.id}\n${ctx.title}\n\n${ctx.description}\n\nSeverity: ${ctx.severity}\nSource: ${ctx.source}`,
      },
    ));
    actions.push(mkAction(
      'notify_telegram',
      'Notify via Telegram',
      'Send alert to analyst phone (chat_id map in connector)',
      'notify',
      false,
      notifyScore + 3,
      ['telegram'],
      connected.telegram,
      connected.telegram ? undefined : 'Connect Telegram bot + phone_contacts JSON',
      {
        message: `[${ctx.severity.toUpperCase()}] ${ctx.title} (#${ctx.id})`,
      },
    ));
  }

  if (!['investigating', 'contained', 'resolved', 'closed'].includes(ctx.status)) {
    actions.push(mkAction(
      'mark_investigating',
      'Mark investigating',
      'Update incident status and timeline',
      'status',
      false,
      30,
      [],
      true,
      undefined,
      { status: 'investigating' },
    ));
  }

  if (['open', 'new', 'investigating', 'triaging'].includes(ctx.status)) {
    actions.push(mkAction(
      'mark_contained',
      'Mark contained',
      'Record containment in case timeline',
      'status',
      false,
      scoreIsolate(ctx) >= MIN_SCORE || scoreBlockIp(ctx) >= MIN_SCORE ? 45 : 25,
      [],
      true,
      undefined,
      { status: 'contained' },
    ));
  }

  if (connected.platform) {
    const platformScore = Math.max(scoreBlockIp(ctx), scoreIsolate(ctx), 50);
    actions.push(mkAction(
      'platform_grc_finding',
      'Submit GRC finding',
      'Push incident to LumiSec GRC findings register',
      'platform',
      false,
      platformScore,
      ['lumisec_platform'],
      true,
      undefined,
      { incidentId: ctx.id, asset: ip || hostname },
    ));
    actions.push(mkAction(
      'platform_grc_risk',
      'Submit GRC risk',
      'Create risk entry linked to this incident',
      'platform',
      false,
      platformScore - 5,
      ['lumisec_platform'],
      true,
      undefined,
      { incidentId: ctx.id },
    ));
    if (platformScore >= MIN_SCORE) {
      actions.push(mkAction(
        'platform_uctc_rule',
        'Deploy detection rule',
        'Create or deploy UCTC Sigma rule from incident context',
        'platform',
        false,
        platformScore,
        ['lumisec_platform'],
        true,
        undefined,
        { incidentId: ctx.id, name: `SOAR — ${ctx.title}` },
      ));
    }
    actions.push(mkAction(
      'platform_phishing_campaign',
      'Link phishing campaign',
      'Create awareness campaign tied to this incident',
      'platform',
      false,
      42,
      ['lumisec_platform'],
      true,
      undefined,
      { incidentId: ctx.id },
    ));
    if (ip || hostname) {
      actions.push(mkAction(
        'platform_luminet_context',
        'LumiNet asset context',
        `Fetch network inventory for ${ip || hostname}`,
        'platform',
        false,
        55,
        ['lumisec_network'],
        true,
        undefined,
        { asset: ip || hostname },
      ));
    }
  }

  return actions.sort((a, b) => b.score - a.score);
}
