/**
 * Single source of truth for integration types, config schemas, and executor resolution.
 * Used by Gateway Connectors, SoarApp Integrations modal, workflow engine, and connectivity tests.
 */

import { decryptIntegrationConfig } from '@/lib/integrations/config-secrets';

export interface IntegrationCatalogEntry {
  type: string;
  name: string;
  category: string;
  description: string;
  icon: string;
}

export interface IntegrationConfigFieldDef {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

/** All supported executor integration types (must match workflow node / executor lookup keys). */
/** Connectors that can reach "connected" without API credentials (free tier / optional token). */
export const NO_KEY_CONNECTOR_TYPES = new Set(['ipinfo']);

/** LumiSec SOC priority stack — configure these first. */
export const PRIORITY_CONNECTOR_TYPES = [
  'elastic',
  'fortigate',
  'opnsense',
  'pfsense',
  'virustotal',
  'email',
  'telegram',
] as const;

export type PriorityConnectorType = (typeof PRIORITY_CONNECTOR_TYPES)[number];

export const PRIORITY_CONNECTOR_META: Record<
  PriorityConnectorType,
  { role: string; hint: string }
> = {
  elastic: { role: 'Primary SIEM', hint: 'Logs & Elastic Security alerts → SOAR' },
  fortigate: { role: 'Firewall', hint: 'Block IPs / policies via FortiOS API' },
  opnsense: { role: 'Firewall', hint: 'Aliases & rules via OPNsense API' },
  pfsense: { role: 'Firewall', hint: 'pfSense REST block lists' },
  virustotal: { role: 'Threat intel', hint: 'IP / hash / domain reputation' },
  email: { role: 'Notify', hint: 'SMTP alerts to analysts' },
  telegram: { role: 'Notify', hint: 'Bot messages to phones (via chat_id map)' },
};

export const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  { type: 'elastic', name: 'Elasticsearch', category: 'siem', description: 'Primary SIEM — logs, search & security alerts', icon: 'database' },
  { type: 'fortigate', name: 'FortiGate', category: 'network', description: 'FortiOS REST API — block & contain', icon: 'shield' },
  { type: 'opnsense', name: 'OPNsense', category: 'network', description: 'Firewall aliases & rules', icon: 'shield' },
  { type: 'pfsense', name: 'pfSense', category: 'network', description: 'pfSense REST API', icon: 'shield' },
  { type: 'virustotal', name: 'VirusTotal', category: 'threat_intel', description: 'IOC reputation (IP/hash/domain/url)', icon: 'shield' },
  { type: 'email', name: 'Email (SMTP)', category: 'communication', description: 'Email notifications to analysts', icon: 'mail' },
  { type: 'telegram', name: 'Telegram', category: 'communication', description: 'Bot alerts to phones (chat_id map)', icon: 'send' },
  { type: 'abuseipdb', name: 'AbuseIPDB', category: 'threat_intel', description: 'IP abuse confidence score', icon: 'bug' },
  { type: 'ipinfo', name: 'IPInfo', category: 'security', description: 'IP geolocation & ASN', icon: 'globe' },
  { type: 'otx', name: 'AlienVault OTX', category: 'security', description: 'Open Threat Exchange', icon: 'radar' },
  { type: 'misp', name: 'MISP', category: 'security', description: 'Threat intel sharing', icon: 'database' },
  { type: 'opencti', name: 'OpenCTI', category: 'security', description: 'CTI platform GraphQL', icon: 'database' },
  { type: 'greynoise', name: 'GreyNoise', category: 'security', description: 'Internet noise intel', icon: 'radar' },
  { type: 'shodan', name: 'Shodan', category: 'security', description: 'Host exposure search', icon: 'globe' },
  { type: 'sentinel', name: 'Microsoft Sentinel', category: 'security', description: 'Azure Sentinel + KQL', icon: 'shield' },
  { type: 'splunk', name: 'Splunk', category: 'siem', description: 'SPL via REST API', icon: 'radar' },
  { type: 'wazuh', name: 'Wazuh', category: 'siem', description: 'Open SIEM/XDR', icon: 'radar' },
  { type: 'arkime', name: 'Arkime', category: 'security', description: 'Network forensics', icon: 'globe' },
  { type: 'jira', name: 'Jira', category: 'communication', description: 'Issues & comments', icon: 'ticket' },
  { type: 'servicenow', name: 'ServiceNow', category: 'communication', description: 'Incidents Table API', icon: 'ticket' },
  { type: 'pagerduty', name: 'PagerDuty', category: 'communication', description: 'On-call incidents', icon: 'bell' },
  { type: 'thehive', name: 'TheHive', category: 'security', description: 'IR cases & observables', icon: 'shield' },
  { type: 'defectdojo', name: 'DefectDojo', category: 'security', description: 'Vuln management', icon: 'bug' },
  { type: 'msgraph', name: 'Microsoft Graph', category: 'iam', description: 'Users, alerts, mail', icon: 'users' },
  { type: 'entra_id', name: 'Microsoft Entra ID', category: 'iam', description: 'Identity & groups', icon: 'users' },
  { type: 'aws_securityhub', name: 'AWS Security Hub', category: 'cloud', description: 'AWS findings', icon: 'cloud' },
  { type: 'gcp_scc', name: 'GCP Security Command Center', category: 'cloud', description: 'GCP findings', icon: 'cloud' },
  { type: 'digitalocean', name: 'DigitalOcean', category: 'cloud', description: 'Droplets & firewall', icon: 'cloud' },
  { type: 'cuckoo', name: 'Cuckoo Sandbox', category: 'security', description: 'Malware analysis', icon: 'bug' },
  { type: 'clamav', name: 'ClamAV', category: 'security', description: 'AV scan gateway', icon: 'shield' },
  { type: 'velociraptor', name: 'Velociraptor', category: 'endpoint', description: 'DFIR & VQL', icon: 'monitor' },
  { type: 'crowdstrike', name: 'CrowdStrike Falcon', category: 'endpoint', description: 'EDR API', icon: 'shield' },
  { type: 'slack', name: 'Slack', category: 'communication', description: 'Incoming webhook', icon: 'message-square' },
  { type: 'teams', name: 'Microsoft Teams', category: 'communication', description: 'Webhook MessageCard', icon: 'message-square' },
  { type: 'http', name: 'HTTP Request', category: 'security', description: 'Generic REST', icon: 'globe' },
  { type: 'webhook', name: 'Webhook', category: 'security', description: 'Outbound webhook', icon: 'webhook' },
  { type: 'lumisec_platform', name: 'LumiSec Platform', category: 'platform', description: 'GRC · UCTC · Phishing · LumiNet monolith', icon: 'layers' },
  { type: 'lumisec_grc', name: 'LumiSec GRC', category: 'platform', description: 'Findings & risk register', icon: 'clipboard-list' },
  { type: 'lumisec_uctc', name: 'LumiSec UCTC', category: 'platform', description: 'Sigma rules & SIEM deploy', icon: 'code' },
  { type: 'lumisec_phishing', name: 'LumiSec Phishing', category: 'platform', description: 'Simulation campaigns', icon: 'mail' },
  { type: 'lumisec_network', name: 'LumiSec LumiNet', category: 'platform', description: 'Asset discovery & network context', icon: 'network' },
];

export const INTEGRATION_CONFIG_FIELDS: Record<string, IntegrationConfigFieldDef[]> = {
  virustotal: [{ key: 'api_key', label: 'API Key', secret: true, placeholder: 'From virustotal.com/gui/my-apikey' }],
  abuseipdb: [{ key: 'api_key', label: 'API Key', secret: true }],
  ipinfo: [{ key: 'token', label: 'Token (optional)' }],
  otx: [{ key: 'api_key', label: 'API Key', secret: true }],
  misp: [{ key: 'url', label: 'MISP URL' }, { key: 'api_key', label: 'API Key', secret: true }],
  opencti: [{ key: 'url', label: 'OpenCTI URL' }, { key: 'api_key', label: 'API Key', secret: true }],
  greynoise: [{ key: 'api_key', label: 'API Key', secret: true }],
  shodan: [{ key: 'api_key', label: 'API Key', secret: true }],
  sentinel: [
    { key: 'tenant_id', label: 'Azure Tenant ID' },
    { key: 'client_id', label: 'Client ID' },
    { key: 'client_secret', label: 'Client Secret', secret: true },
    { key: 'subscription_id', label: 'Subscription ID' },
    { key: 'resource_group', label: 'Resource Group' },
    { key: 'workspace_name', label: 'Workspace Name' },
    { key: 'workspace_id', label: 'Workspace ID' },
  ],
  splunk: [
    { key: 'host', label: 'Splunk Host' },
    { key: 'port', label: 'Port', placeholder: '8089' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
  ],
  elastic: [
    { key: 'url', label: 'Elasticsearch URL', placeholder: 'https://elastic.example.com:9200' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
    { key: 'api_key', label: 'API Key', secret: true },
    { key: 'alerts_index', label: 'Security alerts index', placeholder: '.alerts-security.alerts-*' },
  ],
  wazuh: [
    { key: 'host', label: 'Manager Host' },
    { key: 'port', label: 'Port', placeholder: '55000' },
    { key: 'username', label: 'Username', placeholder: 'wazuh' },
    { key: 'password', label: 'Password', secret: true },
  ],
  arkime: [
    { key: 'url', label: 'Arkime URL' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
  ],
  jira: [
    { key: 'host', label: 'Jira Host', placeholder: 'acme.atlassian.net' },
    { key: 'email', label: 'User Email' },
    { key: 'api_token', label: 'API Token', secret: true },
  ],
  servicenow: [
    { key: 'host', label: 'Instance Host' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
  ],
  pagerduty: [
    { key: 'api_key', label: 'API Key', secret: true },
    { key: 'routing_key', label: 'Routing Key', secret: true },
    { key: 'email', label: 'From Email' },
  ],
  thehive: [{ key: 'url', label: 'TheHive URL' }, { key: 'api_key', label: 'API Key', secret: true }],
  defectdojo: [{ key: 'url', label: 'URL' }, { key: 'api_key', label: 'API Key', secret: true }],
  msgraph: [
    { key: 'tenant_id', label: 'Tenant ID' },
    { key: 'client_id', label: 'Client ID' },
    { key: 'client_secret', label: 'Client Secret', secret: true },
  ],
  entra_id: [
    { key: 'tenant_id', label: 'Tenant ID' },
    { key: 'client_id', label: 'Client ID' },
    { key: 'client_secret', label: 'Client Secret', secret: true },
  ],
  aws_securityhub: [
    { key: 'access_key_id', label: 'Access Key ID', secret: true },
    { key: 'secret_access_key', label: 'Secret Access Key', secret: true },
    { key: 'region', label: 'Region', placeholder: 'us-east-1' },
  ],
  gcp_scc: [
    { key: 'service_account_json', label: 'Service Account JSON', secret: true },
    { key: 'organization_id', label: 'Organization ID' },
    { key: 'project_id', label: 'Project ID' },
  ],
  digitalocean: [{ key: 'api_token', label: 'API Token', secret: true }],
  fortigate: [
    { key: 'host', label: 'Host' },
    { key: 'port', label: 'Port', placeholder: '443' },
    { key: 'api_key', label: 'API Key', secret: true },
    { key: 'vdom', label: 'VDOM', placeholder: 'root' },
  ],
  opnsense: [
    { key: 'host', label: 'Host' },
    { key: 'port', label: 'Port', placeholder: '443' },
    { key: 'api_key', label: 'API Key' },
    { key: 'api_secret', label: 'API Secret', secret: true },
  ],
  pfsense: [
    { key: 'host', label: 'Host' },
    { key: 'port', label: 'Port', placeholder: '443' },
    { key: 'api_key', label: 'API Key', secret: true },
  ],
  cuckoo: [
    { key: 'url', label: 'API URL' },
    { key: 'api_token', label: 'API Token', secret: true },
  ],
  clamav: [{ key: 'url', label: 'clamav-rest URL' }],
  velociraptor: [{ key: 'url', label: 'URL' }, { key: 'api_key', label: 'API Key', secret: true }],
  crowdstrike: [
    { key: 'client_id', label: 'Client ID' },
    { key: 'client_secret', label: 'Client Secret', secret: true },
    { key: 'base_url', label: 'Base URL', placeholder: 'https://api.crowdstrike.com' },
  ],
  slack: [
    { key: 'webhook', label: 'Webhook URL' },
    { key: 'channel', label: 'Default Channel', placeholder: '#soc-alerts' },
  ],
  teams: [{ key: 'webhook_url', label: 'Webhook URL', secret: true }],
  email: [
    { key: 'smtp_host', label: 'SMTP Host' },
    { key: 'service', label: 'Service (gmail|outlook)', placeholder: 'gmail' },
    { key: 'port', label: 'Port', placeholder: '587' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
    { key: 'from', label: 'From address' },
    { key: 'test_to', label: 'Test recipient' },
    { key: 'default_to', label: 'Default To' },
  ],
  telegram: [
    { key: 'bot_token', label: 'Bot token', secret: true },
    { key: 'chat_id', label: 'Default chat ID' },
    {
      key: 'phone_contacts',
      label: 'Phone → chat_id JSON',
      placeholder: '{"+201234567890":"123456789"}',
    },
  ],
  webhook: [
    { key: 'url', label: 'Webhook URL' },
    { key: 'auth_header', label: 'Auth header', secret: true },
  ],
  http: [
    { key: 'base_url', label: 'Base URL' },
    { key: 'api_key', label: 'API Key', secret: true },
  ],
  lumisec_platform: [
    { key: 'base_url', label: 'Platform API URL', placeholder: 'http://localhost:4000' },
    { key: 'internal_api_key', label: 'X-Internal-Api-Key', secret: true },
  ],
  lumisec_grc: [
    { key: 'base_url', label: 'Platform API URL', placeholder: 'http://localhost:4000' },
    { key: 'internal_api_key', label: 'X-Internal-Api-Key', secret: true },
  ],
  lumisec_uctc: [
    { key: 'base_url', label: 'Platform API URL', placeholder: 'http://localhost:4000' },
    { key: 'internal_api_key', label: 'X-Internal-Api-Key', secret: true },
  ],
  lumisec_phishing: [
    { key: 'base_url', label: 'Platform API URL', placeholder: 'http://localhost:4000' },
    { key: 'internal_api_key', label: 'X-Internal-Api-Key', secret: true },
  ],
  lumisec_network: [
    { key: 'base_url', label: 'Platform API URL', placeholder: 'http://localhost:4000' },
    { key: 'internal_api_key', label: 'X-Internal-Api-Key', secret: true },
  ],
};

/** Short aliases → canonical executor type (workflow ctx.getIntegration keys). */
export const EXECUTOR_ALIASES: Record<string, string[]> = {
  virustotal: ['vt', 'virus_total'],
  abuseipdb: ['abuse_ipdb'],
  ipinfo: ['ip_info'],
  otx: ['alienvault', 'alien_vault', 'alienvault_otx'],
  elastic: ['elasticsearch', 'es'],
  email: ['smtp', 'email_smtp', 'mail'],
  msgraph: ['microsoft', 'microsoft_graph', 'ms_graph'],
  fortigate: ['fortios'],
  digitalocean: ['do'],
  servicenow: ['snow'],
  crowdstrike: ['falcon', 'cs'],
  greynoise: ['gn'],
  shodan: ['shodan_io'],
  teams: ['msteams', 'microsoft_teams'],
  entra_id: ['entra', 'azure_ad', 'entraid'],
  aws_securityhub: ['securityhub', 'aws_security_hub'],
  gcp_scc: ['security_command_center'],
  pfsense: ['pfsense_plus'],
  cuckoo: ['cuckoo_sandbox'],
  arkime: ['moloch'],
  telegram: ['tg'],
  sentinel: ['microsoft_sentinel', 'ms_sentinel'],
  create_alert: ['alert_out'],
  http: ['rest', 'api_request', 'custom_app', 'custom', 'custom_api'],
};

const GENERIC_TYPES = new Set([
  'siem', 'edr', 'firewall', 'ticketing', 'cloud', 'threat_intel',
  'security', 'communication', 'network', 'endpoint', 'iam', 'other', 'api',
]);

const KNOWN_EXECUTOR_TYPES = new Set([
  ...INTEGRATION_CATALOG.map(c => c.type),
  ...Object.keys(INTEGRATION_CONFIG_FIELDS),
]);

/** Infer executor type from DB type + integration name (fixes legacy generic types). */
export function resolveExecutorType(type: string, name: string): string {
  const t = type.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (KNOWN_EXECUTOR_TYPES.has(t) && !GENERIC_TYPES.has(t)) return t;

  const n = name.toLowerCase().replace(/[\s\-_]/g, '');
  const patterns: [string, string][] = [
    ['virustotal', 'virustotal'],
    ['abuseipdb', 'abuseipdb'],
    ['ipinfo', 'ipinfo'],
    ['alienvault', 'otx'],
    ['otx', 'otx'],
    ['misp', 'misp'],
    ['opencti', 'opencti'],
    ['greynoise', 'greynoise'],
    ['shodan', 'shodan'],
    ['sentinel', 'sentinel'],
    ['splunk', 'splunk'],
    ['elastic', 'elastic'],
    ['elasticsearch', 'elastic'],
    ['wazuh', 'wazuh'],
    ['arkime', 'arkime'],
    ['moloch', 'arkime'],
    ['jira', 'jira'],
    ['servicenow', 'servicenow'],
    ['pagerduty', 'pagerduty'],
    ['thehive', 'thehive'],
    ['defectdojo', 'defectdojo'],
    ['msgraph', 'msgraph'],
    ['microsoftgraph', 'msgraph'],
    ['entra', 'entra_id'],
    ['azuread', 'entra_id'],
    ['securityhub', 'aws_securityhub'],
    ['gcpscc', 'gcp_scc'],
    ['digitalocean', 'digitalocean'],
    ['fortigate', 'fortigate'],
    ['fortios', 'fortigate'],
    ['opnsense', 'opnsense'],
    ['pfsense', 'pfsense'],
    ['cuckoo', 'cuckoo'],
    ['clamav', 'clamav'],
    ['velociraptor', 'velociraptor'],
    ['crowdstrike', 'crowdstrike'],
    ['falcon', 'crowdstrike'],
    ['slack', 'slack'],
    ['teams', 'teams'],
    ['msteams', 'teams'],
    ['telegram', 'telegram'],
    ['smtp', 'email'],
    ['webhook', 'webhook'],
  ];

  for (const [needle, exec] of patterns) {
    if (n.includes(needle)) return exec;
  }
  return t;
}

export function integrationConfigFields(type: string): IntegrationConfigFieldDef[] {
  const exec = resolveExecutorType(type, type);
  return INTEGRATION_CONFIG_FIELDS[exec] ?? INTEGRATION_CONFIG_FIELDS[type.toLowerCase()] ?? [
    { key: 'host', label: 'Host / URL' },
    { key: 'api_key', label: 'API Key', secret: true },
  ];
}

export function integrationTypeLabel(type: string): string {
  const exec = resolveExecutorType(type, type);
  const entry = INTEGRATION_CATALOG.find(c => c.type === exec);
  if (entry) return entry.name;
  return type.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

export function connectorTypeOptions() {
  const seen = new Set<string>();
  const ordered: { value: string; label: string }[] = [];
  for (const type of PRIORITY_CONNECTOR_TYPES) {
    const entry = INTEGRATION_CATALOG.find((c) => c.type === type);
    if (entry && !seen.has(entry.type)) {
      ordered.push({ value: entry.type, label: entry.name });
      seen.add(entry.type);
    }
  }
  for (const c of INTEGRATION_CATALOG) {
    if (!seen.has(c.type)) ordered.push({ value: c.type, label: c.name });
  }
  return ordered;
}

export function isPriorityConnectorType(type: string): boolean {
  return (PRIORITY_CONNECTOR_TYPES as readonly string[]).includes(
    resolveExecutorType(type, type),
  );
}

/** Register integration under all keys the workflow engine may look up. */
export function indexIntegrationAliases(
  map: Map<string, { id: string; name: string; type: string; category: string; config: Record<string, unknown>; status: string }>,
  item: { id: string; name: string; type: string; category: string; config: Record<string, unknown>; status: string },
  dbType: string,
  name: string,
  id: string,
): void {
  const executor = resolveExecutorType(dbType, name);
  const keys = new Set<string>();

  keys.add(executor);
  keys.add(dbType.toLowerCase());
  keys.add(id.toLowerCase());
  keys.add(name.toLowerCase().replace(/[\s\-_]/g, ''));

  const aliases = EXECUTOR_ALIASES[executor] || [];
  for (const a of aliases) keys.add(a);

  if (executor === 'email' || dbType === 'email') {
    ['smtp', 'email_smtp', 'mail'].forEach(k => keys.add(k));
  }

  for (const k of keys) {
    map.set(k, item);
  }
}

export function integrationHasSecrets(configEnc: string | null | undefined): boolean {
  if (!configEnc || configEnc === '{}' || configEnc.length < 10) return false;
  try {
    const cfg = decryptIntegrationConfig(configEnc);
    return Object.values(cfg).some(v => typeof v === 'string' && v.trim().length > 0);
  } catch {
    return configEnc.length > 20;
  }
}
