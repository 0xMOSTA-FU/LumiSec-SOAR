import { soarFetch } from '@/lib/soar/fetch-json';

export type QuickFixAction =
  | 'health_check'
  | 'test_all_connectors'
  | 'connect_free_tier'
  | 'sync_artifacts'
  | 'fix_all';

export interface QuickFixStep {
  action: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface QuickFixResponse {
  ok: boolean;
  action: QuickFixAction;
  steps: QuickFixStep[];
}

export async function runPlatformQuickFix(action: QuickFixAction): Promise<QuickFixResponse> {
  const res = await soarFetch<QuickFixResponse>('/api/platform/quick-fix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok || !res.data) {
    throw new Error(res.error || 'Quick fix request failed');
  }
  return res.data;
}
