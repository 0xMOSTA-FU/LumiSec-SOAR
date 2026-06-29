/**
 * Shared SMTP configuration parsing for email executor + connectivity tests.
 */
import nodemailer from 'nodemailer';

export interface ParsedSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  service: string;
  username: string;
  password: string;
  from: string;
  defaultTo: string;
  rejectUnauthorized: boolean;
}

export function parseSmtpConfig(cfg: Record<string, unknown>): ParsedSmtpConfig | null {
  const service = String(cfg.service || '').trim().toLowerCase();
  const host = String(cfg.smtp_host || cfg.host || '').trim();
  if (!host && !service) return null;

  const portRaw = cfg.port;
  const port = portRaw !== undefined && portRaw !== '' ? Number(portRaw) : (service ? 0 : 587);
  const secure = cfg.secure === true || cfg.secure === 'true' || port === 465;
  const username = String(cfg.username || cfg.user || cfg.email || '').trim();
  const password = String(cfg.password || cfg.pass || cfg.app_password || '').trim();
  const from = String(cfg.from || username || '').trim();
  const defaultTo = String(cfg.default_to || cfg.test_to || cfg.to || '').trim();
  const rejectUnauthorized = !(cfg.reject_unauthorized === false || cfg.reject_unauthorized === 'false');

  return {
    host,
    port,
    secure,
    service,
    username,
    password,
    from,
    defaultTo,
    rejectUnauthorized,
  };
}

export function buildSmtpTransporter(cfg: Record<string, unknown>) {
  const parsed = parseSmtpConfig(cfg);
  if (!parsed) return null;

  if (parsed.service) {
    return nodemailer.createTransport({
      service: parsed.service,
      ...(parsed.username || parsed.password
        ? { auth: { user: parsed.username, pass: parsed.password } }
        : {}),
    });
  }

  const opts = {
    host: parsed.host,
    port: parsed.port || 587,
    secure: parsed.secure,
    requireTLS: !parsed.secure && (parsed.port || 587) === 587,
    ...(parsed.username || parsed.password
      ? { auth: { user: parsed.username, pass: parsed.password } }
      : {}),
    ...(!parsed.rejectUnauthorized ? { tls: { rejectUnauthorized: false as const } } : {}),
  };
  return nodemailer.createTransport(opts);
}

export function resolveSmtpFrom(cfg: Record<string, unknown>, override?: string): string {
  const parsed = parseSmtpConfig(cfg);
  return (override || '').trim() || parsed?.from || parsed?.username || 'soar@localhost';
}

export function integrationHasSmtpCredentials(cfg: Record<string, unknown>): boolean {
  const parsed = parseSmtpConfig(cfg);
  if (!parsed) return false;
  if (parsed.service) return Boolean(parsed.username && parsed.password);
  return Boolean(parsed.host && parsed.username && parsed.password);
}
