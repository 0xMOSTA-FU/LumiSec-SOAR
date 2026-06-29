import { apiClient } from '@/lib/lumisec-api/browser/api-client';
import {
  asArray,
  extractPagination,
  toPaginatedResult,
  unwrapData,
  type ApiEnvelope,
  type PaginatedResult,
  type PaginationMeta,
} from '@/lib/lumisec-api/browser/envelope';

const NOTIFICATION_LIST_KEYS = ['items', 'notifications', 'results', 'data'];

export interface SoarNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
  resource_type: string | null;
  resource_id: string | null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return 0;
}

export function normalizeNotification(raw: Record<string, unknown>): SoarNotification {
  const readFlag = raw.read ?? raw.is_read ?? raw.isRead ?? raw.read_at ?? raw.readAt;
  const read =
    readFlag === true ||
    readFlag === 'true' ||
    readFlag === 1 ||
    (typeof readFlag === 'string' && readFlag.length > 0);

  const resourceType =
    raw.resource_type ?? raw.resourceType ?? raw.entity_type ?? raw.entityType ?? null;
  const resourceId =
    raw.resource_id ?? raw.resourceId ?? raw.entity_id ?? raw.entityId ?? raw.ref_id ?? null;

  return {
    id: String(raw.id ?? raw._id ?? raw.notification_id ?? raw.notificationId ?? ''),
    type: String(raw.type ?? raw.notification_type ?? raw.notificationType ?? 'info'),
    title: String(raw.title ?? raw.subject ?? raw.message ?? 'Notification'),
    body:
      raw.body ?? raw.content ?? raw.message ?? raw.excerpt
        ? String(raw.body ?? raw.content ?? raw.message ?? raw.excerpt)
        : null,
    read,
    created_at: String(
      raw.created_at ?? raw.createdAt ?? raw.timestamp ?? raw.sent_at ?? raw.sentAt ?? '',
    ),
    resource_type: resourceType ? String(resourceType) : null,
    resource_id: resourceId ? String(resourceId) : null,
  };
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const response = await apiClient.get<ApiEnvelope<unknown> | unknown>(
    '/api/soar/notifications/unread-count',
  );
  const data = unwrapData<unknown>(response);

  if (typeof data === 'number') return data;

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    return pickNumber(record, [
      'count',
      'unread',
      'unread_count',
      'unreadCount',
      'total',
    ]);
  }

  return 0;
}

export async function fetchNotifications(
  page = 1,
  limit = 30,
): Promise<PaginatedResult<SoarNotification>> {
  const response = await apiClient.get<ApiEnvelope<unknown>>(
    `/api/soar/notifications?page=${page}&limit=${limit}`,
  );
  const data = unwrapData<unknown>(response);
  const items = asArray<Record<string, unknown>>(data, NOTIFICATION_LIST_KEYS).map(normalizeNotification);
  const pagination = extractPagination(data, { page, limit, itemCount: items.length });
  return { items, pagination };
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.patch(`/api/soar/notifications/${encodeURIComponent(id)}/read`, {});
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.patch('/api/soar/notifications/read-all', {});
}
