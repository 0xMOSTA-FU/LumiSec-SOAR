/**
 * Parse workflow node outputs into committee-friendly enrichment snapshot.
 */
export interface EnrichmentSnapshot {
  virustotal?: {
    ok: boolean;
    malicious: number;
    suspicious: number;
    harmless: number;
    undetected: number;
    total: number;
    score: number;
    is_malicious: boolean;
    reputation?: number;
    country?: string;
    as_owner?: string;
    ioc?: string;
    skipped?: boolean;
    error?: string;
  };
  ipinfo?: {
    ok: boolean;
    ip?: string;
    country?: string;
    city?: string;
    region?: string;
    org?: string;
    asn?: string;
    timezone?: string;
    skipped?: boolean;
    error?: string;
  };
  abuseipdb?: {
    ok: boolean;
    abuse_score?: number;
    total_reports?: number;
    country?: string;
    isp?: string;
    is_malicious?: boolean;
    ip?: string;
    skipped?: boolean;
    error?: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseVirustotalBlock(vt: Record<string, unknown>): EnrichmentSnapshot['virustotal'] {
  const malicious = num(vt.malicious ?? vt.detections);
  const suspicious = num(vt.suspicious);
  const harmless = num(vt.harmless);
  const undetected = num(vt.undetected);
  const total = num(vt.total ?? vt.total_engines, malicious + suspicious + harmless + undetected);
  const score = num(vt.score, total > 0 ? Math.round((malicious / total) * 100) : 0);

  return {
    ok: Boolean(vt.ok),
    malicious,
    suspicious,
    harmless,
    undetected,
    total,
    score,
    is_malicious: Boolean(vt.is_malicious ?? malicious >= 3),
    reputation: vt.reputation as number | undefined,
    country: vt.country as string | undefined,
    as_owner: vt.as_owner as string | undefined,
    ioc: vt.ioc as string | undefined,
    skipped: Boolean(vt.skipped),
    error: vt.error as string | undefined,
  };
}

function parseVirustotalFromNode(o: Record<string, unknown>): EnrichmentSnapshot['virustotal'] | undefined {
  const nested = asRecord(o.virustotal);
  if (nested) return parseVirustotalBlock(nested);

  if (
    o.ioc_type != null ||
    o.detections != null ||
    o.total_engines != null ||
    (o.ok !== undefined && o.score !== undefined)
  ) {
    return parseVirustotalBlock(o);
  }

  return undefined;
}

function parseIpinfoFromNode(o: Record<string, unknown>): EnrichmentSnapshot['ipinfo'] | undefined {
  const nested = asRecord(o.ipinfo);
  if (nested) {
    return {
      ok: Boolean(nested.ok),
      ip: nested.ip as string | undefined,
      country: nested.country as string | undefined,
      city: nested.city as string | undefined,
      region: nested.region as string | undefined,
      org: nested.org as string | undefined,
      asn: (nested.asn as string) || (nested.asn_name as string),
      timezone: nested.timezone as string | undefined,
      skipped: Boolean(nested.skipped),
      error: nested.error as string | undefined,
    };
  }

  if (o.ip != null && (o.country != null || o.org != null || o.city != null)) {
    return {
      ok: Boolean(o.ok ?? true),
      ip: o.ip as string | undefined,
      country: o.country as string | undefined,
      city: o.city as string | undefined,
      region: o.region as string | undefined,
      org: o.org as string | undefined,
      asn: (o.asn as string) || (o.asn_name as string),
      timezone: o.timezone as string | undefined,
      skipped: Boolean(o.skipped),
      error: o.error as string | undefined,
    };
  }

  return undefined;
}

function parseAbuseipdbFromNode(o: Record<string, unknown>): EnrichmentSnapshot['abuseipdb'] | undefined {
  const nested = asRecord(o.abuseipdb);
  if (nested) {
    return {
      ok: Boolean(nested.ok),
      abuse_score: nested.abuse_score as number | undefined,
      total_reports: nested.total_reports as number | undefined,
      country: nested.country as string | undefined,
      isp: nested.isp as string | undefined,
      is_malicious: nested.is_malicious as boolean | undefined,
      ip: nested.ip as string | undefined,
      skipped: Boolean(nested.skipped),
      error: nested.error as string | undefined,
    };
  }

  if (o.abuse_score != null || o.total_reports != null) {
    return {
      ok: Boolean(o.ok),
      abuse_score: o.abuse_score as number | undefined,
      total_reports: o.total_reports as number | undefined,
      country: o.country as string | undefined,
      isp: o.isp as string | undefined,
      is_malicious: o.is_malicious as boolean | undefined,
      ip: o.ip as string | undefined,
      skipped: Boolean(o.skipped),
      error: o.error as string | undefined,
    };
  }

  return undefined;
}

/** Prefer later nodes when multiple enrichment sources ran (e.g. parallel branches). */
function mergeEnrichment(
  current: EnrichmentSnapshot,
  next: EnrichmentSnapshot,
): EnrichmentSnapshot {
  return {
    virustotal: next.virustotal?.ok ? next.virustotal : current.virustotal ?? next.virustotal,
    ipinfo: next.ipinfo?.ok ? next.ipinfo : current.ipinfo ?? next.ipinfo,
    abuseipdb: next.abuseipdb?.ok ? next.abuseipdb : current.abuseipdb ?? next.abuseipdb,
  };
}

export function extractEnrichmentFromOutputs(
  outputs: Record<string, unknown>,
): EnrichmentSnapshot {
  let enrichment: EnrichmentSnapshot = {};

  for (const nodeOutput of Object.values(outputs)) {
    const o = asRecord(nodeOutput);
    if (!o) continue;

    const partial: EnrichmentSnapshot = {};
    const vt = parseVirustotalFromNode(o);
    if (vt) partial.virustotal = vt;

    const ip = parseIpinfoFromNode(o);
    if (ip) partial.ipinfo = ip;

    const abuse = parseAbuseipdbFromNode(o);
    if (abuse) partial.abuseipdb = abuse;

    enrichment = mergeEnrichment(enrichment, partial);
  }

  return enrichment;
}

export function extractDisplayIp(
  outputs: Record<string, unknown>,
  trigger?: Record<string, unknown>,
): string | null {
  const fromTrigger = trigger?.ip || trigger?.source_ip;
  if (typeof fromTrigger === 'string' && fromTrigger.trim()) {
    return fromTrigger.trim();
  }

  for (const nodeOutput of Object.values(outputs)) {
    const o = asRecord(nodeOutput);
    if (!o) continue;

    const vt = asRecord(o.virustotal);
    if (vt?.ioc && typeof vt.ioc === 'string') return vt.ioc;

    if (o.ioc && typeof o.ioc === 'string') return o.ioc;

    const ipinfo = asRecord(o.ipinfo);
    if (ipinfo?.ip && typeof ipinfo.ip === 'string') return ipinfo.ip;

    const abuse = asRecord(o.abuseipdb);
    if (abuse?.ip && typeof abuse.ip === 'string') return abuse.ip;
  }

  return null;
}
