import type { WFNode } from '@/lib/executors/types';

const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface AlertTriggerInput {
  severity: string;
  source: string;
}

export function matchesAlertTriggerConfig(
  triggerNode: WFNode,
  alert: AlertTriggerInput,
): boolean {
  const cfg = triggerNode.data?.config || {};
  const minSeverity = String(cfg.severity || 'low').toLowerCase();
  const sourceFilter = String(cfg.source || '').trim().toLowerCase();

  const alertSeverity = String(alert.severity || 'medium').toLowerCase();
  const alertSource = String(alert.source || '').toLowerCase();

  const minRank = SEVERITY_RANK[minSeverity] ?? 1;
  const alertRank = SEVERITY_RANK[alertSeverity] ?? 2;
  if (alertRank < minRank) return false;

  if (sourceFilter && sourceFilter !== 'any' && sourceFilter !== '*') {
    if (!alertSource.includes(sourceFilter) && alertSource !== sourceFilter) {
      return false;
    }
  }

  return true;
}

export function findAlertTriggerNode(nodes: WFNode[]): WFNode | null {
  return nodes.find(
    n => n.type === 'trigger' && (n.subtype === 'alert' || n.data?.config?.subtype === 'alert'),
  ) || null;
}
