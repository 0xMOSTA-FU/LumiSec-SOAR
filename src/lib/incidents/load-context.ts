import { db } from '@/lib/db';
import { buildIncidentContext } from './parse-context';
import type { IncidentContext, IncidentKind } from './types';

function parseJson<T>(val: string | null | undefined, fallback: T): T {
  try {
    return JSON.parse(val || JSON.stringify(fallback)) as T;
  } catch {
    return fallback;
  }
}

function recordToObject(kind: IncidentKind, row: Record<string, unknown>) {
  const iocs = kind === 'alert' ? parseJson<{ type: string; value: string }[]>(row.iocs as string, []) : [];
  const artifacts = kind === 'case'
    ? parseJson(row.artifacts as string, [])
    : iocs.map(ioc => ({ type: ioc.type, value: ioc.value }));
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    source: kind === 'alert' ? row.source : row.source || 'case',
    tags: parseJson(row.tags as string, []),
    artifacts,
    timeline: parseJson(row.timeline as string, []),
    raw: kind === 'alert' ? parseJson(row.raw as string, {}) : {},
    caseId: row.caseId,
    createdAt: row.createdAt,
  };
}

function mergeContexts(base: IncidentContext, extra: IncidentContext): IncidentContext {
  const key = (a: { type: string; value: string }) => `${a.type}:${a.value.toLowerCase()}`;
  const seen = new Set(base.artifacts.map(key));
  const artifacts = [...base.artifacts];
  for (const a of extra.artifacts) {
    const k = key(a);
    if (!seen.has(k)) {
      seen.add(k);
      artifacts.push(a);
    }
  }
  const uniq = (arr: string[]) => [...new Set(arr)];
  return {
    ...base,
    tags: uniq([...base.tags, ...extra.tags]),
    artifacts,
    ips: uniq([...base.ips, ...extra.ips]),
    hostnames: uniq([...base.hostnames, ...extra.hostnames]),
    hashes: uniq([...base.hashes, ...extra.hashes]),
    domains: uniq([...base.domains, ...extra.domains]),
    users: uniq([...base.users, ...extra.users]),
    emails: uniq([...base.emails, ...extra.emails]),
    raw: { ...base.raw, ...extra.raw },
  };
}

export async function loadFullIncidentContext(
  id: string,
  tenantWhere: Record<string, unknown> = {},
): Promise<IncidentContext | null> {
  let kind: IncidentKind = 'case';
  let row = await db.case.findFirst({ where: { id, ...tenantWhere } }) as Record<string, unknown> | null;
  if (!row) {
    row = await db.alert.findFirst({ where: { id, ...tenantWhere } }) as Record<string, unknown> | null;
    kind = 'alert';
  }
  if (!row) return null;

  let context = buildIncidentContext(kind, recordToObject(kind, row));

  if (kind === 'case') {
    const linkedAlerts = await db.alert.findMany({
      where: { caseId: id, ...tenantWhere },
      select: { id: true, title: true, source: true, severity: true, description: true, raw: true, iocs: true },
    });
    for (const alert of linkedAlerts) {
      const alertCtx = buildIncidentContext('alert', recordToObject('alert', {
        ...alert,
        status: 'new',
        tags: '[]',
      }));
      context = mergeContexts(context, alertCtx);
    }
  } else if (row.caseId) {
    const parent = await db.case.findFirst({ where: { id: String(row.caseId), ...tenantWhere } });
    if (parent) {
      const caseCtx = buildIncidentContext('case', recordToObject('case', parent as Record<string, unknown>));
      context = mergeContexts(caseCtx, context);
    }
  }

  return context;
}
