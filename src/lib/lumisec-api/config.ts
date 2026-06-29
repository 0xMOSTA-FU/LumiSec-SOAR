/**
 * SOAR API routing
 *
 * Industry UI (gateway): `NEXT_PUBLIC_SOAR_GATEWAY=1` (default ON unless `=0`)
 *
 * Local backend (this repo):  browser → `/api/soar/*` → Prisma router (default)
 *                              or `SOAR_USE_NODE_BACKEND=1` → Node + Mongo (port 4000)
 * Remote colleague backend:   browser → `/api/gateway/api/soar/*` → LUMISEC_API_URL
 *   requires:
 *     NEXT_PUBLIC_SOAR_USE_REMOTE_GATEWAY=1
 *     SOAR_USE_REMOTE_GATEWAY=1
 *     LUMISEC_API_URL=https://lumisec.tech
 *     LUMISEC_INTERNAL_API_KEY=...
 */

export const LUMISEC_API_URL =
  process.env.LUMISEC_API_URL ||
  process.env.NEXT_PUBLIC_LUMISEC_API_URL ||
  '';

export const LUMISEC_INTERNAL_API_KEY =
  process.env.LUMISEC_INTERNAL_API_KEY ||
  process.env.SERVICE_API_KEY ||
  '';

export function isLumisecBackendEnabled(): boolean {
  return Boolean(LUMISEC_API_URL && LUMISEC_INTERNAL_API_KEY);
}

/** Server: proxy /api/gateway/* to colleague backend */
export function useRemoteGateway(): boolean {
  return isLumisecBackendEnabled() && process.env.SOAR_USE_REMOTE_GATEWAY === '1';
}

/** Industry SOAR UI (Incidents hub, Connectors, Vault, …) */
export function isGatewayMode(): boolean {
  if (process.env.NEXT_PUBLIC_SOAR_GATEWAY === '0') return false;
  return true;
}

/** Browser calls remote BFF instead of local /api/soar */
export function isRemoteSoarBackend(): boolean {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SOAR_USE_REMOTE_GATEWAY === '1') {
    return Boolean(LUMISEC_API_URL);
  }
  return false;
}

/** Prefix before `/api/soar/...` in browser fetch */
export const GATEWAY_BROWSER_PREFIX = isRemoteSoarBackend() ? '/api/gateway' : '';

/** Build full browser path for a SOAR API subpath (e.g. `incidents`, `playbook-runs/abc`) */
export function soarApiPath(subpath: string): string {
  const normalized = subpath.replace(/^\//, '');
  const base = GATEWAY_BROWSER_PREFIX ? `${GATEWAY_BROWSER_PREFIX}/api/soar` : '/api/soar';
  return `${base}/${normalized}`;
}
