/**
 * Sanitizer — Security Tests
 * ---------------------------------------------------------------------------
 * Verifies secret redaction, NoSQL injection prevention, and input sanitization.
 */
import { describe, it, expect } from 'vitest';
import {
  redactSecrets, sanitizeForLog, sanitizeMongoQuery,
  sanitizeForShell, sanitizePath, escapeHtml,
  isValidEmail, isValidIp, isValidDomain, isValidHash, isValidUrl,
} from '@/lib/soar/security/sanitizer';

describe('Sanitizer — secret redaction', () => {
  it('redacts API keys in Authorization headers', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456';
    const out = redactSecrets(input);
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts Slack tokens (xoxb-)', () => {
    const input = 'token=xoxb-1234567890-abcdefghij';
    const out = redactSecrets(input);
    expect(out).not.toContain('xoxb-1234567890');
  });

  it('redacts GitHub tokens (ghp_)', () => {
    const input = 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB';
    const out = redactSecrets(input);
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('redacts passwords in JSON', () => {
    const input = { username: 'admin', password: 'supersecret', api_key: 'abc123' };
    const out = redactSecrets(input) as Record<string, string>;
    expect(out.password).toBe('[REDACTED]');
    expect(out.api_key).toBe('[REDACTED]');
    expect(out.username).toBe('admin');
  });

  it('redacts passwords in connection strings', () => {
    const input = 'mongodb://user:secretpass@host:27017/db';
    const out = redactSecrets(input);
    expect(out).not.toContain('secretpass');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts AWS access key IDs', () => {
    const input = 'aws_access_key_id=AKIAIOSFODNN7EXAMPLE';
    const out = redactSecrets(input);
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts credit card numbers', () => {
    const input = 'card=4111-1111-1111-1111';
    const out = redactSecrets(input);
    expect(out).toContain('[REDACTED-CC]');
  });

  it('redacts US SSNs', () => {
    const input = 'ssn=123-45-6789';
    const out = redactSecrets(input);
    expect(out).toContain('[REDACTED-SSN]');
  });

  it('handles nested objects', () => {
    const input = { user: { name: 'alice', api_key: 'secret123' } };
    const out = redactSecrets(input) as { user: { name: string; api_key: string } };
    expect(out.user.api_key).toBe('[REDACTED]');
    expect(out.user.name).toBe('alice');
  });

  it('handles arrays', () => {
    const input = [{ password: 'a' }, { password: 'b' }];
    const out = redactSecrets(input) as Array<{ password: string }>;
    expect(out[0].password).toBe('[REDACTED]');
    expect(out[1].password).toBe('[REDACTED]');
  });
});

describe('Sanitizer — log injection prevention', () => {
  it('strips newlines (log forging)', () => {
    const input = 'value\nINFO: fake log line';
    const out = sanitizeForLog(input);
    expect(out).not.toContain('\n');
    expect(out).toContain('fake log line');
  });

  it('strips ANSI escape codes', () => {
    const input = '\x1b[31mERROR\x1b[0m: something';
    const out = sanitizeForLog(input);
    expect(out).not.toContain('\x1b');
    expect(out).toContain('ERROR');
  });

  it('strips control characters', () => {
    const input = 'data\x00\x01\x02more';
    const out = sanitizeForLog(input);
    expect(out).not.toContain('\x00');
    expect(out).not.toContain('\x01');
  });

  it('truncates long values', () => {
    const input = 'x'.repeat(5000);
    const out = sanitizeForLog(input, 100);
    expect(out.length).toBeLessThanOrEqual(101); // 100 + ellipsis
    expect(out).toContain('…');
  });
});

describe('Sanitizer — NoSQL injection prevention', () => {
  it('strips MongoDB operators from query objects', () => {
    const malicious = { username: 'admin', $where: 'this.password == "admin"' };
    const out = sanitizeMongoQuery(malicious) as Record<string, unknown>;
    expect(out.username).toBe('admin');
    expect(out.$where).toBeUndefined();
  });

  it('strips $ne (not-equal) bypass', () => {
    const malicious = { password: { $ne: null } };
    const out = sanitizeMongoQuery(malicious) as Record<string, unknown>;
    expect((out as Record<string, unknown>).password).toEqual({}); // $ne stripped
  });

  it('strips $gt (greater-than) data exfiltration', () => {
    const malicious = { username: { $gt: '' } };
    const out = sanitizeMongoQuery(malicious) as Record<string, unknown>;
    expect((out as Record<string, unknown>).username).toEqual({});
  });

  it('preserves regular fields', () => {
    const safe = { name: 'Alice', age: 30 };
    const out = sanitizeMongoQuery(safe);
    expect(out).toEqual(safe);
  });

  it('handles nested objects', () => {
    const malicious = { user: { $ne: null }, name: 'Alice' };
    const out = sanitizeMongoQuery(malicious) as Record<string, unknown>;
    expect((out as Record<string, unknown>).user).toEqual({});
    expect((out as Record<string, unknown>).name).toBe('Alice');
  });
});

describe('Sanitizer — shell injection prevention', () => {
  it('strips shell metacharacters', () => {
    expect(sanitizeForShell('ls; rm -rf /')).toBe('ls rm -rf /');
    expect(sanitizeForShell('cat $(/etc/passwd)')).toBe('cat /etc/passwd');
    expect(sanitizeForShell('echo `whoami`')).toBe('echo whoami');
    expect(sanitizeForShell('cmd && malicious')).toBe('cmd  malicious');
    expect(sanitizeForShell('cmd | nc -l 4444')).toBe('cmd  nc -l 4444');
  });

  it('preserves safe characters (IPs, paths)', () => {
    expect(sanitizeForShell('8.8.8.8')).toBe('8.8.8.8');
    expect(sanitizeForShell('/usr/bin/curl')).toBe('/usr/bin/curl');
  });
});

describe('Sanitizer — path traversal prevention', () => {
  it('strips ../ sequences', () => {
    expect(sanitizePath('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizePath('logs/../../secret')).toBe('logs/secret');
  });

  it('strips null bytes', () => {
    expect(sanitizePath('file.txt\x00.exe')).toBe('file.txt.exe');
  });

  it('strips leading slashes (forces relative)', () => {
    expect(sanitizePath('/etc/passwd')).toBe('etc/passwd');
  });
});

describe('Sanitizer — HTML/XSS prevention', () => {
  it('escapes dangerous HTML chars', () => {
    expect(escapeHtml('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    expect(escapeHtml("'><img src=x onerror=alert(1)>"))
      .toBe('&#x27;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('Sanitizer — format validators', () => {
  it('validates emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user.name+tag@sub.example.co.uk')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
  });

  it('validates IPs', () => {
    expect(isValidIp('8.8.8.8')).toBe(true);
    expect(isValidIp('::1')).toBe(true);
    expect(isValidIp('2001:db8::1')).toBe(true);
    expect(isValidIp('999.999.999.999')).toBe(false);
    expect(isValidIp('not-an-ip')).toBe(false);
  });

  it('validates domains', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('sub.example.co.uk')).toBe(true);
    expect(isValidDomain('invalid_domain')).toBe(false);
    expect(isValidDomain('-bad.com')).toBe(false);
  });

  it('validates hashes', () => {
    expect(isValidHash('d41d8cd98f00b204e9800998ecf8427e')).toBe(true); // MD5
    expect(isValidHash('da39a3ee5e6b4b0d3255bfef95601890afd80709')).toBe(true); // SHA1
    expect(isValidHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(true); // SHA256
    expect(isValidHash('short')).toBe(false);
    expect(isValidHash('XYZ1234567890abcdef1234567890abcdef')).toBe(false); // 33 chars, non-hex
  });

  it('validates URLs (http/https only)', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://example.com/path?q=1')).toBe(true);
    expect(isValidUrl('ftp://example.com')).toBe(false);
    expect(isValidUrl('not a url')).toBe(false);
  });
});
