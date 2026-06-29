/**
 * Recommended response actions (ported from Next recommended-actions.ts — simplified).
 */
import { proxyToSoarGateway } from '../lib/gateway-proxy.js';

const CONNECTOR_ACTIONS = new Set([
  'block_ip',
  'isolate_host',
  'enrich_ip',
  'scan_hash',
  'notify_soc_slack',
  'notify_email',
  'notify_telegram',
  'disable_user',
]);

export function resolveConnectedIntegrations(connectors) {
  const connected = connectors.filter((c) => c.status === 'connected' || c.status === 'active');
  const types = connected.map((c) => String(c.type).toLowerCase().replace(/[\s\-_]/g, ''));
  const match = (keys) => types.some((t) => keys.some((k) => t.includes(k) || k.includes(t)));

  return {
    firewall: match(['fortigate', 'opnsense', 'pfsense', 'paloalto', 'firewall']),
    edr: match(['crowdstrike', 'falcon', 'defender', 'edr', 'wazuh']),
    virustotal: match(['virustotal', 'vt']),
    abuseipdb: match(['abuseipdb', 'abuse']),
    slack: match(['slack']),
    entra: match(['entra', 'azuread', 'msgraph']),
    email: match(['email', 'smtp', 'mail']),
    telegram: match(['telegram', 'tg']),
    elastic: match(['elastic', 'elasticsearch', 'es']),
  };
}

function parseIocs(incident) {
  const ips = [];
  const hashes = [];
  const hostnames = [];
  for (const art of incident.artifacts || []) {
    const t = String(art.type).toLowerCase();
    const v = String(art.value);
    if (t === 'ip') ips.push(v);
    if (t === 'hash') hashes.push(v);
    if (t === 'hostname') hostnames.push(v);
  }
  const text = `${incident.title} ${incident.description} ${incident.source}`.toLowerCase();
  const ipMatch = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g);
  if (ipMatch) ips.push(...ipMatch);
  return { ips: [...new Set(ips)], hashes: [...new Set(hashes)], hostnames: [...new Set(hostnames)] };
}

export function buildRecommendations(incident, connectors) {
  const connected = resolveConnectedIntegrations(connectors);
  const { ips, hashes, hostnames } = parseIocs(incident);
  const actions = [];

  if (ips.length) {
    actions.push({
      id: 'block_ip',
      label: `Block IP ${ips[0]}`,
      description: `Add deny rule for ${ips[0]} on firewall`,
      category: 'contain',
      destructive: true,
      available: connected.firewall,
      unavailableReason: connected.firewall ? undefined : 'Connect FortiGate, OPNsense, or pfSense',
      requiresIntegrations: ['fortigate', 'opnsense', 'pfsense'],
      params: { ip: ips[0] },
      score: 90,
    });
    actions.push({
      id: 'enrich_ip',
      label: `Enrich IP ${ips[0]}`,
      description: 'Threat intel lookup (VirusTotal / AbuseIPDB)',
      category: 'investigate',
      destructive: false,
      available: connected.virustotal || connected.abuseipdb,
      unavailableReason: connected.virustotal || connected.abuseipdb ? undefined : 'Connect VirusTotal or AbuseIPDB',
      requiresIntegrations: ['virustotal', 'abuseipdb'],
      params: { ip: ips[0] },
      score: 70,
    });
  }

  if (hostnames.length) {
    actions.push({
      id: 'isolate_host',
      label: `Isolate host ${hostnames[0]}`,
      description: 'Network isolate endpoint via EDR',
      category: 'contain',
      destructive: true,
      available: connected.edr,
      unavailableReason: connected.edr ? undefined : 'Connect Crowdstrike, Defender, or Wazuh',
      requiresIntegrations: ['crowdstrike', 'defender', 'edr'],
      params: { host: hostnames[0] },
      score: 85,
    });
  }

  if (hashes.length) {
    actions.push({
      id: 'scan_hash',
      label: `Scan hash ${hashes[0].slice(0, 12)}…`,
      description: 'Submit hash to VirusTotal',
      category: 'investigate',
      destructive: false,
      available: connected.virustotal,
      unavailableReason: connected.virustotal ? undefined : 'Connect VirusTotal',
      requiresIntegrations: ['virustotal'],
      params: { hash: hashes[0] },
      score: 75,
    });
  }

  actions.push({
    id: 'notify_soc_slack',
    label: 'Notify SOC (Slack)',
    description: 'Post incident summary to #soc-alerts',
    category: 'notify',
    destructive: false,
    available: connected.slack,
    unavailableReason: connected.slack ? undefined : 'Connect Slack webhook',
    requiresIntegrations: ['slack'],
    params: { channel: '#soc-alerts' },
    score: 50,
  });

  actions.push({
    id: 'notify_email',
    label: 'Notify via Email',
    description: 'Send incident summary via SMTP',
    category: 'notify',
    destructive: false,
    available: connected.email,
    unavailableReason: connected.email ? undefined : 'Connect Email (SMTP) connector',
    requiresIntegrations: ['email', 'smtp'],
    params: { subject: `SOAR alert — ${incident.title}` },
    score: 52,
  });

  actions.push({
    id: 'notify_telegram',
    label: 'Notify via Telegram',
    description: 'Send to analyst phone (chat_id map in connector)',
    category: 'notify',
    destructive: false,
    available: connected.telegram,
    unavailableReason: connected.telegram ? undefined : 'Connect Telegram bot + phone_contacts',
    requiresIntegrations: ['telegram'],
    params: { message: `[${incident.severity}] ${incident.title}` },
    score: 51,
  });

  actions.push({
    id: 'mark_investigating',
    label: 'Mark investigating',
    description: 'Update incident status',
    category: 'status',
    destructive: false,
    available: true,
    requiresIntegrations: [],
    params: { status: 'investigating' },
    score: 40,
  });

  actions.push({
    id: 'mark_contained',
    label: 'Mark contained',
    description: 'Record containment in timeline',
    category: 'status',
    destructive: false,
    available: true,
    requiresIntegrations: [],
    params: { status: 'contained' },
    score: 35,
  });

  return actions.sort((a, b) => b.score - a.score);
}

export async function executeAction(incident, actionId, params, userId, authHeader) {
  const now = new Date();
  const actor = userId || 'System';

  if (actionId === 'mark_investigating' || actionId === 'mark_contained') {
    const status = actionId === 'mark_investigating' ? 'investigating' : 'contained';
    incident.status = status;
    incident.timeline.push({
      time: now,
      actor,
      actorType: 'analyst',
      message: `Status updated to ${status}`,
      type: 'status',
    });
    await incident.save();
    return { ok: true, message: `Status updated to ${status}`, statusUpdated: status, actionId };
  }

  if (CONNECTOR_ACTIONS.has(actionId)) {
    const proxied = await proxyToSoarGateway(`/api/soar/incidents/${incident._id}/respond`, {
      body: { actionId, params: params || {} },
      authHeader,
    });
    if (proxied.ok) {
      incident.timeline.push({
        time: now,
        actor,
        actorType: 'automation',
        message: proxied.message || `Executed ${actionId} via SOAR gateway`,
        type: 'action',
      });
      await incident.save();
      return { ok: true, message: proxied.message, actionId, data: proxied.data };
    }
    return {
      ok: false,
      message:
        proxied.message ||
        `Connector action "${actionId}" failed. Configure SOAR_WORKFLOW_GATEWAY_URL and SOAR_INTERNAL_API_KEY, or use Prisma gateway (NEXT_PUBLIC_SOAR_GATEWAY=1 without SOAR_USE_NODE_BACKEND).`,
      actionId,
    };
  }

  return { ok: false, message: `Unknown or unavailable action: ${actionId}`, actionId };
}
