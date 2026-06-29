/**
 * Microsoft Sentinel — certified Phase 3 connector (full manifest)
 * Docs: https://learn.microsoft.com/en-us/rest/api/securityinsights/
 */
import type { NodeManifest } from './manifest';
import { safeValidateManifest } from './manifest';
import { defineNode } from './registry';
import { toLegacyCtx, toLegacyNode } from './legacy-bridge';
import { executeSentinel } from '@/lib/executors/nodes/sentinel';

export const sentinelManifest: NodeManifest = (() => {
  const validated = safeValidateManifest({
  id: 'sentinel',
  name: 'Microsoft Sentinel',
  version: '1.0.0',
  category: 'siem',
  description: 'Microsoft Sentinel via Azure Resource Manager: list/get/update incidents and run Log Analytics KQL queries against the workspace.',
  icon: 'Shield',
  color: '#0078d4',
  vendor: 'Microsoft',
  vendorUrl: 'https://azure.microsoft.com/products/microsoft-sentinel',
  docsUrl: 'https://learn.microsoft.com/en-us/rest/api/securityinsights/',
  config: [
    {
      key: 'action',
      label: 'Action',
      type: 'select',
      required: true,
      template: false,
      options: [
        { value: 'list_incidents', label: 'List incidents' },
        { value: 'get_incident', label: 'Get incident' },
        { value: 'update_incident', label: 'Update incident' },
        { value: 'run_query', label: 'Run KQL query' },
      ],
      default: 'list_incidents',
    },
    { key: 'incident_id', label: 'Incident ID', type: 'text', required: false, template: true, placeholder: '{{trigger.incident_id}}' },
    {
      key: 'status',
      label: 'Status (update)',
      type: 'select',
      required: false,
      template: true,
      options: [
        { value: 'New', label: 'New' },
        { value: 'Active', label: 'Active' },
        { value: 'Closed', label: 'Closed' },
      ],
    },
    { key: 'classification', label: 'Classification', type: 'text', required: false, template: true },
    { key: 'owner_email', label: 'Owner email', type: 'text', required: false, template: true },
    { key: 'comment', label: 'Comment', type: 'textarea', required: false, template: true },
    { key: 'filter', label: 'OData filter (list)', type: 'text', required: false, template: true, placeholder: "properties/status eq 'New'" },
    { key: 'top', label: 'Max results', type: 'number', required: false, template: false, default: 50 },
    { key: 'query', label: 'KQL query', type: 'textarea', required: false, template: true, placeholder: 'SecurityIncident | where TimeGenerated > ago(1d) | take 10' },
    { key: 'timespan', label: 'Timespan (ISO 8601)', type: 'text', required: false, template: false, default: 'PT1H' },
  ],
  credentials: [
    {
      kind: 'oauth2_client_credentials',
      fields: [
        { key: 'tenant_id', label: 'Azure Tenant ID', type: 'text', required: true, secret: false, template: false },
        { key: 'client_id', label: 'App Client ID', type: 'text', required: true, secret: false, template: false },
        { key: 'client_secret', label: 'Client Secret', type: 'password', required: true, secret: true, template: false },
        { key: 'subscription_id', label: 'Azure Subscription ID', type: 'text', required: true, secret: false, template: false },
        { key: 'resource_group', label: 'Resource Group', type: 'text', required: true, secret: false, template: false },
        { key: 'workspace_name', label: 'Log Analytics Workspace Name', type: 'text', required: true, secret: false, template: false },
        { key: 'workspace_id', label: 'Workspace ID (for KQL)', type: 'text', required: false, secret: false, template: false },
      ],
      placement: 'header',
      fieldName: 'Authorization',
      valueTemplate: 'Bearer {access_token}',
    },
  ],
  allowedHosts: ['management.azure.com', 'api.loganalytics.azure.com', 'login.microsoftonline.com'],
  rateLimit: { requestsPerWindow: 30, windowMs: 60_000, burst: 5 },
  timeout: { callTimeoutMs: 30_000, totalTimeoutMs: 120_000 },
  retry: {
    maxAttempts: 3,
    backoff: 'exponential_jitter',
    baseDelayMs: 1000,
    maxDelayMs: 15_000,
    retryOn: ['429', '500', '502', '503', '504', 'timeout'],
    noRetryOn: ['400', '401', '403', '404'],
  },
  errors: [
    { code: 'AUTH_FAILED', message: 'Azure AD authentication failed', retryable: false },
    { code: 'NO_INTEGRATION', message: 'Sentinel integration not configured', retryable: false },
    { code: 'INVALID_INPUT', message: 'Missing required parameters', retryable: false },
  ],
  compliance: { dataClassification: 'confidential', piiHandling: true, gdprRelevant: true, retentionDays: 90 },
  examples: [],
  });
  if (!validated.ok) throw new Error(validated.error);
  return validated.manifest;
})();

export const sentinelExecutor = defineNode(sentinelManifest, async (node, ctx) => {
  const legacy = await executeSentinel(toLegacyNode(node), toLegacyCtx(ctx));
  return {
    success: legacy.success,
    output: legacy.output,
    branch: legacy.branch,
    logs: legacy.logs,
  };
});
