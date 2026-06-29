/**
 * Shared Azure AD client-credentials token for Microsoft Graph / Entra ID.
 */
import type { IntegrationConfig } from '../types';

export interface AzureAppCreds {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export function parseAzureAppCreds(integration: IntegrationConfig | null): AzureAppCreds | null {
  const c = integration?.config || {};
  const tenantId = String(c.tenant_id || c.tenantId || '');
  const clientId = String(c.client_id || c.clientId || '');
  const clientSecret = String(c.client_secret || c.clientSecret || '');
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

export function parseAzureAppCredsFromConfig(config: Record<string, unknown>): AzureAppCreds | null {
  return parseAzureAppCreds({
    id: 'test',
    name: 'azure',
    type: 'entra_id',
    category: 'cloud_iam',
    config,
    status: 'connected',
  });
}

export async function getGraphAccessToken(
  creds: AzureAppCreds,
): Promise<{ token: string | null; error?: string }> {
  try {
    const res = await fetch(`https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
      cache: 'no-store',
    });
    const data = await res.json() as { access_token?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      return { token: null, error: data.error_description || `HTTP ${res.status}` };
    }
    return { token: data.access_token };
  } catch (err) {
    return { token: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function testGraphConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const creds = parseAzureAppCredsFromConfig(config);
  if (!creds) return { ok: false, message: 'tenant_id, client_id, client_secret required' };
  const start = Date.now();
  const { token, error } = await getGraphAccessToken(creds);
  if (!token) return { ok: false, message: error || 'OAuth failed', durationMs: Date.now() - start };
  const res = await fetch('https://graph.microsoft.com/v1.0/users?$top=1&$select=id,displayName', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, message: `Graph API ${res.status}: ${body.slice(0, 150)}`, durationMs: Date.now() - start };
  }
  return { ok: true, message: 'Microsoft Graph / Entra ID connected', durationMs: Date.now() - start };
}
