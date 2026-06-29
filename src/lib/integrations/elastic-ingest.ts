/**
 * Ingest Elasticsearch / Elastic Security alerts into SOAR.
 */
import { db } from '@/lib/db';
import { decryptIntegrationConfig } from '@/lib/integrations/config-secrets';
import { parseElasticCreds, searchElasticSecurityAlerts, type ElasticSearchHit } from '@/lib/integrations/elastic-client';
import { ingestAlertRecord } from '@/lib/soar/alerts/upsert-alert';

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export function normalizeElasticHitToAlert(
  hit: ElasticSearchHit | Record<string, unknown>,
): Record<string, unknown> {
  const h = hit as ElasticSearchHit;
  const source = (h._source || hit) as Record<string, unknown>;
  const rule = (source['kibana.alert.rule'] || source.rule || {}) as Record<string, unknown>;
  const title =
    pickString(source, 'kibana.alert.rule.name', 'rule.name', 'message', 'event.action') ||
    pickString(rule as Record<string, unknown>, 'name') ||
    'Elastic security alert';
  const severity =
    pickString(source, 'kibana.alert.severity', 'event.severity', 'severity') || 'medium';
  const description =
    pickString(source, 'kibana.alert.reason', 'message', 'event.reason') || title;
  const sourceId = h._id || pickString(source, 'kibana.alert.uuid', 'event.id', '_id');
  const ips: string[] = [];
  const srcIp = source.source || source['source.ip'];
  if (typeof srcIp === 'string') ips.push(srcIp);
  if (Array.isArray(source.related)) {
    for (const r of source.related) {
      if (typeof r === 'string' && /^\d{1,3}\./.test(r)) ips.push(r);
    }
  }

  return {
    title,
    description,
    severity: String(severity).toLowerCase(),
    source: 'elastic',
    sourceId,
    sourceModule: 'elastic',
    dedupKey: sourceId ? `elastic:${sourceId}` : undefined,
    iocs: ips.map((ip) => ({ type: 'ip', value: ip })),
    raw: { _id: h._id, _index: h._index, ...source },
  };
}

export async function ingestElasticEvent(
  payload: Record<string, unknown>,
  tenantWhere: Record<string, unknown>,
): Promise<{ alert_id: string; created: boolean; deduplicated: boolean }> {
  const tenantId = (tenantWhere.tenantId as string | null | undefined) ?? null;
  const kibana = payload.kibana;
  const hasElasticShape =
    Boolean(payload._source) ||
    (kibana !== null && typeof kibana === 'object' && 'alert' in kibana);
  const normalized = hasElasticShape
    ? normalizeElasticHitToAlert(payload as unknown as ElasticSearchHit)
    : {
          title: String(payload.title || payload.message || 'Elastic event'),
          description: String(payload.description || payload.message || ''),
          severity: String(payload.severity || 'medium'),
          source: 'elastic',
          sourceId: payload.id ? String(payload.id) : undefined,
          raw: payload,
        };

  const ingested = await ingestAlertRecord({
    payload: normalized,
    tenantId,
    source: 'elastic',
  });
  return {
    alert_id: ingested.alert.id,
    created: ingested.created,
    deduplicated: ingested.deduplicated,
  };
}

export async function pollElasticIntegrations(
  tenantWhere: Record<string, unknown>,
  options: { minutes?: number; limit?: number } = {},
): Promise<{
  ok: boolean;
  polled: number;
  ingested: number;
  deduplicated: number;
  errors: string[];
}> {
  const integrations = await db.integration.findMany({
    where: {
      ...tenantWhere,
      type: { in: ['elastic', 'elasticsearch', 'es'] },
      status: 'connected',
    },
  });

  if (!integrations.length) {
    return { ok: false, polled: 0, ingested: 0, deduplicated: 0, errors: ['No connected Elasticsearch integration'] };
  }

  const minutes = options.minutes ?? 60;
  const gte = new Date(Date.now() - minutes * 60_000).toISOString();
  let ingested = 0;
  let deduplicated = 0;
  const errors: string[] = [];

  for (const row of integrations) {
    const config = decryptIntegrationConfig(row.config) as Record<string, unknown>;
    const creds = parseElasticCreds(config);
    if (!creds) {
      errors.push(`${row.name}: missing Elasticsearch URL`);
      continue;
    }
    const index = String(config.alerts_index || config.alertsIndex || '.alerts-security.alerts-*');
    const search = await searchElasticSecurityAlerts(creds, {
      index,
      gte,
      size: options.limit ?? 100,
      query: '*',
    });
    if (!search.ok) {
      errors.push(`${row.name}: ${search.message}`);
      continue;
    }
    for (const hit of search.hits) {
      const result = await ingestElasticEvent(
        { _id: hit._id, _index: hit._index, _source: hit._source },
        tenantWhere,
      );
      if (result.deduplicated) deduplicated += 1;
      else ingested += 1;
    }
  }

  return {
    ok: errors.length === 0 || ingested > 0,
    polled: integrations.length,
    ingested,
    deduplicated,
    errors,
  };
}
