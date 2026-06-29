/**
 * Wave 3 certified connectors — Entra ID, AWS Security Hub, GCP SCC
 */
import { buildCertifiedConnector } from './build-connector';
import { executeEntraId } from '@/lib/executors/nodes/entra-id';
import { executeAwsSecurityHub } from '@/lib/executors/nodes/aws-securityhub';
import { executeGcpScc } from '@/lib/executors/nodes/gcp-scc';

const actionField = (options: { value: string; label: string }[]) => ({
  key: 'action',
  label: 'Action',
  type: 'select' as const,
  required: true,
  secret: false,
  template: false,
  options,
});

export const entraIdExecutor = buildCertifiedConnector({
  id: 'entra_id',
  name: 'Microsoft Entra ID',
  version: '1.0.0',
  category: 'cloud_iam',
  description: 'Entra ID identity operations via Microsoft Graph: users, groups, sign-ins, enable/disable accounts.',
  icon: 'Users',
  color: '#0078d4',
  vendor: 'Microsoft',
  vendorUrl: 'https://www.microsoft.com/security/business/identity-access/microsoft-entra-id',
  docsUrl: 'https://learn.microsoft.com/en-us/graph/api/overview',
  config: [
    actionField([
      { value: 'list_users', label: 'List users' },
      { value: 'get_user', label: 'Get user' },
      { value: 'disable_user', label: 'Disable user account' },
      { value: 'enable_user', label: 'Enable user account' },
      { value: 'list_groups', label: 'List groups' },
      { value: 'add_user_to_group', label: 'Add user to group' },
      { value: 'list_sign_ins', label: 'List sign-in logs' },
    ]),
    { key: 'upn', label: 'User UPN / ID', type: 'text', required: false, secret: false, template: true, placeholder: '{{trigger.user}}' },
    { key: 'user_id', label: 'User object ID', type: 'text', required: false, secret: false, template: true },
    { key: 'group_id', label: 'Group ID', type: 'text', required: false, secret: false, template: true },
    { key: 'top', label: 'Max results', type: 'number', required: false, secret: false, template: false, default: 25 },
  ],
  credentials: [{
    kind: 'oauth2_client_credentials',
    fields: [
      { key: 'tenant_id', label: 'Tenant ID', type: 'text', required: true, secret: false, template: false },
      { key: 'client_id', label: 'Client ID', type: 'text', required: true, secret: false, template: false },
      { key: 'client_secret', label: 'Client Secret', type: 'password', required: true, secret: true, template: false },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'Bearer {access_token}',
  }],
  allowedHosts: ['graph.microsoft.com', 'login.microsoftonline.com'],
  requiresApproval: true,
  approvalRiskLevel: 'high',
}, executeEntraId);

export const awsSecurityHubExecutor = buildCertifiedConnector({
  id: 'aws_securityhub',
  name: 'AWS Security Hub',
  version: '1.0.0',
  category: 'cloud_iam',
  description: 'AWS Security Hub: list/update findings, describe hub, list enabled compliance standards.',
  icon: 'Cloud',
  color: '#ff9900',
  vendor: 'Amazon Web Services',
  vendorUrl: 'https://aws.amazon.com/security-hub/',
  docsUrl: 'https://docs.aws.amazon.com/securityhub/latest/APIReference/',
  config: [
    actionField([
      { value: 'list_findings', label: 'List findings' },
      { value: 'update_finding', label: 'Update finding workflow' },
      { value: 'list_standards', label: 'List enabled standards' },
      { value: 'describe_hub', label: 'Describe hub' },
    ]),
    { key: 'finding_id', label: 'Finding ID', type: 'text', required: false, secret: false, template: true },
    { key: 'product_arn', label: 'Product ARN', type: 'text', required: false, secret: false, template: true },
    { key: 'workflow_status', label: 'Workflow status', type: 'select', required: false, secret: false, template: true, options: [
      { value: 'NEW', label: 'NEW' }, { value: 'NOTIFIED', label: 'NOTIFIED' },
      { value: 'RESOLVED', label: 'RESOLVED' }, { value: 'SUPPRESSED', label: 'SUPPRESSED' },
    ]},
    { key: 'severity', label: 'Severity filter', type: 'select', required: false, secret: false, template: false, options: [
      { value: 'CRITICAL', label: 'CRITICAL' }, { value: 'HIGH', label: 'HIGH' },
      { value: 'MEDIUM', label: 'MEDIUM' }, { value: 'LOW', label: 'LOW' },
    ]},
    { key: 'note', label: 'Update note', type: 'textarea', required: false, secret: false, template: true },
    { key: 'max_results', label: 'Max results', type: 'number', required: false, secret: false, template: false, default: 50 },
  ],
  credentials: [{
    kind: 'custom',
    fields: [
      { key: 'access_key_id', label: 'Access Key ID', type: 'text', required: true, secret: false, template: false },
      { key: 'secret_access_key', label: 'Secret Access Key', type: 'password', required: true, secret: true, template: false },
      { key: 'region', label: 'AWS Region', type: 'text', required: true, secret: false, template: false, placeholder: 'us-east-1' },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'AWS4-HMAC-SHA256',
  }],
  allowedHosts: ['securityhub.amazonaws.com', 'amazonaws.com'],
}, executeAwsSecurityHub);

export const gcpSccExecutor = buildCertifiedConnector({
  id: 'gcp_scc',
  name: 'GCP Security Command Center',
  version: '1.0.0',
  category: 'cloud_iam',
  description: 'Google Cloud SCC: list, get, and update security findings at org or project scope.',
  icon: 'Cloud',
  color: '#4285f4',
  vendor: 'Google Cloud',
  vendorUrl: 'https://cloud.google.com/security-command-center',
  docsUrl: 'https://cloud.google.com/security-command-center/docs/reference/rest',
  config: [
    actionField([
      { value: 'list_findings', label: 'List findings' },
      { value: 'get_finding', label: 'Get finding' },
      { value: 'update_finding', label: 'Update finding state' },
    ]),
    { key: 'finding_name', label: 'Finding resource name', type: 'text', required: false, secret: false, template: true },
    { key: 'filter', label: 'List filter', type: 'text', required: false, secret: false, template: true, placeholder: 'severity="HIGH"' },
    { key: 'state', label: 'State (update)', type: 'select', required: false, secret: false, template: true, options: [
      { value: 'ACTIVE', label: 'ACTIVE' }, { value: 'INACTIVE', label: 'INACTIVE' },
    ]},
    { key: 'page_size', label: 'Page size', type: 'number', required: false, secret: false, template: false, default: 50 },
  ],
  credentials: [{
    kind: 'custom',
    fields: [
      { key: 'service_account_json', label: 'Service Account JSON', type: 'textarea', required: true, secret: true, template: false },
      { key: 'organization_id', label: 'Organization ID', type: 'text', required: false, secret: false, template: false },
      { key: 'project_id', label: 'Project ID', type: 'text', required: false, secret: false, template: false },
    ],
    placement: 'body',
    fieldName: 'credentials',
    valueTemplate: '{service_account_json}',
  }],
  allowedHosts: ['securitycenter.googleapis.com', 'oauth2.googleapis.com'],
}, executeGcpScc);

export const wave3Executors = [
  entraIdExecutor,
  awsSecurityHubExecutor,
  gcpSccExecutor,
];
