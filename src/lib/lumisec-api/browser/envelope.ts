/** Shared SOAR gateway envelope helpers for browser API clients. */

export interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  pages?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export function unwrapData<T>(response: T | ApiEnvelope<T>): T {
  if (response && typeof response === 'object' && 'data' in response) {
    const envelope = response as ApiEnvelope<T>;
    if (envelope.data !== undefined) return envelope.data;
  }
  return response as T;
}

export function asArray<T>(value: unknown, keys?: string[]): T[] {
  const listKeys = keys ?? ['items', 'results', 'data'];
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of listKeys) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

export function extractPagination(
  source: unknown,
  fallback: { page: number; limit: number; itemCount: number },
): PaginationMeta {
  const record = source && typeof source === 'object' ? (source as Record<string, unknown>) : {};
  const pagination =
    record.pagination && typeof record.pagination === 'object'
      ? (record.pagination as Record<string, unknown>)
      : record.meta && typeof record.meta === 'object'
        ? (record.meta as Record<string, unknown>)
        : record;

  const page = Number(pagination.page ?? fallback.page);
  const limit = Number(pagination.limit ?? fallback.limit);
  const total = Number(pagination.total ?? pagination.totalItems ?? fallback.itemCount);
  const totalPages = Number(
    pagination.totalPages ?? pagination.pages ?? (limit > 0 ? Math.ceil(total / limit) : 1),
  );

  return {
    page: Number.isFinite(page) ? page : fallback.page,
    limit: Number.isFinite(limit) ? limit : fallback.limit,
    total: Number.isFinite(total) ? total : fallback.itemCount,
    totalPages: Number.isFinite(totalPages) ? totalPages : 1,
  };
}

export function toPaginatedResult<T>(
  response: unknown,
  page: number,
  limit: number,
  listKeys?: string[],
): PaginatedResult<T> {
  const data = unwrapData<unknown>(response);
  const items = asArray<T>(data, listKeys);
  const pagination = extractPagination(data, { page, limit, itemCount: items.length });
  return { items, pagination };
}
