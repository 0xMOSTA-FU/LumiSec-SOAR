/**
 * Open-source / free-tier connector catalog — priority for community SOAR stacks.
 */
export type ConnectorTier = 'oss' | 'free_tier' | 'commercial';

export interface ConnectorCatalogEntry {
  id: string;
  name: string;
  tier: ConnectorTier;
  category: string;
  docsUrl: string;
  vendorUrl?: string;
  notes?: string;
}

/** Connectors shipped in LumiSec SOAR (registry ids). */
export const OSS_PRIORITY_CATALOG: ConnectorCatalogEntry[] = [
  { id: 'virustotal', name: 'VirusTotal', tier: 'free_tier', category: 'threat_intel', docsUrl: 'https://docs.virustotal.com/', notes: 'Free API tier available' },
  { id: 'abuseipdb', name: 'AbuseIPDB', tier: 'free_tier', category: 'threat_intel', docsUrl: 'https://docs.abuseipdb.com/' },
  { id: 'ipinfo', name: 'IPInfo', tier: 'free_tier', category: 'threat_intel', docsUrl: 'https://ipinfo.io/developers', notes: 'Works without key (limited)' },
  { id: 'otx', name: 'AlienVault OTX', tier: 'free_tier', category: 'threat_intel', docsUrl: 'https://otx.alienvault.com/api', notes: 'Free registration' },
  { id: 'greynoise', name: 'GreyNoise', tier: 'free_tier', category: 'threat_intel', docsUrl: 'https://docs.greynoise.io/docs', notes: 'Community API' },
  { id: 'shodan', name: 'Shodan', tier: 'free_tier', category: 'threat_intel', docsUrl: 'https://developer.shodan.io/api' },
  { id: 'misp', name: 'MISP', tier: 'oss', category: 'threat_intel', docsUrl: 'https://www.misp-project.org/openapi/', vendorUrl: 'https://www.misp-project.org/' },
  { id: 'opencti', name: 'OpenCTI', tier: 'oss', category: 'threat_intel', docsUrl: 'https://docs.opencti.io/', vendorUrl: 'https://filigran.io/' },
  { id: 'elastic', name: 'Elasticsearch', tier: 'oss', category: 'siem', docsUrl: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/search-search.html', vendorUrl: 'https://www.elastic.co/elasticsearch/' },
  { id: 'wazuh', name: 'Wazuh', tier: 'oss', category: 'siem', docsUrl: 'https://documentation.wazuh.com/', vendorUrl: 'https://wazuh.com/' },
  { id: 'splunk', name: 'Splunk', tier: 'commercial', category: 'siem', docsUrl: 'https://docs.splunk.com/', notes: 'Free dev license available' },
  { id: 'sentinel', name: 'Microsoft Sentinel', tier: 'commercial', category: 'siem', docsUrl: 'https://learn.microsoft.com/en-us/rest/api/securityinsights/' },
  { id: 'thehive', name: 'TheHive', tier: 'oss', category: 'case_management', docsUrl: 'https://docs.strangebee.com/', vendorUrl: 'https://strangebee.com/thehive/' },
  { id: 'defectdojo', name: 'DefectDojo', tier: 'oss', category: 'case_management', docsUrl: 'https://defectdojo.github.io/', vendorUrl: 'https://www.defectdojo.org/' },
  { id: 'velociraptor', name: 'Velociraptor', tier: 'oss', category: 'edr', docsUrl: 'https://docs.velociraptor.app/', vendorUrl: 'https://velociraptor.ai/' },
  { id: 'opnsense', name: 'OPNsense', tier: 'oss', category: 'firewall', docsUrl: 'https://docs.opnsense.org/development/api.html', vendorUrl: 'https://opnsense.org/' },
  { id: 'pfsense', name: 'pfSense', tier: 'oss', category: 'firewall', docsUrl: 'https://docs.netgate.com/pfsense/en/latest/api/index.html', vendorUrl: 'https://www.pfsense.org/' },
  { id: 'cuckoo', name: 'Cuckoo Sandbox', tier: 'oss', category: 'utility', docsUrl: 'https://cuckoo.readthedocs.io/en/latest/usage/api.html', vendorUrl: 'https://cuckoosandbox.org/' },
  { id: 'clamav', name: 'ClamAV', tier: 'oss', category: 'utility', docsUrl: 'https://docs.clamav.net/', vendorUrl: 'https://www.clamav.net/', notes: 'Via clamd or clamav-rest HTTP' },
  { id: 'arkime', name: 'Arkime', tier: 'oss', category: 'siem', docsUrl: 'https://arkime.com/faq#api', vendorUrl: 'https://arkime.com/', notes: 'Formerly Moloch' },
  { id: 'http', name: 'HTTP Request', tier: 'oss', category: 'utility', docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP', notes: 'Generic integration' },
  { id: 'telegram', name: 'Telegram', tier: 'free_tier', category: 'communication', docsUrl: 'https://core.telegram.org/bots/api', notes: 'Free Bot API' },
  { id: 'webhook', name: 'Webhook', tier: 'oss', category: 'utility', docsUrl: 'https://en.wikipedia.org/wiki/Webhook' },
];

export function isOssOrFreeTier(connectorId: string): boolean {
  const entry = OSS_PRIORITY_CATALOG.find(c => c.id === connectorId);
  return entry?.tier === 'oss' || entry?.tier === 'free_tier';
}
