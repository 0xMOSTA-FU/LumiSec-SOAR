import { describe, it, expect } from 'vitest';
import {
  formatDurationMs,
  parseAnalyticsDays,
  pctDelta,
} from '@/lib/soar/metrics/dashboard-metrics';

describe('dashboard-metrics helpers', () => {
  it('formats durations for sub-hour and multi-hour values', () => {
    expect(formatDurationMs(45_000)).toBe('45s');
    expect(formatDurationMs(135_000)).toBe('2m');
    expect(formatDurationMs(7_500_000)).toBe('2h 5m');
  });

  it('parses supported analytics day ranges', () => {
    expect(parseAnalyticsDays('7')).toBe(7);
    expect(parseAnalyticsDays('30')).toBe(30);
    expect(parseAnalyticsDays('invalid')).toBe(30);
  });

  it('computes percent delta between periods', () => {
    expect(pctDelta(10, 5)).toBe(100);
    expect(pctDelta(0, 0)).toBe(0);
    expect(pctDelta(5, 10)).toBe(-50);
  });
});
