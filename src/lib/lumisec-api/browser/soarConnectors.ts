import { apiClient, ApiError } from '@/lib/lumisec-api/browser/api-client';
import { normalizeConnectorStatus } from '@/lib/lumisec-api/browser/connectorUi';
import {
  asArray,
  extractPagination,
  unwrapData,
  type ApiEnvelope,
  type PaginatedResult,
  type PaginationMeta,
} from '@/lib/lumisec-api/browser/envelope';

const CONNECTOR_LIST_KEYS = ['items', 'connectors', 'results', 'data', 'actions'];

export interface SoarConnector {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'inactive' | 'error';
  description: string | null;
  last_tested_at: string | null;
  last_error: string | null;
  has_config: boolean;
  config?: Record<string, unknown> | unknown;
  raw: Record<string, unknown>;
}

export interface ConnectorAction {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
}

export interface CreateConnectorInput {
  name: string;
  type: string;
  description?: string;
  config: Record<string, string>;
}

export interface UpdateConnectorInput {
  name?: string;
  type?: string;
  description?: string;
  config?: Record<string, string>;
}

export interface ConnectorTestResult {
  success: boolean;
  status: 'active' | 'inactive' | 'error';
  message: string | null;
  last_tested_at: string;
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const key of ['message', 'error', 'detail', 'reason']) {
    if (typeof record[key] === 'string' && record[key]) return String(record[key]);
  }
  const nested = record.data;
  if (nested && typeof nested === 'object') {
    return extractErrorMessage(nested);
  }
  return null;
}

export function normalizeConnector(raw: Record<string, unknown>): SoarConnector {
  const statusRaw = String(raw.status ?? raw.state ?? 'inactive');
  const lastError =
    raw.last_error ?? raw.lastError ?? raw.error_message ?? raw.errorMessage ?? null;
  const config = raw.config ?? raw.credentials ?? raw.settings;

  return {
    id: String(raw.id ?? raw._id ?? ''),
    name: String(raw.name ?? 'Unnamed connector'),
    type: String(raw.type ?? raw.connector_type ?? raw.connectorType ?? 'other'),
    status: normalizeConnectorStatus(statusRaw),
    description:
      raw.description !== undefined && raw.description !== null
        ? String(raw.description)
        : null,
    last_tested_at: raw.last_tested_at
      ? String(raw.last_tested_at)
      : raw.lastTestedAt
        ? String(raw.lastTestedAt)
        : raw.last_seen
          ? String(raw.last_seen)
          : raw.lastSeen
            ? String(raw.lastSeen)
            : null,
    last_error: lastError ? String(lastError) : null,
    has_config: Boolean(config && typeof config === 'object'),
    config: raw.config ?? raw.credentials ?? raw.settings,
    raw,
  };
}

function normalizeAction(raw: Record<string, unknown>, index: number): ConnectorAction {
  return {
    id: String(raw.id ?? raw._id ?? raw.action_id ?? raw.actionId ?? raw.name ?? index),
    name: String(raw.name ?? raw.label ?? raw.action ?? `Action ${index + 1}`),
    description:
      raw.description !== undefined && raw.description !== null
        ? String(raw.description)
        : raw.summary
          ? String(raw.summary)
          : null,
    type: raw.type ? String(raw.type) : null,
  };
}

export async function fetchConnectors(
  page = 1,
  limit = 50,
): Promise<PaginatedResult<SoarConnector>> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/connectors?page=${page}&limit=${limit}`,
  );
  const data = unwrapData<unknown>(response);
  const items = asArray<Record<string, unknown>>(data, CONNECTOR_LIST_KEYS).map(normalizeConnector);
  const pagination = extractPagination(data, { page, limit, itemCount: items.length });
  return { items, pagination };
}

export async function fetchConnectorById(id: string): Promise<SoarConnector> {
  const response = await apiClient.get<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/connectors/${encodeURIComponent(id)}`,
  );
  const data = unwrapData(response);
  return normalizeConnector(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function fetchConnectorActions(id: string): Promise<ConnectorAction[]> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/connectors/${encodeURIComponent(id)}/actions`,
  );
  const data = unwrapData<unknown>(response);
  return asArray<Record<string, unknown>>(data, CONNECTOR_LIST_KEYS).map(normalizeAction);
}

export async function createConnector(input: CreateConnectorInput): Promise<SoarConnector> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    '/api/soar/connectors',
    {
      name: input.name,
      type: input.type,
      description: input.description,
      config: input.config,
    },
  );
  const data = unwrapData(response);
  return normalizeConnector(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : { name: input.name },
  );
}

export async function updateConnector(
  id: string,
  input: UpdateConnectorInput,
): Promise<SoarConnector> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.type !== undefined) body.type = input.type;
  if (input.description !== undefined) body.description = input.description;
  if (input.config && Object.keys(input.config).length > 0) {
    body.config = input.config;
  }

  const response = await apiClient.patch<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/connectors/${encodeURIComponent(id)}`,
    body,
  );
  const data = unwrapData(response);
  return normalizeConnector(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : { id },
  );
}

export async function deleteConnector(id: string): Promise<void> {
  await apiClient.delete(`/api/soar/connectors/${encodeURIComponent(id)}`);
}

export async function testConnector(id: string): Promise<ConnectorTestResult> {
  const now = new Date().toISOString();

  try {
    const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
      `/api/soar/connectors/${encodeURIComponent(id)}/test`,
      {},
    );
    const data = unwrapData(response);
    const record =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

    const successFlag = record.success ?? record.ok ?? record.connected;
    const success =
      successFlag === true ||
      successFlag === 'true' ||
      normalizeConnectorStatus(String(record.status ?? 'active')) === 'active';

    return {
      success,
      status: success ? 'active' : normalizeConnectorStatus(String(record.status ?? 'error')),
      message:
        extractErrorMessage(record) ??
        (typeof record.message === 'string' ? record.message : null),
      last_tested_at: String(record.last_tested_at ?? record.lastTestedAt ?? now),
    };
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        success: false,
        status: 'error',
        message: extractErrorMessage(err.body) ?? err.message,
        last_tested_at: now,
      };
    }
    throw err;
  }
}
