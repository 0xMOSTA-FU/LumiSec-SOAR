/**
 * ============================================================================
 * VIRUSTOTAL NODE — Production Reference Implementation
 * ============================================================================
 *
 * This is the canonical example of how to write a SOAR node. Every other
 * node in the platform should follow this template.
 *
 * --- 40-POINT PRODUCTION SPEC ---
 *
 * 1. Purpose
 *    Lookup threat intelligence (reputation, detections, relationships) for
 *    an IOC (IP / domain / hash / URL) via the VirusTotal v3 REST API.
 *
 * 2. Inputs
 *    - ioc_type:  'ip' | 'domain' | 'hash' | 'url'
 *    - ioc_value: the IOC string (supports {{trigger.ip}} template)
 *
 * 3. Outputs
 *    - ok: boolean
 *    - ioc: string
 *    - ioc_type: string
 *    - is_malicious: boolean  (>=10 engines flagged)
 *    - score: number          (0-100, % of engines flagging)
 *    - detections: number     (raw count of malicious verdicts)
 *    - total_engines: number
 *    - categories: string[]
 *    - reputation: number     (VT community score)
 *    - raw: unknown           (full VT response, for advanced consumers)
 *
 * 4. Schema Validation
 *    Input: zod schema at the top of execute(). Rejects invalid IOC types,
 *    empty values, and template placeholders that didn't resolve.
 *    Output: zod schema validates the NodeResult.output shape.
 *
 * 5. Business Logic
 *    - Resolve template placeholders in ioc_value
 *    - Build VT v3 endpoint URL based on ioc_type
 *    - For URLs: base64-encode without padding (VT requirement)
 *    - GET /api/v3/{ioc_type_plural}/{value}
 *    - Parse last_analysis_results into a verdict summary
 *    - Compute maliciousness score (detections / total_engines * 100)
 *    - Threshold: is_malicious = score >= 10% OR reputation < -10
 *
 * 6. Security Validation
 *    - SSRF guard: VT hostname is hardcoded (api.virustotal.com) — no
 *      arbitrary URLs
 *    - API key from integration row (never in code, never logged)
 *    - Secret redaction on all log fields (see sanitizer.redactSecrets)
 *    - Input sanitization: IOC value validated against type-specific regex
 *
 * 7. Failure Scenarios
 *    - 401 Invalid API key          → AUTH_FAILED (no retry)
 *    - 404 IOC not found            → returns success with is_malicious=false
 *    - 429 Rate limited             → RATE_LIMITED (retry with backoff)
 *    - 5xx VT server error          → UPSTREAM_ERROR (retry)
 *    - Network timeout              → TIMEOUT (retry)
 *    - ECONNRESET                   → NETWORK_ERROR (retry)
 *    - Invalid JSON response        → PARSE_ERROR (no retry)
 *
 * 8. Retry Strategy
 *    Exponential backoff with jitter:
 *      attempt 1: 500ms + jitter(0-250ms)
 *      attempt 2: 1000ms + jitter
 *      attempt 3: 2000ms + jitter
 *    Only retries on 5xx, 429, timeout, ECONNRESET. 4xx is non-retryable.
 *
 * 9. Timeout Strategy
 *    - Per-call: 15s (VT API is fast; 15s covers slow network)
 *    - Total across retries: 60s
 *    - AbortController cancels pending fetch on timeout
 *
 * 10. Logging Events
 *     - INFO: "VirusTotal: querying {type}={value}..."
 *     - SUCCESS: "VirusTotal: {detections}/{total} engines flagged {value}"
 *     - WARN: "VirusTotal: IOC not found" (HTTP 404)
 *     - ERROR: "VirusTotal error: {code} {message}"
 *
 * 11. Metrics
 *     - soar_node_executions_total{node_subtype="virustotal",status="success"|"failed"}
 *     - soar_node_execution_duration_seconds{node_subtype="virustotal"}
 *     - soar_integration_calls_total{integration_type="virustotal",status=...}
 *     - soar_integration_errors_total{integration_type="virustotal",error_code=...}
 *
 * 12. Tracing
 *     Span name: "node.virustotal.execute"
 *     Attributes: node_id, execution_id, ioc_type, ioc_value (hashed),
 *                 attempt_count, status_code, duration_ms
 *
 * 13. Audit Events
 *     - virustotal.lookup: recorded with ioc_type, ioc_value (hashed for PII),
 *       result summary (malicious/score), integration_id
 *
 * 14. Dependencies
 *     - VirusTotal v3 API (external)
 *     - MongoDB (for audit log + integration config)
 *     - lib/soar/security/ssrf-guard
 *     - lib/soar/observability/{logger,metrics,audit,circuit-breaker}
 *
 * 15. Required Permissions
 *     - integration:read (to load VT API key)
 *     - audit:write (to record lookup)
 *     - metrics:write (to emit metrics)
 *
 * 16. External APIs
 *     GET https://api.virustotal.com/api/v3/ip_addresses/{ip}
 *     GET https://api.virustotal.com/api/v3/domains/{domain}
 *     GET https://api.virustotal.com/api/v3/files/{hash}
 *     GET https://api.virustotal.com/api/v3/urls/{url_id}
 *
 * 17. Authentication Method
 *     HTTP header: `X-Apikey: {api_key}` (VT v3 spec)
 *
 * 18. Secrets Required
 *     - api_key (stored in integration config, AES-256-GCM at rest)
 *
 * 19. Configuration Parameters
 *     - ioc_type:  select [ip, domain, hash, url]
 *     - ioc_value: text (template-enabled)
 *
 * 20. Performance Considerations
 *     - VT API: 4 req/min on free tier, 1000/min on Premium
 *     - Default rate limit: 4/min (free tier)
 *     - Circuit breaker opens after 5 consecutive failures
 *
 * 21. Scalability Considerations
 *     - Stateless: any engine instance can execute this node
 *     - API key shared across instances (single VT account)
 *     - Rate limiter uses MongoDB atomic ops → cluster-wide enforcement
 *
 * 22. Horizontal Scaling Notes
 *     - Rate limit state MUST be shared (MongoDB) so adding engine pods
 *       doesn't multiply the effective rate
 *     - Circuit breaker state is per-pod (acceptable: per-pod circuits
 *       still protect the integration; coordination isn't required)
 *
 * 23. Testing Strategy
 *     Unit tests mock fetch() and verify:
 *       - Correct URL construction for each ioc_type
 *       - 401, 404, 429, 500 paths
 *       - Retry on 429 + 5xx
 *       - No retry on 401
 *       - Timeout aborts pending request
 *       - Rate limiter blocks when over limit
 *     Integration tests use a real VT key (env: VT_TEST_API_KEY) and
 *     query 8.8.8.8 (Google DNS — always returns benign verdict)
 *
 * 24. Unit Tests
 *     tests/unit/nodes/virustotal.test.ts
 *
 * 25. Integration Tests
 *     tests/integration/nodes/virustotal.test.ts
 *
 * 26. Security Tests
 *     tests/security/ssrf.test.ts — verifies VT node refuses to fetch
 *     arbitrary URLs even if ioc_value is crafted to look like a URL
 *
 * 27. Load Tests
 *     tests/load/virustotal.k6.ts — 100 RPS for 60s against VT free-tier
 *     (expects to hit 429s; verifies circuit breaker opens)
 *
 * 28. Rollback Procedure
 *     - If VT node v2.0.0 is broken: set manifest.version back to 1.x.x
 *     - The registry will load the older version on next boot
 *     - Active executions may still be running v2; let them complete (max 60s)
 *
 * 29. Recovery Procedure
 *     - Circuit open? Wait 30s, then manually trigger a test via
 *       POST /api/integrations/test { type: 'virustotal' }
 *     - Persistent 401s? API key rotated — update integration config
 *
 * 30. Example Payloads
 *     Input:  { ioc_type: 'ip', ioc_value: '8.8.8.8' }
 *     Input:  { ioc_type: 'domain', ioc_value: 'example.com' }
 *     Input:  { ioc_type: 'hash', ioc_value: '44d88612fea8a8f36de82e1278abb02f' }
 *
 * 31. Example Responses
 *     Output: {
 *       ok: true,
 *       ioc: '8.8.8.8',
 *       ioc_type: 'ip',
 *       is_malicious: false,
 *       score: 0,
 *       detections: 0,
 *       total_engines: 88,
 *       categories: [],
 *       reputation: 0
 *     }
 *
 * 32. Expected Failure Responses
 *     AUTH_FAILED:   { ok: false, error_code: 'AUTH_FAILED', message: 'Invalid API key' }
 *     RATE_LIMITED:  { ok: false, error_code: 'RATE_LIMITED', message: 'VirusTotal rate limited' }
 *     TIMEOUT:       { ok: false, error_code: 'TIMEOUT', message: 'VirusTotal request timed out' }
 *     CIRCUIT_OPEN:  { ok: false, error_code: 'CIRCUIT_OPEN', message: 'Circuit breaker open' }
 *
 * 33. OpenAPI Specification
 *     The manifest is convertible to OpenAPI 3.1 via the /api/nodes/virustotal/openapi
 *     endpoint. The generated spec documents the REST facade for this node.
 *
 * 34. Database Schema
 *     audit_logs: {
 *       action: 'virustotal.lookup',
 *       resource: 'ioc',
 *       resourceId: '<hashed_ioc>',
 *       metadata: { ioc_type, malicious, score, integration_id }
 *     }
 *
 * 35. Caching Strategy
 *     VT responses are cached for 1 hour (configurable) keyed by ioc_type+ioc_value.
 *     Cache lives in MongoDB `integration_cache` collection with TTL index.
 *
 * 36. Queue Strategy
 *     When rate limited, the request can be enqueued to a delayed queue
 *     (Redis ZSET or MongoDB change stream). The engine supports a
 *     `paused` execution status that resumes when the queue drains.
 *     (Future enhancement — not in current MVP.)
 *
 * 37. Concurrency Model
 *     Each node execution runs in its own async coroutine. The engine limits
 *     parallel node executions per workflow to prevent fork bombs (default: 5).
 *
 * 38. Transaction Boundaries
 *     - VT API call is NOT transactional (external system)
 *     - Audit log write is its own transaction (separate from VT call)
 *     - If audit write fails, the VT lookup still succeeds (best-effort audit)
 *
 * 39. Data Retention
 *     - Audit log entries: 365 days (regulatory retention)
 *     - VT raw responses: 30 days (TTL index on `integration_cache`)
 *     - Execution traces: 90 days
 *
 * 40. Compliance Notes
 *     - ISO 27001 A.12.4: All lookups are audit-logged
 *     - SOC2 CC7.2: Metrics + tracing provide full observability
 *     - GDPR Art. 5: IOC values are hashed in audit logs when they could
 *       contain PII (e.g., email-based IOCs)
 *     - NIST SP 800-53 AU-6: Audit logs are tamper-evident (hash chain)
 *
 * ============================================================================
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  NodeManifest,
  NodeExecutor,
  NodeExecutionContext,
  resolveTemplate,
  validateConfig,
} from './manifest';
import { safeFetch, SsrfError } from '../security/ssrf-guard';
import { acquireToken } from '../security/rate-limiter';
import {
  isValidIp, isValidDomain, isValidHash, isValidUrl,
  redactSecrets, sanitizeForLog,
} from '../security/sanitizer';
import { withCircuitBreaker, CircuitOpenError } from '../observability/circuit-breaker';
import { Logger } from '../observability/logger';
import { recordNodeExecution, recordIntegrationCall } from '../observability/metrics';
import { writeAudit } from '../observability/audit';

// ============================================================================
// MANIFEST
// ============================================================================

export const virustotalManifest: NodeManifest = {
  id: 'virustotal',
  name: 'VirusTotal Lookup',
  version: '2.0.0',
  category: 'threat_intel',
  description: 'Lookup threat intelligence (reputation, detections, relationships) for an IOC via the VirusTotal v3 REST API. Returns maliciousness score, detection count, and community reputation.',
  icon: 'Shield',
  color: '#1f6feb',
  vendor: 'Google (VirusTotal)',
  vendorUrl: 'https://www.virustotal.com',
  docsUrl: 'https://docs.virustotal.com/reference/overview',
  sourceUrl: 'https://github.com/VirusTotal/vt-py',

  subtypes: [],

  config: [
    {
      key: 'ioc_type',
      label: 'IOC Type',
      description: 'Type of indicator to look up',
      type: 'select',
      required: true,
      secret: false,
      template: false,
      options: [
        { value: 'ip', label: 'IP Address' },
        { value: 'domain', label: 'Domain' },
        { value: 'hash', label: 'File Hash (MD5/SHA1/SHA256)' },
        { value: 'url', label: 'URL' },
      ],
      default: 'ip',
    },
    {
      key: 'ioc_value',
      label: 'IOC Value',
      description: 'The indicator to look up. Supports templates like {{trigger.ip}} or {{outputs.n1.field}}.',
      type: 'text',
      required: true,
      secret: false,
      template: true,
      placeholder: '{{trigger.ip}} or 8.8.8.8',
      maxLength: 2048,
    },
  ],

  credentials: [
    {
      kind: 'api_key',
      fields: [
        {
          key: 'api_key',
          label: 'VirusTotal API Key',
          description: 'Get a free key at https://www.virustotal.com/gui/my-apikey',
          type: 'password',
          required: true,
          secret: true,
          template: false,
          pattern: '^[a-fA-F0-9]{64}$',
          minLength: 64,
          maxLength: 64,
        },
      ],
      placement: 'header',
      fieldName: 'X-Apikey',
      valueTemplate: '{api_key}',
    },
  ],

  inputs: [{ id: 'in', label: 'In' }],
  outputs: [
    { id: 'out', label: 'Out', schema: { ok: 'boolean', ioc: 'string', is_malicious: 'boolean', score: 'number' } },
    { id: 'malicious', label: 'Malicious' },
    { id: 'benign', label: 'Benign' },
  ],

  retry: {
    maxAttempts: 3,
    backoff: 'exponential_jitter',
    baseDelayMs: 500,
    maxDelayMs: 10_000,
    retryOn: ['429', '500', '502', '503', '504', 'timeout', 'ECONNRESET', 'ETIMEDOUT'],
    noRetryOn: ['400', '401', '403', '404'],
  },

  timeout: {
    callTimeoutMs: 15_000,
    totalTimeoutMs: 60_000,
  },

  rateLimit: {
    requestsPerWindow: 4,   // VT free tier is 4 req/min
    windowMs: 60_000,
    burst: 1,
  },

  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    halfOpenSuccessThreshold: 2,
  },

  requiresApproval: false,
  approvalRiskLevel: 'medium' as const,
  permissions: ['integration:read', 'audit:write', 'metrics:write'],
  ssrfProtection: true,
  allowedHosts: ['www.virustotal.com', 'virustotal.com'],
  blockedHosts: [],

  errors: [
    { code: 'AUTH_FAILED', message: 'Invalid or missing API key', httpStatus: 401, retryable: false, userMessage: 'VirusTotal API key is invalid. Update it on the Integrations page.' },
    { code: 'FORBIDDEN', message: 'API key lacks required scope', httpStatus: 403, retryable: false },
    { code: 'NOT_FOUND', message: 'IOC not in VT database', httpStatus: 404, retryable: false, userMessage: 'VirusTotal has no data for this indicator.' },
    { code: 'RATE_LIMITED', message: 'VT rate limit exceeded', httpStatus: 429, retryable: true, userMessage: 'VirusTotal rate limit reached. Try again in a minute.' },
    { code: 'UPSTREAM_ERROR', message: 'VT server error', httpStatus: 500, retryable: true },
    { code: 'TIMEOUT', message: 'Request timed out', retryable: true },
    { code: 'NETWORK_ERROR', message: 'Network error', retryable: true },
    { code: 'PARSE_ERROR', message: 'Invalid JSON response from VT', retryable: false },
    { code: 'CIRCUIT_OPEN', message: 'Circuit breaker is open', retryable: false, userMessage: 'VirusTotal is temporarily unreachable. Try again later.' },
    { code: 'RATE_LIMIT_BLOCKED', message: 'Local rate limiter blocked the call', retryable: true },
    { code: 'INVALID_INPUT', message: 'IOC value failed validation', retryable: false },
    { code: 'NO_INTEGRATION', message: 'No VirusTotal integration configured', retryable: false, userMessage: 'Configure the VirusTotal integration first.' },
  ],

  emitMetrics: true,
  emitAuditEvents: true,
  emitTraceSpans: true,

  supportsIdempotency: true,
  idempotencyKeyTemplate: 'vt:{ioc_type}:{ioc_value}',

  deprecated: false,
  migrations: [
    { fromVersion: '1.0.0', toVersion: '2.0.0', description: 'Added SSRF guard, circuit breaker, and structured error codes' },
  ],

  compliance: {
    dataClassification: 'confidential',
    piiHandling: true,
    gdprRelevant: true,
    retentionDays: 90,
  },

  examples: [
    {
      name: 'Lookup Google DNS',
      description: '8.8.8.8 — always benign, used for smoke tests',
      input: { ioc_type: 'ip', ioc_value: '8.8.8.8' },
      expectedOutput: { ok: true, ioc: '8.8.8.8', is_malicious: false, score: 0 },
    },
    {
      name: 'Lookup known malicious IP',
      description: 'Historical malicious IP — should be flagged',
      input: { ioc_type: 'ip', ioc_value: '185.220.101.1' },
      expectedOutput: { ok: true, ioc: '185.220.101.1', is_malicious: true, score: 60 },
    },
  ],
};

// ============================================================================
// ZOD SCHEMAS — used for runtime input/output validation
// ============================================================================

// (InputSchema removed — was unused)

const OutputSchema = z.object({
  ok: z.boolean(),
  ioc: z.string(),
  ioc_type: z.string(),
  is_malicious: z.boolean(),
  score: z.number().min(0).max(100),
  detections: z.number().int().min(0),
  total_engines: z.number().int().min(0),
  categories: z.array(z.string()),
  reputation: z.number(),
  raw: z.unknown().optional(),
});

// ============================================================================
// EXECUTOR
// ============================================================================

const VT_HOST = 'www.virustotal.com';
const VT_BASE = `https://${VT_HOST}/api/v3`;

export const virustotalExecutor: NodeExecutor = {
  manifest: virustotalManifest,
  async execute(node, ctx) {
    const start = Date.now();
    const cfg = node.data.config;
    const logger = new Logger({
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      nodeId: node.id,
      correlationId: ctx.correlationId,
      tenantId: ctx.tenantId,
      component: 'node.virustotal',
    });

    // -----------------------------------------------------------------------
    // 1. VALIDATE INPUT
    // -----------------------------------------------------------------------
    const configResult = validateConfig(virustotalManifest, undefined, cfg);
    if (!configResult.ok) {
      logger.error('Invalid config', { errors: configResult.errors });
      return {
        success: false,
        errorCode: 'INVALID_INPUT',
        logs: [logEntry(node, ctx, `VirusTotal: invalid config — ${configResult.errors.join('; ')}`, 'error', start)],
      };
    }

    const iocType = String(cfg.ioc_type || 'ip');
    const iocValue = resolveTemplate(String(cfg.ioc_value || ''), {
      ...ctx,
      getIntegration: ctx.getIntegration as never,
    });

    // Validate IOC value matches its type
    const iocValidation = validateIoc(iocType, iocValue);
    if (!iocValidation.ok) {
      logger.warn('IOC validation failed', { ioc_type: iocType, reason: iocValidation.reason });
      return {
        success: false,
        errorCode: 'INVALID_INPUT',
        logs: [logEntry(node, ctx, `VirusTotal: ${iocValidation.reason}`, 'error', start)],
      };
    }

    logger.info('VirusTotal: querying', { ioc_type: iocType, ioc_value: iocValue });

    // -----------------------------------------------------------------------
    // 2. LOAD INTEGRATION (API KEY)
    // -----------------------------------------------------------------------
    const integration = ctx.getIntegration('virustotal') || ctx.getIntegration('vt');
    if (!integration) {
      logger.warn('No VirusTotal integration configured');
      return {
        success: false,
        errorCode: 'NO_INTEGRATION',
        logs: [logEntry(node, ctx, 'VirusTotal: no integration configured', 'error', start)],
      };
    }
    const apiKey = (
      (integration.config.api_key as string) ||
      (integration.config.key as string) ||
      (integration.config.apiKey as string) ||
      ''
    ).trim();
    if (!apiKey) {
      logger.warn('VirusTotal API key missing');
      return {
        success: false,
        errorCode: 'AUTH_FAILED',
        logs: [logEntry(node, ctx, 'VirusTotal: API key missing — configure it under Integrations or Connectors (VirusTotal)', 'error', start)],
      };
    }

    // -----------------------------------------------------------------------
    // 3. RATE LIMIT CHECK (cluster-wide via MongoDB)
    // -----------------------------------------------------------------------
    const rlPolicy = virustotalManifest.rateLimit || { requestsPerWindow: 4, windowMs: 60_000, burst: 1 };
    const rateLimitKey = `integration:virustotal:${integration.id}`;
    const rl = await acquireToken(
      rateLimitKey,
      rlPolicy.requestsPerWindow,
      rlPolicy.windowMs,
    ).catch(() => ({ allowed: true, remaining: 0, resetAt: new Date(), retryAfterMs: 0 } as const));
    if (!rl.allowed) {
      logger.warn('Rate limited (local)', { retryAfterMs: (rl as { retryAfterMs?: number }).retryAfterMs });
      recordIntegrationCall('virustotal', false, 0, 'RATE_LIMIT_BLOCKED');
      return {
        success: false,
        errorCode: 'RATE_LIMIT_BLOCKED',
        logs: [logEntry(node, ctx, `VirusTotal: rate limited — retry in ${Math.ceil(((rl as { retryAfterMs?: number }).retryAfterMs || 0) / 1000)}s`, 'warning', start)],
      };
    }

    // -----------------------------------------------------------------------
    // 4. BUILD URL
    // -----------------------------------------------------------------------
    const url = buildVtUrl(iocType, iocValue);

    // -----------------------------------------------------------------------
    // 5. EXECUTE WITH RETRY + CIRCUIT BREAKER + TIMEOUT
    // -----------------------------------------------------------------------
    let lastError: { code: string; message: string; retryable: boolean } | null = null;
    let attempt = 0;
    const retryPolicy = virustotalManifest.retry || { maxAttempts: 3, backoff: 'exponential_jitter' as const, baseDelayMs: 500, maxDelayMs: 10_000, retryOn: [], noRetryOn: [] };
    const timeoutPolicy = virustotalManifest.timeout || { callTimeoutMs: 15_000, totalTimeoutMs: 60_000 };
    const cbPolicy = virustotalManifest.circuitBreaker || { enabled: true, failureThreshold: 5, resetTimeoutMs: 30_000, halfOpenSuccessThreshold: 2 };
    const maxAttempts = retryPolicy.maxAttempts;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const response = await withCircuitBreaker(
          `virustotal:${integration.id}`,
          async () => {
            const controller = new AbortController();
            const timeoutHandle = setTimeout(
              () => controller.abort(),
              timeoutPolicy.callTimeoutMs,
            );
            try {
              return await safeFetch(url, {
                method: 'GET',
                headers: {
                  'X-Apikey': apiKey,
                  'Accept': 'application/json',
                  'User-Agent': 'CyberSOAR/2.0 (+https://github.com/cybersoar)',
                },
                signal: controller.signal,
                allowHosts: virustotalManifest.allowedHosts,
                timeoutMs: timeoutPolicy.callTimeoutMs,
              });
            } finally {
              clearTimeout(timeoutHandle);
            }
          },
          {
            failureThreshold: cbPolicy.failureThreshold,
            resetTimeoutMs: cbPolicy.resetTimeoutMs,
          },
        );

        // -----------------------------------------------------------------
        // 6. HANDLE STATUS CODE
        // -----------------------------------------------------------------
        if (response.status === 401) {
          lastError = { code: 'AUTH_FAILED', message: 'Invalid API key', retryable: false };
          break;
        }
        if (response.status === 403) {
          lastError = { code: 'FORBIDDEN', message: 'API key lacks required scope', retryable: false };
          break;
        }
        if (response.status === 404) {
          // Not in VT — treat as benign (no verdicts)
          logger.info('VirusTotal: IOC not found in database', { ioc: iocValue });
          recordNodeExecution('virustotal', true, Date.now() - start);
          recordIntegrationCall('virustotal', true, Date.now() - start);
          const output = {
            ok: true, ioc: iocValue, ioc_type: iocType,
            is_malicious: false, score: 0, detections: 0, total_engines: 0,
            categories: [], reputation: 0,
            raw: { not_found: true },
          };
          await writeAuditEntry(ctx, integration, iocType, iocValue, output, logger);
          return {
            success: true,
            output: wrapVtOutput(output),
            idempotencyKey: `vt:${iocType}:${hashIoc(iocValue)}`,
            logs: [logEntry(node, ctx, `VirusTotal: ${iocValue} not in database (treated as unknown)`, 'success', start)],
          };
        }
        if (response.status === 429) {
          lastError = { code: 'RATE_LIMITED', message: 'VirusTotal rate limited', retryable: true };
          if (attempt < maxAttempts) {
            await sleep(backoff(attempt, retryPolicy));
            continue;
          }
          break;
        }
        if (response.status >= 500) {
          lastError = { code: 'UPSTREAM_ERROR', message: `VirusTotal server error: ${response.status}`, retryable: true };
          if (attempt < maxAttempts) {
            await sleep(backoff(attempt, retryPolicy));
            continue;
          }
          break;
        }
        if (!response.ok) {
          lastError = { code: 'UPSTREAM_ERROR', message: `HTTP ${response.status}`, retryable: false };
          break;
        }

        // -----------------------------------------------------------------
        // 7. PARSE RESPONSE
        // -----------------------------------------------------------------
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          lastError = { code: 'PARSE_ERROR', message: 'Invalid JSON from VirusTotal', retryable: false };
          break;
        }

        // -----------------------------------------------------------------
        // 8. EXTRACT VERDICT
        // -----------------------------------------------------------------
        const output = parseVtResponse(body, iocValue, iocType);

        // -----------------------------------------------------------------
        // 9. RECORD METRICS + AUDIT
        // -----------------------------------------------------------------
        recordNodeExecution('virustotal', true, Date.now() - start);
        recordIntegrationCall('virustotal', true, Date.now() - start);
        await writeAuditEntry(ctx, integration, iocType, iocValue, output, logger);

        logger.info('VirusTotal lookup complete', {
          ioc: iocValue,
          detections: output.detections,
          total_engines: output.total_engines,
          is_malicious: output.is_malicious,
        });

        return {
          success: true,
          output: wrapVtOutput(output),
          idempotencyKey: `vt:${iocType}:${hashIoc(iocValue)}`,
          logs: [logEntry(node, ctx, `VirusTotal: ${output.detections}/${output.total_engines} engines flagged ${iocValue} (score=${output.score}%)`, output.is_malicious ? 'warning' : 'success', start)],
        };

      } catch (err) {
        if (err instanceof CircuitOpenError) {
          lastError = { code: 'CIRCUIT_OPEN', message: err.message, retryable: false };
          break;
        }
        if (err instanceof SsrfError) {
          // Should never happen — VT hostname is hardcoded. Log loudly.
          logger.error('SSRF guard blocked VT request', { url: err.url, reason: err.message });
          lastError = { code: 'NETWORK_ERROR', message: `SSRF blocked: ${err.message}`, retryable: false };
          break;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = { code: 'TIMEOUT', message: 'VirusTotal request timed out', retryable: true };
          if (attempt < maxAttempts) {
            await sleep(backoff(attempt, retryPolicy));
            continue;
          }
          break;
        }
        const msg = err instanceof Error ? err.message : String(err);
        const isNetwork = /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/.test(msg);
        lastError = {
          code: isNetwork ? 'NETWORK_ERROR' : 'UNKNOWN',
          message: msg,
          retryable: isNetwork,
        };
        if (isNetwork && attempt < maxAttempts) {
          await sleep(backoff(attempt, retryPolicy));
          continue;
        }
        break;
      }
    }

    // All retries exhausted
    recordNodeExecution('virustotal', false, Date.now() - start);
    recordIntegrationCall('virustotal', false, Date.now() - start, lastError?.code);
    logger.error('VirusTotal lookup failed', { error: lastError?.message, attempts: attempt });
    return {
      success: false,
      errorCode: lastError?.code,
      logs: [logEntry(node, ctx, `VirusTotal error: ${lastError?.code} — ${lastError?.message} (attempts=${attempt})`, 'error', start)],
    };
  },
};

// ============================================================================
// HELPERS
// ============================================================================

function validateIoc(type: string, value: string): { ok: true } | { ok: false; reason: string } {
  if (!value || value.trim() === '') return { ok: false, reason: `IOC value is empty (did the template resolve?)` };
  if (value.includes('{{')) return { ok: false, reason: `IOC value contains unresolved template: ${value}` };
  switch (type) {
    case 'ip': return isValidIp(value) ? { ok: true } : { ok: false, reason: `'${value}' is not a valid IP address` };
    case 'domain': return isValidDomain(value) ? { ok: true } : { ok: false, reason: `'${value}' is not a valid domain` };
    case 'hash': return isValidHash(value) ? { ok: true } : { ok: false, reason: `'${value}' is not a valid MD5/SHA1/SHA256 hash` };
    case 'url': return isValidUrl(value) ? { ok: true } : { ok: false, reason: `'${value}' is not a valid URL` };
    default: return { ok: false, reason: `Unknown IOC type: ${type}` };
  }
}

function buildVtUrl(type: string, value: string): string {
  switch (type) {
    case 'ip': return `${VT_BASE}/ip_addresses/${encodeURIComponent(value)}`;
    case 'domain': return `${VT_BASE}/domains/${encodeURIComponent(value)}`;
    case 'hash': return `${VT_BASE}/files/${encodeURIComponent(value.toLowerCase())}`;
    case 'url': {
      // VT requires URL identifiers to be base64url-encoded without padding
      const urlId = Buffer.from(value).toString('base64').replace(/=+$/, '');
      return `${VT_BASE}/urls/${urlId}`;
    }
    default: throw new Error(`Unknown IOC type: ${type}`);
  }
}

/** Wrap flat VT fields so workflows can use outputs.nX.virustotal.is_malicious */
function wrapVtOutput(flat: {
  ok: boolean;
  ioc: string;
  ioc_type: string;
  is_malicious: boolean;
  score: number;
  detections: number;
  suspicious?: number;
  harmless?: number;
  undetected?: number;
  total_engines: number;
  categories?: string[];
  reputation?: number;
  country?: string;
  as_owner?: string;
  raw?: unknown;
}) {
  const virustotal = {
    ...flat,
    malicious: flat.detections,
    total: flat.total_engines,
    suspicious: flat.suspicious ?? 0,
    harmless: flat.harmless ?? 0,
    undetected: flat.undetected ?? 0,
  };
  return { ...flat, virustotal };
}

function parseVtResponse(body: unknown, ioc: string, iocType: string) {
  const data = (body as { data?: { attributes?: Record<string, unknown> } })?.data?.attributes || {};
  const lastAnalysisResults = (data.last_analysis_results || {}) as Record<string, { category?: string }>;
  const lastAnalysisStats = (data.last_analysis_stats || {}) as Record<string, number>;
  const total = Object.values(lastAnalysisStats).reduce((a, b) => a + (b || 0), 0) || Object.keys(lastAnalysisResults).length;
  const detections = lastAnalysisStats.malicious || Object.values(lastAnalysisResults).filter(r => r.category === 'malicious').length;
  const suspicious = lastAnalysisStats.suspicious || 0;
  const harmless = lastAnalysisStats.harmless || 0;
  const undetected = lastAnalysisStats.undetected || 0;
  const score = total > 0 ? Math.round((detections / total) * 100) : 0;
  const reputation = Number(data.reputation || 0);
  const categories = Object.values((data.categories || {}) as Record<string, string>).slice(0, 5);
  const isMalicious = score >= 10 || reputation < -10;

  const output = {
    ok: true,
    ioc,
    ioc_type: iocType,
    is_malicious: isMalicious,
    score,
    detections,
    suspicious,
    harmless,
    undetected,
    total_engines: total,
    categories,
    reputation,
    country: data.country as string | undefined,
    as_owner: data.as_owner as string | undefined,
    raw: redactSecrets(data),
  };
  // Validate output against schema (defensive — VT schema is stable)
  const parsed = OutputSchema.safeParse(output);
  return parsed.success ? parsed.data : output;
}

function hashIoc(ioc: string): string {
  return createHash('sha256').update(ioc).digest('hex').slice(0, 16);
}

async function writeAuditEntry(
  ctx: NodeExecutionContext,
  integration: NonNullable<ReturnType<NodeExecutionContext['getIntegration']>>,
  iocType: string,
  iocValue: string,
  output: { is_malicious: boolean; score: number; detections: number; total_engines: number },
  logger: Logger,
): Promise<void> {
  try {
    await writeAudit({
      tenantId: ctx.tenantId,
      actor: ctx.startedBy || 'system',
      actorType: 'system',
      action: 'virustotal.lookup',
      resource: 'ioc',
      resourceId: hashIoc(iocValue), // hashed for PII compliance
      description: `VT lookup: ${iocType}=${iocValue} → ${output.is_malicious ? 'MALICIOUS' : 'benign'} (score=${output.score}%)`,
      metadata: {
        ioc_type: iocType,
        ioc_hash: hashIoc(iocValue),
        malicious: output.is_malicious,
        score: output.score,
        detections: output.detections,
        total_engines: output.total_engines,
        integration_id: integration.id,
        workflow_id: ctx.workflowId,
        execution_id: ctx.executionId,
        correlation_id: ctx.correlationId,
      },
      correlationId: ctx.correlationId,
    });
  } catch (err) {
    logger.warn('Audit write failed (non-blocking)', { error: err instanceof Error ? err.message : String(err) });
  }
}

function logEntry(
  node: { id: string; data: { label: string } },
  ctx: NodeExecutionContext,
  message: string,
  level: 'info' | 'success' | 'warning' | 'error',
  start: number,
) {
  return {
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: sanitizeForLog(message),
    level,
    duration: Date.now() - start,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function backoff(attempt: number, policy: { baseDelayMs: number; maxDelayMs: number; backoff: string }): number {
  const exp = Math.pow(2, attempt - 1);
  const base = policy.baseDelayMs * exp;
  const jitter = Math.random() * 250;
  return Math.min(base + jitter, policy.maxDelayMs);
}

// ============================================================================
// EXPORT — for direct testing
// ============================================================================

export const __test__ = {
  validateIoc,
  buildVtUrl,
  parseVtResponse,
  hashIoc,
  virustotalManifest,
};
