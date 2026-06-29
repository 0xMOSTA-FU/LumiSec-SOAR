import { apiClient } from '@/lib/lumisec-api/browser/api-client';
import { SECRET_FIELD_KEYS } from '@/lib/lumisec-api/browser/vaultUi';
import {
  asArray,
  extractPagination,
  unwrapData,
  type ApiEnvelope,
  type PaginatedResult,
  type PaginationMeta,
} from '@/lib/lumisec-api/browser/envelope';

const VAULT_LIST_KEYS = ['items', 'entries', 'secrets', 'vault', 'results', 'data'];

export interface SoarVaultEntry {
  id: string;
  name: string;
  type: string;
  description: string | null;
  created_at: string;
  last_used_at: string | null;
  has_value: boolean;
}

export interface CreateVaultEntryInput {
  name: string;
  type: string;
  value: string;
  description?: string;
}

export interface UpdateVaultEntryInput {
  name?: string;
  type?: string;
  description?: string;
  value?: string;
}

function entryHasValue(raw: Record<string, unknown>): boolean {
  for (const key of SECRET_FIELD_KEYS) {
    const value = raw[key];
    if (value !== null && value !== undefined && value !== '') return true;
  }
  return Boolean(raw.has_value ?? raw.hasValue ?? raw.has_secret ?? raw.hasSecret);
}

/** Extract secret for one-time clipboard use only — never persist or render. */
export function extractSecretValue(raw: Record<string, unknown>): string | null {
  for (const key of SECRET_FIELD_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

export function normalizeVaultEntry(raw: Record<string, unknown>): SoarVaultEntry {
  return {
    id: String(raw.id ?? raw._id ?? raw.vault_id ?? raw.vaultId ?? ''),
    name: String(raw.name ?? 'Unnamed secret'),
    type: String(raw.type ?? raw.secret_type ?? raw.secretType ?? 'password'),
    description:
      raw.description !== undefined && raw.description !== null
        ? String(raw.description)
        : null,
    created_at: String(raw.created_at ?? raw.createdAt ?? ''),
    last_used_at:
      raw.last_used_at ?? raw.lastUsedAt
        ? String(raw.last_used_at ?? raw.lastUsedAt)
        : raw.last_accessed_at ?? raw.lastAccessedAt
          ? String(raw.last_accessed_at ?? raw.lastAccessedAt)
          : null,
    has_value: entryHasValue(raw),
  };
}

export async function fetchVaultEntries(
  page = 1,
  limit = 50,
): Promise<PaginatedResult<SoarVaultEntry>> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/vault?page=${page}&limit=${limit}`,
  );
  const data = unwrapData<unknown>(response);
  const items = asArray<Record<string, unknown>>(data, VAULT_LIST_KEYS).map(normalizeVaultEntry);
  const pagination = extractPagination(data, { page, limit, itemCount: items.length });
  return { items, pagination };
}

export async function fetchVaultEntryById(id: string): Promise<SoarVaultEntry> {
  const response = await apiClient.get<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/vault/${encodeURIComponent(id)}`,
  );
  const data = unwrapData(response);
  return normalizeVaultEntry(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

/** Fetch and return secret for clipboard — caller must not store or log the result. */
export async function fetchVaultSecretForCopy(id: string): Promise<string | null> {
  const response = await apiClient.get<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/vault/${encodeURIComponent(id)}/reveal`,
  );
  const data = unwrapData(response);
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  return extractSecretValue(record) ?? (typeof record.value === 'string' ? record.value : null);
}

export async function createVaultEntry(input: CreateVaultEntryInput): Promise<SoarVaultEntry> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    '/api/soar/vault',
    {
      name: input.name,
      type: input.type,
      value: input.value,
      description: input.description,
    },
  );
  const data = unwrapData(response);
  return normalizeVaultEntry(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : { name: input.name },
  );
}

export async function updateVaultEntry(
  id: string,
  input: UpdateVaultEntryInput,
): Promise<SoarVaultEntry> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.type !== undefined) body.type = input.type;
  if (input.description !== undefined) body.description = input.description;
  if (input.value !== undefined && input.value.trim() !== '') {
    body.value = input.value;
  }

  const response = await apiClient.patch<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/vault/${encodeURIComponent(id)}`,
    body,
  );
  const data = unwrapData(response);
  return normalizeVaultEntry(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : { id },
  );
}

export async function deleteVaultEntry(id: string): Promise<void> {
  await apiClient.delete(`/api/soar/vault/${encodeURIComponent(id)}`);
}
