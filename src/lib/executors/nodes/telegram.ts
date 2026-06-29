/**
 * Telegram Bot API — send messages via bot token
 * Docs: https://core.telegram.org/bots/api#sendmessage
 */
import { NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

export interface TelegramCreds {
  botToken: string;
  defaultChatId: string;
}

export function parseTelegramCreds(config: Record<string, unknown>): TelegramCreds | null {
  const botToken = String(config.bot_token || config.botToken || config.token || '').trim();
  const defaultChatId = String(config.chat_id || config.chatId || config.default_chat_id || '').trim();
  if (!botToken) return null;
  return { botToken, defaultChatId };
}

/** Resolve chat_id from numeric id, @username, or phone via phone_contacts map. */
export function resolveTelegramChatId(
  target: string,
  config: Record<string, unknown>,
): string {
  const trimmed = target.trim();
  if (!trimmed) return String(config.chat_id || config.chatId || '').trim();

  if (/^-?\d+$/.test(trimmed)) return trimmed;

  const rawMap = config.phone_contacts || config.phoneContacts;
  if (rawMap) {
    try {
      const map = typeof rawMap === 'string' ? JSON.parse(rawMap) : rawMap;
      if (map && typeof map === 'object') {
        const normalized = trimmed.replace(/\s/g, '');
        const direct = (map as Record<string, string>)[normalized]
          || (map as Record<string, string>)[trimmed];
        if (direct) return String(direct);
      }
    } catch {
      /* ignore invalid JSON */
    }
  }

  return trimmed;
}

export async function sendTelegramMessage(
  creds: TelegramCreds,
  chatId: string,
  text: string,
  parseMode?: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  const tgOk = res.ok && (data as { ok?: boolean }).ok !== false;
  return { ok: tgOk, status: res.status, data };
}

export async function testTelegramConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const creds = parseTelegramCreds(config);
  if (!creds) return { ok: false, message: 'bot_token required' };
  const start = Date.now();
  const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/getMe`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({})) as { ok?: boolean; result?: { username?: string } };
  if (!res.ok || !data.ok) {
    const desc = (data as { description?: string }).description || `HTTP ${res.status}`;
    return { ok: false, message: desc, durationMs: Date.now() - start };
  }
  const username = data.result?.username || 'bot';
  if (creds.defaultChatId) {
    const ping = await sendTelegramMessage(
      creds,
      creds.defaultChatId,
      `[SOAR] Connectivity test OK — @${username} at ${new Date().toISOString()}`,
    );
    if (!ping.ok) {
      const err = (ping.data as { description?: string }).description || 'sendMessage failed';
      return { ok: false, message: `getMe OK but test message failed: ${err}`, durationMs: Date.now() - start };
    }
    return { ok: true, message: `Telegram @${username} connected; test message sent to ${creds.defaultChatId}`, durationMs: Date.now() - start };
  }
  return { ok: true, message: `Telegram @${username} token valid (add chat_id to send test message)`, durationMs: Date.now() - start };
}

export async function executeTelegram(
  node: WFNode,
  ctx: ExecutionContext,
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  const integration = ctx.getIntegration('telegram') || ctx.getIntegration('tg');
  if (integration?.status !== 'connected') {
    logs.push({
      time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label,
      message: 'Telegram: integration not connected. Configure bot token and test on Integrations page.',
      level: 'error', duration: Date.now() - start,
    });
    return { success: false, logs };
  }

  const creds = parseTelegramCreds(integration.config || {});
  if (!creds) {
    logs.push({
      time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label,
      message: 'Telegram: bot_token missing in integration config',
      level: 'error', duration: Date.now() - start,
    });
    return { success: false, logs };
  }

  const chatId = resolveTelegramChatId(
    String(cfg.chat_id || cfg.chatId || cfg.phone || creds.defaultChatId || ''),
    integration.config || {},
  );
  let message = resolveTemplate(String(cfg.message || cfg.text || ''), ctx);
  const parseMode = (cfg.parse_mode as string) || (cfg.parseMode as string) || '';

  if (!chatId) {
    logs.push({
      time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label,
      message: 'Telegram: chat_id required (node config or integration default)',
      level: 'error', duration: Date.now() - start,
    });
    return { success: false, logs };
  }
  if (!message) {
    logs.push({
      time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label,
      message: 'Telegram: message text is empty',
      level: 'error', duration: Date.now() - start,
    });
    return { success: false, logs };
  }

  logs.push({
    time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label,
    message: `Telegram: sending to chat ${chatId}...`, level: 'info',
  });

  try {
    const result = await sendTelegramMessage(creds, chatId, message, parseMode || undefined);
    if (!result.ok) {
      const err = (result.data as { description?: string }).description || `HTTP ${result.status}`;
      logs.push({
        time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label,
        message: `Telegram error: ${err}`, level: 'error', duration: Date.now() - start, data: result.data,
      });
      return { success: false, output: { telegram: { ok: false, error: err } }, logs };
    }
    const msgId = (result.data as { result?: { message_id?: number } }).result?.message_id;
    logs.push({
      time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label,
      message: `Telegram: message sent (message_id=${msgId})`, level: 'success', duration: Date.now() - start,
    });
    return {
      success: true,
      output: { telegram: { ok: true, chat_id: chatId, message_id: msgId, preview: message.slice(0, 120) } },
      logs,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push({
      time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label,
      message: `Telegram error: ${msg}`, level: 'error', duration: Date.now() - start,
    });
    return { success: false, logs };
  }
}
