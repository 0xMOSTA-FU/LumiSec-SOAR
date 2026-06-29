import { describe, it, expect } from 'vitest';
import { parseSmtpConfig, integrationHasSmtpCredentials } from '@/lib/executors/nodes/smtp-config';

describe('smtp-config', () => {
  it('parses Gmail service preset', () => {
    const p = parseSmtpConfig({
      service: 'gmail',
      username: 'soc@gmail.com',
      password: 'app-password',
    });
    expect(p).not.toBeNull();
    expect(p?.service).toBe('gmail');
    expect(p?.username).toBe('soc@gmail.com');
  });

  it('parses corporate SMTP host', () => {
    const p = parseSmtpConfig({
      smtp_host: 'mail.corp.local',
      port: 587,
      username: 'soar@corp.local',
      password: 'secret',
    });
    expect(p?.host).toBe('mail.corp.local');
    expect(p?.port).toBe(587);
    expect(p?.secure).toBe(false);
  });

  it('requires credentials for send', () => {
    expect(integrationHasSmtpCredentials({ smtp_host: 'x', username: 'a', password: 'b' })).toBe(true);
    expect(integrationHasSmtpCredentials({ service: 'gmail' })).toBe(false);
  });
});
