/** Authenticated JSON fetch for SOAR API routes (session cookie). */
export async function soarFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  });

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const err = (parsed as { error?: string; message?: string })?.error
      || (parsed as { message?: string })?.message
      || res.statusText;
    return { ok: false, status: res.status, data: null, error: err };
  }

  return { ok: true, status: res.status, data: parsed as T };
}

export function asArray<T>(data: unknown): T[] {
  return Array.isArray(data) ? data : [];
}
