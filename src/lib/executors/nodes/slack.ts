// Slack executor - posts messages to Slack via incoming webhook
// Docs: https://api.slack.com/messaging/webhooks

import { NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

export async function executeSlack(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  let message = (cfg.message as string) || (cfg.text as string) || '';
  let channel = (cfg.channel as string) || '#general';

  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  message = resolveTemplate(message, ctx);
  channel = resolveTemplate(channel, ctx);

  // Get webhook URL from integration config or node config
  const integration = ctx.getIntegration('slack');
  const webhookUrl = (cfg.webhook_url as string) || (integration?.config?.webhook as string) || (integration?.config?.webhook_url as string) || '';

  if (!webhookUrl) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Slack: no webhook URL configured (set in Integrations or node config)', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Slack: posting to ${channel}...`, level: 'info' });

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message, channel }),
      cache: 'no-store',
    });
    const responseTime = Date.now() - start;
    const respBody = await res.text().catch(() => '');

    if (res.ok && respBody === 'ok') {
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: `Slack: message posted to ${channel} (${responseTime}ms)`,
        level: 'success',
        duration: responseTime,
        data: { channel, message_preview: message.slice(0, 100) },
      });
      return { success: true, output: { slack: { ok: true, channel, message, responseTimeMs: responseTime } }, logs };
    } else {
      logs.push({
        time: new Date().toISOString(),
        nodeId: node.id,
        nodeLabel: node.data.label,
        message: `Slack error: HTTP ${res.status} - ${respBody}`,
        level: 'error',
        duration: responseTime,
      });
      return { success: false, output: { slack: { ok: false, status: res.status, error: respBody } }, logs };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Slack error: ${msg}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
