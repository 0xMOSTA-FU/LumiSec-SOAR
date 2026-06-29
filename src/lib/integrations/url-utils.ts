/** Normalize integration host/url fields for outbound HTTPS calls. */

export function normalizeHost(hostOrUrl: string): string {
  return hostOrUrl.trim().replace(/\/$/, '').replace(/^https?:\/\//i, '');
}

/** Build https URL from host-only or full URL configs (matches executor behavior). */
export function buildHttpsUrl(hostOrUrl: string, port = 443, path = ''): string {
  const trimmed = hostOrUrl.trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(trimmed)) {
    const base = trimmed;
    return path ? `${base}/${path.replace(/^\//, '')}` : base;
  }
  const host = normalizeHost(trimmed);
  const pathPart = path ? `/${path.replace(/^\//, '')}` : '';
  return `https://${host}:${port}${pathPart}`;
}

/** Ensure config value is a usable https base URL. */
export function ensureUrlBase(hostOrUrl: string, defaultPort?: number): string {
  const trimmed = hostOrUrl.trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (defaultPort) return buildHttpsUrl(trimmed, defaultPort);
  return `https://${normalizeHost(trimmed)}`;
}
