/**
 * Forward platform integration calls to the LumiSec monolith (never stub locally).
 */
const PLATFORM_URL = (
  process.env.LUMISEC_PLATFORM_URL ||
  process.env.LUMISEC_API_URL ||
  ''
).replace(/\/$/, '');

const INTERNAL_KEY =
  process.env.LUMISEC_INTERNAL_API_KEY ||
  process.env.SERVICE_API_KEY ||
  process.env.SOAR_INTERNAL_API_KEY ||
  '';

export function isPlatformForwardConfigured() {
  return Boolean(PLATFORM_URL);
}

export async function forwardPlatformIntegration(path, { method = 'POST', body, authHeader } = {}) {
  if (!isPlatformForwardConfigured()) {
    return {
      ok: false,
      status: 501,
      message:
        'LUMISEC_PLATFORM_URL not set on soar-backend. Point it at the full LumiSec monolith.',
      data: null,
    };
  }

  const url = `${PLATFORM_URL}${path}`;
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (INTERNAL_KEY) {
    headers['X-Internal-Api-Key'] = INTERNAL_KEY;
    headers['x-service-key'] = INTERNAL_KEY;
  }
  if (authHeader) headers.Authorization = authHeader;

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 2000) };
    }
    const envelope = data && typeof data === 'object' ? data : null;
    const payload =
      envelope && envelope.data !== undefined ? envelope.data : data;
    const message =
      (envelope && (envelope.message || envelope.error)) ||
      (res.ok ? 'OK' : text.slice(0, 400) || `HTTP ${res.status}`);

    return {
      ok: res.ok,
      status: res.status,
      message: String(message),
      data: payload,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: `Platform unreachable: ${err instanceof Error ? err.message : String(err)}`,
      data: null,
      durationMs: Date.now() - started,
    };
  }
}
