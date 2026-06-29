/**
 * Microsoft Teams incoming webhook
 * Docs: https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
 */
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

export function getTeamsWebhookUrl(integration: IntegrationConfig | null): string | null {
  const c = integration?.config || {};
  return String(c.webhook_url || c.webhookUrl || c.url || '') || null;
}

export async function testTeamsConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const url = String(config.webhook_url || config.webhookUrl || config.url || '');
  if (!url) return { ok: false, message: 'webhook_url required' };
  if (!url.includes('webhook.office.com') && !url.includes('logic.azure.com')) {
    return { ok: false, message: 'URL must be a Microsoft Teams or Power Automate webhook' };
  }
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'LumiSec SOAR connectivity test — you may delete this message.' }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, message: `Teams webhook ${res.status}: ${body.slice(0, 120)}`, durationMs: Date.now() - start };
  }
  return { ok: true, message: 'Teams webhook delivered test message', durationMs: Date.now() - start };
}

export async function executeTeams(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('teams') || ctx.getIntegration('msteams') || ctx.getIntegration('microsoft_teams');

  const webhookUrl = resolveTemplate(String(cfg.webhook_url || ''), ctx) || getTeamsWebhookUrl(integration);
  if (!webhookUrl) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Teams: webhook_url required (node config or integration)', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const title = resolveTemplate(String(cfg.title || 'SOAR Notification'), ctx);
  const text = resolveTemplate(String(cfg.message || cfg.text || ''), ctx);
  const themeColor = String(cfg.theme_color || cfg.themeColor || '0078D4');

  const payload = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: title,
    themeColor,
    title,
    text,
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Teams webhook failed: HTTP ${res.status}`, level: 'error', duration: Date.now() - start, data: { body: body.slice(0, 200) } });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Teams: message sent`, level: 'success', duration: Date.now() - start });
    return { success: true, output: { teams: { ok: true, sent: true, title } }, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Teams error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
