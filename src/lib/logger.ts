// Structured logger — pino with redaction, request ID, and OTel-friendly fields.
// In production, ship logs to stdout (collected by OTel Collector → Loki/ES).
// In dev, pretty-print for readability.

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.api_key',
  '*.apiKey',
  '*.api_token',
  '*.apiToken',
  '*.client_secret',
  '*.clientSecret',
  '*.secret',
  '*.token',
  '*.webhook',
  '*.webhook_url',
  '*.mfaSecret',
  '*.keyHash',
  'config.api_key',
  'config.api_token',
  'config.password',
  'config.client_secret',
  'config.webhook',
  'config.webhook_url',
  'config.secret',
  '*.config.api_key',
  '*.config.api_token',
  '*.config.password',
  '*.config.client_secret',
  '*.config.webhook',
  '*.config.webhook_url',
];

export const logger = pino({
  level,
  base: {
    service: 'soar',
    version: process.env.APP_VERSION || '1.0.0',
    env: process.env.NODE_ENV || 'development',
  },
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string) => ({ level: label }),
    log: (obj: Record<string, unknown>) => obj,
  },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service,version,env',
          messageFormat: '{msg}',
          singleLine: false,
        },
      }
    : undefined, // JSON to stdout in production
});

/**
 * Create a child logger with request context.
 */
export function requestLogger(opts: {
  requestId?: string;
  userId?: string;
  tenantId?: string;
  traceId?: string;
  spanId?: string;
  actorIp?: string;
}) {
  return logger.child({
    request_id: opts.requestId,
    user_id: opts.userId,
    tenant_id: opts.tenantId,
    trace_id: opts.traceId,
    span_id: opts.spanId,
    actor_ip: opts.actorIp,
  });
}

/**
 * Log a structured audit event (also persisted to AuditLog table by middleware).
 */
export function logAuditEvent(opts: {
  action: string;
  resource: string;
  resourceId?: string;
  description: string;
  actor?: string;
  userId?: string;
  tenantId?: string;
  requestId?: string;
  actorIp?: string;
  metadata?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  level?: 'info' | 'warn' | 'error';
}) {
  logger.info({
    event: 'audit',
    audit_action: opts.action,
    resource: opts.resource,
    resource_id: opts.resourceId,
    description: opts.description,
    actor: opts.actor || 'system',
    user_id: opts.userId,
    tenant_id: opts.tenantId,
    request_id: opts.requestId,
    actor_ip: opts.actorIp,
    metadata: opts.metadata,
    before: opts.before,
    after: opts.after,
    level: opts.level || 'info',
  }, `AUDIT: ${opts.action} on ${opts.resource}${opts.resourceId ? `/${opts.resourceId}` : ''}`);
}
