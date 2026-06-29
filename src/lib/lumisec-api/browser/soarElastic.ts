import { apiClient } from '@/lib/lumisec-api/browser/api-client';

export interface ElasticPollResult {
  ok: boolean;
  polled: number;
  ingested: number;
  deduplicated: number;
  errors: string[];
}

export async function pollElasticAlerts(options?: {
  minutes?: number;
  limit?: number;
}): Promise<ElasticPollResult> {
  const response = await apiClient.post<ElasticPollResult | { data: ElasticPollResult }>(
    '/api/soar/integrations/elastic/poll',
    options || {},
  );
  if (response && typeof response === 'object' && 'data' in response && response.data) {
    return response.data as ElasticPollResult;
  }
  return response as ElasticPollResult;
}
