/**
 * Proxy governed actions / workflows to the Next.js Prisma SOAR gateway.
 */
const GATEWAY_URL = (
  process.env.SOAR_WORKFLOW_GATEWAY_URL ||
  process.env.SOAR_NEXT_GATEWAY_URL ||
  process.env.NEXT_SOAR_URL ||
  'http://localhost:3000'
).replace(/\/$/, '');

const INTERNAL_KEY = process.env.SOAR_INTERNAL_API_KEY || '';

export function isWorkflowGatewayConfigured() {
  return Boolean(GATEWAY_URL && INTERNAL_KEY);
}

export async function proxyToSoarGateway(path, { method = 'POST', body, authHeader } = {}) {
  if (!INTERNAL_KEY) {
    return {
      ok: false,
      status: 501,
      message: 'SOAR_INTERNAL_API_KEY required to proxy connector/workflow execution to Prisma gateway.',
      data: null,
    };
  }

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Internal-Api-Key': INTERNAL_KEY,
  };
  if (authHeader) headers.Authorization = authHeader;

  try {
    const res = await fetch(`${GATEWAY_URL}${path}`, {
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

    return { ok: res.ok, status: res.status, message: String(message), data: payload };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: `SOAR gateway unreachable (${GATEWAY_URL}): ${err instanceof Error ? err.message : String(err)}`,
      data: null,
    };
  }
}
