/**
 * Alert upsert with deduplication — Event Triage layer.
 */
import { db } from '@/lib/db';
import { afterAlertIngested } from '@/lib/soar/alerts/ingest-alert';
import {
  normalizeInboundAlert,
  pickHigherSeverity,
  type NormalizedAlert,
} from '@/lib/soar/alerts/normalize-alert';

export interface IngestAlertInput {
  payload: Record<string, unknown>;
  tenantId?: string | null;
  source?: string;
  assigneeId?: string | null;
  caseId?: string | null;
  /** Skip workflow trigger on dedup bump (still enriches IOCs) */
  skipTriggerOnDedup?: boolean;
}

export interface IngestAlertResult {
  alert: {
    id: string;
    title: string;
    description: string | null;
    severity: string;
    source: string;
    status: string;
    caseId: string | null;
    raw: string;
    iocs: string;
    tenantId: string | null;
    dedupKey: string | null;
    occurrenceCount: number;
  };
  created: boolean;
  deduplicated: boolean;
  normalized: NormalizedAlert;
}

function tenantWhere(tenantId?: string | null) {
  return tenantId ? { tenantId } : {};
}

export async function ingestAlertRecord(
  input: IngestAlertInput,
): Promise<IngestAlertResult> {
  const normalized = normalizeInboundAlert(input.payload, {
    source: input.source,
    tenantId: input.tenantId,
  });
  const tw = tenantWhere(input.tenantId);

  if (normalized.dedupKey) {
    const existing = await db.alert.findFirst({
      where: { ...tw, dedupKey: normalized.dedupKey },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const updated = await db.alert.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: existing.occurrenceCount + 1,
          severity: pickHigherSeverity(existing.severity, normalized.severity),
          description: normalized.description || existing.description,
          raw: JSON.stringify(normalized.raw),
          iocs: JSON.stringify(
            mergeIocs(
              parseJsonArray(existing.iocs),
              normalized.iocs,
            ),
          ),
        },
      });

      if (!input.skipTriggerOnDedup) {
        await afterAlertIngested(updated, tw).catch(() => {});
      }

      return {
        alert: updated,
        created: false,
        deduplicated: true,
        normalized,
      };
    }
  }

  const alert = await db.alert.create({
    data: {
      tenantId: input.tenantId ?? null,
      title: normalized.title,
      description: normalized.description,
      source: normalized.source,
      severity: normalized.severity,
      status: normalized.status,
      assigneeId: input.assigneeId ?? null,
      caseId: input.caseId ?? null,
      raw: JSON.stringify(normalized.raw),
      iocs: JSON.stringify(normalized.iocs),
      dedupKey: normalized.dedupKey,
      occurrenceCount: 1,
    },
  });

  await afterAlertIngested(alert, tw);

  const { createSoarNotification } = await import('@/lib/soar/notifications/create-notification');
  await createSoarNotification({
    tenantId: input.tenantId ?? null,
    title: `New alert: ${alert.title}`,
    message: `${alert.severity.toUpperCase()} alert from ${alert.source}`,
  }).catch(() => {});

  return {
    alert,
    created: true,
    deduplicated: false,
    normalized,
  };
}

function parseJsonArray(raw: string): Array<{ type: string; value: string }> {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeIocs(
  existing: Array<{ type: string; value: string }>,
  incoming: Array<{ type: string; value: string }>,
) {
  const map = new Map<string, { type: string; value: string }>();
  for (const i of [...existing, ...incoming]) {
    map.set(`${i.type}:${i.value}`, i);
  }
  return [...map.values()];
}
