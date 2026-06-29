export const SOAR_API_BASE =
  typeof window !== 'undefined' ? window.location.origin : '';

export const WEBHOOK_SOURCE_TYPES = [
  { value: 'crowdstrike', label: 'CrowdStrike' },
  { value: 'defender', label: 'Microsoft Defender' },
  { value: 'fortigate', label: 'FortiGate' },
  { value: 'splunk', label: 'Splunk' },
  { value: 'wazuh', label: 'Wazuh' },
  { value: 'custom', label: 'Custom' },
] as const;

export interface InboundWebhookEndpoint {
  slug: string;
  label: string;
  description: string;
  externalNote?: string;
}

export const INBOUND_WEBHOOK_ENDPOINTS: InboundWebhookEndpoint[] = [
  {
    slug: 'crowdstrike',
    label: 'CrowdStrike',
    description: 'Send Falcon detection and incident events to SOAR from CrowdStrike API integrations.',
  },
  {
    slug: 'defender',
    label: 'Microsoft Defender',
    description: 'Ingest alerts from Microsoft Defender for Endpoint via webhook forwarding.',
  },
  {
    slug: 'fortigate',
    label: 'FortiGate / pfSense',
    description: 'Receive firewall log and threat events from FortiGate or pfSense syslog/webhook forwarding.',
    externalNote: 'External dependency required: FortiGate or pfSense must be configured to forward events.',
  },
  {
    slug: 'splunk',
    label: 'Splunk',
    description: 'Forward notable events or alert actions from Splunk Enterprise/Cloud to SOAR.',
  },
  {
    slug: 'wazuh',
    label: 'Wazuh',
    description: 'Push Wazuh manager alerts and security events into the SOAR pipeline.',
  },
  {
    slug: 'custom',
    label: 'Custom',
    description: 'Generic inbound endpoint for custom tools, scripts, or third-party integrations.',
  },
];

export function inboundWebhookUrl(slug: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/webhook/${slug}`;
  }
  return `/api/webhook/${slug}`;
}

export function webhookSourceTypeLabel(type: string): string {
  const match = WEBHOOK_SOURCE_TYPES.find((item) => item.value === type.toLowerCase());
  if (match) return match.label;
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function webhookStatusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
    case 'enabled':
    case 'connected':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    case 'inactive':
    case 'disabled':
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
    case 'error':
    case 'failed':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
}
