/**
 * Priority production connectors — full manifests for nodes that must work
 * in customer workflows (VirusTotal companions, Elastic, email, firewalls, alerts, custom apps).
 */
import { buildCertifiedConnector } from './build-connector';
import { executeElastic } from '@/lib/executors/nodes/elastic';
import { executeEmail } from '@/lib/executors/nodes/email';
import { executeFortiGate } from '@/lib/executors/nodes/fortigate';
import { executeOPNsense } from '@/lib/executors/nodes/opnsense';
import { executeCreateAlert } from '@/lib/executors/nodes/case-alert';
import { executeHTTP } from '@/lib/executors/nodes/http';

const actionField = (options: { value: string; label: string }[]) => ({
  key: 'action',
  label: 'Action',
  type: 'select' as const,
  required: true,
  secret: false,
  template: false,
  options,
});

export const elasticPriorityExecutor = buildCertifiedConnector({
  id: 'elastic',
  name: 'Elasticsearch',
  version: '2.1.0',
  category: 'siem',
  description: 'Elastic Stack: search indices, index events, count docs, and query security alerts.',
  icon: 'Database',
  color: '#00bfb3',
  vendor: 'Elastic',
  vendorUrl: 'https://www.elastic.co/',
  docsUrl: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/rest-apis.html',
  config: [
    actionField([
      { value: 'search', label: 'Search (_search)' },
      { value: 'count', label: 'Count (_count)' },
      { value: 'index', label: 'Index document (_doc)' },
      { value: 'alerts_search', label: 'Security alerts search' },
      { value: 'get_document', label: 'Get document by ID' },
    ]),
    { key: 'index', label: 'Index pattern', type: 'text', required: false, template: true, placeholder: 'logs-* or .alerts-security.alerts-*' },
    { key: 'query', label: 'Query (Lucene or JSON)', type: 'textarea', required: false, template: true, placeholder: 'source.ip:{{trigger.ip}}' },
    { key: 'body', label: 'Document JSON (index action)', type: 'textarea', required: false, template: true },
    { key: 'doc_id', label: 'Document ID', type: 'text', required: false, template: true },
    { key: 'size', label: 'Result size', type: 'number', required: false, template: false, default: 50 },
  ],
  credentials: [{
    kind: 'basic_auth',
    fields: [
      { key: 'url', label: 'Elasticsearch URL', type: 'text', required: true, secret: false, template: false, placeholder: 'https://elastic.example.com:9200' },
      { key: 'username', label: 'Username', type: 'text', required: false, secret: false, template: false },
      { key: 'password', label: 'Password', type: 'password', required: false, secret: true, template: false },
      { key: 'api_key', label: 'API key (optional)', type: 'password', required: false, secret: true, template: false },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'ApiKey {api_key}',
  }],
  allowedHosts: [],
}, executeElastic);

export const emailPriorityExecutor = buildCertifiedConnector({
  id: 'email',
  name: 'Email (SMTP)',
  version: '2.1.0',
  category: 'communication',
  description: 'Send email notifications via SMTP (nodemailer). Requires connected SMTP integration.',
  icon: 'Mail',
  color: '#3b82f6',
  vendor: 'SMTP',
  docsUrl: 'https://nodemailer.com/',
  config: [
    { key: 'to', label: 'To', type: 'text', required: false, template: true, placeholder: '{{trigger.email}}' },
    { key: 'subject', label: 'Subject', type: 'text', required: false, template: true, placeholder: 'SOAR alert: {{trigger.title}}' },
    { key: 'body', label: 'Body', type: 'textarea', required: false, template: true },
    { key: 'html', label: 'HTML body', type: 'textarea', required: false, template: true },
  ],
  credentials: [{
    kind: 'basic_auth',
    fields: [
      { key: 'smtp_host', label: 'SMTP host', type: 'text', required: true, secret: false, template: false },
      { key: 'port', label: 'Port', type: 'number', required: false, secret: false, template: false, default: 587 },
      { key: 'username', label: 'Username', type: 'text', required: false, secret: false, template: false },
      { key: 'password', label: 'Password', type: 'password', required: false, secret: true, template: false },
      { key: 'from', label: 'From address', type: 'text', required: false, secret: false, template: false },
      { key: 'default_to', label: 'Default recipient', type: 'text', required: false, secret: false, template: false },
    ],
    placement: 'body',
    fieldName: 'smtp',
    valueTemplate: '{smtp_host}',
  }],
  allowedHosts: [],
}, executeEmail);

export const fortigatePriorityExecutor = buildCertifiedConnector({
  id: 'fortigate',
  name: 'FortiGate',
  version: '2.1.0',
  category: 'firewall',
  description: 'FortiOS REST API: block/unblock IPs and domains via address objects and groups.',
  icon: 'Shield',
  color: '#ee3124',
  vendor: 'Fortinet',
  vendorUrl: 'https://www.fortinet.com/',
  docsUrl: 'https://docs.fortinet.com/document/fortigate/',
  config: [
    actionField([
      { value: 'block_ip', label: 'Block IP' },
      { value: 'unblock_ip', label: 'Unblock IP' },
      { value: 'block_domain', label: 'Block domain' },
    ]),
    { key: 'ip', label: 'IP address', type: 'text', required: false, template: true, placeholder: '{{trigger.ip}}' },
    { key: 'domain', label: 'Domain', type: 'text', required: false, template: true },
    { key: 'target', label: 'Target (IP or domain)', type: 'text', required: false, template: true },
    { key: 'address_group', label: 'Address group', type: 'text', required: false, template: false, default: 'SOAR-BlockList' },
  ],
  credentials: [{
    kind: 'bearer_token',
    fields: [
      { key: 'host', label: 'FortiGate host', type: 'text', required: true, secret: false, template: false },
      { key: 'port', label: 'HTTPS port', type: 'number', required: false, secret: false, template: false, default: 443 },
      { key: 'api_key', label: 'API key', type: 'password', required: true, secret: true, template: false },
      { key: 'vdom', label: 'VDOM', type: 'text', required: false, secret: false, template: false, default: 'root' },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'Bearer {api_key}',
  }],
  allowedHosts: [],
  requiresApproval: true,
  approvalRiskLevel: 'high',
}, executeFortiGate);

export const opnsensePriorityExecutor = buildCertifiedConnector({
  id: 'opnsense',
  name: 'OPNsense',
  version: '2.1.0',
  category: 'firewall',
  description: 'OPNsense firewall API: host aliases, block IP, list aliases.',
  icon: 'Shield',
  color: '#f97316',
  vendor: 'Deciso',
  vendorUrl: 'https://opnsense.org/',
  docsUrl: 'https://docs.opnsense.org/development/api.html',
  config: [
    actionField([
      { value: 'block_ip', label: 'Block IP (host alias)' },
      { value: 'list_aliases', label: 'List aliases' },
    ]),
    { key: 'ip', label: 'IP address', type: 'text', required: false, template: true, placeholder: '{{trigger.ip}}' },
    { key: 'alias', label: 'Alias name', type: 'text', required: false, template: false, default: 'SOAR_BlockList' },
  ],
  credentials: [{
    kind: 'api_key',
    fields: [
      { key: 'host', label: 'OPNsense host', type: 'text', required: true, secret: false, template: false },
      { key: 'port', label: 'HTTPS port', type: 'number', required: false, secret: false, template: false, default: 443 },
      { key: 'api_key', label: 'API key', type: 'text', required: true, secret: false, template: false },
      { key: 'api_secret', label: 'API secret', type: 'password', required: true, secret: true, template: false },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'Basic {api_key}:{api_secret}',
  }],
  allowedHosts: [],
  requiresApproval: true,
  approvalRiskLevel: 'high',
}, executeOPNsense);

export const createAlertPriorityExecutor = buildCertifiedConnector({
  id: 'create_alert',
  name: 'Create Alert',
  version: '2.1.0',
  category: 'case_management',
  description: 'Create a SOAR alert in the platform database (alias: alert_out).',
  icon: 'Bell',
  color: '#eab308',
  vendor: 'CyberSOAR',
  docsUrl: 'https://github.com/LumiSec-SOAR',
  config: [
    { key: 'title', label: 'Title', type: 'text', required: true, template: true, placeholder: 'Alert: {{trigger.ip}}' },
    { key: 'description', label: 'Description', type: 'textarea', required: false, template: true },
    { key: 'severity', label: 'Severity', type: 'select', required: false, template: false, options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'critical', label: 'Critical' },
    ], default: 'medium' },
    { key: 'source', label: 'Source', type: 'text', required: false, template: false, default: 'workflow' },
  ],
  credentials: [],
  allowedHosts: [],
}, executeCreateAlert);

export const customAppExecutor = buildCertifiedConnector({
  id: 'custom_app',
  name: 'Custom App (HTTP)',
  version: '1.0.0',
  category: 'utility',
  description: 'Call a custom application REST API you develop. Uses SSRF-safe HTTP with template variables.',
  icon: 'Globe',
  color: '#8b5cf6',
  vendor: 'Custom',
  docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP',
  config: [
    { key: 'method', label: 'HTTP method', type: 'select', required: false, template: false, options: [
      { value: 'GET', label: 'GET' },
      { value: 'POST', label: 'POST' },
      { value: 'PUT', label: 'PUT' },
      { value: 'PATCH', label: 'PATCH' },
      { value: 'DELETE', label: 'DELETE' },
    ], default: 'POST' },
    { key: 'url', label: 'API URL', type: 'text', required: true, template: true, placeholder: 'https://myapp.internal/api/v1/action' },
    { key: 'headers', label: 'Headers (JSON)', type: 'textarea', required: false, template: true, placeholder: '{"Authorization":"Bearer {{vault.myapp_token}}"}' },
    { key: 'body', label: 'Body (JSON)', type: 'textarea', required: false, template: true, placeholder: '{"ip":"{{trigger.ip}}"}' },
    { key: 'auth_integration', label: 'Auth integration key', type: 'text', required: false, template: false, placeholder: 'http' },
  ],
  credentials: [],
  allowedHosts: [],
}, executeHTTP);

export const priorityConnectorsExecutors = [
  elasticPriorityExecutor,
  emailPriorityExecutor,
  fortigatePriorityExecutor,
  opnsensePriorityExecutor,
  createAlertPriorityExecutor,
  customAppExecutor,
];
