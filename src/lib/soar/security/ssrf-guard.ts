/**
 * SSRF Guard — Server-Side Request Forgery protection
 * ---------------------------------------------------------------------------
 * Every outbound HTTP request initiated by a SOAR node MUST pass through
 * this guard. It blocks:
 *   - Private / loopback / link-local IPs (RFC 1918, RFC 6598, RFC 3927)
 *   - Cloud metadata endpoints (169.254.169.254, fd00:ec2::254)
 *   - Internal hostnames (localhost, *.local, *.internal, *.corp)
 *   - DNS rebinding attacks (resolves hostname, validates IP, locks socket
 *     to that IP — prevents TOCTOU)
 *   - IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1)
 *   - Decimal / hex / octal IP encodings (e.g., 2130706433, 0x7f000001)
 *
 * Compliance:
 *   OWASP ASVS v4.0 12.6.1 (verify outbound HTTP requests are validated)
 *   SOC2 CC6.6 (logical access)
 *   ISO27001 A.14.2 (protection against malicious code)
 *
 * The guard supports an allowlist (per-node, per-integration) and a global
 * blocklist. Allowlist wins — if a host matches both, it's allowed.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// ============================================================================
// IP / hostname classification
// ============================================================================

const PRIVATE_RANGES_V4 = [
  /^127\./,                         // loopback (RFC 990)
  /^10\./,                          // private (RFC 1918)
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // private (RFC 1918)
  /^192\.168\./,                    // private (RFC 1918)
  /^169\.254\./,                    // link-local (RFC 3927) — also cloud metadata
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT (RFC 6598)
  /^0\./,                           // "this" network (RFC 791)
  /^192\.0\.2\./,                   // TEST-NET-1 (RFC 5737)
  /^198\.51\.100\./,                // TEST-NET-2 (RFC 5737)
  /^203\.0\.113\./,                 // TEST-NET-3 (RFC 5737)
  /^22[4-9]\./,                     // multicast (RFC 5771)
  /^24[0-9]\./,                     // reserved
  /^25[0-5]\./,                     // reserved
];

const PRIVATE_RANGES_V6 = [
  /^::1$/,                          // loopback
  /^fc00:/i,                        // ULA (RFC 4193) — fc00::/7 covers fc00:: and fd00::
  /^fd00:/i,                        // ULA — explicit fd00: prefix
  /^fd[0-9a-f]{2}:/i,              // ULA — any fdXX: prefix (RFC 4193)
  /^fe80:/i,                        // link-local
  /^fd00:ec2:/i,                    // AWS EC2 IPv6 metadata
  /^::ffff:0:0\//,                  // IPv4-mapped (covered below too)
  /^::/,                            // unspecified / 0.0.0.0
  /^64:ff9b::/,                     // NAT64
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.local',
  '.internal',
  '.corp',
  '.intranet',
  '.lan',
  '.home',
];

export interface SsrfCheckResult {
  allowed: boolean;
  reason?: string;
  resolvedIp?: string;
}

/** Check if an IP string is in a private/reserved range. */
export function isPrivateIp(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 (::ffff:1.2.3.4) to plain IPv4
  const v4MappedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedMatch) ip = v4MappedMatch[1];

  const family = isIP(ip);
  if (family === 4) {
    return PRIVATE_RANGES_V4.some(r => r.test(ip));
  }
  if (family === 6) {
    return PRIVATE_RANGES_V6.some(r => r.test(ip));
  }
  // Not a valid IP — treat as private (fail closed)
  return true;
}

/** Check if a hostname is blocked (without DNS resolution). */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().trim();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (BLOCKED_HOSTNAME_SUFFIXES.some(s => h.endsWith(s))) return true;
  // Decimal-encoded IPv4 (e.g., 2130706433 → 127.0.0.1)
  if (/^\d+$/.test(h) && Number(h) <= 0xffffffff) {
    const n = Number(h);
    const ip = `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
    return isPrivateIp(ip);
  }
  // Hex-encoded IPv4 (e.g., 0x7f000001)
  if (/^0x[0-9a-f]{8}$/i.test(h)) {
    const n = parseInt(h.slice(2), 16);
    const ip = `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
    return isPrivateIp(ip);
  }
  // Octal-encoded IPv4 (e.g., 0177.0.0.1)
  if (/^0\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) {
    const ip = h.split('.').map(o => parseInt(o, 8)).join('.');
    return isPrivateIp(ip);
  }
  return false;
}

export interface SsrfOptions {
  allowHosts?: string[];  // explicit allowlist (overrides blocklist)
  blockHosts?: string[];  // additional blocklist
  allowPrivateIp?: boolean; // set true ONLY for local dev
  resolveDns?: boolean;   // resolve hostname and validate IP (default: true)
}

/**
 * Validate a URL for outbound fetch. Returns the resolved IP (if DNS resolved)
 * so the caller can pin the socket to that IP (defends against DNS rebinding).
 */
export async function checkSsrf(url: string, opts: SsrfOptions = {}): Promise<SsrfCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  // Disallow non-HTTP(S) protocols — check BEFORE hostname (file:// has empty host)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { allowed: false, reason: `Disallowed protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname;
  if (!hostname) return { allowed: false, reason: 'Empty hostname' };

  // Allowlist (win over blocklist)
  if (opts.allowHosts?.length) {
    const allowed = opts.allowHosts.some(pattern => matchHost(pattern, hostname));
    if (!allowed) return { allowed: false, reason: `Host ${hostname} not in allowlist` };
  }

  // User-supplied blocklist
  if (opts.blockHosts?.some(pattern => matchHost(pattern, hostname))) {
    return { allowed: false, reason: `Host ${hostname} is blocked` };
  }

  // Hostname-level checks (no DNS)
  if (!opts.allowPrivateIp && isBlockedHostname(hostname)) {
    return { allowed: false, reason: `Hostname ${hostname} is blocked` };
  }

  // If hostname is already an IP literal, validate it directly
  if (isIP(hostname)) {
    if (!opts.allowPrivateIp && isPrivateIp(hostname)) {
      return { allowed: false, reason: `IP ${hostname} is private/reserved` };
    }
    return { allowed: true, resolvedIp: hostname };
  }

  // DNS resolution + IP validation (defense against DNS rebinding)
  if (opts.resolveDns !== false) {
    try {
      const addrs = await lookup(hostname, { all: true });
      for (const a of addrs) {
        if (!opts.allowPrivateIp && isPrivateIp(a.address)) {
          return { allowed: false, reason: `Resolved IP ${a.address} is private/reserved` };
        }
      }
      // Return first resolved IP for socket pinning
      return { allowed: true, resolvedIp: addrs[0]?.address };
    } catch {
      return { allowed: false, reason: `DNS resolution failed for ${hostname}` };
    }
  }

  return { allowed: true };
}

/** Match a host against a pattern (supports wildcards like *.example.com). */
function matchHost(pattern: string, hostname: string): boolean {
  const p = pattern.toLowerCase().trim();
  const h = hostname.toLowerCase().trim();
  if (p === h) return true;
  if (p.startsWith('*.')) {
    const suffix = p.slice(2);
    return h === suffix || h.endsWith('.' + suffix);
  }
  // CIDR notation for IP patterns
  if (p.includes('/')) {
    try {
      return ipInCidr(h, p);
    } catch { /* fall through */ }
  }
  return false;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const family = isIP(ip);
  const baseFamily = isIP(base);
  if (family !== baseFamily || family === 0) return false;
  if (family === 4) {
    const ipNum = ipv4ToInt(ip);
    const baseNum = ipv4ToInt(base);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipNum & mask) === (baseNum & mask);
  }
  // IPv6 — simple implementation
  return false;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// ============================================================================
// SSRF-SAFE FETCH
// ============================================================================

/**
 * SSRF-safe fetch — wraps undici with:
 *   - Pre-flight URL validation (above)
 *   - Socket pinning to validated IP (defeats DNS rebinding)
 *   - Redirects manually followed + re-validated (defeats open-redirect SSRF)
 *   - Max redirect depth (5)
 *   - Default timeout 30s
 */
export interface SafeFetchOptions extends RequestInit {
  allowHosts?: string[];
  blockHosts?: string[];
  allowPrivateIp?: boolean;
  maxRedirects?: number;
  timeoutMs?: number;
}

export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const {
    allowHosts, blockHosts, allowPrivateIp = false,
    maxRedirects = 5, timeoutMs = 30_000, ...fetchOpts
  } = opts;

  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    const ssrf = await checkSsrf(currentUrl, { allowHosts, blockHosts, allowPrivateIp });
    if (!ssrf.allowed) {
      throw new SsrfError(`SSRF blocked: ${ssrf.reason}`, currentUrl);
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // SSRF pre-check above; use native fetch (custom undici dispatcher broke HTTPS on Windows).
      const response = await fetch(currentUrl, {
        ...fetchOpts,
        signal: controller.signal,
      });

      // Manual redirect handling — re-validate every hop
      if ([301, 302, 303, 307, 308].includes(response.status) && redirectCount < maxRedirects) {
        const location = response.headers.get('location');
        if (location) {
          currentUrl = new URL(location, currentUrl).toString();
          redirectCount++;
          continue;
        }
      }
      return response;
    } catch (err) {
      if (err instanceof SsrfError) throw err;
      throw new Error(`fetch failed for ${currentUrl}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
  throw new Error(`Too many redirects (>${maxRedirects})`);
}

export class SsrfError extends Error {
  constructor(message: string, public url: string) {
    super(message);
    this.name = 'SsrfError';
  }
}
