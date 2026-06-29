/**
 * Wave 2 certified connectors — manifests + registry entries
 */
import { buildCertifiedConnector } from './build-connector';
import { executeCrowdStrike } from '@/lib/executors/nodes/crowdstrike';
import { executeGreyNoise } from '@/lib/executors/nodes/greynoise';
import { executeShodan } from '@/lib/executors/nodes/shodan';
import { executeTeams } from '@/lib/executors/nodes/teams';

const actionField = (options: { value: string; label: string }[]) => ({
  key: 'action',
  label: 'Action',
  type: 'select' as const,
  required: true,
  secret: false,
  template: false,
  options,
});

export const crowdstrikeExecutor = buildCertifiedConnector({
  id: 'crowdstrike',
  name: 'CrowdStrike Falcon',
  version: '1.0.0',
  category: 'edr',
  description: 'CrowdStrike Falcon API: query hosts and detections, contain or lift containment on endpoints.',
  icon: 'Shield',
  color: '#e00000',
  vendor: 'CrowdStrike',
  vendorUrl: 'https://www.crowdstrike.com',
  docsUrl: 'https://falcon.crowdstrike.com/documentation/46/crowdstrike-oauth2-based-apis',
  config: [
    actionField([
      { value: 'list_hosts', label: 'List hosts' },
      { value: 'list_detections', label: 'List detections' },
      { value: 'contain_host', label: 'Contain host' },
      { value: 'lift_containment', label: 'Lift containment' },
    ]),
    { key: 'device_id', label: 'Device ID', type: 'text', required: false, secret: false, template: true, placeholder: '{{trigger.device_id}}' },
    { key: 'filter', label: 'FQL filter', type: 'text', required: false, secret: false, template: true },
  ],
  credentials: [{
    kind: 'oauth2_client_credentials',
    fields: [
      { key: 'client_id', label: 'API Client ID', type: 'text', required: true, secret: false, template: false },
      { key: 'client_secret', label: 'API Client Secret', type: 'password', required: true, secret: true, template: false },
      { key: 'base_url', label: 'API Base URL', type: 'text', required: false, secret: false, template: false, placeholder: 'https://api.crowdstrike.com' },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'Bearer {access_token}',
  }],
  allowedHosts: ['api.crowdstrike.com', 'api.eu-1.crowdstrike.com', 'api.laggar.gcw.crowdstrike.com'],
  requiresApproval: true,
  approvalRiskLevel: 'high',
}, executeCrowdStrike);

export const greynoiseExecutor = buildCertifiedConnector({
  id: 'greynoise',
  name: 'GreyNoise',
  version: '1.0.0',
  category: 'threat_intel',
  description: 'GreyNoise internet noise intelligence: community IP lookup, RIOT benign services, and enterprise context.',
  icon: 'Radar',
  color: '#5c6bc0',
  vendor: 'GreyNoise',
  vendorUrl: 'https://www.greynoise.io',
  docsUrl: 'https://docs.greynoise.io/docs',
  config: [
    actionField([
      { value: 'lookup_ip', label: 'Community IP lookup' },
      { value: 'context', label: 'Enterprise context (requires tier)' },
      { value: 'riot_lookup', label: 'RIOT benign lookup' },
    ]),
    { key: 'ip', label: 'IP address', type: 'text', required: true, secret: false, template: true, placeholder: '{{trigger.ip}}' },
  ],
  credentials: [{
    kind: 'api_key',
    fields: [{ key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true, template: false }],
    placement: 'header',
    fieldName: 'key',
    valueTemplate: '{api_key}',
  }],
  allowedHosts: ['api.greynoise.io'],
  rateLimit: { requestsPerWindow: 100, windowMs: 60_000, burst: 10 },
}, executeGreyNoise);

export const shodanExecutor = buildCertifiedConnector({
  id: 'shodan',
  name: 'Shodan',
  version: '1.0.0',
  category: 'threat_intel',
  description: 'Shodan host intelligence and internet-wide search for exposed services and attack surface.',
  icon: 'Globe',
  color: '#d32f2f',
  vendor: 'Shodan',
  vendorUrl: 'https://www.shodan.io',
  docsUrl: 'https://developer.shodan.io/api',
  config: [
    actionField([
      { value: 'host_lookup', label: 'Host lookup' },
      { value: 'search', label: 'Search query' },
    ]),
    { key: 'ip', label: 'IP / host', type: 'text', required: false, secret: false, template: true, placeholder: '{{trigger.ip}}' },
    { key: 'query', label: 'Shodan query', type: 'text', required: false, secret: false, template: true, placeholder: 'apache country:US' },
  ],
  credentials: [{
    kind: 'api_key',
    fields: [{ key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true, template: false }],
    placement: 'query',
    fieldName: 'key',
    valueTemplate: '{api_key}',
  }],
  allowedHosts: ['api.shodan.io'],
  rateLimit: { requestsPerWindow: 10, windowMs: 60_000, burst: 2 },
}, executeShodan);

export const teamsExecutor = buildCertifiedConnector({
  id: 'teams',
  name: 'Microsoft Teams',
  version: '1.0.0',
  category: 'communication',
  description: 'Post MessageCard notifications to a Microsoft Teams incoming webhook connector.',
  icon: 'MessageSquare',
  color: '#6264a7',
  vendor: 'Microsoft',
  vendorUrl: 'https://www.microsoft.com/microsoft-teams',
  docsUrl: 'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
  config: [
    { key: 'webhook_url', label: 'Webhook URL (override)', type: 'text', required: false, template: false, secret: true },
    { key: 'title', label: 'Title', type: 'text', required: false, secret: false, template: true, default: 'SOAR Notification' },
    { key: 'message', label: 'Message', type: 'textarea', required: true, secret: false, template: true },
    { key: 'theme_color', label: 'Theme color (hex)', type: 'text', required: false, secret: false, template: false, default: '0078D4' },
  ],
  credentials: [{
    kind: 'custom',
    fields: [{ key: 'webhook_url', label: 'Incoming Webhook URL', type: 'password', required: true, secret: true, template: false }],
    placement: 'body',
    fieldName: 'webhook_url',
    valueTemplate: '{webhook_url}',
  }],
  allowedHosts: ['webhook.office.com', 'outlook.office.com', 'logic.azure.com'],
}, executeTeams);

export const wave2Executors = [
  crowdstrikeExecutor,
  greynoiseExecutor,
  shodanExecutor,
  teamsExecutor,
];
