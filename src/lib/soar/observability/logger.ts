/**
 * Structured Logger — Pino-based with correlation IDs
 * ---------------------------------------------------------------------------
 * Every log line carries:
 *   - timestamp (ISO 8601 UTC)
 *   - level (debug/info/warn/error/fatal)
 *   - correlationId (request/workflow-scoped, propagates across services)
 *   - workflowId / executionId / nodeId (when in execution context)
 *   - tenantId (for multi-tenant log routing)
 *   - actor (user / api-key / system)
 *   - redacted secrets (see sanitizer.ts)
 *
 * Output: JSON to stdout (k8s/CloudWatch/Datadog friendly).
 *
 * Compliance: SOC2 CC7.2 (system operations), ISO27001 A.12.4 (logging)
 */
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from '../security/sanitizer';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';

const baseLogger = pino({
  level: LOG_LEVEL,
  base: {
    service: 'soar-platform',
    version: process.env.npm_package_version || '1.0.0',
    env: NODE_ENV,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.api_key',
      '*.api_token',
      '*.secret',
      '*.client_secret',
      '*.refresh_token',
      '*.access_token',
      '*.private_key',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label: string) => ({ level: label }),
    bindings: (bindings) => ({ pid: bindings.pid, host: bindings.hostname }),
  },
  // Pretty-print only in dev — production uses JSON for log aggregators
  ...(NODE_ENV === 'development' ? {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
    },
  } : {}),
});

export interface LogContext {
  correlationId?: string;
  workflowId?: string;
  executionId?: string;
  nodeId?: string;
  tenantId?: string;
  actor?: string;
  requestId?: string;
  [key: string]: unknown;
}

export class Logger {
  private ctx: LogContext;

  constructor(ctx: LogContext = {}) {
    this.ctx = {
      correlationId: ctx.correlationId || randomUUID(),
      ...ctx,
    };
  }

  /** Create a child logger with additional context (merges, not replaces). */
  child(extra: LogContext): Logger {
    return new Logger({ ...this.ctx, ...extra });
  }

  /** Get the current correlation ID. */
  get correlationId(): string {
    return this.ctx.correlationId!;
  }

  debug(msg: string, data?: unknown): void {
    baseLogger.debug({ ...this.ctx, ...(data ? { data: redactSecrets(data) } : {}) }, msg);
  }

  info(msg: string, data?: unknown): void {
    baseLogger.info({ ...this.ctx, ...(data ? { data: redactSecrets(data) } : {}) }, msg);
  }

  warn(msg: string, data?: unknown): void {
    baseLogger.warn({ ...this.ctx, ...(data ? { data: redactSecrets(data) } : {}) }, msg);
  }

  error(msg: string, data?: unknown): void {
    baseLogger.error({ ...this.ctx, ...(data ? { data: redactSecrets(data) } : {}) }, msg);
  }

  fatal(msg: string, data?: unknown): void {
    baseLogger.fatal({ ...this.ctx, ...(data ? { data: redactSecrets(data) } : {}) }, msg);
  }

  /** Log a security-relevant event at warn level (always visible). */
  audit(action: string, data?: unknown): void {
    baseLogger.warn({
      ...this.ctx,
      event: 'audit',
      action,
      ...(data ? { data: redactSecrets(data) } : {}),
    }, `AUDIT: ${action}`);
  }
}

/** Create a logger for a request handler (auto-extracts correlationId from headers). */
export function createRequestLogger(req: Request): Logger {
  const correlationId = req.headers.get('x-correlation-id') || randomUUID();
  const tenantId = req.headers.get('x-tenant-id') || undefined;
  const actor = req.headers.get('x-actor') || undefined;
  return new Logger({ correlationId, tenantId, actor });
}

/** Create a logger for a workflow execution. */
export function createExecutionLogger(opts: {
  workflowId: string;
  executionId: string;
  tenantId?: string;
  correlationId?: string;
  triggerType?: string;
}): Logger {
  return new Logger({
    workflowId: opts.workflowId,
    executionId: opts.executionId,
    tenantId: opts.tenantId,
    correlationId: opts.correlationId || randomUUID(),
    component: 'workflow-engine',
    triggerType: opts.triggerType,
  });
}

/** Create a logger for a node execution. */
export function createNodeLogger(opts: {
  workflowId: string;
  executionId: string;
  nodeId: string;
  nodeSubtype?: string;
  correlationId: string;
  tenantId?: string;
}): Logger {
  return new Logger({
    workflowId: opts.workflowId,
    executionId: opts.executionId,
    nodeId: opts.nodeId,
    nodeSubtype: opts.nodeSubtype,
    correlationId: opts.correlationId,
    tenantId: opts.tenantId,
    component: 'node-executor',
  });
}

export { baseLogger };
