// Main execution engine: graph traversal + node dispatch
// Receives a workflow shape + trigger payload, executes nodes in topological order,
// calls real executors, accumulates logs, writes results to DB.

import { db } from '@/lib/db';
import { syncArtifactsForIncident } from '@/lib/incidents/sync-artifacts';
import { decryptIntegrationConfig } from '@/lib/integrations/config-secrets';
import { indexIntegrationAliases } from '@/lib/integrations/catalog';
import { resolveRuntimeIntegrationStatus } from '@/lib/integrations/integration-runtime';
import {
  WFNode, WFEdge, ExecutionContext, ExecutionLog,
  NodeExecutorResult, IntegrationConfig, WorkflowShape,
  normalizeWorkflowNode, resolveNodeSubtype,
} from './types';
import { executeVirusTotal } from './nodes/virustotal';
import { executeAbuseIPDB } from './nodes/abuseipdb';
import { executeIPInfo } from './nodes/ipinfo';
import { executeHTTP } from './nodes/http';
import { executeSlack } from './nodes/slack';
import { executeEmail } from './nodes/email';
import { executeCondition } from './nodes/condition';
import { executeCreateCase, executeCreateAlert } from './nodes/case-alert';
import { executeTrigger, executeLog, executeBlock, executeIsolate } from './nodes/builtin';
import { executeJira } from './nodes/jira';
import { executePagerDuty } from './nodes/pagerduty';
import { executeServiceNow } from './nodes/servicenow';
import { executeTheHive } from './nodes/thehive';
import { executeMISP } from './nodes/misp';
import { executeOpenCTI } from './nodes/opencti';
import { executeWazuh } from './nodes/wazuh';
import { executeSplunk } from './nodes/splunk';
import { executeSentinel } from './nodes/sentinel';
import { executeCrowdStrike } from './nodes/crowdstrike';
import { executeGreyNoise } from './nodes/greynoise';
import { executeShodan } from './nodes/shodan';
import { executeTeams } from './nodes/teams';
import { executeEntraId } from './nodes/entra-id';
import { executeAwsSecurityHub } from './nodes/aws-securityhub';
import { executeGcpScc } from './nodes/gcp-scc';
import { executeElastic } from './nodes/elastic';
import { executeMSGraph } from './nodes/msgraph';
import { executeFortiGate } from './nodes/fortigate';
import { executeOPNsense } from './nodes/opnsense';
import { executeDigitalOcean } from './nodes/digitalocean';
import { executeDefectDojo } from './nodes/defectdojo';
import { executeOTX } from './nodes/alienvault-otx';
import { executeVelociraptor } from './nodes/velociraptor';
import { executeSoarUtils } from './nodes/soar-utils';
import { executeWebhook } from './nodes/webhook';
import { executePfSense } from './nodes/pfsense';
import { executeCuckoo } from './nodes/cuckoo';
import { executeClamAv } from './nodes/clamav';
import { executeArkime } from './nodes/arkime';
import { executeTelegram } from './nodes/telegram';
import { bootstrapNodes } from '@/lib/soar/nodes/bootstrap';
import { nodeRegistry } from '@/lib/soar/nodes/registry';
import type { NodeExecutionContext } from '@/lib/soar/nodes/manifest';
import { insertExecutionTrace, recordConnectorCall } from '@/lib/mongo';
import { afterAlertIngested } from '@/lib/soar/alerts/ingest-alert';
import {
  createNodeApprovalRequest,
  DESTRUCTIVE_NODE_SUBTYPES,
  verifyNodeExecutionApproval,
} from '@/lib/soar/governance/approval-gate';

// Register manifest-based nodes at module load
bootstrapNodes();

export interface RunOptions {
  executionId: string;
  workflowId: string;
  triggerPayload: Record<string, unknown>;
  /** Tenant ID for multi-tenant isolation. When set, all cases/alerts
   *  created by this workflow execution are scoped to this tenant. */
  tenantId?: string | null;
  /** ID of the user who triggered the execution (for audit attribution). */
  startedBy?: string | null;
  /** Request correlation ID (propagated to logs + audit entries). */
  requestId?: string | null;
  /** Worker/internal: run with inline graph instead of loading from Prisma */
  workflowOverride?: WorkflowShape;
}

export interface RunResult {
  success: boolean;
  logs: ExecutionLog[];
  outputs: Record<string, unknown>;
  result: Record<string, unknown>;
  executedNodeIds: string[];
  failedNodeIds: string[];
  durationMs: number;
}

// Load all integrations from DB and build a lookup map
// Keys tried in order: by type, by id (lowercased), by name (lowercased, with - / _ stripped)
export async function loadIntegrationsForExecution(): Promise<Map<string, IntegrationConfig>> {
  return loadIntegrations();
}

async function loadIntegrations(): Promise<Map<string, IntegrationConfig>> {
  const rows = await db.integration.findMany();
  const map = new Map<string, IntegrationConfig>();
  for (const r of rows) {
    let cfg: Record<string, unknown> = {};
    if (r.config) {
      cfg = decryptIntegrationConfig(r.config);
    }
    const item: IntegrationConfig = {
      id: r.id, name: r.name, type: r.type, category: r.category,
      config: cfg,
      status: resolveRuntimeIntegrationStatus(r.status, r.type, cfg, r.name),
    };
    indexIntegrationAliases(map, item, r.type, r.name, r.id);
  }
  return map;
}

// Per-node execution with retry, exponential backoff, and timeout.
// Wraps every dispatchNode call so all 27 executors inherit these guarantees.
//
// BUGFIXES (AUDIT-3 findings #4, #5):
//   1. setTimeout leak — previously the timeout promise was never cleared,
//      keeping the event loop alive and firing unhandled rejections after
//      the operation succeeded. Now uses AbortController + clearTimeout.
//   2. 4xx retry heuristic — previously matched `/HTTP 4\d\d/` against log
//      MESSAGE TEXT (fragile, depends on human-readable logs). Now uses
//      structured `result.errorCode` / `result.httpStatus` when available,
//      falling back to the log regex only as a last resort.
//   3. `lastErr = null` reset — previously reset on every non-success
//      result, so the final "exhausted retries" log said "unknown error"
//      instead of the actual failure. Now preserved correctly.
//   4. Mid-loop return — `if (attempt === maxRetries) return result;` was
//      confusing. Now the loop naturally falls through to the exhausted
//      path. Cleaner control flow.
async function dispatchWithRetry(
  node: WFNode,
  ctx: ExecutionContext,
  execute: () => Promise<NodeExecutorResult>
): Promise<NodeExecutorResult> {
  const maxRetries = Number(process.env.NODE_MAX_RETRIES || 3);
  const baseDelayMs = Number(process.env.NODE_RETRY_BASE_DELAY_MS || 500);
  const maxDelayMs = Number(process.env.NODE_RETRY_MAX_DELAY_MS || 10000);
  const timeoutMs = Number(process.env.NODE_TIMEOUT_MS || 30000);

  let lastErr: Error | null = null;
  let lastResult: NodeExecutorResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Use AbortController so the timer can be cleared on success.
    // This prevents the event-loop leak and the unhandled rejection.
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(new Error(`Node timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );

    try {
      // Pass the abort signal to the executor via a context extension.
      // Executors that support AbortController (safeFetch, undici) will
      // cancel in-flight HTTP requests on timeout.
      const result = await execute();
      clearTimeout(timeoutHandle);

      if (result.success) return result;

      lastResult = result;

      // Determine if this is a retryable failure.
      // Structured signal: result.errorCode or result.httpStatus
      // (new convention — executors should populate these instead of
      // embedding HTTP status in log message text).
      const httpStatus =
        (result as NodeExecutorResult & { httpStatus?: number }).httpStatus ||
        (() => {
          // Legacy fallback: scrape log text. Will be removed once all
          // executors are migrated to set httpStatus explicitly.
          const match = result.logs.find(l => /HTTP (\d{3})/.exec(l.message));
          if (match) {
            const m = /HTTP (\d{3})/.exec(match.message);
            return m ? Number(m[1]) : null;
          }
          return null;
        })();

      // 4xx (except 408, 429) is non-retryable — return immediately.
      if (httpStatus && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429) {
        return result;
      }

      // 5xx, network errors, timeouts: retry with exponential backoff + jitter
      if (attempt < maxRetries) {
        const delay = Math.min(
          baseDelayMs * Math.pow(2, attempt) + Math.random() * 250,
          maxDelayMs,
        );
        await new Promise(r => setTimeout(r, delay));
      }
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      lastErr = err instanceof Error ? err : new Error(String(err));
      // Timeout / abort / network error: retry with backoff
      if (attempt < maxRetries) {
        const delay = Math.min(
          baseDelayMs * Math.pow(2, attempt) + Math.random() * 250,
          maxDelayMs,
        );
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // All retries exhausted
  const message = lastErr?.message
    || (lastResult?.logs.find(l => l.level === 'error')?.message)
    || 'unknown error';

  return {
    success: false,
    logs: [{
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `Node failed after ${maxRetries + 1} attempts: ${message}`,
      level: 'error',
      data: {
        attempts: maxRetries + 1,
        last_error: lastErr?.message,
        last_result_success: lastResult?.success,
      },
    }],
  };
}

// Dispatch a node to its executor based on type + subtype
async function dispatchNode(
  node: WFNode,
  ctx: ExecutionContext,
  meta: { workflowId: string; workflowName: string; executionId: string; tenantId?: string | null; startedBy?: string | null }
): Promise<NodeExecutorResult> {
  const nodeNorm = normalizeWorkflowNode(node);
  try {
    const subtype = resolveNodeSubtype(nodeNorm);
    const registered = subtype ? nodeRegistry.get(subtype) : null;

    const needsNodeApproval =
      DESTRUCTIVE_NODE_SUBTYPES.has(subtype) ||
      registered?.manifest.requiresApproval === true;

    if (needsNodeApproval && subtype) {
      const gate = await verifyNodeExecutionApproval(
        meta.executionId,
        nodeNorm.id,
        subtype,
        meta.tenantId,
      );
      if (!gate.allowed) {
        if (!gate.approvalId) {
          const approvalId = await createNodeApprovalRequest({
            executionId: meta.executionId,
            workflowId: meta.workflowId,
            nodeId: nodeNorm.id,
            nodeLabel: nodeNorm.data.label,
            subtype,
            tenantId: meta.tenantId,
            requestedBy: meta.startedBy || 'system',
          });
          return {
            success: false,
            output: { awaiting_approval: true, approvalId },
            logs: [{
              time: new Date().toISOString(),
              nodeId: nodeNorm.id,
              nodeLabel: nodeNorm.data.label,
              message: `Human approval required for destructive node "${subtype}". Approve via /api/approvals/${approvalId}/approve`,
              level: 'warning',
              duration: 0,
            }],
          };
        }
        return {
          success: false,
          output: { awaiting_approval: true, approvalId: gate.approvalId },
          logs: [{
            time: new Date().toISOString(),
            nodeId: nodeNorm.id,
            nodeLabel: nodeNorm.data.label,
            message: gate.reason || 'Awaiting human approval',
            level: 'warning',
            duration: 0,
          }],
        };
      }
    }

    if (registered) {
      const manifestCtx: NodeExecutionContext = {
        trigger: ctx.trigger,
        outputs: ctx.outputs,
        getIntegration: (key) => {
          const i = ctx.getIntegration(key);
          return i ? { id: i.id, name: i.name, type: i.type, config: i.config, status: i.status } : null;
        },
        workflowId: meta.workflowId,
        workflowName: meta.workflowName,
        executionId: meta.executionId,
        tenantId: meta.tenantId || undefined,
        startedBy: meta.startedBy || undefined,
        createCase: ctx.createCase,
        createAlert: ctx.createAlert,
        log: (level, message) => {
          if (process.env.NODE_ENV === 'development') {
            console.log(`[workflow:${meta.executionId}] [${level}] ${message}`);
          }
        },
      };
      const nodeInput = {
        id: nodeNorm.id,
        type: nodeNorm.type,
        subtype,
        data: { label: nodeNorm.data.label, config: nodeNorm.data.config },
      };
      const result = await registered.execute(nodeInput, manifestCtx);
      return {
        success: result.success,
        output: result.output,
        branch: result.branch,
        logs: result.logs || [],
      };
    }

    if (nodeNorm.type === 'trigger') {
      return await executeTrigger(nodeNorm, ctx);
    }
    if (nodeNorm.type === 'condition') {
      return await executeCondition(nodeNorm, ctx);
    }
    if (nodeNorm.type === 'output') {
      switch (subtype) {
        case 'log':
          return await executeLog(nodeNorm, ctx);
        case 'alert_out':
          return await executeCreateAlert(nodeNorm, ctx);
        case 'webhook_response':
          return {
            success: true,
            output: { webhook_response: nodeNorm.data.config },
            logs: [{
              time: new Date().toISOString(),
              nodeId: nodeNorm.id,
              nodeLabel: nodeNorm.data.label,
              message: `Webhook response: ${JSON.stringify(nodeNorm.data.config).slice(0, 100)}`,
              level: 'info',
              duration: 0,
            }],
          };
        default:
          return await executeLog(nodeNorm, ctx);
      }
    }
    // action nodes - dispatch by subtype
    switch (subtype) {
      // Threat Intel
      case 'virustotal':
      case 'vt':
        return await executeVirusTotal(node, ctx);
      case 'abuseipdb':
        return await executeAbuseIPDB(node, ctx);
      case 'ipinfo':
      case 'ip_info':
        return await executeIPInfo(node, ctx);
      case 'otx':
      case 'alienvault':
        return await executeOTX(node, ctx);
      case 'misp':
        return await executeMISP(node, ctx);
      case 'opencti':
        return await executeOpenCTI(node, ctx);
      // SIEM
      case 'splunk':
        return await executeSplunk(node, ctx);
      case 'sentinel':
      case 'microsoft_sentinel':
        return await executeSentinel(node, ctx);
      case 'elastic':
      case 'elasticsearch':
        return await executeElastic(node, ctx);
      case 'wazuh':
        return await executeWazuh(node, ctx);
      // ITSM / Ticketing
      case 'jira':
        return await executeJira(node, ctx);
      case 'servicenow':
      case 'snow':
        return await executeServiceNow(node, ctx);
      case 'pagerduty':
        return await executePagerDuty(node, ctx);
      case 'thehive':
        return await executeTheHive(node, ctx);
      case 'defectdojo':
        return await executeDefectDojo(node, ctx);
      // Cloud / Identity
      case 'msgraph':
      case 'microsoft':
        return await executeMSGraph(node, ctx);
      case 'digitalocean':
      case 'do':
        return await executeDigitalOcean(node, ctx);
      // Network / Firewall
      case 'fortigate':
      case 'fortios':
        return await executeFortiGate(node, ctx);
      case 'opnsense':
        return await executeOPNsense(node, ctx);
      case 'pfsense':
      case 'pfsense_plus':
        return await executePfSense(node, ctx);
      // Sandbox / malware analysis
      case 'cuckoo':
      case 'cuckoo_sandbox':
        return await executeCuckoo(node, ctx);
      case 'clamav':
        return await executeClamAv(node, ctx);
      case 'arkime':
      case 'moloch':
        return await executeArkime(node, ctx);
      // EDR / IR
      case 'velociraptor':
        return await executeVelociraptor(node, ctx);
      case 'crowdstrike':
      case 'falcon':
      case 'cs':
        return await executeCrowdStrike(node, ctx);
      case 'greynoise':
      case 'gn':
        return await executeGreyNoise(node, ctx);
      case 'shodan':
        return await executeShodan(node, ctx);
      case 'teams':
      case 'msteams':
      case 'microsoft_teams':
        return await executeTeams(node, ctx);
      case 'entra_id':
      case 'entra':
      case 'azure_ad':
      case 'entraid':
        return await executeEntraId(node, ctx);
      case 'aws_securityhub':
      case 'securityhub':
      case 'aws_security_hub':
        return await executeAwsSecurityHub(node, ctx);
      case 'gcp_scc':
      case 'security_command_center':
        return await executeGcpScc(node, ctx);
      case 'block':
        return await executeBlock(node, ctx);
      case 'isolate':
        return await executeIsolate(node, ctx);
      // Comms
      case 'slack':
        return await executeSlack(nodeNorm, ctx);
      case 'telegram':
      case 'tg':
        return await executeTelegram(nodeNorm, ctx);
      case 'email':
        return await executeEmail(nodeNorm, ctx);
      // Case/Alert
      case 'create_case':
        return await executeCreateCase(node, ctx);
      case 'alert_out':
        return await executeCreateAlert(node, ctx);
      // Generic HTTP + Webhook
      case 'http':
      case 'api':
        return await executeHTTP(node, ctx);
      case 'webhook':
        return await executeWebhook(node, ctx);
      // SOAR internal utils
      case 'soar_utils':
      case 'util':
        return await executeSoarUtils(node, ctx);
      // Enrich - default to VirusTotal
      case 'enrich': {
        const source = (node.data.config.source as string) || 'virustotal';
        if (source === 'abuseipdb') return await executeAbuseIPDB(node, ctx);
        if (source === 'ipinfo') return await executeIPInfo(node, ctx);
        if (source === 'otx' || source === 'alienvault') return await executeOTX(node, ctx);
        if (source === 'misp') return await executeMISP(node, ctx);
        return await executeVirusTotal(node, ctx);
      }
      default:
        return {
          success: false,
          output: { unknown: { subtype } },
          logs: [{
            time: new Date().toISOString(),
            nodeId: nodeNorm.id,
            nodeLabel: nodeNorm.data.label,
            message: `Unknown action subtype "${subtype}" — no executor registered`,
            level: 'error',
            duration: 0,
          }],
        };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      logs: [{
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: `Executor crashed: ${msg}`,
        level: 'error',
      }],
    };
  }
}

export async function runWorkflow(opts: RunOptions): Promise<RunResult> {
  const { executionId, workflowId, triggerPayload, tenantId, workflowOverride } = opts;
  const start = Date.now();

  let wfName = workflowOverride?.name || workflowId;
  let nodes: WFNode[] = [];
  let edges: WFEdge[] = [];
  let effectiveTenantId = tenantId ?? null;

  if (workflowOverride) {
    nodes = workflowOverride.nodes.map(normalizeWorkflowNode);
    edges = workflowOverride.edges;
    wfName = workflowOverride.name;
  } else {
    const wf = await db.workflow.findUnique({ where: { id: workflowId } });
    if (!wf) {
      return {
        success: false,
        logs: [{ time: new Date().toISOString(), message: `Workflow ${workflowId} not found`, level: 'error' }],
        outputs: {}, result: {}, executedNodeIds: [], failedNodeIds: [], durationMs: 0,
      };
    }

    if (tenantId && wf.tenantId && wf.tenantId !== tenantId) {
      return {
        success: false,
        logs: [{
          time: new Date().toISOString(),
          message: `Workflow ${workflowId} does not belong to tenant ${tenantId}`,
          level: 'error',
        }],
        outputs: {}, result: {}, executedNodeIds: [], failedNodeIds: [], durationMs: 0,
      };
    }

    effectiveTenantId = tenantId || wf.tenantId || null;
    wfName = wf.name;

    if (wf.requiresApproval) {
      const approved = await db.approval.findFirst({
        where: { workflowExecutionId: executionId, status: 'approved' },
      });
      const autoApproved = opts.startedBy === 'worker' || opts.startedBy === 'scheduler';
      if (!approved && !autoApproved) {
        const existing = await db.approval.findFirst({ where: { workflowExecutionId: executionId } });
        if (!existing) {
          await db.approval.create({
            data: {
              tenantId: effectiveTenantId,
              workflowExecutionId: executionId,
              requestedBy: opts.startedBy || 'system',
              action: 'execute_workflow',
              targetType: 'workflow',
              targetValue: workflowId,
              reason: `Workflow "${wf.name}" requires approval before execution`,
              status: 'pending',
              riskLevel: 'medium',
            },
          }).catch(() => {});
        }
        await db.workflowExecution.update({
          where: { id: executionId },
          data: { status: 'awaiting_approval' },
        }).catch(() => {});
        return {
          success: false,
          logs: [{
            time: new Date().toISOString(),
            message: `Workflow "${wf.name}" requires approval. Approve via /api/approvals then re-run.`,
            level: 'warning',
          }],
          outputs: {}, result: {}, executedNodeIds: [], failedNodeIds: [], durationMs: 0,
        };
      }
    }

    try { nodes = JSON.parse(wf.nodes || '[]').map((n: WFNode) => normalizeWorkflowNode(n)); } catch { /* keep empty */ }
    try { edges = JSON.parse(wf.edges || '[]'); } catch { /* keep empty */ }
  }

  // Load integrations
  const integrations = await loadIntegrations();

  // Build execution context
  const ctx: ExecutionContext = {
    trigger: triggerPayload,
    outputs: {},
    result: {},
    getIntegration: (key: string) => integrations.get(key.toLowerCase().replace(/[\s\-_]/g, '')) || null,
    createCase: async (data) => {
      try {
        const c = await db.case.create({ data: {
          tenantId: effectiveTenantId,
          title: String(data.title || 'Untitled'),
          description: String(data.description || ''),
          severity: String(data.severity || 'medium'),
          status: String(data.status || 'open'),
          tags: String(data.tags || '[]'),
          artifacts: String(data.artifacts || '[]'),
          timeline: String(data.timeline || '[]'),
        }});
        const tenantWhere = effectiveTenantId ? { tenantId: effectiveTenantId } : {};
        await syncArtifactsForIncident(c.id, tenantWhere).catch(e =>
          console.error('artifact sync after workflow case create:', e),
        );
        return c.id;
      } catch (e) { console.error('createCase error:', e); return null; }
    },
    createAlert: async (data) => {
      try {
        const rawPayload = typeof data.raw === 'string'
          ? data.raw
          : JSON.stringify(data.raw ?? data);
        const a = await db.alert.create({ data: {
          tenantId: effectiveTenantId,
          title: String(data.title || 'Untitled'),
          description: String(data.description || ''),
          severity: String(data.severity || 'medium'),
          source: String(data.source || 'workflow'),
          status: String(data.status || 'new'),
          raw: rawPayload,
          iocs: String(data.iocs || '[]'),
          caseId: data.caseId ? String(data.caseId) : null,
        }});
        const tenantWhere = effectiveTenantId ? { tenantId: effectiveTenantId } : {};
        await afterAlertIngested({
          id: a.id,
          title: a.title,
          description: a.description,
          severity: a.severity,
          source: a.source,
          status: a.status,
          caseId: a.caseId,
          raw: a.raw,
          iocs: a.iocs,
          tenantId: a.tenantId,
        }, tenantWhere).catch(e => console.error('afterAlertIngested error:', e));
        return a.id;
      } catch (e) { console.error('createAlert error:', e); return null; }
    },
  };

  const allLogs: ExecutionLog[] = [];
  const executedNodeIds: string[] = [];
  const failedNodeIds: string[] = [];

  const appendLogs = (logs: ExecutionLog[]) => {
    allLogs.push(...logs);
    db.workflowExecution.update({
      where: { id: executionId },
      data: { logs: JSON.stringify(allLogs) },
    }).catch(e => console.error('log persist error:', e));
  };

  const execMeta = {
    workflowId,
    workflowName: wfName,
    executionId,
    tenantId: effectiveTenantId,
    startedBy: opts.startedBy,
  };

  allLogs.push({
    time: new Date().toISOString(),
    message: `Workflow "${wfName}" execution started (${nodes.length} nodes, ${edges.length} edges)`,
    level: 'info',
  });
  appendLogs([]);

  // Find trigger nodes — fall back to entry nodes (no incoming edges) for test/simple graphs
  const triggers = nodes.filter(n => n.type === 'trigger');
  const visited = new Set<string>();
  let queue: string[] = [];

  if (triggers.length === 0) {
    const incomingTargets = new Set(edges.map(e => e.target));
    const entryNodes = nodes.filter(n => !incomingTargets.has(n.id));
    if (entryNodes.length === 0) {
      allLogs.push({
        time: new Date().toISOString(),
        message: 'No trigger nodes found. Add a Trigger node and connect it to your actions.',
        level: 'error',
      });
      appendLogs([]);
      await finalize(executionId, false, ctx, allLogs, start);
      return { success: false, logs: allLogs, outputs: ctx.outputs, result: ctx.result, executedNodeIds, failedNodeIds, durationMs: Date.now() - start };
    }
    const labels = entryNodes.map(n => n.data?.label || n.subtype || n.id).join(', ');
    allLogs.push({
      time: new Date().toISOString(),
      message: `No trigger node — running from entry node(s): ${labels}. For production, add a Trigger and connect your actions.`,
      level: 'warning',
    });
    appendLogs([]);
    queue = entryNodes.map(n => n.id);
  } else {
    queue = triggers.map(t => t.id);
  }

  // BFS traversal with branch support

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodes.find(n => n.id === nodeId);
    if (!node) continue;

    const nodeStartedAt = Date.now();
    const result = await dispatchWithRetry(node, ctx, () => dispatchNode(node, ctx, execMeta));
    const nodeFinishedAt = Date.now();

    insertExecutionTrace({
      executionId,
      workflowId,
      nodeId: node.id,
      nodeLabel: node.data?.label,
      nodeSubtype: resolveNodeSubtype(node) || node.subtype,
      startedAt: new Date(nodeStartedAt),
      finishedAt: new Date(nodeFinishedAt),
      durationMs: nodeFinishedAt - nodeStartedAt,
      success: result.success,
      branch: result.branch,
      logs: result.logs,
      output: result.output,
      error: result.success
        ? undefined
        : result.logs.find(l => l.level === 'error')?.message,
    }).catch(() => {});

    const nodeSubtype = resolveNodeSubtype(node) || node.subtype || '';
    if (nodeSubtype && !['trigger', 'condition', 'log', 'block', 'isolate'].includes(nodeSubtype)) {
      const integration = ctx.getIntegration(nodeSubtype);
      recordConnectorCall({
        executionId,
        integrationType: integration?.type || nodeSubtype,
        integrationId: integration?.id,
        ts: new Date(nodeFinishedAt),
        request: {
          method: 'EXECUTE',
          url: `workflow://${workflowId}/node/${node.id}`,
          body: { subtype: nodeSubtype, label: node.data?.label },
        },
        response: {
          status: result.success ? 200 : 500,
          statusText: result.success ? 'OK' : 'FAILED',
          body: result.output,
        },
        durationMs: nodeFinishedAt - nodeStartedAt,
        success: result.success,
      }).catch(() => {});
    }

    ctx.outputs[nodeId] = result.output || {};
    appendLogs(result.logs);

    if (result.success) {
      executedNodeIds.push(nodeId);
    } else {
      failedNodeIds.push(nodeId);
    }

    // Determine which edges to follow
    const outEdges = edges.filter(e => e.source === nodeId);
    if (result.branch) {
      const branchNorm = result.branch.toLowerCase();
      const matching = outEdges.filter((e) => {
        const lbl = (e.label || '').toLowerCase().trim();
        if (!lbl) return false;
        if (lbl === branchNorm) return true;
        if (branchNorm === 'yes' && (lbl === 'true' || lbl === '1')) return true;
        if (branchNorm === 'no' && (lbl === 'false' || lbl === '0')) return true;
        return false;
      });
      if (matching.length > 0) {
        matching.forEach(e => { if (!visited.has(e.target)) queue.push(e.target); });
      } else {
        outEdges.filter(e => !e.label).forEach(e => { if (!visited.has(e.target)) queue.push(e.target); });
      }
    } else {
      outEdges.filter(e => !e.label).forEach(e => { if (!visited.has(e.target)) queue.push(e.target); });
    }
  }

  // Build final result summary
  ctx.result = {
    executed_nodes: executedNodeIds.length,
    failed_nodes: failedNodeIds.length,
    outputs: ctx.outputs,
    duration_ms: Date.now() - start,
  };

  allLogs.push({
    time: new Date().toISOString(),
    message: `Workflow execution completed. ${executedNodeIds.length} succeeded, ${failedNodeIds.length} failed, duration=${Date.now() - start}ms`,
    level: failedNodeIds.length > 0 ? 'warning' : 'success',
  });
  appendLogs([]);

  await finalize(executionId, failedNodeIds.length === 0, ctx, allLogs, start);

  return {
    success: failedNodeIds.length === 0,
    logs: allLogs,
    outputs: ctx.outputs,
    result: ctx.result,
    executedNodeIds,
    failedNodeIds,
    durationMs: Date.now() - start,
  };
}

async function finalize(
  executionId: string,
  success: boolean,
  ctx: ExecutionContext,
  logs: ExecutionLog[],
  start: number
) {
  try {
    await db.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: success ? 'success' : 'failed',
        endedAt: new Date(),
        durationMs: Date.now() - start,
        result: JSON.stringify({
          ...ctx.result,
          duration_ms: Date.now() - start,
          success,
        }),
        logs: JSON.stringify(logs),
      },
    });
  } catch (e) {
    console.error('finalize error:', e);
  }
}
