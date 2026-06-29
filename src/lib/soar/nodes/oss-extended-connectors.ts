/**
 * Extended OSS connectors — pfSense, Cuckoo, ClamAV, Arkime
 */
import { buildCertifiedConnector } from './build-connector';
import { executePfSense } from '@/lib/executors/nodes/pfsense';
import { executeCuckoo } from '@/lib/executors/nodes/cuckoo';
import { executeClamAv } from '@/lib/executors/nodes/clamav';
import { executeArkime } from '@/lib/executors/nodes/arkime';

const actionField = (options: { value: string; label: string }[]) => ({
  key: 'action',
  label: 'Action',
  type: 'select' as const,
  required: true,
  secret: false,
  template: false,
  options,
});

export const pfsenseExecutor = buildCertifiedConnector({
  id: 'pfsense',
  name: 'pfSense',
  version: '1.0.0',
  category: 'firewall',
  description: 'Open-source pfSense/Netgate firewall REST API: system status, aliases, and IP block via alias.',
  icon: 'Shield',
  color: '#1e3a5f',
  vendor: 'Netgate',
  vendorUrl: 'https://www.pfsense.org/',
  docsUrl: 'https://docs.netgate.com/pfsense/en/latest/api/index.html',
  config: [
    actionField([
      { value: 'system_status', label: 'System status' },
      { value: 'list_aliases', label: 'List aliases' },
      { value: 'block_ip', label: 'Block IP (alias)' },
      { value: 'add_alias_ip', label: 'Add IP to alias' },
    ]),
    { key: 'ip', label: 'IP address', type: 'text', required: false, template: true, placeholder: '{{trigger.ip}}' },
    { key: 'alias', label: 'Alias name', type: 'text', required: false, template: false, default: 'SOAR_BlockList' },
  ],
  credentials: [{
    kind: 'api_key',
    fields: [
      { key: 'host', label: 'pfSense host', type: 'text', required: true, secret: false, template: false },
      { key: 'port', label: 'HTTPS port', type: 'number', required: false, secret: false, template: false, default: 443 },
      { key: 'api_key', label: 'API key / token', type: 'password', required: true, secret: true, template: false },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'Bearer {api_key}',
  }],
  allowedHosts: [],
  requiresApproval: true,
  approvalRiskLevel: 'high',
}, executePfSense);

export const cuckooExecutor = buildCertifiedConnector({
  id: 'cuckoo',
  name: 'Cuckoo Sandbox',
  version: '1.0.0',
  category: 'utility',
  description: 'Open-source Cuckoo Sandbox malware analysis: submit URLs, list tasks, and fetch JSON reports.',
  icon: 'Bug',
  color: '#6b7280',
  vendor: 'Cuckoo Foundation',
  vendorUrl: 'https://cuckoosandbox.org/',
  docsUrl: 'https://cuckoo.readthedocs.io/en/latest/usage/api.html',
  config: [
    actionField([
      { value: 'submit_url', label: 'Submit URL' },
      { value: 'list_tasks', label: 'List tasks' },
      { value: 'get_report', label: 'Get JSON report' },
      { value: 'view_task', label: 'View task' },
    ]),
    { key: 'url', label: 'Target URL', type: 'text', required: false, template: true },
    { key: 'task_id', label: 'Task ID', type: 'text', required: false, template: true },
    { key: 'limit', label: 'List limit', type: 'number', required: false, template: false, default: 10 },
  ],
  credentials: [{
    kind: 'bearer_token',
    fields: [
      { key: 'url', label: 'Cuckoo API base URL', type: 'text', required: true, secret: false, template: false, placeholder: 'http://cuckoo:8090' },
      { key: 'api_token', label: 'API token (optional)', type: 'password', required: false, secret: true, template: false },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'Bearer {api_token}',
  }],
  allowedHosts: [],
}, executeCuckoo);

export const clamavExecutor = buildCertifiedConnector({
  id: 'clamav',
  name: 'ClamAV',
  version: '1.0.0',
  category: 'utility',
  description: 'Open-source ClamAV antivirus via HTTP gateway (clamav-rest): scan hashes or URLs.',
  icon: 'Shield',
  color: '#0ea5e9',
  vendor: 'Cisco Talos / ClamAV',
  vendorUrl: 'https://www.clamav.net/',
  docsUrl: 'https://docs.clamav.net/',
  config: [
    actionField([
      { value: 'scan_hash', label: 'Scan hash' },
      { value: 'scan_url', label: 'Scan file URL' },
    ]),
    { key: 'hash', label: 'SHA256 hash', type: 'text', required: false, template: true },
    { key: 'file_url', label: 'File URL', type: 'text', required: false, template: true },
  ],
  credentials: [{
    kind: 'custom',
    fields: [{ key: 'url', label: 'clamav-rest base URL', type: 'text', required: true, secret: false, template: false, placeholder: 'http://clamav-rest:8080' }],
    placement: 'body',
    fieldName: 'url',
    valueTemplate: '{url}',
  }],
  allowedHosts: [],
}, executeClamAv);

export const arkimeExecutor = buildCertifiedConnector({
  id: 'arkime',
  name: 'Arkime',
  version: '1.0.0',
  category: 'siem',
  description: 'Open-source Arkime (Moloch) network forensics: session search and capture stats.',
  icon: 'Globe',
  color: '#059669',
  vendor: 'Arkime',
  vendorUrl: 'https://arkime.com/',
  docsUrl: 'https://arkime.com/faq#api',
  config: [
    actionField([
      { value: 'search_sessions', label: 'Search sessions' },
      { value: 'stats', label: 'Cluster stats' },
    ]),
    { key: 'expression', label: 'Arkime expression', type: 'text', required: false, template: true, placeholder: 'ip.src=={{trigger.ip}}' },
    { key: 'start_time', label: 'Start epoch', type: 'number', required: false, template: false },
    { key: 'stop_time', label: 'Stop epoch', type: 'number', required: false, template: false },
  ],
  credentials: [{
    kind: 'basic_auth',
    fields: [
      { key: 'url', label: 'Arkime base URL', type: 'text', required: true, secret: false, template: false },
      { key: 'username', label: 'Username', type: 'text', required: false, secret: false, template: false },
      { key: 'password', label: 'Password', type: 'password', required: false, secret: true, template: false },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'Basic {username}:{password}',
  }],
  allowedHosts: [],
}, executeArkime);

export const ossExtendedExecutors = [
  pfsenseExecutor,
  cuckooExecutor,
  clamavExecutor,
  arkimeExecutor,
];
