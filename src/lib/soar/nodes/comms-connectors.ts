/**
 * Communication connectors — Telegram
 */
import { buildCertifiedConnector } from './build-connector';
import { executeTelegram } from '@/lib/executors/nodes/telegram';

export const telegramExecutor = buildCertifiedConnector({
  id: 'telegram',
  name: 'Telegram',
  version: '1.0.0',
  category: 'communication',
  description: 'Send SOAR notifications via Telegram Bot API (sendMessage).',
  icon: 'Send',
  color: '#0088cc',
  vendor: 'Telegram',
  vendorUrl: 'https://telegram.org/',
  docsUrl: 'https://core.telegram.org/bots/api',
  allowedHosts: ['api.telegram.org'],
  config: [
    { key: 'chat_id', label: 'Chat ID', type: 'text', required: false, secret: false, template: true, placeholder: '{{trigger.chat_id}} or -1001234567890' },
    { key: 'message', label: 'Message', type: 'textarea', required: true, secret: false, template: true, placeholder: 'SOAR alert: {{trigger.title}}' },
    { key: 'parse_mode', label: 'Parse mode', type: 'select', required: false, secret: false, template: false, options: [
      { value: '', label: 'Plain text' },
      { value: 'HTML', label: 'HTML' },
      { value: 'MarkdownV2', label: 'MarkdownV2' },
    ]},
  ],
  credentials: [{
    kind: 'api_key',
    fields: [
      { key: 'bot_token', label: 'Bot token', type: 'password', required: true, secret: true, template: false },
      { key: 'chat_id', label: 'Default chat ID', type: 'text', required: false, secret: false, template: false, placeholder: '-1001234567890' },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'Bearer {bot_token}',
  }],
}, executeTelegram);

export const commsExtendedExecutors = [telegramExecutor];
