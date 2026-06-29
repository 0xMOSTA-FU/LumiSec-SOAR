/**
 * Server-side alert normalization — canonical shape for triage queue.
 * Used by webhooks, SIEM ingest, API POST, and manual creation.
 */
export interface NormalizedAlert {
  title: string;
  description: string;
  source: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  dedupKey: string | null;
  raw: Record<string, unknown>;
  iocs: Array<{ type: string; value: string }>;
  ruleName: string | null;
  externalId: string | null;
}

const SEV_ORDER = ['low', 'medium', 'high', 'critical'] as const;

export function pickHigherSeverity(a: string, b: string): typeof SEV_ORDER[number] {
  const ai = SEV_ORDER.indexOf(a.toLowerCase() as typeof SEV_ORDER[number]);
  const bi = SEV_ORDER.indexOf(b.toLowerCase() as typeof SEV_ORDER[number]);
  const safeA = ai >= 0 ? ai : 1;
  const safeB = bi >= 0 ? bi : 1;
  return SEV_ORDER[Math.max(safeA, safeB)];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function normalizeSeverity(raw: unknown): NormalizedAlert['severity'] {
  const s = String(raw ?? 'medium').toLowerCase();
  if (s.includes('crit') || s === '1' || s === 'p1') return 'critical';
  if (s.includes('high') || s === '2' || s === 'p2') return 'high';
  if (s.includes('low') || s === '4' || s === 'p4' || s === 'info') return 'low';
  return 'medium';
}

function extractIocs(raw: Record<string, unknown>): NormalizedAlert['iocs'] {
  const iocs: NormalizedAlert['iocs'] = [];
  const push = (type: string, value: unknown) => {
    const v = str(value);
    if (v) iocs.push({ type, value: v });
  };

  push('ip', raw.src_ip ?? raw.source_ip ?? raw.ip ?? raw.sourceIp);
  push('ip', raw.dst_ip ?? raw.dest_ip ?? raw.destination_ip);
  push('domain', raw.domain ?? raw.hostname);
  push('hash', raw.file_hash ?? raw.hash ?? raw.sha256);
  push('user', raw.username ?? raw.user ?? raw.user_principal_name);
  push('email', raw.email ?? raw.sender);

  const nested = raw.iocs ?? raw.indicators;
  if (Array.isArray(nested)) {
    for (const item of nested) {
      const row = asRecord(item);
      const type = str(row.type, row.ioc_type, 'unknown');
      const value = str(row.value, row.indicator);
      if (value) iocs.push({ type, value });
    }
  }

  const seen = new Set<string>();
  return iocs.filter(i => {
    const k = `${i.type}:${i.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function buildDedupKey(
  source: string,
  externalId: string | null,
  raw: Record<string, unknown>,
  fallbackTitle: string,
): string | null {
  if (externalId) return `${source}:${externalId}`.toLowerCase();
  const rule = str(raw.rule_id, raw.ruleId, raw.detection_rule, raw.signature_id);
  const ip = str(raw.src_ip, raw.source_ip, raw.ip);
  const hash = str(raw.file_hash, raw.hash, raw.sha256);
  if (rule && ip) return `${source}:rule:${rule}:ip:${ip}`.toLowerCase();
  if (rule && hash) return `${source}:rule:${rule}:hash:${hash}`.toLowerCase();
  if (rule) return `${source}:rule:${rule}`.toLowerCase();
  if (fallbackTitle && source) return `${source}:title:${fallbackTitle.slice(0, 120)}`.toLowerCase();
  return null;
}

/** Normalize inbound payloads from SIEM, EDR, webhooks, or manual API. */
export function normalizeInboundAlert(
  payload: Record<string, unknown>,
  defaults: { source?: string; tenantId?: string | null } = {},
): NormalizedAlert {
  const nested = asRecord(payload.alert ?? payload.event ?? payload.data);
  const merged = { ...nested, ...payload };
  const raw = asRecord(merged.raw_event ?? merged.rawEvent ?? merged.raw ?? merged);

  const title = str(
    merged.title,
    merged.alert_title,
    merged.name,
    merged.subject,
    raw.rule_name,
    raw.detection_rule,
    'Security alert',
  );

  const source = str(merged.source, merged.vendor, merged.siem, defaults.source, 'unknown');
  const externalId = str(
    merged.external_id,
    merged.externalId,
    merged.alert_id,
    merged.alertId,
    merged.event_id,
    merged.id,
  ) || null;

  const severity = normalizeSeverity(merged.severity ?? merged.priority ?? raw.severity);
  const description = str(
    merged.description,
    merged.message,
    merged.summary,
    raw.description,
  );

  const dedupKey =
    str(merged.dedup_key, merged.dedupKey) ||
    buildDedupKey(source, externalId, { ...raw, ...merged }, title);

  return {
    title,
    description,
    source,
    severity,
    status: str(merged.status, 'new'),
    dedupKey: dedupKey || null,
    raw: { ...raw, ...merged, _normalized_at: new Date().toISOString() },
    iocs: extractIocs({ ...raw, ...merged }),
    ruleName: str(merged.rule_name, merged.ruleName, raw.rule_name, raw.detection_rule) || null,
    externalId,
  };
}
