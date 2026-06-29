/**
 * Real integration connectivity tests — used by POST /api/integrations/test
 * Every test performs an actual outbound HTTP/SMTP call (no mocks).
 */

import { resolveExecutorType } from '@/lib/integrations/catalog';
import { buildHttpsUrl, ensureUrlBase, normalizeHost } from '@/lib/integrations/url-utils';

import { sendTestEmail } from '@/lib/executors/nodes/email';
import { callVirusTotal } from '@/lib/executors/nodes/virustotal';
import { testSentinelConnectivity } from '@/lib/executors/nodes/sentinel';
import { testCrowdStrikeConnectivity } from '@/lib/executors/nodes/crowdstrike';
import { testGreyNoiseConnectivity } from '@/lib/executors/nodes/greynoise';
import { testShodanConnectivity } from '@/lib/executors/nodes/shodan';
import { testTeamsConnectivity } from '@/lib/executors/nodes/teams';
import { testEntraIdConnectivity } from '@/lib/executors/nodes/entra-id';
import { testAwsSecurityHubConnectivity } from '@/lib/executors/nodes/aws-securityhub';
import { testGcpSccConnectivity } from '@/lib/executors/nodes/gcp-scc';
import { callIPInfo } from '@/lib/executors/nodes/ipinfo';
import { testPfSenseConnectivity } from '@/lib/executors/nodes/pfsense';
import { testCuckooConnectivity } from '@/lib/executors/nodes/cuckoo';
import { testClamAvConnectivity } from '@/lib/executors/nodes/clamav';
import { testArkimeConnectivity } from '@/lib/executors/nodes/arkime';
import { testTelegramConnectivity } from '@/lib/executors/nodes/telegram';
import { pingPlatformModules, isPlatformOutboundConfigured } from '@/lib/lumisec-api/platform-outbound';

export interface TestResult {
  ok: boolean;
  message: string;
  data?: unknown;
  durationMs?: number;
}

type Config = Record<string, unknown>;

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

function cfgStr(cfg: Config, ...keys: string[]): string {
  for (const k of keys) {
    const v = cfg[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

function authHeader(cfg: Config): Record<string, string> {
  const token = cfgStr(cfg, 'api_key', 'apiKey', 'token', 'access_token');
  if (token) return { Authorization: `Bearer ${token}` };
  const user = cfgStr(cfg, 'username', 'user');
  const pass = cfgStr(cfg, 'password', 'pass');
  if (user && pass) {
    return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
  }
  return {};
}

async function fetchTest(
  url: string,
  init: RequestInit = {},
): Promise<TestResult> {
  const { result: res, durationMs } = await timed(() => fetch(url, { ...init, cache: 'no-store' }));
  const text = await res.text().catch(() => '');
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const msg = typeof json === 'object' && json && 'message' in json
      ? String((json as { message: string }).message)
      : text.slice(0, 200) || `HTTP ${res.status}`;
    return { ok: false, message: `${res.status}: ${msg}`, data: json, durationMs };
  }
  return { ok: true, message: `Connected (${res.status})`, data: json, durationMs };
}

export async function testIntegrationConnectivity(
  type: string,
  config: Config,
  name = type,
): Promise<TestResult> {
  const t = resolveExecutorType(type, name).toLowerCase().replace(/[\s-]/g, '_');

  switch (t) {
    case 'virustotal':
    case 'vt': {
      const r = await callVirusTotal(
        { id: 'test', name, type: 'virustotal', category: 'threat_intel', config, status: 'connected' },
        'ip_addresses/8.8.8.8',
      );
      if (!r.ok) {
        const err = r.data as { error?: { message?: string } };
        return { ok: false, message: err?.error?.message || `HTTP ${r.status}`, durationMs: r.durationMs };
      }
      return { ok: true, message: 'VirusTotal API key valid (queried 8.8.8.8)', durationMs: r.durationMs };
    }

    case 'abuseipdb': {
      const key = cfgStr(config, 'api_key', 'apiKey');
      if (!key) return { ok: false, message: 'api_key required' };
      return fetchTest('https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8&maxAgeInDays=90', {
        headers: { Key: key, Accept: 'application/json' },
      });
    }

    case 'ipinfo':
    case 'ip_info': {
      const token = cfgStr(config, 'token', 'api_key');
      const r = await callIPInfo('8.8.8.8', token || undefined);
      if (!r.ok) {
        const d = r.data as { error?: { message?: string } };
        return { ok: false, message: d?.error?.message || `HTTP ${r.status}`, durationMs: r.durationMs };
      }
      const d = r.data as { country?: string; city?: string; org?: string };
      return {
        ok: true,
        message: `IPInfo: ${d.country || '?'}, ${d.city || '?'}, ASN: ${d.org || '?'}`,
        durationMs: r.durationMs,
      };
    }

    case 'otx':
    case 'alienvault':
    case 'alienvault_otx': {
      const key = cfgStr(config, 'api_key', 'apiKey');
      if (!key) return { ok: false, message: 'api_key required' };
      return fetchTest('https://otx.alienvault.com/api/v1/user/me', {
        headers: { 'X-OTX-API-KEY': key },
      });
    }

    case 'slack': {
      const webhook = cfgStr(config, 'webhook', 'webhook_url');
      if (!webhook) return { ok: false, message: 'webhook URL required' };
      const { result: res, durationMs } = await timed(() => fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `[SOAR] Connectivity test from ${name}` }),
      }));
      const body = await res.text();
      if (res.ok && body === 'ok') {
        return { ok: true, message: 'Slack webhook delivered test message', durationMs };
      }
      return { ok: false, message: `Slack webhook failed: ${body || res.status}`, durationMs };
    }

    case 'email':
    case 'smtp': {
      const to = cfgStr(config, 'test_to', 'default_to', 'to');
      if (!to) return { ok: false, message: 'test_to required — your real email address to receive the test' };
      const r = await sendTestEmail({ config, name }, to);
      return { ok: r.ok, message: r.message, data: r.data };
    }

    case 'jira': {
      const base = cfgStr(config, 'host', 'url', 'base_url').replace(/\/$/, '');
      const email = cfgStr(config, 'email', 'username');
      const token = cfgStr(config, 'api_token', 'token', 'api_key');
      if (!base || !email || !token) return { ok: false, message: 'host, email, api_token required' };
      return fetchTest(`${base}/rest/api/3/myself`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
          Accept: 'application/json',
        },
      });
    }

    case 'servicenow':
    case 'snow': {
      const base = cfgStr(config, 'instance', 'host', 'url').replace(/\/$/, '');
      const user = cfgStr(config, 'username', 'user');
      const pass = cfgStr(config, 'password');
      if (!base || !user || !pass) return { ok: false, message: 'instance, username, password required' };
      return fetchTest(`${base}/api/now/table/incident?sysparm_limit=1`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
          Accept: 'application/json',
        },
      });
    }

    case 'pagerduty': {
      const key = cfgStr(config, 'api_key', 'routing_key', 'token');
      if (!key) return { ok: false, message: 'api_key required' };
      return fetchTest('https://api.pagerduty.com/users?limit=1', {
        headers: { Authorization: `Token token=${key}`, Accept: 'application/vnd.pagerduty+json;version=2' },
      });
    }

    case 'thehive': {
      const base = cfgStr(config, 'url', 'host').replace(/\/$/, '');
      const key = cfgStr(config, 'api_key', 'apiKey');
      if (!base || !key) return { ok: false, message: 'url and api_key required' };
      return fetchTest(`${base}/api/v1/user/current`, {
        headers: { Authorization: `Bearer ${key}` },
      });
    }

    case 'misp': {
      const base = cfgStr(config, 'url', 'host').replace(/\/$/, '');
      const key = cfgStr(config, 'api_key', 'apiKey');
      if (!base || !key) return { ok: false, message: 'url and api_key required' };
      return fetchTest(`${base}/servers/getPyMISPVersion.json`, {
        headers: { Authorization: key, Accept: 'application/json' },
      });
    }

    case 'opencti': {
      const base = cfgStr(config, 'url', 'host').replace(/\/$/, '');
      const token = cfgStr(config, 'api_key', 'token');
      if (!base || !token) return { ok: false, message: 'url and api_key required' };
      const { result: res, durationMs } = await timed(() => fetch(`${base}/graphql`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ settings { platform_title } }' }),
      }));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: `OpenCTI GraphQL failed (${res.status})`, data: json, durationMs };
      return { ok: true, message: 'OpenCTI GraphQL connected', data: json, durationMs };
    }

    case 'splunk': {
      const base = ensureUrlBase(cfgStr(config, 'host', 'url'));
      const token = cfgStr(config, 'token', 'api_key');
      const user = cfgStr(config, 'username');
      const pass = cfgStr(config, 'password');
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      else if (user && pass) headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
      else return { ok: false, message: 'token or username/password required' };
      return fetchTest(`${base}/services/server/info`, { headers });
    }

    case 'elastic':
    case 'elasticsearch': {
      const base = ensureUrlBase(cfgStr(config, 'url', 'host'));
      if (!base) return { ok: false, message: 'url required' };
      return fetchTest(base, { headers: authHeader(config) });
    }

    case 'wazuh': {
      const base = ensureUrlBase(cfgStr(config, 'url', 'host'));
      const user = cfgStr(config, 'username', 'user');
      const pass = cfgStr(config, 'password');
      if (!base || !user || !pass) return { ok: false, message: 'url, username, password required' };
      return fetchTest(`${base}/security/user/authenticate`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
        },
      });
    }

    case 'sentinel':
    case 'microsoft_sentinel':
    case 'microsoft sentinel':
      return testSentinelConnectivity(config);

    case 'crowdstrike':
    case 'falcon':
    case 'cs':
      return testCrowdStrikeConnectivity(config);

    case 'greynoise':
    case 'gn':
      return testGreyNoiseConnectivity(config);

    case 'shodan':
      return testShodanConnectivity(config);

    case 'teams':
    case 'msteams':
    case 'microsoft_teams':
      return testTeamsConnectivity(config);

    case 'entra_id':
    case 'entra':
    case 'azure_ad':
    case 'entraid':
      return testEntraIdConnectivity(config);

    case 'aws_securityhub':
    case 'securityhub':
    case 'aws_security_hub':
      return testAwsSecurityHubConnectivity(config);

    case 'gcp_scc':
    case 'security_command_center':
      return testGcpSccConnectivity(config);

    case 'msgraph':
    case 'microsoft':
    case 'microsoft_graph': {
      const tenant = cfgStr(config, 'tenant_id', 'tenant');
      const clientId = cfgStr(config, 'client_id', 'app_id');
      const secret = cfgStr(config, 'client_secret', 'secret');
      if (!tenant || !clientId || !secret) return { ok: false, message: 'tenant_id, client_id, client_secret required' };
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: secret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      });
      const { result: res, durationMs } = await timed(() => fetch(
        `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
      ));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: 'MS Graph token request failed', data: json, durationMs };
      return { ok: true, message: 'Microsoft Graph OAuth token acquired', durationMs };
    }

    case 'fortigate':
    case 'fortios': {
      const host = normalizeHost(cfgStr(config, 'host', 'url'));
      const port = Number(config.port) || 443;
      const token = cfgStr(config, 'api_key', 'token');
      if (!host || !token) return { ok: false, message: 'host and api_key required' };
      return fetchTest(buildHttpsUrl(host, port, 'api/v2/monitor/system/status'), {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    case 'opnsense': {
      const base = ensureUrlBase(cfgStr(config, 'url', 'host'));
      const key = cfgStr(config, 'api_key');
      const secret = cfgStr(config, 'api_secret', 'secret');
      if (!base || !key || !secret) return { ok: false, message: 'url, api_key, api_secret required' };
      const auth = Buffer.from(`${key}:${secret}`).toString('base64');
      return fetchTest(`${base}/api/core/system/status`, {
        headers: { Authorization: `Basic ${auth}` },
      });
    }

    case 'pfsense':
    case 'pfsense_plus':
      return testPfSenseConnectivity(config);

    case 'cuckoo':
    case 'cuckoo_sandbox':
      return testCuckooConnectivity(config);

    case 'clamav':
      return testClamAvConnectivity(config);

    case 'arkime':
    case 'moloch':
      return testArkimeConnectivity(config);

    case 'telegram':
    case 'tg':
      return testTelegramConnectivity(config);

    case 'lumisec_platform':
    case 'lumisec_grc':
    case 'lumisec_uctc':
    case 'lumisec_phishing':
    case 'lumisec_network': {
      if (!isPlatformOutboundConfigured()) {
        return {
          ok: false,
          message: 'LUMISEC_PLATFORM_URL not set — point at the full LumiSec monolith (not mini-services).',
        };
      }
      const { result, durationMs } = await timed(() => pingPlatformModules());
      const moduleKey =
        t === 'lumisec_grc' ? 'grc' :
        t === 'lumisec_uctc' ? 'uctc' :
        t === 'lumisec_phishing' ? 'phishing' :
        t === 'lumisec_network' ? 'network' : 'health';
      const mod = result.modules[moduleKey];
      if (t === 'lumisec_platform') {
        if (!result.ok) {
          return { ok: false, message: 'Platform health check failed', data: result.modules, durationMs };
        }
        return { ok: true, message: `LumiSec platform reachable (${result.baseUrl})`, data: result.modules, durationMs };
      }
      if (!mod?.ok) {
        return {
          ok: false,
          message: mod?.message || `Module "${moduleKey}" unreachable on ${result.baseUrl}`,
          data: result.modules,
          durationMs,
        };
      }
      return { ok: true, message: `${moduleKey} module OK on ${result.baseUrl}`, data: result.modules, durationMs };
    }

    case 'digitalocean':
    case 'do': {
      const token = cfgStr(config, 'api_token', 'api_key', 'token');
      if (!token) return { ok: false, message: 'api_token required' };
      return fetchTest('https://api.digitalocean.com/v2/account', {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    case 'defectdojo': {
      const base = cfgStr(config, 'url', 'host').replace(/\/$/, '');
      const token = cfgStr(config, 'api_key', 'token');
      if (!base || !token) return { ok: false, message: 'url and api_key required' };
      return fetchTest(`${base}/api/v2/engagements/?limit=1`, {
        headers: { Authorization: `Token ${token}` },
      });
    }

    case 'velociraptor': {
      const base = cfgStr(config, 'url', 'host').replace(/\/$/, '');
      const user = cfgStr(config, 'username', 'api_user');
      const pass = cfgStr(config, 'password', 'api_password');
      if (!base) return { ok: false, message: 'url required' };
      const { result: res, durationMs } = await timed(() => fetch(`${base}/api/v1/GetClientMetadata`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user && pass ? { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` } : {}),
        },
        body: JSON.stringify({ client_id: 'C.0000000000000000' }),
      }));
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `Velociraptor auth failed (${res.status})`, durationMs };
      }
      return { ok: true, message: `Velociraptor API reachable (${res.status})`, durationMs };
    }

    case 'webhook':
    case 'http':
    case 'api': {
      const url = cfgStr(config, 'url', 'webhook_url', 'endpoint');
      if (!url) return { ok: false, message: 'url required' };
      const method = (cfgStr(config, 'method') || 'HEAD').toUpperCase();
      return fetchTest(url, { method, headers: authHeader(config) });
    }

    default:
      return { ok: false, message: `No connectivity test implemented for type "${type}"` };
  }
}
