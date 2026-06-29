/**
 * Browser gateway client — calls `/api/soar/*` via BFF (session cookie auth).
 * Optional JWT in localStorage for remote gateway mode.
 */
import { soarApiPath } from '@/lib/lumisec-api/config';

export const JWT_STORAGE_KEY = 'lumisec_jwt';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromResponse(status: number, body: unknown): ApiError {
    let message = `Request failed (${status})`;

    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      if (typeof record.message === 'string') {
        message = record.message;
      } else if (typeof record.error === 'string') {
        message = record.error;
      } else if (record.data && typeof record.data === 'object') {
        const data = record.data as Record<string, unknown>;
        if (typeof data.message === 'string') {
          message = data.message;
        } else if (typeof data.error === 'string') {
          message = data.error;
        }
      }
    }

    return new ApiError(message, status, body);
  }
}

type RequestOptions = RequestInit & {
  skipAuthRedirect?: boolean;
};

class ApiClient {
  private resolvePath(path: string): string {
    if (path.startsWith('/api/soar/')) {
      return soarApiPath(path.slice('/api/soar/'.length));
    }
    if (path.startsWith('/api/soar')) {
      return soarApiPath(path.slice('/api/soar'.length).replace(/^\//, ''));
    }
    return path;
  }

  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(JWT_STORAGE_KEY);
  }

  setToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(JWT_STORAGE_KEY, token);
  }

  clearToken(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(JWT_STORAGE_KEY);
  }

  private handleUnauthorized(skipRedirect?: boolean): void {
    this.clearToken();
    if (
      skipRedirect ||
      typeof window === 'undefined' ||
      window.location.pathname.startsWith('/login')
    ) {
      return;
    }
    try {
      sessionStorage.setItem('soar:prefer_login', '1');
    } catch {
      /* ignore */
    }
    window.location.reload();
  }

  private async parseResponseBody(response: Response): Promise<unknown> {
    if (response.status === 204) return {};

    const text = await response.text();
    if (!text.trim()) return {};

    const contentType = response.headers.get('content-type') ?? '';
    const looksLikeJson =
      contentType.includes('application/json') ||
      text.trim().startsWith('{') ||
      text.trim().startsWith('[');

    if (!looksLikeJson) {
      return { message: text.slice(0, 500) };
    }

    try {
      return JSON.parse(text);
    } catch {
      return { message: text.slice(0, 500) };
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { skipAuthRedirect, headers: customHeaders, ...init } = options;
    const token = this.getToken();

    const headers = new Headers(customHeaders);
    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(this.resolvePath(path), {
      ...init,
      credentials: 'include',
      headers,
    });

    const body = await this.parseResponseBody(response);

    if (response.status === 401) {
      this.handleUnauthorized(skipAuthRedirect);
      throw new ApiError(
        ApiError.fromResponse(response.status, body).message,
        401,
        body,
      );
    }

    if (!response.ok) {
      throw ApiError.fromResponse(response.status, body);
    }

    return body as T;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  }

  patch<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PATCH',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  }

  put<T>(path: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
}

export function safeParseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
