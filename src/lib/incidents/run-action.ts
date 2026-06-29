import { db } from '@/lib/db';
import { loadIntegrationsForExecution } from '@/lib/executors/engine';
import { executeBlock, executeIsolate } from '@/lib/executors/nodes/builtin';
import { executeVirusTotal } from '@/lib/executors/nodes/virustotal';
import { executeAbuseIPDB } from '@/lib/executors/nodes/abuseipdb';
import { executeEntraId } from '@/lib/executors/nodes/entra-id';
import { executeSlack } from '@/lib/executors/nodes/slack';
import { executeEmail } from '@/lib/executors/nodes/email';
import { executeTelegram } from '@/lib/executors/nodes/telegram';
import type { ExecutionContext, ExecutionLog, WFNode } from '@/lib/executors/types';
import { startWorkflowExecution } from '@/lib/soar/execution/start-execution';
import { runLumisecIncidentAction, shouldDelegateActionToLumisec, isLumisecBackendEnabled } from '@/lib/lumisec-api/client';
import { isPlatformActionId, runPlatformIncidentAction } from '@/lib/incidents/platform-respond';
import type { IncidentContext, IncidentActionResult, ResponseActionId } from './types';

function synthNode(id: string, label: string, subtype: string, config: Record<string, unknown>): WFNode {
  return {
    id,
    type: 'action',
    subtype,
    position: { x: 0, y: 0 },
    data: { label, config: { subtype, ...config } },
  };
}

async function buildExecutionContext(incident: IncidentContext): Promise<ExecutionContext> {
  const integrations = await loadIntegrationsForExecution();
  const trigger = {
    incident_id: incident.id,
    source_ip: incident.ips[0],
    ip: incident.ips[0],
    hostname: incident.hostnames[0],
    host: incident.hostnames[0],
    hash: incident.hashes[0],
    user: incident.users[0],
    upn: incident.emails[0] || incident.users[0],
    ...incident.raw,
  };
  return {
    trigger,
    outputs: {},
    result: {},
    getIntegration: (key: string) => integrations.get(key.toLowerCase().replace(/[\s\-_]/g, '')) || null,
  };
}

function flattenLogs(logs: ExecutionLog[]): { time: string; message: string; level: string }[] {
  return logs.map(l => ({ time: l.time, message: l.message, level: l.level }));
}

function lastMessage(logs: ExecutionLog[]): string {
  const last = logs[logs.length - 1];
  return last?.message || 'Action completed';
}

function parseTimeline(raw: string | null | undefined): { time: string; event: string }[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendCaseTimeline(
  caseId: string,
  event: string,
  status?: string,
): Promise<void> {
  const c = await db.case.findUnique({ where: { id: caseId } });
  if (!c) return;
  const timeline = parseTimeline(c.timeline);
  timeline.push({ time: new Date().toISOString(), event });
  await db.case.update({
    where: { id: caseId },
    data: {
      timeline: JSON.stringify(timeline),
      ...(status ? { status } : {}),
    },
  });
}

export async function updateIncidentStatus(
  incident: IncidentContext,
  status: string,
  timelineEvent: string,
): Promise<void> {
  if (incident.kind === 'case') {
    await appendCaseTimeline(incident.id, timelineEvent, status);
    return;
  }
  await db.alert.update({
    where: { id: incident.id },
    data: { status },
  });
  if (incident.caseId) {
    await appendCaseTimeline(incident.caseId, timelineEvent);
    if (status === 'contained' || status === 'investigating') {
      await db.case.update({
        where: { id: incident.caseId },
        data: { status: status === 'contained' ? 'contained' : 'investigating' },
      }).catch(() => undefined);
    }
  }
}

export async function runIncidentAction(
  actionId: ResponseActionId,
  incident: IncidentContext,
  opts: { userId?: string | null; params?: Record<string, unknown> } = {},
): Promise<IncidentActionResult> {
  const params = opts.params || {};

  if (isPlatformActionId(actionId)) {
    const result = await runPlatformIncidentAction(actionId, incident, params);
    if (result.ok) {
      await updateIncidentStatus(
        incident,
        incident.status,
        result.message,
      );
    }
    return result;
  }

  if (shouldDelegateActionToLumisec(actionId)) {
    const delegated = await runLumisecIncidentAction(actionId, incident, params);
    if (delegated) {
      if (delegated.ok && delegated.statusUpdated) {
        await updateIncidentStatus(incident, delegated.statusUpdated, delegated.message);
      }
      return delegated;
    }
  }

  const ctx = await buildExecutionContext(incident);
  const nodeId = `inc-${actionId}`;

  try {
    if (actionId === 'block_ip') {
      const ip = String(params.ip || incident.ips[0] || '');
      const node = synthNode(nodeId, 'Block IP', 'block', { target: ip, ip, type: 'ip' });
      const result = await executeBlock(node, ctx);
      const ok = result.success;
      if (ok) {
        const event = `Firewall block applied for ${ip}`;
        await updateIncidentStatus(incident, incident.kind === 'alert' ? 'investigating' : incident.status, event);
        if (incident.caseId && incident.kind === 'alert') {
          await appendCaseTimeline(incident.caseId, event);
        }
      }
      return {
        ok,
        message: lastMessage(result.logs),
        actionId,
        logs: flattenLogs(result.logs),
      };
    }

    if (actionId === 'isolate_host') {
      const hostname = String(params.hostname || params.host || incident.hostnames[0] || '');
      const node = synthNode(nodeId, 'Isolate Host', 'isolate', { hostname, host: hostname });
      const result = await executeIsolate(node, ctx);
      const ok = result.success;
      if (ok) {
        const event = `Host ${hostname} isolated via EDR`;
        await updateIncidentStatus(incident, 'contained', event);
      }
      return {
        ok,
        message: lastMessage(result.logs),
        actionId,
        logs: flattenLogs(result.logs),
        statusUpdated: ok ? 'contained' : undefined,
      };
    }

    if (actionId === 'enrich_ip') {
      const ip = String(params.ip || incident.ips[0] || '');
      const logs: ExecutionLog[] = [];
      let ok = false;
      const vtNode = synthNode(`${nodeId}-vt`, 'VT IP Lookup', 'virustotal', {
        ioc_type: 'ip',
        ioc_value: ip,
        type: 'ip',
        value: ip,
      });
      const vt = await executeVirusTotal(vtNode, ctx);
      logs.push(...vt.logs);
      ok = vt.success;
      if (ctx.getIntegration('abuseipdb')?.status === 'connected') {
        const abuseNode = synthNode(`${nodeId}-abuse`, 'AbuseIPDB', 'abuseipdb', { ip, action: 'check_ip' });
        const abuse = await executeAbuseIPDB(abuseNode, ctx);
        logs.push(...abuse.logs);
        ok = ok || abuse.success;
      }
      if (ok) {
        await updateIncidentStatus(incident, incident.status, `Threat intel enrichment completed for ${ip}`);
      }
      return { ok, message: lastMessage(logs), actionId, logs: flattenLogs(logs) };
    }

    if (actionId === 'scan_hash') {
      const hash = String(params.hash || params.ioc_value || incident.hashes.find(h => h.length >= 32 && !h.includes('...')) || '');
      const node = synthNode(nodeId, 'Scan Hash', 'virustotal', {
        ioc_type: 'hash',
        ioc_value: hash,
        type: 'hash',
        value: hash,
      });
      const result = await executeVirusTotal(node, ctx);
      if (result.success) {
        await updateIncidentStatus(incident, incident.status, `Hash submitted to VirusTotal: ${hash.slice(0, 16)}…`);
      }
      return {
        ok: result.success,
        message: lastMessage(result.logs),
        actionId,
        logs: flattenLogs(result.logs),
      };
    }

    if (actionId === 'disable_user') {
      const upn = String(params.upn || params.user || incident.emails[0] || incident.users[0] || '');
      const node = synthNode(nodeId, 'Disable User', 'entra_id', { action: 'disable_user', upn });
      const result = await executeEntraId(node, ctx);
      if (result.success) {
        await updateIncidentStatus(incident, 'contained', `Account disabled: ${upn}`);
      }
      return {
        ok: result.success,
        message: lastMessage(result.logs),
        actionId,
        logs: flattenLogs(result.logs),
        statusUpdated: result.success ? 'contained' : undefined,
      };
    }

    if (actionId === 'notify_soc_slack') {
      const message = String(
        params.message ||
        `[${incident.severity.toUpperCase()}] ${incident.title} (#${incident.id})`,
      );
      const channel = String(params.channel || '#soc-alerts');
      const node = synthNode(nodeId, 'Notify SOC', 'slack', { message, channel });
      const result = await executeSlack(node, ctx);
      if (result.success) {
        await updateIncidentStatus(incident, incident.status, 'SOC notified via Slack');
      }
      return {
        ok: result.success,
        message: lastMessage(result.logs),
        actionId,
        logs: flattenLogs(result.logs),
      };
    }

    if (actionId === 'notify_email') {
      const subject = String(
        params.subject || `[SOAR ${incident.severity.toUpperCase()}] ${incident.title}`,
      );
      const body = String(
        params.message ||
          `Incident #${incident.id}\n${incident.title}\n\n${incident.description}\n\nSeverity: ${incident.severity}`,
      );
      const to = String(params.to || params.email || '');
      const node = synthNode(nodeId, 'Notify Email', 'email', {
        to,
        subject,
        body,
        message: body,
      });
      const result = await executeEmail(node, ctx);
      if (result.success) {
        await updateIncidentStatus(incident, incident.status, 'SOC notified via email');
      }
      return {
        ok: result.success,
        message: lastMessage(result.logs),
        actionId,
        logs: flattenLogs(result.logs),
      };
    }

    if (actionId === 'notify_telegram') {
      const message = String(
        params.message ||
          `[${incident.severity.toUpperCase()}] ${incident.title} (#${incident.id})`,
      );
      const node = synthNode(nodeId, 'Notify Telegram', 'telegram', {
        message,
        phone: params.phone || params.chat_id || params.chatId || '',
        chat_id: params.chat_id || params.chatId || params.phone || '',
      });
      const result = await executeTelegram(node, ctx);
      if (result.success) {
        await updateIncidentStatus(incident, incident.status, 'SOC notified via Telegram');
      }
      return {
        ok: result.success,
        message: lastMessage(result.logs),
        actionId,
        logs: flattenLogs(result.logs),
      };
    }

    if (actionId === 'run_enrichment_playbook') {
      const wfId = params.workflow_id ? String(params.workflow_id) : undefined;
      const wf = await db.workflow.findFirst({
        where: {
          status: 'active',
          ...(wfId
            ? { id: wfId }
            : {
                OR: [
                  { tags: { contains: 'enrichment' } },
                  { name: { contains: 'enrich' } },
                ],
              }),
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (!wf) {
        return {
          ok: false,
          message: 'No active enrichment workflow found. Create a workflow tagged "enrichment" and link it to a playbook.',
          actionId,
          logs: [],
        };
      }
      const trigger = {
        incident_id: incident.id,
        ip: String(params.ip || incident.ips[0] || ''),
        source_ip: String(params.ip || incident.ips[0] || ''),
        hash: String(params.hash || incident.hashes[0] || ''),
      };
      const started = await startWorkflowExecution({
        workflow: wf,
        trigger,
        triggerType: 'incident_action',
        startedBy: opts.userId || null,
      });
      await updateIncidentStatus(incident, 'investigating', `Enrichment playbook started (${wf.name})`);
      return {
        ok: true,
        message: `Workflow "${wf.name}" started (${started.mode})`,
        actionId,
        logs: [{ time: new Date().toISOString(), message: `Execution ${started.executionId} — ${started.status}`, level: 'info' }],
        executionId: started.executionId,
        statusUpdated: 'investigating',
      };
    }

    if (actionId === 'mark_investigating') {
      const status = incident.kind === 'alert' ? 'investigating' : 'investigating';
      await updateIncidentStatus(incident, status, 'Analyst marked incident as investigating');
      return {
        ok: true,
        message: 'Status updated to investigating',
        actionId,
        logs: [],
        statusUpdated: status,
      };
    }

    if (actionId === 'mark_contained') {
      const status = 'contained';
      await updateIncidentStatus(incident, status, 'Incident marked contained');
      return {
        ok: true,
        message: 'Status updated to contained',
        actionId,
        logs: [],
        statusUpdated: status,
      };
    }

    return { ok: false, message: `Unknown action: ${actionId}`, actionId, logs: [] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg, actionId, logs: [{ time: new Date().toISOString(), message: msg, level: 'error' }] };
  }
}
