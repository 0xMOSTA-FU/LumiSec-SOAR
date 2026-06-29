/**
 * VirusTotal Node — Unit Tests
 * ---------------------------------------------------------------------------
 * Tests pure logic of the VT node (no network).
 *
 * Run: npx vitest run tests/unit/nodes/virustotal.test.ts
 */
import { describe, it, expect } from 'vitest';
import { __test__ } from '@/lib/soar/nodes/virustotal';

const { validateIoc, buildVtUrl, parseVtResponse, hashIoc, virustotalManifest } = __test__;

describe('VirusTotal node — manifest', () => {
  it('has semver version', () => {
    expect(virustotalManifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has all required config fields', () => {
    const keys = virustotalManifest.config.map(f => f.key);
    expect(keys).toContain('ioc_type');
    expect(keys).toContain('ioc_value');
  });

  it('has api_key credential', () => {
    expect(virustotalManifest.credentials).toHaveLength(1);
    expect(virustotalManifest.credentials[0].fields[0].key).toBe('api_key');
  });

  it('rate limits to 4/min (free tier)', () => {
    expect(virustotalManifest.rateLimit?.requestsPerWindow).toBe(4);
  });

  it('allows only www.virustotal.com', () => {
    expect(virustotalManifest.allowedHosts).toContain('www.virustotal.com');
  });

  it('has 12 error codes in catalog', () => {
    expect(virustotalManifest.errors.length).toBeGreaterThanOrEqual(10);
    const codes = virustotalManifest.errors.map(e => e.code);
    expect(codes).toContain('AUTH_FAILED');
    expect(codes).toContain('RATE_LIMITED');
    expect(codes).toContain('CIRCUIT_OPEN');
  });
});

describe('VirusTotal node — validateIoc', () => {
  it('accepts valid IPv4', () => {
    expect(validateIoc('ip', '8.8.8.8')).toEqual({ ok: true });
    expect(validateIoc('ip', '1.2.3.4')).toEqual({ ok: true });
  });

  it('accepts valid IPv6', () => {
    expect(validateIoc('ip', '::1').ok).toBe(true);
    expect(validateIoc('ip', '2001:db8::1').ok).toBe(true);
  });

  it('rejects invalid IPs', () => {
    expect(validateIoc('ip', '999.999.999.999').ok).toBe(false);
    expect(validateIoc('ip', 'not-an-ip').ok).toBe(false);
    expect(validateIoc('ip', '').ok).toBe(false);
  });

  it('accepts valid domains', () => {
    expect(validateIoc('domain', 'example.com').ok).toBe(true);
    expect(validateIoc('domain', 'sub.example.co.uk').ok).toBe(true);
  });

  it('rejects invalid domains', () => {
    expect(validateIoc('domain', 'invalid_domain').ok).toBe(false);
    expect(validateIoc('domain', '-bad.com').ok).toBe(false);
  });

  it('accepts valid MD5/SHA1/SHA256 hashes', () => {
    expect(validateIoc('hash', 'd41d8cd98f00b204e9800998ecf8427e').ok).toBe(true); // MD5
    expect(validateIoc('hash', 'da39a3ee5e6b4b0d3255bfef95601890afd80709').ok).toBe(true); // SHA1
    expect(validateIoc('hash', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855').ok).toBe(true); // SHA256
  });

  it('rejects invalid hashes', () => {
    expect(validateIoc('hash', 'short').ok).toBe(false);
    expect(validateIoc('hash', 'XYZ1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab').ok).toBe(false);
  });

  it('rejects unresolved templates', () => {
    expect(validateIoc('ip', '{{trigger.ip}}').ok).toBe(false);
  });
});

describe('VirusTotal node — buildVtUrl', () => {
  it('builds correct IP URL', () => {
    const url = buildVtUrl('ip', '8.8.8.8');
    expect(url).toBe('https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8');
  });

  it('builds correct domain URL', () => {
    const url = buildVtUrl('domain', 'example.com');
    expect(url).toBe('https://www.virustotal.com/api/v3/domains/example.com');
  });

  it('builds correct hash URL (lowercased)', () => {
    const url = buildVtUrl('hash', 'D41D8CD98F00B204E9800998ECF8427E');
    expect(url).toBe('https://www.virustotal.com/api/v3/files/d41d8cd98f00b204e9800998ecf8427e');
  });

  it('builds correct URL (base64url without padding)', () => {
    const url = buildVtUrl('url', 'https://example.com/malicious');
    const expectedId = Buffer.from('https://example.com/malicious').toString('base64').replace(/=+$/, '');
    expect(url).toBe(`https://www.virustotal.com/api/v3/urls/${expectedId}`);
  });

  it('encodes special characters', () => {
    const url = buildVtUrl('domain', 'test example.com');
    expect(url).toContain('test%20example.com');
  });
});

describe('VirusTotal node — parseVtResponse', () => {
  it('extracts verdict from real VT response shape', () => {
    const body = {
      data: {
        attributes: {
          last_analysis_stats: { malicious: 5, harmless: 80, suspicious: 1, undetected: 2 },
          last_analysis_results: {
            'Engine1': { category: 'malicious' },
            'Engine2': { category: 'malicious' },
            'Engine3': { category: 'harmless' },
          },
          reputation: -5,
          categories: { 'BitDefender': 'phishing', 'DrWeb': 'malware' },
        },
      },
    };
    const out = parseVtResponse(body, '8.8.8.8', 'ip');
    expect(out.ok).toBe(true);
    expect(out.ioc).toBe('8.8.8.8');
    expect(out.ioc_type).toBe('ip');
    expect(out.detections).toBe(5);
    expect(out.total_engines).toBe(88); // 5+80+1+2
    expect(out.score).toBe(Math.round((5 / 88) * 100)); // ~6%
    expect(out.is_malicious).toBe(false); // below 10% threshold
    expect(out.reputation).toBe(-5);
    expect(out.categories).toContain('phishing');
  });

  it('marks malicious when score >= 10%', () => {
    const body = {
      data: {
        attributes: {
          last_analysis_stats: { malicious: 10, harmless: 70, suspicious: 0, undetected: 8 },
          reputation: 0,
          categories: {},
        },
      },
    };
    const out = parseVtResponse(body, '1.2.3.4', 'ip');
    expect(out.score).toBeGreaterThanOrEqual(10);
    expect(out.is_malicious).toBe(true);
  });

  it('marks malicious when reputation < -10 even if score is low', () => {
    const body = {
      data: {
        attributes: {
          last_analysis_stats: { malicious: 1, harmless: 80, suspicious: 0, undetected: 7 },
          reputation: -15,
          categories: {},
        },
      },
    };
    const out = parseVtResponse(body, 'bad-actor.com', 'domain');
    expect(out.is_malicious).toBe(true); // because reputation < -10
  });

  it('handles empty response gracefully', () => {
    const body = {};
    const out = parseVtResponse(body, '1.1.1.1', 'ip');
    expect(out.ok).toBe(true);
    expect(out.detections).toBe(0);
    expect(out.total_engines).toBe(0);
    expect(out.is_malicious).toBe(false);
  });
});

describe('VirusTotal node — hashIoc (idempotency)', () => {
  it('produces deterministic 16-char hash', () => {
    const h1 = hashIoc('8.8.8.8');
    const h2 = hashIoc('8.8.8.8');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
    expect(h1).toMatch(/^[a-f0-9]+$/);
  });

  it('produces different hashes for different IOCs', () => {
    expect(hashIoc('8.8.8.8')).not.toBe(hashIoc('8.8.4.4'));
  });

  it('does NOT leak IOC value (one-way)', () => {
    const h = hashIoc('8.8.8.8');
    expect(h).not.toContain('8.8.8.8');
  });
});
