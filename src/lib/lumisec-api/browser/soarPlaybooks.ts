import { apiClient } from '@/lib/lumisec-api/browser/api-client';
import { formatRunDuration } from '@/lib/lumisec-api/browser/playbookRunUi';
import {
  asArray,
  extractPagination,
  unwrapData,
  type ApiEnvelope,
  type PaginatedResult,
  type PaginationMeta,
} from '@/lib/lumisec-api/browser/envelope';

import type { EnrichmentSnapshot } from '@/lib/platform/enrichment-parse';

const PLAYBOOK_LIST_KEYS = ['items', 'playbooks', 'runs', 'playbook_runs', 'results', 'data'];

export interface SoarPlaybook {
  id: string;
  name: string;
  description?: string;
  trigger_type: string;
  status: string;
  step_count: number;
  last_run_at: string | null;
  workflow_id?: string | null;
  steps: unknown[];
}

export interface PlaybookFormInput {
  name: string;
  description?: string;
  trigger: string;
  steps: unknown[];
  workflow_id?: string | null;
}

export interface PlaybookRun {
  id: string;
  playbook_id: string;
  playbook_name?: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  triggered_by: string | null;
  duration: string | null;
  incident_id?: string | null;
}

export interface PlaybookRunStep {
  id: string;
  name: string;
  status: string;
  output: string | null;
  logs: string | null;
  order: number;
}

export interface PlaybookRunDetail extends PlaybookRun {
  steps: PlaybookRunStep[];
  enrichment?: EnrichmentSnapshot;
  display_ip?: string | null;
  partial_success?: boolean;
  duration_ms?: number | null;
}

function parseSteps(raw: Record<string, unknown>): unknown[] {
  const candidates = [raw.steps, raw.actions, raw.workflow_steps];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (typeof candidate === 'string' && candidate.trim()) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // ignore invalid JSON
      }
    }
  }
  return [];
}

export function normalizePlaybook(raw: Record<string, unknown>): SoarPlaybook {
  const steps = parseSteps(raw);
  const trigger =
    raw.trigger_type ?? raw.trigger ?? raw.triggerType ?? raw.trigger?.toString() ?? 'manual';
  const lastRun =
    raw.last_run_at ?? raw.lastRunAt ?? raw.last_run ?? raw.lastRun ?? null;

  return {
    id: String(raw.id ?? raw._id ?? ''),
    name: String(raw.name ?? 'Unnamed playbook'),
    description: raw.description ? String(raw.description) : undefined,
    trigger_type: String(trigger),
    status: String(raw.status ?? 'inactive'),
    step_count: Number(raw.step_count ?? raw.stepCount ?? steps.length) || steps.length,
    last_run_at: lastRun ? String(lastRun) : null,
    workflow_id: raw.workflow_id != null
      ? String(raw.workflow_id)
      : raw.workflowId != null
        ? String(raw.workflowId)
        : null,
    steps,
  };
}

function normalizePlaybookRunStep(
  raw: Record<string, unknown>,
  index: number,
): PlaybookRunStep {
  const output =
    raw.output ?? raw.result ?? raw.message ?? raw.response ?? null;
  const logs = raw.logs ?? raw.log ?? raw.output_log ?? raw.outputLog ?? null;

  return {
    id: String(raw.id ?? raw._id ?? raw.step_id ?? raw.stepId ?? index),
    name: String(raw.name ?? raw.step_name ?? raw.stepName ?? raw.label ?? `Step ${index + 1}`),
    status: String(raw.status ?? 'pending'),
    output: output !== null && output !== undefined ? String(output) : null,
    logs: logs !== null && logs !== undefined ? String(logs) : null,
    order: Number(raw.order ?? raw.step_order ?? raw.stepOrder ?? index),
  };
}

function parseRunSteps(raw: Record<string, unknown>): PlaybookRunStep[] {
  for (const key of ['steps', 'step_statuses', 'stepStatuses', 'execution_steps', 'actions']) {
    const candidate = raw[key];
    if (Array.isArray(candidate)) {
      return candidate
        .map((item, index) =>
          normalizePlaybookRunStep(
            item && typeof item === 'object' ? (item as Record<string, unknown>) : {},
            index,
          ),
        )
        .sort((a, b) => a.order - b.order);
    }
  }
  return [];
}

function normalizePlaybookRun(raw: Record<string, unknown>): PlaybookRun {
  const startedAt = String(
    raw.started_at ?? raw.startedAt ?? raw.created_at ?? raw.createdAt ?? '',
  );
  const completedAt =
    raw.completed_at ?? raw.completedAt
      ? String(raw.completed_at ?? raw.completedAt)
      : null;

  const triggered =
    raw.triggered_by ?? raw.triggeredBy ?? raw.triggered_by_user ?? raw.initiated_by ?? null;

  const duration = formatRunDuration(
    (raw.duration ?? raw.duration_ms ?? raw.durationMs) as string | number | null | undefined,
    startedAt,
    completedAt,
  );

  return {
    id: String(raw.id ?? raw._id ?? raw.run_id ?? raw.runId ?? ''),
    playbook_id: String(raw.playbook_id ?? raw.playbookId ?? raw.playbook ?? ''),
    playbook_name: raw.playbook_name
      ? String(raw.playbook_name)
      : raw.playbookName
        ? String(raw.playbookName)
        : undefined,
    status: String(raw.status ?? 'unknown'),
    started_at: startedAt,
    completed_at: completedAt,
    triggered_by: triggered ? String(triggered) : null,
    duration: duration === '—' ? null : duration,
    incident_id:
      raw.incident_id ?? raw.incidentId
        ? String(raw.incident_id ?? raw.incidentId)
        : null,
  };
}

function normalizePlaybookRunDetail(raw: Record<string, unknown>): PlaybookRunDetail {
  const enrichment = raw.enrichment as EnrichmentSnapshot | undefined;
  return {
    ...normalizePlaybookRun(raw),
    steps: parseRunSteps(raw),
    enrichment: enrichment && typeof enrichment === 'object' ? enrichment : undefined,
    display_ip: raw.display_ip != null ? String(raw.display_ip) : raw.displayIp != null ? String(raw.displayIp) : null,
    partial_success: Boolean(raw.partial_success ?? raw.partialSuccess),
    duration_ms: raw.duration_ms != null ? Number(raw.duration_ms) : raw.durationMs != null ? Number(raw.durationMs) : null,
  };
}

function buildPlaybookBody(input: PlaybookFormInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    steps: input.steps,
    triggers: [{ type: input.trigger }],
    status: 'active',
  };
  if (input.workflow_id !== undefined) body.workflow_id = input.workflow_id;
  return body;
}

export async function fetchPlaybooks(): Promise<SoarPlaybook[]> {
  const response = await apiClient.get<ApiEnvelope<unknown>>('/api/soar/playbooks');
  const data = unwrapData<unknown>(response);
  return asArray<Record<string, unknown>>(data, PLAYBOOK_LIST_KEYS).map(normalizePlaybook);
}

export async function fetchPlaybookById(id: string): Promise<SoarPlaybook> {
  const response = await apiClient.get<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/playbooks/${encodeURIComponent(id)}`,
  );
  const data = unwrapData(response);
  return normalizePlaybook(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function createPlaybook(input: PlaybookFormInput): Promise<SoarPlaybook> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    '/api/soar/playbooks',
    buildPlaybookBody(input),
  );
  const data = unwrapData(response);
  return normalizePlaybook(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : { name: input.name },
  );
}

export async function updatePlaybook(
  id: string,
  input: Partial<PlaybookFormInput> & { status?: string },
): Promise<SoarPlaybook> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.description !== undefined) body.description = input.description;
  if (input.trigger !== undefined) body.trigger = input.trigger;
  if (input.steps !== undefined) {
    body.actions = input.steps;
    body.steps = input.steps;
  }
  if (input.status !== undefined) body.status = input.status;
  if (input.workflow_id !== undefined) body.workflow_id = input.workflow_id;

  const response = await apiClient.patch<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/playbooks/${encodeURIComponent(id)}`,
    body,
  );
  const data = unwrapData(response);
  return normalizePlaybook(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function deletePlaybook(id: string): Promise<void> {
  await apiClient.delete(`/api/soar/playbooks/${encodeURIComponent(id)}`);
}

export async function setPlaybookStatus(
  id: string,
  active: boolean,
): Promise<SoarPlaybook> {
  return updatePlaybook(id, { status: active ? 'active' : 'inactive' });
}

export interface PlaybookRunFilters {
  playbook_id?: string;
  page?: number;
  limit?: number;
}

export async function fetchPlaybookRuns(
  filters: PlaybookRunFilters = {},
): Promise<PaginatedResult<PlaybookRun>> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (filters.playbook_id) {
    params.set('playbook_id', filters.playbook_id);
  }

  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/playbook-runs?${params.toString()}`,
  );
  const data = unwrapData<unknown>(response);
  const items = asArray<Record<string, unknown>>(data, PLAYBOOK_LIST_KEYS).map(normalizePlaybookRun);
  const pagination = extractPagination(data, { page, limit, itemCount: items.length });
  return { items, pagination };
}

export interface PlaybookRunResult {
  runId: string;
  raw: unknown;
}

function extractRunId(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  const nested =
    record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : record;
  return String(
    nested.id ??
      nested._id ??
      nested.run_id ??
      nested.runId ??
      nested.playbook_run_id ??
      '',
  );
}

export async function runPlaybookOnIncident(
  incidentId: string,
  playbookId: string,
): Promise<PlaybookRunResult> {
  const response = await apiClient.post<ApiEnvelope<unknown>>(
    `/api/soar/incidents/${encodeURIComponent(incidentId)}/playbooks/run`,
    { playbook_id: playbookId },
  );
  const data = unwrapData(response);
  const runId = extractRunId(data) || extractRunId(response);
  return { runId, raw: data };
}

export async function executePlaybook(
  playbookId: string,
  trigger: Record<string, unknown> = {},
): Promise<PlaybookRunResult> {
  const response = await apiClient.post<ApiEnvelope<unknown>>(
    `/api/playbooks/${encodeURIComponent(playbookId)}/execute`,
    { trigger },
  );
  const data = unwrapData(response);
  const runId = extractRunId(data) || extractRunId(response);
  return { runId, raw: data };
}

export async function fetchPlaybookRun(runId: string): Promise<PlaybookRunDetail> {
  const response = await apiClient.get<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/playbook-runs/${encodeURIComponent(runId)}`,
  );
  const data = unwrapData(response);
  return normalizePlaybookRunDetail(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function cancelPlaybookRun(runId: string): Promise<PlaybookRunDetail> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/playbook-runs/${encodeURIComponent(runId)}/cancel`,
    {},
  );
  const data = unwrapData(response);
  return normalizePlaybookRunDetail(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function pausePlaybookRun(runId: string): Promise<PlaybookRunDetail> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/playbook-runs/${encodeURIComponent(runId)}/pause`,
    {},
  );
  const data = unwrapData(response);
  return normalizePlaybookRunDetail(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}

export async function resumePlaybookRun(runId: string): Promise<PlaybookRunDetail> {
  const response = await apiClient.post<ApiEnvelope<Record<string, unknown>> | Record<string, unknown>>(
    `/api/soar/playbook-runs/${encodeURIComponent(runId)}/resume`,
    {},
  );
  const data = unwrapData(response);
  return normalizePlaybookRunDetail(
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {},
  );
}
