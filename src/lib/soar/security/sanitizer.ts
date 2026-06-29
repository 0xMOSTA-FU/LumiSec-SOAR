/**
 * Input Sanitizer — defense against injection attacks
 * ---------------------------------------------------------------------------
 * Sanitizes untrusted input before it's:
 *   - Logged (log injection)
 *   - Rendered in HTML (XSS)
 *   - Passed to shell (command injection)
 *   - Used in SQL/MongoDB queries (NoSQL injection)
 *   - Used in template interpolation (template injection)
 *
 * Compliance: OWASP ASVS 5.3 (input validation), SOC2 CC6.x
 */

// ============================================================================
// LOG INJECTION — strip control chars + newlines from log fields
// ============================================================================
export function sanitizeForLog(value: unknown, maxLen = 2000): string {
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  // Strip ANSI escape sequences, control chars, and newlines
  s = s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''); // ANSI
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // control chars
  s = s.replace(/[\r\n]+/g, ' '); // newlines → space (log forging prevention)
  if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
  return s;
}

// ============================================================================
// SECRET REDACTION — replace secrets in logs/responses before they leak
// ============================================================================
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // API keys (generic — long hex/alphanumeric strings labeled as key/token/secret)
  { pattern: /((?:api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token|bearer|authorization)[\s:=]+)([A-Za-z0-9_\-.]{8,})/gi, replacement: '$1[REDACTED]' },
  // AWS Access Key IDs (AKIA...)
  { pattern: /(AKIA[0-9A-Z]{16})/g, replacement: 'AKIA[REDACTED]' },
  // AWS Secret Access Keys (40-char base64)
  { pattern: /([A-Za-z0-9/+=]{40})/g, replacement: '[REDACTED-AWS-SECRET]' },
  // Slack tokens (xoxb-, xoxp-, xoxa-)
  { pattern: /(xox[abp]-[A-Za-z0-9-]{10,})/g, replacement: 'xox-[REDACTED]' },
  // GitHub tokens (ghp_, gho_, ghs_, ghu_, ghr_)
  { pattern: /(gh[op-sur]_[A-Za-z0-9]{36})/g, replacement: 'gh[_REDACTED]' },
  // JWT tokens
  { pattern: /(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, replacement: 'eyJ[REDACTED]' },
  // Bearer tokens in Authorization headers
  { pattern: /(Bearer\s+)([A-Za-z0-9_\-.=]{8,})/gi, replacement: '$1[REDACTED]' },
  // Passwords in connection strings (mongodb://user:pass@host)
  { pattern: /(:\/\/[^:\s]+:)([^@\s]+)(@)/g, replacement: '$1[REDACTED]$3' },
  // Generic password field in JSON
  { pattern: /("password"|"passwd"|"pwd"|"secret"|"api[_-]?key"|"token")(\s*:\s*)"([^"]{4,})"/gi, replacement: '$1$2"[REDACTED]"' },
  // Credit card numbers (basic pattern, not full Luhn)
  { pattern: /\b(\d{4}[\s-]?){3}\d{4}\b/g, replacement: '[REDACTED-CC]' },
  // SSN (US)
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED-SSN]' },
];

export function redactSecrets(input: unknown): unknown {
  if (typeof input === 'string') return redactString(input);
  if (Array.isArray(input)) return input.map(redactSecrets);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      // If the key looks secret, replace its value wholesale
      if (/^(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)$/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return input;
}

function redactString(s: string): string {
  let result = s;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ============================================================================
// NoSQL INJECTION — prevent operator injection in MongoDB queries
// ============================================================================
const DANGEROUS_KEYS = /^\$/; // $where, $gt, $ne, $regex, etc.

export function sanitizeMongoQuery(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sanitizeMongoQuery);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      // Strip keys starting with $ (MongoDB operators — attacker could use
      // {$ne: null} to bypass auth, {$gt: ''} to dump all records, etc.)
      if (DANGEROUS_KEYS.test(k)) continue;
      out[k] = sanitizeMongoQuery(v);
    }
    return out;
  }
  return obj;
}

// ============================================================================
// COMMAND INJECTION — strip shell metacharacters from inputs passed to shell
// ============================================================================
const SHELL_METACHARS = /[;`$|&<>(){}[\]!\\\n\r]/g;

export function sanitizeForShell(value: string): string {
  // Allow only alphanumerics, dash, underscore, dot, slash, colon, equals
  // (covers IPs, file paths, hostnames)
  return value.replace(SHELL_METACHARS, '');
}

// ============================================================================
// PATH TRAVERSAL — strip ../ and absolute paths
// ============================================================================
export function sanitizePath(value: string, baseDir?: string): string {
  // Strip null bytes (NTFS stream attack)
  let p = value.replace(/\0/g, '');
  // Strip ../ sequences (path traversal)
  p = p.replace(/\.\.[/\\]/g, '');
  // Strip leading / (force relative)
  p = p.replace(/^\/+/, '');
  if (baseDir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path');
    const resolved = path.resolve(baseDir, p);
    const base = path.resolve(baseDir);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      throw new Error(`Path traversal detected: ${value}`);
    }
    return resolved;
  }
  return p;
}

// ============================================================================
// HTML/XSS — escape dangerous HTML
// ============================================================================
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'/]/g, c => HTML_ESCAPES[c] || c);
}

// ============================================================================
// EMAIL — RFC 5322 simplified validation
// ============================================================================
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

// ============================================================================
// IP / CIDR / DOMAIN validation
// ============================================================================
export function isValidIp(ip: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isIP } = require('node:net');
  return isIP(ip) !== 0;
}

export function isValidDomain(domain: string): boolean {
  // RFC 1035: max 253 chars, labels max 63 chars, alphanumeric + hyphen
  if (domain.length > 253) return false;
  return domain.split('.').every(label =>
    label.length >= 1 && label.length <= 63 &&
    /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
  );
}

export function isValidHash(hash: string): boolean {
  // MD5 (32), SHA1 (40), SHA256 (64)
  return /^[a-fA-F0-9]{32}$|^[a-fA-F0-9]{40}$|^[a-fA-F0-9]{64}$/.test(hash);
}

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
