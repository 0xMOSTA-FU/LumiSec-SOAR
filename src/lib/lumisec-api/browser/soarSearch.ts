import { apiClient } from '@/lib/lumisec-api/browser/api-client';
import { unwrapData, type ApiEnvelope } from '@/lib/lumisec-api/browser/envelope';
import type { SoarAlert } from '@/lib/lumisec-api/browser/soarAlerts';
import type { SoarIncident } from '@/lib/lumisec-api/browser/soarIncidents';
import { normalizeAlert } from '@/lib/lumisec-api/browser/soarAlerts';

export interface SearchResults {
  query: string;
  incidents: SoarIncident[];
  alerts: SoarAlert[];
  artifacts: Array<{
    id: string;
    type: string;
    value: string;
    description: string | null;
    incident_id: string | null;
    created_at: string;
  }>;
  connectors: Array<{ id: string; name: string; type: string; status: string }>;
}

export async function globalSearch(q: string, limit = 20): Promise<SearchResults> {
  const response = await apiClient.get<ApiEnvelope<SearchResults>>(
    `/api/soar/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  const data = unwrapData(response) as SearchResults;
  return {
    query: data.query || q,
    incidents: Array.isArray(data.incidents) ? data.incidents : [],
    alerts: Array.isArray(data.alerts)
      ? data.alerts.map((a) =>
          normalizeAlert(
            (typeof a === 'object' && a !== null ? a : {}) as Record<string, unknown>,
          ),
        )
      : [],
    artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
    connectors: Array.isArray(data.connectors) ? data.connectors : [],
  };
}
