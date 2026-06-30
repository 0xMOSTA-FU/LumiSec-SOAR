import { apiClient } from '@/lib/lumisec-api/browser/api-client';
import {
  toPaginatedResult,
  unwrapData,
  type ApiEnvelope,
  type PaginatedResult,
  type PaginationMeta,
} from '@/lib/lumisec-api/browser/envelope';

export interface SoarAlert {
  id: string;
  title: string;
  severity: string;
  source: string | null;
  status: string;
  created_at: string;
}

export interface RelatedIncidentRef {
  id: string;
  title: string;
  severity?: string;
  status?: string;
}

export interface SoarAlertDetail extends SoarAlert {
  description: string | null;
  raw_event: unknown;
  rule_name: string | null;
  matched_at: string | null;
  related_incidents: RelatedIncidentRef[];
  raw: Record<string, unknown>;
}

export interface AlertFilters {
  page?: number;
  limit?: number;
}

const ALERT_LIST_KEYS = ['items', 'alerts', 'results', 'data'];

function parseRelatedIncidents(raw: Record<string, unknown>): RelatedIncidentRef[] {
  for (const key of ['related_incidents', 'relatedIncidents', 'incidents', 'linked_incidents']) {
    const value = raw[key];
    if (!Array.isArray(value)) continue;
    return value
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const record = item as Record<string, unknown>;
        return {
          id: String(record.id ?? record._id ?? record.incident_id ?? record.incidentId ?? ''),
          title: String(record.title ?? record.name ?? 'Untitled incident'),
          severity: record.severity ? String(record.severity) : undefined,
          status: record.status ? String(record.status) : undefined,
        };
      })
      .filter((item) => item.id);
  }
  return [];
}

function parseRawEvent(raw: Record<string, unknown>): unknown {
  for (const key of ['raw_event', 'rawEvent', 'raw', 'event', 'payload', 'details']) {
    if (raw[key] !== undefined && raw[key] !== null) {
      return raw[key];
    }
  }
  return null;
}

export function normalizeAlert(raw: Record<string, unknown>): SoarAlert {
  return {
    id: String(raw.id ?? raw._id ?? raw.alert_id ?? raw.alertId ?? ''),
    title: String(raw.title ?? raw.name ?? 'Untitled alert'),
    severity: String(raw.severity ?? 'medium'),
    source: raw.source ? String(raw.source) : null,
    status: String(raw.status ?? 'new'),
    created_at: String(
      raw.created_at ?? raw.createdAt ?? raw.timestamp ?? raw.matched_at ?? raw.matchedAt ?? '',
    ),
  };
}

export function normalizeAlertDetail(raw: Record<string, unknown>): SoarAlertDetail {
  const merged = raw;
  const base = normalizeAlert(merged);
  const ruleName = merged.rule_name ?? merged.ruleName ?? merged.rule ?? null;
  const matchedAt = merged.matched_at ?? merged.matchedAt ?? null;

  return {
    ...base,
    description:
      merged.description !== undefined && merged.description !== null
        ? String(merged.description)
        : null,
    raw_event: parseRawEvent(merged),
    rule_name: ruleName ? String(ruleName) : null,
    matched_at: matchedAt ? String(matchedAt) : null,
    related_incidents: parseRelatedIncidents(merged),
    raw: merged,
  };
}

export async function fetchAlerts(
  filters: AlertFilters = {},
): Promise<PaginatedResult<SoarAlert>> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/alerts?page=${page}&limit=${limit}`,
  );
  const result = toPaginatedResult<Record<string, unknown>>(response, page, limit, ALERT_LIST_KEYS);
  return {
    items: result.items.map(normalizeAlert),
    pagination: result.pagination,
  };
}

export async function fetchAlertById(id: string): Promise<SoarAlertDetail> {
  const response = await apiClient.get<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/alerts/${encodeURIComponent(id)}`,
  );
  const data = unwrapData(response);
  return normalizeAlertDetail(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export function getAlertIds(alerts: SoarAlert[]): Set<string> {
  return new Set(alerts.map((alert) => alert.id));
}

export function hasNewAlerts(currentIds: Set<string>, polled: SoarAlert[]): boolean {
  return polled.some((alert) => alert.id && !currentIds.has(alert.id));
}

export async function escalateAlert(
  id: string,
  body: { title?: string; severity?: string; assigned_to?: string } = {},
): Promise<{ incident: { id: string }; deduplicated?: boolean }> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>>>(
    `/api/soar/alerts/${encodeURIComponent(id)}/escalate`,
    body,
  );
  const data = unwrapData(response) as Record<string, unknown>;
  const incident = (data.incident || {}) as Record<string, unknown>;
  return {
    incident: { id: String(incident.id ?? '') },
    deduplicated: Boolean(data.deduplicated),
  };
}

export async function bulkAlertsAction(body: {
  ids: string[];
  action: 'escalate' | 'dismiss' | 'assign';
  assigned_to?: string;
}): Promise<{ processed: number; errors: string[] }> {
  const response = await apiClient.post<ApiEnvelope<{ processed: number; errors: string[] }>>(
    '/api/soar/alerts/bulk',
    body,
  );
  const data = unwrapData(response) as { processed: number; errors: string[] };
  return { processed: data.processed ?? 0, errors: data.errors ?? [] };
}
