import { apiClient } from '@/lib/lumisec-api/browser/api-client';

export interface PlatformModuleStatus {
  ok: boolean;
  message?: string;
}

export interface PlatformStatusResponse {
  configured: boolean;
  ok: boolean;
  base_url?: string;
  message?: string;
  modules: Record<string, PlatformModuleStatus>;
}

export interface PlatformLookupItem {
  _id?: string;
  id?: string;
  name?: string;
  title?: string;
  status?: string;
}

export async function fetchPlatformStatus(): Promise<PlatformStatusResponse> {
  return apiClient.get<PlatformStatusResponse>('/api/soar/platform/status');
}

export async function fetchPhishingTemplates(): Promise<PlatformLookupItem[]> {
  return apiClient.get<PlatformLookupItem[]>('/api/soar/platform/lookups/phishing-templates');
}

export async function fetchPhishingLandingPages(): Promise<PlatformLookupItem[]> {
  return apiClient.get<PlatformLookupItem[]>('/api/soar/platform/lookups/phishing-landing-pages');
}

export async function fetchUctcRules(): Promise<PlatformLookupItem[]> {
  return apiClient.get<PlatformLookupItem[]>('/api/soar/platform/lookups/uctc-rules');
}

export async function fetchLuminetAssetContext(ip: string): Promise<Record<string, unknown>> {
  return apiClient.get<Record<string, unknown>>(
    `/api/soar/platform/luminet/context/${encodeURIComponent(ip.trim())}`,
  );
}

export function lookupItemId(item: PlatformLookupItem): string {
  return String(item._id || item.id || '');
}

export function lookupItemLabel(item: PlatformLookupItem): string {
  const id = lookupItemId(item);
  const label = item.name || item.title || id;
  return item.status ? `${label} (${item.status})` : label;
}
