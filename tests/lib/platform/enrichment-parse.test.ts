import { describe, expect, it } from 'vitest';
import { buildExecutionView } from '@/lib/platform/execution-view';
import {
  extractDisplayIp,
  extractEnrichmentFromOutputs,
} from '@/lib/platform/enrichment-parse';

describe('extractEnrichmentFromOutputs', () => {
  it('parses nested legacy virustotal output', () => {
    const enrichment = extractEnrichmentFromOutputs({
      n2: {
        virustotal: {
          ok: true,
          malicious: 2,
          suspicious: 1,
          harmless: 50,
          undetected: 38,
          total: 91,
          score: 2,
          is_malicious: false,
          reputation: 100,
        },
      },
    });

    expect(enrichment.virustotal?.ok).toBe(true);
    expect(enrichment.virustotal?.malicious).toBe(2);
    expect(enrichment.virustotal?.total).toBe(91);
  });

  it('parses flat manifest virustotal output', () => {
    const enrichment = extractEnrichmentFromOutputs({
      n2: {
        ok: true,
        ioc: '8.8.8.8',
        ioc_type: 'ip',
        detections: 0,
        total_engines: 91,
        score: 0,
        is_malicious: false,
        virustotal: {
          ok: true,
          malicious: 0,
          total: 91,
          score: 0,
          is_malicious: false,
        },
      },
    });

    expect(enrichment.virustotal?.ok).toBe(true);
    expect(enrichment.virustotal?.total).toBe(91);
  });

  it('parses ipinfo and abuseipdb nested outputs', () => {
    const enrichment = extractEnrichmentFromOutputs({
      n4: { ipinfo: { ok: true, ip: '8.8.8.8', country: 'US', city: 'Mountain View', org: 'Google' } },
      n3: { abuseipdb: { ok: false, skipped: true, error: 'No API key' } },
    });

    expect(enrichment.ipinfo?.country).toBe('US');
    expect(enrichment.abuseipdb?.skipped).toBe(true);
  });
});

describe('extractDisplayIp', () => {
  it('prefers trigger ip', () => {
    expect(
      extractDisplayIp(
        { n2: { virustotal: { ok: true, ioc: '1.1.1.1' } } },
        { ip: '8.8.8.8' },
      ),
    ).toBe('8.8.8.8');
  });

  it('falls back to enrichment ioc', () => {
    expect(
      extractDisplayIp({
        n2: { ok: true, ioc: '1.1.1.1', virustotal: { ok: true, ioc: '1.1.1.1' } },
      }),
    ).toBe('1.1.1.1');
  });
});

describe('buildExecutionView', () => {
  it('marks partial success when enrichment ok but workflow failed', () => {
    const view = buildExecutionView(
      {
        success: false,
        failed_nodes: 1,
        outputs: {
          n2: { virustotal: { ok: true, malicious: 0, total: 91, score: 0, is_malicious: false } },
          n4: { ipinfo: { ok: true, ip: '8.8.8.8', country: 'US' } },
        },
      },
      { ip: '8.8.8.8' },
      JSON.stringify([
        { id: 'n2', subtype: 'virustotal', data: { label: 'VirusTotal Lookup' } },
        { id: 'n4', subtype: 'ipinfo', data: { label: 'IPInfo' } },
      ]),
    );

    expect(view.partialSuccess).toBe(true);
    expect(view.displayIp).toBe('8.8.8.8');
    expect(view.nodeSummaries).toHaveLength(2);
    expect(view.nodeSummaries[0].preview).toContain('engines');
  });
});
