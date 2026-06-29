/**
 * Alert → workflow automation — matches active workflows with alert triggers.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { WFNode } from '@/lib/executors/types';
import { findAlertTriggerNode, matchesAlertTriggerConfig } from '../events/alert-matcher';
import { startWorkflowExecution } from './start-execution';
import type { AlertCreatedPayload } from '../events/types';

export interface TriggerAlertWorkflowsResult {
  matched: number;
  started: string[];
}

export async function triggerWorkflowsForAlert(
  alert: AlertCreatedPayload & { tenantId?: string | null },
): Promise<TriggerAlertWorkflowsResult> {
  const where = {
    status: 'active' as const,
    ...(alert.tenantId ? { tenantId: alert.tenantId } : {}),
  };

  const workflows = await db.workflow.findMany({ where });
  const started: string[] = [];

  const triggerPayload: Record<string, unknown> = {
    alert_id: alert.alertId,
    title: alert.title,
    description: alert.description,
    severity: alert.severity,
    source: alert.source,
    status: alert.status,
    raw: alert.raw,
    iocs: alert.iocs,
  };

  for (const wf of workflows) {
    let nodes: WFNode[] = [];
    try { nodes = JSON.parse(wf.nodes || '[]'); } catch { continue; }

    const triggerNode = findAlertTriggerNode(nodes);
    if (!triggerNode) continue;
    if (!matchesAlertTriggerConfig(triggerNode, alert)) continue;

    try {
      const result = await startWorkflowExecution({
        workflow: wf,
        trigger: triggerPayload,
        triggerType: 'alert',
        startedBy: 'alert-bus',
        tenantId: alert.tenantId,
      });
      started.push(result.executionId);
      logger.info({
        workflowId: wf.id,
        executionId: result.executionId,
        alertId: alert.alertId,
        mode: result.mode,
      }, 'Alert triggered workflow');
    } catch (err) {
      logger.error({ err, workflowId: wf.id, alertId: alert.alertId }, 'Alert workflow trigger failed');
    }
  }

  return { matched: started.length, started };
}
