import { apiClient } from '@/lib/lumisec-api/browser/api-client';
import { enrichArtifact as enrichSoarArtifact } from '@/lib/lumisec-api/browser/soarArtifacts';
import {
  asArray,
  extractPagination,
  unwrapData,
  type ApiEnvelope,
  type PaginatedResult,
  type PaginationMeta,
} from '@/lib/lumisec-api/browser/envelope';

const INCIDENT_LIST_KEYS = [
  'items',
  'incidents',
  'results',
  'data',
  'notes',
  'artifacts',
  'timeline',
  'related',
  'events',
];

export interface SoarIncident {
  id: string;
  title: string;
  description?: string;
  severity: string;
  status: string;
  assigned_to: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface IncidentFilters {
  status?: string;
  severity?: string;
  assigned_to?: string;
  date_from?: string;
  date_to?: string;
}

export interface CreateIncidentInput {
  title: string;
  description?: string;
  severity: string;
  assigned_to?: string | null;
  source?: string | null;
  source_alert_id?: string;
}

function normalizeIncident(raw: Record<string, unknown>): SoarIncident {
  const merged = raw;
  const assigned =
    merged.assigned_to ??
    merged.assignee ??
    merged.assignedTo ??
    merged.owner ??
    null;

  const source =
    merged.source ??
    merged.source_type ??
    merged.sourceType ??
    merged.origin ??
    null;

  const created =
    merged.created_at ?? merged.createdAt ?? merged.created ?? '';
  const updated =
    merged.updated_at ?? merged.updatedAt ?? merged.updated ?? created;

  return {
    ...merged,
    id: String(merged.id ?? merged._id ?? ''),
    title: String(merged.title ?? ''),
    description: merged.description ? String(merged.description) : undefined,
    severity: String(merged.severity ?? 'medium'),
    status: String(merged.status ?? 'open'),
    assigned_to: assigned ? String(assigned) : null,
    source: source ? String(source) : null,
    created_at: String(created),
    updated_at: String(updated),
  };
}

function buildQueryString(
  page: number,
  limit: number,
  filters?: IncidentFilters,
): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));

  if (filters?.status) params.set('status', filters.status);
  if (filters?.severity) params.set('severity', filters.severity);
  if (filters?.assigned_to) params.set('assigned_to', filters.assigned_to);
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);

  return params.toString();
}

export async function fetchIncidents(
  page = 1,
  limit = 20,
  filters?: IncidentFilters,
): Promise<PaginatedResult<SoarIncident>> {
  const query = buildQueryString(page, limit, filters);
  const response = await apiClient.get<ApiEnvelope<unknown>>(`/api/soar/incidents?${query}`);
  const data = unwrapData<unknown>(response);
  const items = asArray<Record<string, unknown>>(data, INCIDENT_LIST_KEYS).map(normalizeIncident);
  const pagination = extractPagination(data, { page, limit, itemCount: items.length });
  return { items, pagination };
}

export async function fetchIncidentById(id: string): Promise<SoarIncident> {
  const response = await apiClient.get<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}`,
  );
  const data = unwrapData(response);
  return normalizeIncident(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function createIncident(input: CreateIncidentInput): Promise<SoarIncident> {
  const body: Record<string, unknown> = {
    title: input.title,
    severity: input.severity,
  };
  if (input.description) body.description = input.description;
  if (input.assigned_to) body.assigned_to = input.assigned_to;
  if (input.source) body.source = input.source;
  if (input.source_alert_id) body.source_alert_id = input.source_alert_id;

  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    '/api/soar/incidents',
    body,
  );
  const data = unwrapData(response);
  return normalizeIncident(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export interface UpdateIncidentInput {
  status?: string;
  severity?: string;
  assigned_to?: string | null;
  title?: string;
  description?: string;
}

export interface TimelineEvent {
  id: string;
  type: string;
  description: string;
  actor: string;
  timestamp: string;
}

export interface IncidentNote {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface IncidentArtifact {
  id: string;
  type: string;
  value: string;
  tlp: string;
  enriched: boolean;
  created_at: string;
}

export interface RelatedIncident {
  id: string;
  title: string;
  severity: string;
  status: string;
}

export interface CreateArtifactInput {
  type: string;
  value: string;
  description?: string;
}

function recordId(raw: Record<string, unknown>): string {
  return String(raw.id ?? raw._id ?? '');
}

function normalizeTimelineEvent(raw: Record<string, unknown>): TimelineEvent {
  return {
    id: recordId(raw) || `${raw.timestamp ?? raw.created_at ?? Math.random()}`,
    type: String(raw.type ?? raw.event_type ?? raw.eventType ?? 'event'),
    description: String(
      raw.description ?? raw.message ?? raw.event ?? raw.content ?? raw.action ?? '',
    ),
    actor: String(raw.actor ?? raw.user ?? raw.author ?? raw.actor_name ?? 'System'),
    timestamp: String(
      raw.timestamp ?? raw.created_at ?? raw.createdAt ?? raw.time ?? '',
    ),
  };
}

function normalizeNote(raw: Record<string, unknown>): IncidentNote {
  return {
    id: recordId(raw) || String(raw.created_at ?? Math.random()),
    author: String(raw.author ?? raw.user ?? raw.created_by ?? raw.createdBy ?? 'Unknown'),
    body: String(raw.body ?? raw.content ?? raw.note ?? raw.text ?? ''),
    created_at: String(raw.created_at ?? raw.createdAt ?? raw.timestamp ?? ''),
  };
}

function normalizeArtifact(raw: Record<string, unknown>): IncidentArtifact {
  const enriched = raw.enriched ?? raw.is_enriched ?? raw.isEnriched;
  return {
    id: recordId(raw),
    type: String(raw.type ?? ''),
    value: String(raw.value ?? ''),
    tlp: String(raw.tlp ?? raw.TLP ?? 'clear'),
    enriched: enriched === true || enriched === 'true' || enriched === 1,
    created_at: String(raw.created_at ?? raw.createdAt ?? ''),
  };
}

function normalizeRelatedIncident(raw: Record<string, unknown>): RelatedIncident {
  return {
    id: recordId(raw),
    title: String(raw.title ?? 'Untitled'),
    severity: String(raw.severity ?? 'medium'),
    status: String(raw.status ?? 'open'),
  };
}

export async function updateIncident(
  id: string,
  changes: UpdateIncidentInput,
): Promise<SoarIncident> {
  const response = await apiClient.patch<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}`,
    changes,
  );
  const data = unwrapData(response);
  return normalizeIncident(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function closeIncident(id: string): Promise<SoarIncident> {
  const response = await apiClient.patch<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}/close`,
    {},
  );
  const data = unwrapData(response);
  return normalizeIncident(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function deleteIncident(id: string): Promise<void> {
  await apiClient.delete(`/api/soar/incidents/${encodeURIComponent(id)}`);
}

export async function fetchIncidentTimeline(id: string): Promise<TimelineEvent[]> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}/timeline`,
  );
  const data = unwrapData<unknown>(response);
  return asArray<Record<string, unknown>>(data, INCIDENT_LIST_KEYS)
    .map(normalizeTimelineEvent)
    .sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
}

export async function fetchIncidentNotes(id: string): Promise<IncidentNote[]> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}/notes`,
  );
  const data = unwrapData<unknown>(response);
  return asArray<Record<string, unknown>>(data, INCIDENT_LIST_KEYS).map(normalizeNote);
}

export async function addIncidentNote(id: string, content: string): Promise<IncidentNote> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}/notes`,
    { content },
  );
  const data = unwrapData(response);
  return normalizeNote(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : { content },
  );
}

export async function fetchIncidentArtifacts(id: string): Promise<IncidentArtifact[]> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}/artifacts`,
  );
  const data = unwrapData<unknown>(response);
  return asArray<Record<string, unknown>>(data, INCIDENT_LIST_KEYS).map(normalizeArtifact);
}

export async function addIncidentArtifact(
  id: string,
  input: CreateArtifactInput,
): Promise<IncidentArtifact> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}/artifacts`,
    input,
  );
  const data = unwrapData(response);
  return normalizeArtifact(
    data && typeof data === 'object'
      ? (data as Record<string, unknown>)
      : ({ ...input } as Record<string, unknown>),
  );
}

export async function enrichIncidentArtifact(artifactId: string): Promise<IncidentArtifact> {
  const artifact = await enrichSoarArtifact(artifactId);
  return {
    id: artifact.id,
    type: artifact.type,
    value: artifact.value,
    tlp: artifact.tlp,
    enriched: artifact.enriched,
    created_at: artifact.created_at,
  };
}

export async function fetchRelatedIncidents(id: string): Promise<RelatedIncident[]> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}/related`,
  );
  const data = unwrapData<unknown>(response);
  return asArray<Record<string, unknown>>(data, INCIDENT_LIST_KEYS).map(normalizeRelatedIncident);
}

export async function linkRelatedIncident(
  id: string,
  relatedIncidentId: string,
): Promise<RelatedIncident> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}/related`,
    { related_incident_id: relatedIncidentId },
  );
  const data = unwrapData(response);
  return normalizeRelatedIncident(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : { id: relatedIncidentId },
  );
}

export interface RecommendedResponseAction {
  id: string;
  label: string;
  description: string;
  category: string;
  destructive: boolean;
  available: boolean;
  unavailableReason?: string;
  requiresIntegrations: string[];
  score: number;
}

export interface IncidentSummary {
  incident: Record<string, unknown>;
  parsedContext?: Record<string, unknown>;
  artifacts?: IncidentArtifact[];
  timeline?: TimelineEvent[];
  linkedAlerts?: Array<{ id?: string; title: string; source?: string; severity?: string }>;
  relatedIncidents?: RelatedIncident[];
  recommendations?: RecommendedResponseAction[];
  connectedIntegrations?: Record<string, unknown>;
}

function normalizeRecommendation(raw: Record<string, unknown>): RecommendedResponseAction {
  return {
    id: String(raw.id ?? ''),
    label: String(raw.label ?? raw.name ?? 'Action'),
    description: String(raw.description ?? ''),
    category: String(raw.category ?? 'investigate'),
    destructive: raw.destructive === true,
    available: raw.available !== false,
    unavailableReason: raw.unavailableReason ? String(raw.unavailableReason) : undefined,
    requiresIntegrations: Array.isArray(raw.requiresIntegrations)
      ? (raw.requiresIntegrations as string[])
      : [],
    score: Number(raw.score ?? 0),
  };
}

export async function fetchIncidentSummary(id: string): Promise<IncidentSummary> {
  const response = await apiClient.get<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}/summary`,
  );
  const data = unwrapData(response);
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    incident: (record.incident as Record<string, unknown>) || record,
    parsedContext: record.parsedContext as Record<string, unknown> | undefined,
    artifacts: asArray<Record<string, unknown>>(record.artifacts).map(normalizeArtifact),
    timeline: asArray<Record<string, unknown>>(record.timeline).map(normalizeTimelineEvent),
    linkedAlerts: asArray<Record<string, unknown>>(record.linkedAlerts).map((a) => ({
      id: recordId(a),
      title: String(a.title ?? ''),
      source: a.source ? String(a.source) : undefined,
      severity: a.severity ? String(a.severity) : undefined,
    })),
    relatedIncidents: asArray<Record<string, unknown>>(record.relatedIncidents).map(
      normalizeRelatedIncident,
    ),
    recommendations: asArray<Record<string, unknown>>(record.recommendations).map(
      normalizeRecommendation,
    ),
    connectedIntegrations: record.connectedIntegrations as Record<string, unknown> | undefined,
  };
}

export async function fetchRecommendations(id: string): Promise<{
  recommendations: RecommendedResponseAction[];
  connectedIntegrations?: Record<string, unknown>;
}> {
  const response = await apiClient.get<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/incidents/${encodeURIComponent(id)}/recommendations`,
  );
  const data = unwrapData(response);
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    recommendations: asArray<Record<string, unknown>>(record.recommendations ?? data).map(
      normalizeRecommendation,
    ),
    connectedIntegrations: record.connectedIntegrations as Record<string, unknown> | undefined,
  };
}

export interface RespondResult {
  ok: boolean;
  message: string;
  statusUpdated?: string;
  actionId?: string;
}

export async function respondToIncident(
  id: string,
  actionId: string,
  params?: Record<string, unknown>,
): Promise<RespondResult> {
  const response = await apiClient.post<ApiEnvelope<RespondResult> | RespondResult>(
    `/api/soar/incidents/${encodeURIComponent(id)}/respond`,
    { actionId, params },
  );
  const data = unwrapData(response);
  if (data && typeof data === 'object') {
    const record = data as unknown as Record<string, unknown>;
    return {
      ok: record.ok !== false,
      message: String(record.message ?? record.error ?? (record.ok !== false ? 'Done' : 'Failed')),
      statusUpdated: record.statusUpdated ? String(record.statusUpdated) : undefined,
      actionId: record.actionId ? String(record.actionId) : actionId,
    };
  }
  return { ok: false, message: 'Unexpected response from server', actionId };
}
