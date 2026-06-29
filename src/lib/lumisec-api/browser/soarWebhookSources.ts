import { apiClient } from '@/lib/lumisec-api/browser/api-client';
import { inboundWebhookUrl } from '@/lib/lumisec-api/browser/webhookUi';
import {
  asArray,
  extractPagination,
  unwrapData,
  type ApiEnvelope,
  type PaginatedResult,
  type PaginationMeta,
} from '@/lib/lumisec-api/browser/envelope';

const WEBHOOK_LIST_KEYS = ['items', 'webhook_sources', 'webhookSources', 'sources', 'results', 'data'];

export interface SoarWebhookSource {
  id: string;
  name: string;
  type: string;
  webhook_url: string;
  status: string;
  description: string | null;
  created_at: string;
}

export interface CreateWebhookSourceInput {
  name: string;
  type: string;
  description?: string;
  workflow_id?: string | null;
}

export interface CreateWebhookSourceResult {
  source: SoarWebhookSource;
  generatedUrl: string | null;
}

function extractWebhookUrl(raw: Record<string, unknown>): string {
  for (const key of [
    'webhook_url',
    'webhookUrl',
    'url',
    'endpoint',
    'callback_url',
    'callbackUrl',
  ]) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const type = String(raw.type ?? raw.source_type ?? raw.sourceType ?? 'custom');
  return inboundWebhookUrl(type.toLowerCase());
}

export function normalizeWebhookSource(raw: Record<string, unknown>): SoarWebhookSource {
  const type = String(raw.type ?? raw.source_type ?? raw.sourceType ?? 'custom');
  return {
    id: String(raw.id ?? raw._id ?? raw.source_id ?? raw.sourceId ?? ''),
    name: String(raw.name ?? 'Unnamed source'),
    type,
    webhook_url: extractWebhookUrl(raw),
    status: String(raw.status ?? raw.state ?? 'active'),
    description:
      raw.description !== undefined && raw.description !== null
        ? String(raw.description)
        : null,
    created_at: String(raw.created_at ?? raw.createdAt ?? ''),
  };
}

function extractGeneratedUrl(data: unknown, fallbackType: string): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;

  const direct = extractWebhookUrl(record);
  if (direct && !direct.endsWith(`/${fallbackType}`)) {
    return direct;
  }

  for (const key of ['webhook_url', 'webhookUrl', 'url', 'generated_url', 'generatedUrl']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  const nested = record.data ?? record.source;
  if (nested && typeof nested === 'object') {
    return extractGeneratedUrl(nested as Record<string, unknown>, fallbackType);
  }

  return direct || null;
}

export async function fetchWebhookSources(
  page = 1,
  limit = 50,
): Promise<PaginatedResult<SoarWebhookSource>> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/webhook-sources?page=${page}&limit=${limit}`,
  );
  const data = unwrapData<unknown>(response);
  const items = asArray<Record<string, unknown>>(data, WEBHOOK_LIST_KEYS).map(normalizeWebhookSource);
  const pagination = extractPagination(data, { page, limit, itemCount: items.length });
  return { items, pagination };
}

export async function createWebhookSource(
  input: CreateWebhookSourceInput,
): Promise<CreateWebhookSourceResult> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    '/api/soar/webhook-sources',
    {
      name: input.name,
      slug: input.type,
      type: input.type,
      description: input.description,
      workflow_id: input.workflow_id ?? null,
    },
  );

  const data = unwrapData(response);
  const record =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : { name: input.name };

  const source = normalizeWebhookSource(record);
  const generatedUrl = extractGeneratedUrl(response, input.type) ?? source.webhook_url;

  return {
    source: { ...source, webhook_url: generatedUrl ?? source.webhook_url },
    generatedUrl,
  };
}

export async function updateWebhookSource(
  id: string,
  patch: { enabled?: boolean; workflow_id?: string | null; name?: string },
): Promise<SoarWebhookSource> {
  const response = await apiClient.patch<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/webhook-sources/${encodeURIComponent(id)}`,
    patch,
  );
  const data = unwrapData(response);
  return normalizeWebhookSource(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function deleteWebhookSource(id: string): Promise<void> {
  await apiClient.delete(`/api/soar/webhook-sources/${encodeURIComponent(id)}`);
}
