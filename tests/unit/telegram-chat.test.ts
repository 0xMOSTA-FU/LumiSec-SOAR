import { describe, it, expect } from 'vitest';
import { resolveTelegramChatId } from '@/lib/executors/nodes/telegram';

describe('resolveTelegramChatId', () => {
  it('returns numeric chat id as-is', () => {
    expect(resolveTelegramChatId('123456789', {})).toBe('123456789');
    expect(resolveTelegramChatId('-100123', {})).toBe('-100123');
  });

  it('maps phone via phone_contacts JSON', () => {
    const config = { phone_contacts: '{"+201234567890":"987654321"}' };
    expect(resolveTelegramChatId('+201234567890', config)).toBe('987654321');
  });

  it('falls back to default chat_id from config', () => {
    expect(resolveTelegramChatId('', { chat_id: '111' })).toBe('111');
  });
});
