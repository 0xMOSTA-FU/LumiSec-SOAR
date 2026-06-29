import { apiClient, ApiError } from '@/lib/lumisec-api/browser/api-client';
import { unwrapData, type ApiEnvelope } from '@/lib/lumisec-api/browser/envelope';

export type AnalyticsDays = 7 | 14 | 30 | 90;
export type ExportFormat = 'pdf' | 'csv';

export interface AnalyticsKpi {
  key: string;
  label: string;
  value: string;
  delta: number | null;
  lowerIsBetter: boolean;
}

export interface SnapshotPoint {
  date: string;
  value: number;
}

export interface SnapshotSeries {
  key: string;
  label: string;
  points: SnapshotPoint[];
}

export interface AnalyticsSnapshots {
  series: SnapshotSeries[];
  combined: Record<string, string | number>[];
}

export interface ReportTableRow {
  [key: string]: string | number | null;
}

export interface AnalyticsReportSection {
  title: string;
  type: 'text' | 'table';
  text?: string;
  rows?: ReportTableRow[];
  columns?: string[];
}

export interface AnalyticsReport {
  summary: string | null;
  sections: AnalyticsReportSection[];
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function formatLabel(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatMetricValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function isLowerIsBetterKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('mttr') ||
    normalized.includes('mttd') ||
    normalized.includes('response') ||
    normalized.includes('resolve') ||
    normalized.includes('false_positive') ||
    normalized.includes('false positive') ||
    normalized.includes('latency') ||
    normalized.includes('duration')
  );
}

const META_KEYS = new Set([
  'days',
  'period',
  'meta',
  'generated_at',
  'generatedAt',
  'updated_at',
  'updatedAt',
  'from',
  'to',
  'start_date',
  'end_date',
]);

const DATE_KEYS = ['date', 'timestamp', 'time', 'period', 'week', 'label', 'x', 'day', 'bucket'];

function extractDateLabel(point: Record<string, unknown>, index: number): string {
  for (const key of DATE_KEYS) {
    const value = point[key];
    if (value !== null && value !== undefined && value !== '') {
      return String(value);
    }
  }
  return `Point ${index + 1}`;
}

function extractNumericValue(point: Record<string, unknown>, seriesKey?: string): number | null {
  if (seriesKey && point[seriesKey] !== undefined) {
    const direct = pickNumber(point, [seriesKey]);
    if (direct !== null) return direct;
  }

  for (const key of ['value', 'count', 'total', 'amount', 'y']) {
    const num = pickNumber(point, [key]);
    if (num !== null) return num;
  }

  for (const [key, value] of Object.entries(point)) {
    if (DATE_KEYS.includes(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }

  return null;
}

function parsePointsArray(value: unknown[], seriesKey?: string): SnapshotPoint[] {
  const points: SnapshotPoint[] = [];

  value.forEach((item, index) => {
    if (typeof item === 'number' && Number.isFinite(item)) {
      points.push({ date: `Point ${index + 1}`, value: item });
      return;
    }

    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const numeric = extractNumericValue(record, seriesKey);
    if (numeric === null) return;
    points.push({ date: extractDateLabel(record, index), value: numeric });
  });

  return points;
}

function mergeSeriesByDate(series: SnapshotSeries[]): Record<string, string | number>[] {
  const byDate = new Map<string, Record<string, string | number>>();

  for (const item of series) {
    for (const point of item.points) {
      const row = byDate.get(point.date) ?? { date: point.date };
      row[item.key] = point.value;
      byDate.set(point.date, row);
    }
  }

  return Array.from(byDate.values());
}

function normalizeCombined(rows: Record<string, unknown>[]): Record<string, string | number>[] {
  return rows.map((row, index) => {
    const normalized: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        normalized[key] = value;
      } else if (typeof value === 'string') {
        normalized[key] = value;
      } else if (DATE_KEYS.includes(key)) {
        normalized[key] = String(value);
      }
    }
    if (!normalized.date && !normalized.timestamp && !normalized.time) {
      normalized.date = extractDateLabel(row, index);
    }
    return normalized;
  });
}

function extractSeriesFromCombined(rows: Record<string, string | number>[]): SnapshotSeries[] {
  if (rows.length === 0) return [];

  const dateKey =
    DATE_KEYS.find((key) => rows.some((row) => row[key] !== undefined)) ?? 'date';

  const metricKeys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key === dateKey || DATE_KEYS.includes(key)) continue;
      if (typeof row[key] === 'number') metricKeys.add(key);
    }
  }

  return Array.from(metricKeys).map((key) => ({
    key,
    label: formatLabel(key),
    points: rows.map((row) => ({
      date: String(row[dateKey] ?? row.date ?? ''),
      value: Number(row[key] ?? 0),
    })),
  }));
}

function normalizeKpis(raw: unknown): AnalyticsKpi[] {
  const data = toRecord(unwrapData(raw));
  const kpis: AnalyticsKpi[] = [];
  const consumed = new Set<string>();

  for (const [key, value] of Object.entries(data)) {
    if (META_KEYS.has(key)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

    const obj = value as Record<string, unknown>;
    const metricValue = obj.value ?? obj.current ?? obj.count ?? obj.total ?? obj.amount;
    if (metricValue === undefined) continue;

    const delta = pickNumber(obj, [
      'delta',
      'change',
      'delta_pct',
      'delta_percent',
      'change_percent',
      'changePercent',
      'trend',
    ]);

    kpis.push({
      key,
      label: String(obj.label ?? obj.name ?? formatLabel(key)),
      value: formatMetricValue(metricValue),
      delta,
      lowerIsBetter: isLowerIsBetterKey(key),
    });
    consumed.add(key);
  }

  for (const [key, value] of Object.entries(data)) {
    if (consumed.has(key) || META_KEYS.has(key)) continue;
    if (key.endsWith('_delta') || key.endsWith('_change') || key.endsWith('Delta')) continue;

    const delta =
      pickNumber(data, [
        `${key}_delta`,
        `${key}_change`,
        `${key}Delta`,
        `${key}Change`,
        `${key}_delta_pct`,
        `${key}_change_percent`,
      ]) ?? null;

    if (
      value !== null &&
      value !== undefined &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    ) {
      kpis.push({
        key,
        label: formatLabel(key),
        value: formatMetricValue(value),
        delta,
        lowerIsBetter: isLowerIsBetterKey(key),
      });
    }
  }

  return kpis;
}

function normalizeSnapshots(raw: unknown): AnalyticsSnapshots {
  const record = toRecord(unwrapData(raw));

  for (const key of ['snapshots', 'timeseries', 'time_series', 'series', 'data']) {
    const candidate = record[key];
    if (Array.isArray(candidate) && candidate.length > 0 && typeof candidate[0] === 'object') {
      const combined = normalizeCombined(candidate as Record<string, unknown>[]);
      return {
        combined,
        series: extractSeriesFromCombined(combined),
      };
    }
  }

  const series: SnapshotSeries[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (META_KEYS.has(key)) continue;
    if (!Array.isArray(value) || value.length === 0) continue;

    const points = parsePointsArray(value, key);
    if (points.length > 0) {
      series.push({ key, label: formatLabel(key), points });
    }
  }

  return {
    series,
    combined: mergeSeriesByDate(series),
  };
}

function tableRowsFromArray(value: unknown[]): ReportTableRow[] {
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const row: ReportTableRow = {};
      for (const [key, cell] of Object.entries(item as Record<string, unknown>)) {
        if (cell === null || cell === undefined) {
          row[key] = null;
        } else if (typeof cell === 'number' || typeof cell === 'string') {
          row[key] = cell;
        } else {
          row[key] = formatMetricValue(cell);
        }
      }
      return row;
    });
}

function inferColumns(rows: ReportTableRow[]): string[] {
  if (rows.length === 0) return [];
  const keys = new Set<string>();
  for (const row of rows) {
    Object.keys(row).forEach((key) => keys.add(key));
  }
  return Array.from(keys);
}

function normalizeReport(raw: unknown): AnalyticsReport {
  const record = toRecord(unwrapData(raw));
  const sections: AnalyticsReportSection[] = [];

  const summary =
    typeof record.summary === 'string'
      ? record.summary
      : typeof record.overview === 'string'
        ? record.overview
        : typeof record.description === 'string'
          ? record.description
          : record.summary && typeof record.summary === 'object'
            ? formatMetricValue((record.summary as Record<string, unknown>).text)
            : null;

  const sectionMappings: Array<{ keys: string[]; title: string }> = [
    { keys: ['by_severity', 'severity_breakdown', 'incidents_by_severity'], title: 'By Severity' },
    { keys: ['by_type', 'type_breakdown', 'incidents_by_type', 'top_incident_types'], title: 'By Type' },
    { keys: ['analyst_performance', 'analysts', 'top_analysts'], title: 'Analyst Performance' },
    { keys: ['top_playbooks', 'playbooks', 'automated_playbooks'], title: 'Top Playbooks' },
    { keys: ['incidents_over_time', 'timeline', 'weekly_breakdown'], title: 'Incidents Over Time' },
  ];

  for (const mapping of sectionMappings) {
    for (const key of mapping.keys) {
      const value = record[key];
      if (Array.isArray(value) && value.length > 0) {
        const rows = tableRowsFromArray(value);
        sections.push({
          title: mapping.title,
          type: 'table',
          rows,
          columns: inferColumns(rows),
        });
        break;
      }
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (META_KEYS.has(key)) continue;
    if (['summary', 'overview', 'description'].includes(key)) continue;
    if (sectionMappings.some((mapping) => mapping.keys.includes(key))) continue;

    if (typeof value === 'string' && value.trim()) {
      sections.push({ title: formatLabel(key), type: 'text', text: value });
    } else if (Array.isArray(value) && value.length > 0) {
      const rows = tableRowsFromArray(value);
      if (rows.length > 0) {
        sections.push({
          title: formatLabel(key),
          type: 'table',
          rows,
          columns: inferColumns(rows),
        });
      }
    }
  }

  return { summary, sections };
}

export async function fetchAnalyticsKpis(days: AnalyticsDays = 30): Promise<AnalyticsKpi[]> {
  const response = await apiClient.get<ApiEnvelope<unknown> | unknown>(
    `/api/soar/analytics/kpis?days=${days}`,
  );
  return normalizeKpis(response);
}

export async function fetchAnalyticsSnapshots(days: AnalyticsDays = 30): Promise<AnalyticsSnapshots> {
  const response = await apiClient.get<ApiEnvelope<unknown> | unknown>(
    `/api/soar/analytics/snapshots?days=${days}`,
  );
  return normalizeSnapshots(response);
}

export async function fetchAnalyticsReport(days: AnalyticsDays = 30): Promise<AnalyticsReport> {
  const response = await apiClient.get<ApiEnvelope<unknown> | unknown>(
    `/api/soar/analytics/report?days=${days}`,
  );
  return normalizeReport(response);
}

export async function exportAnalyticsReport(
  format: ExportFormat,
  days: AnalyticsDays,
): Promise<void> {
  const response = await apiClient.post<ApiEnvelope<{
    export_url?: string;
    url?: string;
    content?: string;
    filename?: string;
    format?: string;
  }>>(
    '/api/soar/analytics/export',
    { format, days },
  );
  const data = unwrapData(response);
  if (data?.content && data.filename) {
    const mime = data.format === 'csv' || format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
    const blob = new Blob([data.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = data.filename;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const url = data?.export_url || data?.url;
  if (url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function fetchAllAnalytics(days: AnalyticsDays = 30): Promise<{
  kpis: AnalyticsKpi[];
  snapshots: AnalyticsSnapshots;
  report: AnalyticsReport;
}> {
  const [kpis, snapshots, report] = await Promise.all([
    fetchAnalyticsKpis(days),
    fetchAnalyticsSnapshots(),
    fetchAnalyticsReport(),
  ]);
  return { kpis, snapshots, report };
}
