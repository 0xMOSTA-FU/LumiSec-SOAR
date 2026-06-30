import { apiClient } from '@/lib/lumisec-api/browser/api-client';
import { unwrapData, type ApiEnvelope } from '@/lib/lumisec-api/browser/envelope';

export interface SoarApproval {
  id: string;
  action: string;
  targetType: string;
  targetValue: string;
  status: string;
  riskLevel: string;
  reason: string | null;
  requestedBy: string;
  createdAt: string;
  expiresAt: string | null;
}

function normalize(raw: Record<string, unknown>): SoarApproval {
  return {
    id: String(raw.id ?? ''),
    action: String(raw.action ?? ''),
    targetType: String(raw.targetType ?? raw.target_type ?? ''),
    targetValue: String(raw.targetValue ?? raw.target_value ?? ''),
    status: String(raw.status ?? 'pending'),
    riskLevel: String(raw.riskLevel ?? raw.risk_level ?? 'medium'),
    reason: raw.reason ? String(raw.reason) : null,
    requestedBy: String(raw.requestedBy ?? raw.requested_by ?? ''),
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
    expiresAt: raw.expiresAt || raw.expires_at ? String(raw.expiresAt ?? raw.expires_at) : null,
  };
}

export async function fetchApprovals(status = 'pending'): Promise<SoarApproval[]> {
  const response = await apiClient.get<ApiEnvelope<{ approvals?: unknown[] }>>(
    `/api/soar/approvals?status=${encodeURIComponent(status)}`,
  );
  const data = unwrapData(response) as { approvals?: unknown[] };
  const list = Array.isArray(data?.approvals) ? data.approvals : [];
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalize(item as Record<string, unknown>));
}

export async function approveRequest(id: string, comment?: string): Promise<void> {
  await apiClient.post(`/api/soar/approvals/${encodeURIComponent(id)}/approve`, { comment });
}

export async function rejectRequest(id: string, comment?: string): Promise<void> {
  await apiClient.post(`/api/soar/approvals/${encodeURIComponent(id)}/reject`, { comment });
}
