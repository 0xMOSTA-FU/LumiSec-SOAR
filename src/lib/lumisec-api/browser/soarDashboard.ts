import { apiClient } from '@/lib/lumisec-api/browser/api-client';
import {
  type ApiEnvelope,
  type PaginatedResult,
  type PaginationMeta,
  asArray,
  toPaginatedResult,
  unwrapData,
} from '@/lib/lumisec-api/browser/envelope';

export type { PaginatedResult, PaginationMeta };

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export interface DashboardAnalyst {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: 'active' | 'inactive';
  initials: string;
  department: string;
  openAssignments: number;
  avgResponseTime: string;
  lastActiveMinutesAgo: number;
  workloadFocus: string;
  lastActiveAt: string;
  open_assignments: number;
  avg_response_time: string;
}

function normalizeAnalystRow(row: Record<string, unknown>): DashboardAnalyst {
  const name = String(row.name ?? row.fullName ?? row.full_name ?? 'Analyst').trim();
  const email = String(row.email ?? '').trim();
  const id = String(row.id ?? row._id ?? (email || name));
  const openAssignments = Number(row.open_assignments ?? row.openAssignments ?? 0);
  const avgResponse = String(row.avg_response_time ?? row.avgResponseTime ?? '—');
  const resolvedCount = Number(row.resolved_count ?? row.resolvedCount ?? 0);
  const open = Number.isFinite(openAssignments) ? openAssignments : 0;

  return {
    id,
    fullName: name,
    email: email || `${id}@local`,
    role: String(row.role ?? (resolvedCount > 10 ? 'Senior Analyst' : 'Analyst')),
    status: String(row.status ?? 'active') === 'inactive' ? 'inactive' : 'active',
    initials: String(row.initials ?? initialsFromName(name)),
    department: String(row.department ?? 'SOC'),
    openAssignments: open,
    avgResponseTime: avgResponse,
    lastActiveMinutesAgo: 0,
    workloadFocus: String(row.workloadFocus ?? row.workload_focus ?? (open > 0 ? 'Active cases' : 'Monitoring')),
    lastActiveAt: String(row.last_active_at ?? row.lastActiveAt ?? row.last_active ?? new Date().toISOString()),
    open_assignments: open,
    avg_response_time: avgResponse,
  };
}

function normalizeAnalystsFromApi(apiRows: Array<Record<string, unknown>>): DashboardAnalyst[] {
  if (apiRows.length === 0) return [];
  return apiRows.map(normalizeAnalystRow);
}

export interface DashboardOverview {
  open_incidents: number;
  critical_count: number;
  mttr: string | number;
  [key: string]: unknown;
}

export interface DashboardIncident {
  id: string;
  title: string;
  severity: string;
  status: string;
  assigned_to: string | null;
  created_at: string;
}

export interface DashboardPlaybookSummary {
  name: string;
  total_runs?: number;
  successful_runs?: number;
  failed_runs?: number;
  success_rate?: number;
  [key: string]: unknown;
}

export interface DashboardAutomation {
  success_rate: number;
  triggered_count: number;
  [key: string]: unknown;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function normalizeAutomation(raw: unknown): DashboardAutomation {
  let record = toRecord(raw);

  for (const nestedKey of ['stats', 'automation', 'metrics', 'summary']) {
    const nested = record[nestedKey];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      record = { ...record, ...toRecord(nested) };
    }
  }

  const success_rate =
    pickNumber(record, [
      'success_rate',
      'successRate',
      'automation_success_rate',
      'rate',
      'success_percentage',
    ]) ?? 0;

  const triggered_count =
    pickNumber(record, [
      'triggered_count',
      'triggeredCount',
      'triggered',
      'total_triggered',
      'automations_triggered',
      'automation_triggered',
      'executions_triggered',
      'count',
      'total',
    ]) ?? 0;

  return {
    ...record,
    success_rate,
    triggered_count,
  };
}

export interface DashboardConnector {
  name: string;
  type: string;
  status: string;
  last_seen: string | null;
  [key: string]: unknown;
}

const DASHBOARD_LIST_KEYS = ['items', 'incidents', 'playbooks', 'connectors', 'analysts', 'results', 'data'];

export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const response = await apiClient.get<ApiEnvelope<DashboardOverview> | DashboardOverview>(
    '/api/soar/dashboard/overview',
  );
  return unwrapData(response);
}

export async function fetchDashboardIncidents(
  page = 1,
  limit = 20,
): Promise<PaginatedResult<DashboardIncident>> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/dashboard/incidents?page=${page}&limit=${limit}`,
  );
  return toPaginatedResult<DashboardIncident>(response, page, limit, DASHBOARD_LIST_KEYS);
}

export async function fetchDashboardPlaybooks(): Promise<DashboardPlaybookSummary[]> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    '/api/soar/dashboard/playbooks',
  );
  const data = unwrapData<unknown>(response);
  return asArray<DashboardPlaybookSummary>(data, DASHBOARD_LIST_KEYS);
}

export async function fetchDashboardAutomation(): Promise<DashboardAutomation> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    '/api/soar/dashboard/automation',
  );
  return normalizeAutomation(unwrapData(response));
}

export async function fetchDashboardAnalysts(): Promise<DashboardAnalyst[]> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    '/api/soar/dashboard/analysts',
  );
  const data = unwrapData<unknown>(response);
  const rows = asArray<Record<string, unknown>>(data, DASHBOARD_LIST_KEYS);
  return normalizeAnalystsFromApi(rows);
}

export async function fetchDashboardConnectors(
  page = 1,
  limit = 20,
): Promise<PaginatedResult<DashboardConnector>> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/dashboard/connectors?page=${page}&limit=${limit}`,
  );
  return toPaginatedResult<DashboardConnector>(response, page, limit, DASHBOARD_LIST_KEYS);
}
