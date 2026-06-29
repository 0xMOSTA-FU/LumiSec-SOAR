import { ApiError } from '@/lib/lumisec-api/browser/api-client';

export class IntegrationUnavailableError extends Error {
  constructor() {
    super('Integration unavailable — the external dependency is not reachable');
    this.name = 'IntegrationUnavailableError';
  }
}

export class IntegrationValidationError extends Error {
  constructor(
    message: string,
    public fieldErrors: Record<string, string>,
  ) {
    super(message);
    this.name = 'IntegrationValidationError';
  }
}

function normalizeFieldKey(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^\./, '')
    .split('.')
    .pop() ?? path;
}

export function parseValidationErrors(body: unknown): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  if (!body || typeof body !== 'object') return fieldErrors;

  const record = body as Record<string, unknown>;
  const nested =
    record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : record;

  const errorsSource = nested.errors ?? record.errors;
  if (errorsSource && typeof errorsSource === 'object' && !Array.isArray(errorsSource)) {
    for (const [key, value] of Object.entries(errorsSource as Record<string, unknown>)) {
      if (typeof value === 'string') fieldErrors[key] = value;
      else if (Array.isArray(value)) fieldErrors[key] = value.map(String).join(', ');
    }
  }

  const details =
    nested.details ??
    nested.validationErrors ??
    record.details ??
    record.validationErrors;

  if (Array.isArray(details)) {
    for (const item of details) {
      if (!item || typeof item !== 'object') continue;
      const detail = item as Record<string, unknown>;
      const path = Array.isArray(detail.path)
        ? detail.path.map(String).join('.')
        : String(detail.field ?? detail.param ?? detail.key ?? '');
      const message = String(detail.message ?? detail.msg ?? detail.error ?? 'Invalid value');
      if (path) {
        fieldErrors[normalizeFieldKey(path)] = message;
      }
    }
  }

  return fieldErrors;
}

export function extractSuccessMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return 'Request completed successfully';
  const record = body as Record<string, unknown>;
  const nested =
    record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : record;

  for (const key of ['message', 'status', 'result']) {
    const value = nested[key];
    if (typeof value === 'string' && value.trim()) return value;
  }

  return 'Request completed successfully';
}

export function handleIntegrationError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.status === 502) {
      throw new IntegrationUnavailableError();
    }
    if (err.status === 422) {
      const fieldErrors = parseValidationErrors(err.body);
      throw new IntegrationValidationError(
        ApiError.fromResponse(err.status, err.body).message,
        fieldErrors,
      );
    }
  }
  throw err;
}
