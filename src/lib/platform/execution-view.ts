/**
 * Normalize workflow execution payloads for API + UI consumers.
 */
import {
  extractEnrichmentFromOutputs,
  extractDisplayIp,
  type EnrichmentSnapshot,
} from '@/lib/platform/enrichment-parse';

export interface NodeOutputSummary {
  nodeId: string;
  label?: string;
  subtype?: string;
  ok: boolean;
  skipped?: boolean;
  preview?: string;
  output?: Record<string, unknown>;
}

export interface ExecutionView {
  enrichment: EnrichmentSnapshot;
  displayIp: string | null;
  partialSuccess: boolean;
  workflowSuccess: boolean;
  nodeSummaries: NodeOutputSummary[];
}

interface WorkflowNodeRef {
  id: string;
  subtype?: string;
  data?: { label?: string; config?: { subtype?: string } };
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function parseWorkflowNodes(nodes: unknown): WorkflowNodeRef[] {
  const parsed = parseJsonValue<WorkflowNodeRef[]>(nodes, []);
  return Array.isArray(parsed) ? parsed : [];
}

function summarizeNodeOutput(
  nodeId: string,
  output: Record<string, unknown>,
  nodeRef?: WorkflowNodeRef,
): NodeOutputSummary {
  const subtype =
    nodeRef?.subtype ||
    nodeRef?.data?.config?.subtype ||
    (output.ioc_type ? 'virustotal' : undefined);

  const vt = output.virustotal as Record<string, unknown> | undefined;
  const ipinfo = output.ipinfo as Record<string, unknown> | undefined;
  const abuse = output.abuseipdb as Record<string, unknown> | undefined;

  let ok = Boolean(output.ok);
  let skipped = false;
  let preview: string | undefined;

  if (vt && typeof vt === 'object') {
    ok = Boolean(vt.ok);
    skipped = Boolean(vt.skipped);
    if (vt.ok) {
      preview = `${vt.malicious ?? vt.detections ?? 0}/${vt.total ?? vt.total_engines ?? 0} engines`;
    } else {
      preview = String(vt.error || 'VirusTotal failed');
    }
  } else if (output.detections != null || output.total_engines != null) {
    ok = Boolean(output.ok);
    preview = `${output.detections ?? 0}/${output.total_engines ?? 0} engines`;
  } else if (ipinfo && typeof ipinfo === 'object') {
    ok = Boolean(ipinfo.ok);
    skipped = Boolean(ipinfo.skipped);
    preview = ok
      ? [ipinfo.country, ipinfo.city || ipinfo.org].filter(Boolean).join(', ')
      : String(ipinfo.error || 'IPInfo failed');
  } else if (abuse && typeof abuse === 'object') {
    ok = Boolean(abuse.ok);
    skipped = Boolean(abuse.skipped);
    preview = ok
      ? `score ${abuse.abuse_score ?? 0}%`
      : String(abuse.error || 'AbuseIPDB skipped');
  } else if (output.awaiting_approval) {
    ok = false;
    preview = 'Awaiting approval';
  } else if (output.message) {
    preview = String(output.message).slice(0, 120);
  } else if (output.error) {
    ok = false;
    preview = String(output.error);
  }

  return {
    nodeId,
    label: nodeRef?.data?.label,
    subtype,
    ok,
    skipped,
    preview,
    output,
  };
}

export function buildExecutionView(
  result: unknown,
  trigger: unknown,
  workflowNodes?: unknown,
): ExecutionView {
  const resultObj = parseJsonValue<Record<string, unknown>>(result, {});
  const triggerObj = parseJsonValue<Record<string, unknown>>(trigger, {});
  const nodes = parseWorkflowNodes(workflowNodes);

  const outputs =
    resultObj.outputs && typeof resultObj.outputs === 'object'
      ? (resultObj.outputs as Record<string, unknown>)
      : {};

  const enrichment = extractEnrichmentFromOutputs(outputs);
  const displayIp = extractDisplayIp(outputs, triggerObj);
  const workflowSuccess = Boolean(resultObj.success);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeSummaries = Object.entries(outputs).map(([nodeId, raw]) =>
    summarizeNodeOutput(
      nodeId,
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {},
      nodeById.get(nodeId),
    ),
  );

  const hasEnrichment =
    Boolean(enrichment.virustotal?.ok) ||
    Boolean(enrichment.ipinfo?.ok) ||
    Boolean(enrichment.abuseipdb?.ok);

  const partialSuccess = !workflowSuccess && hasEnrichment;

  return {
    enrichment,
    displayIp,
    partialSuccess,
    workflowSuccess,
    nodeSummaries,
  };
}
