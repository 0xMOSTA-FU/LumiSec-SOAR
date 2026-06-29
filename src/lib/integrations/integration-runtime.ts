/**
 * Integration readiness — key saved ⇒ runnable in workflows without extra steps.
 */
import { db } from '@/lib/db';
import {
  NO_KEY_CONNECTOR_TYPES,
  resolveExecutorType,
} from '@/lib/integrations/catalog';
import {
  decryptIntegrationConfig,
  encryptIntegrationConfig,
  mergeIntegrationConfig,
} from '@/lib/integrations/config-secrets';
import { testIntegrationConnectivity } from '@/lib/integrations/test-connectivity';

function cfgStr(cfg: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = cfg[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

/** Minimum credential sets per integration type (any matching group is enough). */
const CREDENTIAL_GROUPS: Record<string, string[][]> = {
  virustotal: [['api_key']],
  vt: [['api_key']],
  abuseipdb: [['api_key']],
  otx: [['api_key']],
  alienvault: [['api_key']],
  greynoise: [['api_key']],
  shodan: [['api_key']],
  misp: [['url', 'api_key']],
  opencti: [['url', 'api_key']],
  thehive: [['url', 'api_key']],
  defectdojo: [['url', 'api_key']],
  digitalocean: [['api_token']],
  crowdstrike: [['client_id', 'client_secret']],
  telegram: [['bot_token']],
  slack: [['webhook']],
  teams: [['webhook_url']],
  jira: [['host', 'email', 'api_token']],
  servicenow: [['host', 'username', 'password']],
  pagerduty: [['api_key']],
  splunk: [['host', 'username', 'password']],
  wazuh: [['host', 'password']],
  elastic: [['url', 'api_key'], ['url', 'username', 'password']],
  arkime: [['url', 'password']],
  fortigate: [['host', 'api_key']],
  fortios: [['host', 'api_key']],
  opnsense: [['host', 'api_key', 'api_secret']],
  pfsense: [['host', 'api_key']],
  msgraph: [['tenant_id', 'client_id', 'client_secret']],
  entra_id: [['tenant_id', 'client_id', 'client_secret']],
  sentinel: [['tenant_id', 'client_id', 'client_secret', 'workspace_id']],
  aws_securityhub: [['access_key_id', 'secret_access_key']],
  gcp_scc: [['service_account_json']],
  velociraptor: [['url', 'api_key']],
  cuckoo: [['url']],
  clamav: [['url']],
  email: [['smtp_host', 'username', 'password'], ['smtp_host', 'service']],
  webhook: [['url']],
  http: [['base_url']],
};

export function integrationConfigReady(
  type: string,
  config: Record<string, unknown>,
  name = type,
): boolean {
  const t = resolveExecutorType(type, name).toLowerCase().replace(/[\s-]/g, '_');
  if (NO_KEY_CONNECTOR_TYPES.has(t)) return true;

  const groups = CREDENTIAL_GROUPS[t];
  if (groups) {
    return groups.some(fields => fields.every(f => cfgStr(config, f).length > 0));
  }

  return Object.values(config).some(v => typeof v === 'string' && v.trim().length > 0);
}

/** Runtime status for workflow executors — honors DB connected or saved credentials. */
export function resolveRuntimeIntegrationStatus(
  dbStatus: string,
  type: string,
  config: Record<string, unknown>,
  name = type,
): string {
  if (dbStatus === 'connected') return 'connected';
  if (integrationConfigReady(type, config, name)) return 'connected';
  return dbStatus;
}

export interface AutoTestResult {
  ok: boolean;
  message: string;
  status: 'connected' | 'error' | 'disconnected';
  durationMs?: number;
}

/** After config save: connectivity test + persist status (best-effort). */
export async function testAndUpdateIntegrationStatus(
  integrationId: string,
): Promise<AutoTestResult> {
  const row = await db.integration.findUnique({ where: { id: integrationId } });
  if (!row) {
    return { ok: false, message: 'Integration not found', status: 'disconnected' };
  }

  const config = decryptIntegrationConfig(row.config);
  const executorType = resolveExecutorType(row.type, row.name);

  if (!integrationConfigReady(row.type, config, row.name)) {
    await db.integration.update({
      where: { id: integrationId },
      data: { status: 'disconnected' },
    }).catch(() => {});
    return {
      ok: false,
      message: 'Add required credentials for this integration type',
      status: 'disconnected',
    };
  }

  const result = await testIntegrationConnectivity(executorType, config, row.name);
  const status = result.ok ? 'connected' : 'error';

  await db.integration.update({
    where: { id: integrationId },
    data: {
      status,
      lastTestedAt: new Date(),
      lastTestResult: {
        ok: result.ok,
        message: result.message,
        durationMs: result.durationMs,
      },
    },
  }).catch(() => {});

  return {
    ok: result.ok,
    message: result.message,
    status,
    durationMs: result.durationMs,
  };
}

/** Merge + encrypt config, auto-test, return updated row metadata. */
export async function saveIntegrationConfig(
  integrationId: string,
  incomingConfig: Record<string, unknown>,
): Promise<{ ok: boolean; status: string; test: AutoTestResult }> {
  const row = await db.integration.findUnique({ where: { id: integrationId } });
  if (!row) {
    return {
      ok: false,
      status: 'disconnected',
      test: { ok: false, message: 'Not found', status: 'disconnected' },
    };
  }

  const stored = decryptIntegrationConfig(row.config);
  const merged = mergeIntegrationConfig(stored, incomingConfig);

  await db.integration.update({
    where: { id: integrationId },
    data: { config: encryptIntegrationConfig(merged) },
  });

  const test = await testAndUpdateIntegrationStatus(integrationId);
  return { ok: test.ok, status: test.status, test };
}
