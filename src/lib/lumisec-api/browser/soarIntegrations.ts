import { apiClient } from '@/lib/lumisec-api/browser/api-client';
import {
  extractSuccessMessage,
  handleIntegrationError,
} from '@/lib/lumisec-api/browser/integrationErrors';

export interface IntegrationActionResult {
  message: string;
  raw: unknown;
}

async function postIntegration(
  path: string,
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  try {
    const response = await apiClient.post<unknown>(path, body);
    return {
      message: extractSuccessMessage(response),
      raw: response,
    };
  } catch (err) {
    handleIntegrationError(err);
    throw err;
  }
}

export async function submitGrcFinding(
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  return postIntegration('/api/soar/integrations/grc/finding', body);
}

export async function submitGrcRisk(
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  return postIntegration('/api/soar/integrations/grc/risk', body);
}

export async function pushUctcRule(
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  return postIntegration('/api/soar/integrations/uctc/rule', body);
}

export async function triggerUctcRule(
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  return postIntegration('/api/soar/integrations/uctc/rule-trigger', body);
}

export async function createPhishingCampaign(
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  return postIntegration('/api/soar/integrations/phishing/campaign', body);
}

export async function sendSiemEvent(
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  return postIntegration('/api/soar/integrations/siem/event', body);
}

export async function blockIpFirewall(
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  return postIntegration('/api/soar/integrations/firewall/block-ip', body);
}

export async function blockIpNetwork(
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  return postIntegration('/api/soar/integrations/network/block-ip', body);
}

export async function isolateHostNetwork(
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  return postIntegration('/api/soar/integrations/network/isolate-host', body);
}

export async function isolateHostEdr(
  body: Record<string, unknown>,
): Promise<IntegrationActionResult> {
  return postIntegration('/api/soar/integrations/edr/isolate-host', body);
}
