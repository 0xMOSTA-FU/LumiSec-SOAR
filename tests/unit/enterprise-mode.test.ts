import { describe, expect, it } from 'vitest';
import { computeExposureRiskScore } from '@/lib/platform/enterprise-mode';
import { getConnectorActionsForIntegration } from '@/lib/integrations/connector-actions';

describe('enterprise-mode', () => {
  it('computes exposure risk from open alerts', () => {
    expect(computeExposureRiskScore([])).toBe(12);
    expect(
      computeExposureRiskScore([
        { severity: 'critical', status: 'new' },
        { severity: 'high', status: 'investigating' },
      ]),
    ).toBeGreaterThan(25);
    expect(
      computeExposureRiskScore([{ severity: 'low', status: 'resolved' }]),
    ).toBe(12);
  });
});

describe('connector-actions', () => {
  it('returns test + manifest actions for virustotal', () => {
    const actions = getConnectorActionsForIntegration('virustotal', 'VirusTotal');
    expect(actions.some(a => a.id === 'test')).toBe(true);
    expect(actions.length).toBeGreaterThan(1);
  });
});
