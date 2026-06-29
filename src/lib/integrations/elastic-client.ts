/**
 * Shared Elasticsearch HTTP helpers for workflows and SIEM ingest.
 */
export interface ElasticCreds {
  url: string;
  username: string;
  password: string;
  api_key: string;
}

export function parseElasticCreds(config: Record<string, unknown>): ElasticCreds | null {
  const url = String(config.url || config.host || '').replace(/\/$/, '');
  if (!url) return null;
  return {
    url,
    username: String(config.username || config.user || ''),
    password: String(config.password || ''),
    api_key: String(config.api_key || config.apiKey || ''),
  };
}

export function elasticAuthHeaders(creds: ElasticCreds): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (creds.api_key) headers.Authorization = `ApiKey ${creds.api_key}`;
  else if (creds.username && creds.password) {
    headers.Authorization = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
  }
  return headers;
}

export interface ElasticSearchHit {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
}

export async function searchElasticSecurityAlerts(
  creds: ElasticCreds,
  options: {
    index?: string;
    query?: string;
    size?: number;
    gte?: string;
  } = {},
): Promise<{ ok: boolean; status: number; hits: ElasticSearchHit[]; total: number; message?: string }> {
  const index = options.index || '.alerts-security.alerts-*';
  const size = options.size ?? 50;
  const queryStr = options.query || '*';
  const body: Record<string, unknown> = {
    query: {
      bool: {
        must: [{ query_string: { query: queryStr } }],
      },
    },
    size,
    sort: [{ '@timestamp': { order: 'desc' } }],
  };
  if (options.gte) {
    (body.query as { bool: { filter?: unknown[] } }).bool.filter = [
      { range: { '@timestamp': { gte: options.gte } } },
    ];
  }

  const res = await fetch(`${creds.url}/${encodeURIComponent(index)}/_search`, {
    method: 'POST',
    headers: elasticAuthHeaders(creds),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({})) as {
    hits?: { total?: { value?: number } | number; hits?: ElasticSearchHit[] };
    error?: { reason?: string };
  };
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      hits: [],
      total: 0,
      message: data.error?.reason || `HTTP ${res.status}`,
    };
  }
  const total =
    typeof data.hits?.total === 'number' ? data.hits.total : data.hits?.total?.value || 0;
  return { ok: true, status: res.status, hits: data.hits?.hits || [], total };
}
