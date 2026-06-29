import { apiClient, ApiError } from '@/lib/lumisec-api/browser/api-client';
import {
  asArray,
  extractPagination,
  unwrapData,
  type ApiEnvelope,
  type PaginatedResult,
  type PaginationMeta,
} from '@/lib/lumisec-api/browser/envelope';

const ARTIFACT_LIST_KEYS = ['items', 'artifacts', 'results', 'data'];

export interface SoarArtifact {
  id: string;
  type: string;
  value: string;
  tlp: string;
  enriched: boolean;
  source_incident: string | null;
  source_incident_title: string | null;
  created_at: string;
  description: string | null;
  enrichment: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface UpdateArtifactInput {
  type?: string;
  value?: string;
  tlp?: string;
  description?: string;
}

export interface ArtifactFilters {
  page?: number;
  limit?: number;
  search?: string;
}

export class EnrichmentUnavailableError extends Error {
  constructor() {
    super('Enrichment service unavailable (OpenCTI)');
    this.name = 'EnrichmentUnavailableError';
  }
}

function parseEnrichment(raw: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of [
    'enrichment',
    'enrichment_data',
    'enrichmentData',
    'opencti',
    'threat_intel',
    'threatIntel',
    'intel',
  ]) {
    const value = raw[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function extractIncidentRef(raw: Record<string, unknown>): {
  id: string | null;
  title: string | null;
} {
  const incident =
    raw.source_incident ??
    raw.sourceIncident ??
    raw.incident_id ??
    raw.incidentId ??
    raw.incident ??
    null;

  const fallbackTitle =
    raw.source_incident_title ??
    raw.sourceIncidentTitle ??
    raw.incident_title ??
    raw.incidentTitle ??
    null;

  if (!incident) {
    return {
      id: null,
      title: fallbackTitle ? String(fallbackTitle) : null,
    };
  }

  if (typeof incident === 'string' || typeof incident === 'number') {
    return {
      id: String(incident),
      title: fallbackTitle ? String(fallbackTitle) : null,
    };
  }

  if (typeof incident === 'object') {
    const record = incident as Record<string, unknown>;
    const id = record.id ?? record._id ?? record.incident_id ?? record.incidentId;
    const title =
      record.title ??
      record.name ??
      fallbackTitle ??
      null;

    return {
      id: id !== undefined && id !== null ? String(id) : null,
      title: title !== undefined && title !== null ? String(title) : null,
    };
  }

  return { id: null, title: null };
}

export function normalizeArtifact(raw: Record<string, unknown>): SoarArtifact {
  const enriched = raw.enriched ?? raw.is_enriched ?? raw.isEnriched;
  const { id: incidentId, title: incidentTitle } = extractIncidentRef(raw);

  return {
    id: String(raw.id ?? raw._id ?? ''),
    type: String(raw.type ?? ''),
    value: String(raw.value ?? ''),
    tlp: String(raw.tlp ?? raw.TLP ?? 'WHITE'),
    enriched: enriched === true || enriched === 'true' || enriched === 1,
    source_incident: incidentId,
    source_incident_title: incidentTitle,
    created_at: String(raw.created_at ?? raw.createdAt ?? ''),
    description:
      raw.description !== undefined && raw.description !== null
        ? String(raw.description)
        : null,
    enrichment: parseEnrichment(raw),
    raw,
  };
}

export async function fetchArtifacts(
  filters: ArtifactFilters = {},
): Promise<PaginatedResult<SoarArtifact>> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (filters.search?.trim()) {
    params.set('search', filters.search.trim());
    params.set('q', filters.search.trim());
  }

  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/artifacts?${params.toString()}`,
  );
  const data = unwrapData<unknown>(response);
  const items = asArray<Record<string, unknown>>(data, ARTIFACT_LIST_KEYS).map(normalizeArtifact);
  const pagination = extractPagination(data, { page, limit, itemCount: items.length });
  return { items, pagination };
}

export async function fetchArtifactById(id: string): Promise<SoarArtifact> {
  const response = await apiClient.get<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/artifacts/${encodeURIComponent(id)}`,
  );
  const data = unwrapData(response);
  return normalizeArtifact(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function updateArtifact(
  id: string,
  input: UpdateArtifactInput,
): Promise<SoarArtifact> {
  const response = await apiClient.patch<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/artifacts/${encodeURIComponent(id)}`,
    input,
  );
  const data = unwrapData(response);
  return normalizeArtifact(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : { id, ...input },
  );
}

export async function deleteArtifact(id: string): Promise<void> {
  await apiClient.delete(`/api/soar/artifacts/${encodeURIComponent(id)}`);
}

export async function enrichArtifact(artifactId: string): Promise<SoarArtifact> {
  try {
    const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
      `/api/soar/artifacts/${encodeURIComponent(artifactId)}/enrich`,
      {},
    );
    const data = unwrapData(response);
    return normalizeArtifact(
      data && typeof data === 'object' ? (data as Record<string, unknown>) : { id: artifactId, enriched: true },
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 502) {
      throw new EnrichmentUnavailableError();
    }
    throw err;
  }
}

export async function bulkEnrichArtifacts(artifactIds: string[]): Promise<void> {
  try {
    await apiClient.post('/api/soar/artifacts/enrich/bulk', {
      artifact_ids: artifactIds,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 502) {
      throw new EnrichmentUnavailableError();
    }
    throw err;
  }
}
