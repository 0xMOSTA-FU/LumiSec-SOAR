/**
 * Platform metrics helpers (enterprise mode only — no demo overlays).
 */
export function computeExposureRiskScore(
  alerts: Array<{ severity?: string; status?: string }>,
): number {
  const closed = new Set(['resolved', 'closed', 'false_positive', 'dismissed']);
  const open = alerts.filter(a => !closed.has(String(a.status ?? '').toLowerCase()));
  if (open.length === 0) return 12;

  const weight: Record<string, number> = {
    critical: 35,
    high: 22,
    medium: 12,
    low: 5,
  };

  const raw = open.reduce((sum, a) => {
    const sev = String(a.severity ?? 'medium').toLowerCase();
    return sum + (weight[sev] ?? 8);
  }, 0);

  const density = Math.min(1.5, 1 + open.length * 0.04);
  return Math.min(100, Math.round((raw / open.length) * density));
}
