export const SOAR_EVENTS_CHANNEL = 'soar:events';

export type SoarEventType =
  | 'alert.created'
  | 'alert.updated'
  | 'workflow.executed'
  | 'case.created';

export interface SoarEvent<T = Record<string, unknown>> {
  type: SoarEventType;
  tenantId?: string | null;
  payload: T;
  ts: string;
}

export interface AlertCreatedPayload {
  alertId: string;
  title: string;
  description?: string;
  severity: string;
  source: string;
  status?: string;
  raw?: unknown;
  iocs?: unknown;
}
