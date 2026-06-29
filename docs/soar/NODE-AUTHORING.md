# CyberSOAR — Node Authoring Guide

> **Audience**: SOAR engineers building new integration nodes (e.g., a new threat-intel vendor, an internal ticketing system, a custom enrichment script).
>
> **Goal**: Every node in the platform is production-grade. This guide walks you through the 40-point spec, shows a complete reference implementation, and gives you a copy-paste template to start from.

---

## 1. What is a SOAR Node?

A node is a single unit of work inside a workflow. When a workflow runs, the engine walks its graph in BFS order and, for each node, dispatches to a registered executor. The executor:

1. Reads its config (typed + schema-validated)
2. Resolves template placeholders like `{{trigger.ip}}` against the execution context
3. Calls the external integration (VirusTotal, Splunk, Jira, ...)
4. Parses the response into a typed output object
5. Records metrics + audit entries
6. Returns either `{ success: true, output }` or `{ success: false, errorCode }`

The engine handles retry, timeout, circuit breaking, idempotency, and log persistence — you focus on the integration logic.

---

## 2. The 40-Point Production Spec

Every node MUST satisfy all 40 points below. The reference implementation in
`src/lib/soar/nodes/virustotal.ts` is the canonical example — copy from it,
don't reinvent.

| # | Concern | What "done" looks like |
|---|---------|------------------------|
| 1 | **Purpose** | One-paragraph description in the manifest |
| 2 | **Inputs** | Typed config fields (Zod-validated at the top of `execute()`) |
| 3 | **Outputs** | Typed output object; consumers can rely on every field |
| 4 | **Schema Validation** | Input + Output both have Zod schemas; rejects malformed data |
| 5 | **Business Logic** | Pure function for the parse step (unit-testable, no I/O) |
| 6 | **Security Validation** | SSRF guard, secret redaction, input sanitization |
| 7 | **Failure Scenarios** | All HTTP 4xx/5xx, network, timeout, parse errors mapped to error codes |
| 8 | **Retry Strategy** | Exponential backoff + jitter; only retries 5xx/429/network/timeout |
| 9 | **Timeout Strategy** | Per-call + total; AbortController cancels pending fetch |
| 10 | **Logging** | INFO/SUCCESS/WARN/ERROR events at well-defined points |
| 11 | **Metrics** | Counters + histograms for executions, duration, errors |
| 12 | **Tracing** | Span name `node.{id}.execute`, attributes include hashed IOC, status |
| 13 | **Audit** | One entry per execution with hashed PII fields |
| 14 | **Dependencies** | External API, MongoDB, security/observability libs |
| 15 | **Required Permissions** | `integration:read`, `audit:write`, `metrics:write` |
| 16 | **External APIs** | Endpoint URL + method in manifest |
| 17 | **Authentication Method** | Header / OAuth / mTLS / HMAC |
| 18 | **Secrets Required** | Listed in `credentials[]` of manifest |
| 19 | **Configuration Parameters** | Listed in `config[]` of manifest |
| 20 | **Performance** | Rate limit documented (free tier vs paid tier) |
| 21 | **Scalability** | Stateless? Rate-limit shared? Cache key? |
| 22 | **Horizontal Scaling** | Notes on multi-instance behavior |
| 23 | **Testing Strategy** | Unit + integration + security + load test plans |
| 24 | **Unit Tests** | File at `tests/unit/nodes/{id}.test.ts` |
| 25 | **Integration Tests** | File at `tests/integration/nodes/{id}.test.ts` |
| 26 | **Security Tests** | File at `tests/security/{id}.test.ts` (SSRF, injection) |
| 27 | **Load Tests** | File at `tests/load/{id}.k6.ts` (100 RPS for 60s) |
| 28 | **Rollback Procedure** | Documented; older manifest versions still loadable |
| 29 | **Recovery Procedure** | How to recover from circuit-open, bad creds, etc. |
| 30 | **Example Payloads** | At least 2 sample inputs in `manifest.examples` |
| 31 | **Example Responses** | Output shape documented |
| 32 | **Expected Failure Responses** | Error code + message + user message |
| 33 | **OpenAPI Specification** | `/api/nodes/{id}/openapi` returns the generated spec |
| 34 | **Database Schema** | Audit log entry shape documented |
| 35 | **Caching Strategy** | TTL + cache key + invalidation |
| 36 | **Queue Strategy** | How the node behaves when rate limited |
| 37 | **Concurrency Model** | Parallel-safe? Per-pod mutex? Distributed lock? |
| 38 | **Transaction Boundaries** | External call vs audit write vs cache update |
| 39 | **Data Retention** | Audit: 365d; cache: 30d; traces: 90d |
| 40 | **Compliance** | ISO 27001 / SOC2 / GDPR / NIST mappings |

---

## 3. Anatomy of a Node

A node is composed of three files:

```
src/lib/soar/nodes/{id}.ts                  ← manifest + executor
tests/unit/nodes/{id}.test.ts               ← pure-logic tests (mock fetch)
tests/integration/nodes/{id}.test.ts        ← end-to-end (real API key, mocked DB)
tests/security/{id}.test.ts                 ← SSRF + injection attempts
tests/load/{id}.k6.ts                       ← k6 load script (optional)
```

The manifest is the single source of truth — it drives:

- UI palette rendering (`/api/nodes`)
- Config form auto-generation (`/api/nodes/{id}/config`)
- Schema validation (Zod, at execute time)
- OpenAPI generation (`/api/nodes/{id}/openapi`)
- K8s probe generation (for sidecar nodes)
- Plugin marketplace listing

---

## 4. Step-by-Step: Adding a New Node

### 4.1 Pick an ID

IDs are lowercase, snake_case, stable forever. Examples: `virustotal`, `abuseipdb`, `misp`, `thehive`, `cortex_xsoar`.

```bash
id=shodan
mkdir -p src/lib/soar/nodes
touch src/lib/soar/nodes/${id}.ts
touch tests/unit/nodes/${id}.test.ts
touch tests/integration/nodes/${id}.test.ts
touch tests/security/${id}.test.ts
```

### 4.2 Write the Manifest

The manifest is a plain TypeScript object validated by a Zod schema
(`NodeManifestSchema` in `manifest.ts`). Here's the minimum:

```typescript
import { NodeManifest, NodeExecutor } from './manifest';

export const shodanManifest: NodeManifest = {
  id: 'shodan',
  name: 'Shodan Host Lookup',
  version: '1.0.0',
  category: 'threat_intel',
  description: 'Lookup host metadata (open ports, services, vulnerabilities) for an IP via the Shodan REST API.',
  icon: 'Radar',
  color: '#9333ea',
  vendor: 'Shodan, Inc.',
  vendorUrl: 'https://www.shodan.io',
  docsUrl: 'https://developer.shodan.io/api',

  config: [
    {
      key: 'ip',
      label: 'IP Address',
      description: 'Supports {{trigger.ip}} templates.',
      type: 'text',
      required: true,
      template: true,
      placeholder: '{{trigger.ip}} or 8.8.8.8',
      maxLength: 45,
    },
  ],

  credentials: [
    {
      kind: 'api_key',
      fields: [{
        key: 'api_key',
        label: 'Shodan API Key',
        type: 'password',
        required: true,
        secret: true,
        template: false,
        pattern: '^[a-zA-Z0-9]{32}$',
      }],
      placement: 'query',
      fieldName: 'key',
      valueTemplate: '{api_key}',
    },
  ],

  inputs:  [{ id: 'in',  label: 'In'  }],
  outputs: [
    { id: 'out', label: 'Out', schema: { ip: 'string', ports: 'number[]', vulns: 'number' } },
  ],

  retry: {
    maxAttempts: 3,
    backoff: 'exponential_jitter',
    baseDelayMs: 500,
    maxDelayMs: 10_000,
    retryOn: ['429', '500', '502', '503', '504', 'timeout', 'ECONNRESET'],
    noRetryOn: ['400', '401', '403', '404'],
  },

  timeout: { callTimeoutMs: 15_000, totalTimeoutMs: 60_000 },

  rateLimit: { requestsPerWindow: 60, windowMs: 60_000, burst: 2 },

  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    halfOpenSuccessThreshold: 2,
  },

  ssrfProtection: true,
  allowedHosts: ['api.shodan.io'],
  permissions: ['integration:read', 'audit:write', 'metrics:write'],

  errors: [
    { code: 'AUTH_FAILED', message: 'Invalid API key', httpStatus: 401, retryable: false },
    { code: 'RATE_LIMITED', message: 'Shodan rate limited', httpStatus: 429, retryable: true },
    { code: 'NOT_FOUND', message: 'IP not in Shodan', httpStatus: 404, retryable: false },
    { code: 'UPSTREAM_ERROR', message: 'Shodan server error', httpStatus: 500, retryable: true },
    { code: 'TIMEOUT', message: 'Request timed out', retryable: true },
    { code: 'NETWORK_ERROR', message: 'Network error', retryable: true },
    { code: 'CIRCUIT_OPEN', message: 'Circuit breaker open', retryable: false },
    { code: 'INVALID_INPUT', message: 'Bad IP', retryable: false },
    { code: 'NO_INTEGRATION', message: 'No Shodan integration configured', retryable: false },
  ],

  emitMetrics: true,
  emitAuditEvents: true,
  emitTraceSpans: true,
  supportsIdempotency: true,
  idempotencyKeyTemplate: 'shodan:{ip}',

  compliance: {
    dataClassification: 'confidential',
    piiHandling: true,
    gdprRelevant: true,
    retentionDays: 90,
  },

  examples: [
    { name: 'Lookup Google DNS', description: '8.8.8.8 — well-known host', input: { ip: '8.8.8.8' }, expectedOutput: { ip: '8.8.8.8', ports: [53, 443] } },
  ],
};
```

### 4.3 Write the Executor

```typescript
import { z } from 'zod';
import { NodeExecutor, NodeExecutionContext, NodeResult, resolveTemplate, validateConfig } from './manifest';
import { safeFetch, SsrfError } from '../security/ssrf-guard';
import { acquireToken } from '../security/rate-limiter';
import { withCircuitBreaker, CircuitOpenError } from '../observability/circuit-breaker';
import { Logger } from '../observability/logger';
import { recordNodeExecution, recordIntegrationCall } from '../observability/metrics';
import { writeAudit } from '../observability/audit';
import { isValidIp, redactSecrets, sanitizeForLog } from '../security/sanitizer';

const InputSchema = z.object({ ip: z.string().min(1).max(45) });
const OutputSchema = z.object({
  ok: z.boolean(),
  ip: z.string(),
  ports: z.array(z.number()),
  vulns: z.number().int().min(0),
  country: z.string().optional(),
  org: z.string().optional(),
  raw: z.unknown().optional(),
});

export const shodanExecutor: NodeExecutor = {
  manifest: shodanManifest,
  async execute(node, ctx) {
    const start = Date.now();
    const logger = new Logger({ workflowId: ctx.workflowId, executionId: ctx.executionId, nodeId: node.id, component: 'node.shodan' });

    // 1. Validate config
    const cfg = node.data.config;
    const cfgResult = validateConfig(shodanManifest, undefined, cfg);
    if (!cfgResult.ok) {
      return { success: false, errorCode: 'INVALID_INPUT', logs: [logLine(node, `Invalid config: ${cfgResult.errors.join('; ')}`, 'error')] };
    }

    // 2. Resolve templates + validate IP
    const ip = resolveTemplate(String(cfg.ip || ''), ctx);
    if (!isValidIp(ip)) {
      return { success: false, errorCode: 'INVALID_INPUT', logs: [logLine(node, `Bad IP: ${ip}`, 'error')] };
    }

    // 3. Load integration
    const integration = ctx.getIntegration('shodan');
    if (!integration) {
      return { success: false, errorCode: 'NO_INTEGRATION', logs: [logLine(node, 'No Shodan integration configured', 'error')] };
    }
    const apiKey = String(integration.config.api_key || '');
    if (!apiKey) {
      return { success: false, errorCode: 'AUTH_FAILED', logs: [logLine(node, 'Missing API key', 'error')] };
    }

    // 4. Rate limit
    const rl = await acquireToken(`integration:shodan:${integration.id}`, 60, 60_000).catch(() => ({ allowed: true }));
    if (!('allowed' in rl) || !rl.allowed) {
      return { success: false, errorCode: 'RATE_LIMITED', logs: [logLine(node, 'Rate limited', 'warning')] };
    }

    // 5. Build URL — NEVER interpolate user input into the host
    const url = `https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}?key=${encodeURIComponent(apiKey)}`;

    // 6. Execute with circuit breaker + retry
    try {
      const response = await withCircuitBreaker(`shodan:${integration.id}`, async () => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 15_000);
        try {
          return await safeFetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal,
            allowHosts: ['api.shodan.io'],
            timeoutMs: 15_000,
          });
        } finally { clearTimeout(t); }
      }, { failureThreshold: 5, resetTimeoutMs: 30_000 });

      if (response.status === 401) return fail('AUTH_FAILED', node, 'Invalid API key');
      if (response.status === 404) {
        // Not in Shodan = benign empty result
        recordNodeExecution('shodan', true, Date.now() - start);
        return { success: true, output: { ok: true, ip, ports: [], vulns: 0, raw: { not_found: true } }, logs: [logLine(node, `Shodan: ${ip} not in database`, 'success')] };
      }
      if (response.status === 429) return fail('RATE_LIMITED', node, 'Rate limited');
      if (!response.ok) return fail('UPSTREAM_ERROR', node, `HTTP ${response.status}`);

      const body = await response.json() as Record<string, unknown>;
      const ports = Array.isArray(body.ports) ? body.ports as number[] : [];
      const vulns = Array.isArray(body.vulns) ? body.vulns.length : 0;

      const output = OutputSchema.parse({
        ok: true, ip, ports, vulns,
        country: body.country_code as string | undefined,
        org: body.org as string | undefined,
        raw: redactSecrets(body),
      });

      recordNodeExecution('shodan', true, Date.now() - start);
      recordIntegrationCall('shodan', true, Date.now() - start);
      await writeAudit({
        tenantId: ctx.tenantId,
        actor: ctx.startedBy || 'system',
        action: 'shodan.lookup',
        resource: 'ip',
        resourceId: ip,
        description: `Shodan lookup: ${ip} (${ports.length} ports, ${vulns} vulns)`,
        metadata: { ip, ports: ports.length, vulns, integration_id: integration.id, workflow_id: ctx.workflowId, execution_id: ctx.executionId, correlation_id: ctx.correlationId },
        correlationId: ctx.correlationId,
      }).catch(() => {});

      return { success: true, output, idempotencyKey: `shodan:${ip}`, logs: [logLine(node, `Shodan: ${ip} → ${ports.length} ports, ${vulns} vulns`, 'success')] };
    } catch (err) {
      if (err instanceof CircuitOpenError) return fail('CIRCUIT_OPEN', node, err.message);
      if (err instanceof SsrfError) return fail('NETWORK_ERROR', node, `SSRF blocked: ${err.message}`);
      if (err instanceof Error && err.name === 'AbortError') return fail('TIMEOUT', node, 'Timed out');
      recordNodeExecution('shodan', false, Date.now() - start);
      recordIntegrationCall('shodan', false, Date.now() - start, 'UNKNOWN');
      return { success: false, errorCode: 'UNKNOWN', logs: [logLine(node, `Shodan error: ${err instanceof Error ? err.message : String(err)}`, 'error')] };
    }
  },
};

function fail(code: string, node: { id: string; data: { label: string } }, msg: string) {
  return { success: false, errorCode: code, logs: [{ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Shodan: ${msg}`, level: 'error' as const }] };
}
function logLine(node: { id: string; data: { label: string } }, msg: string, level: 'info' | 'success' | 'warning' | 'error') {
  return { time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: sanitizeForLog(msg), level };
}
```

### 4.4 Register the Node

Add a single line to `src/lib/soar/nodes/bootstrap.ts`:

```typescript
import { shodanExecutor } from './shodan';
// ...
nodeRegistry.register(shodanExecutor);
```

The registry validates the manifest against the Zod schema at boot — if anything is malformed, the app refuses to start. This is intentional: we want broken nodes caught in CI, not at 3 AM in production.

### 4.5 Write Tests

**Unit tests** mock `fetch` and verify the pure logic:

```typescript
// tests/unit/nodes/shodan.test.ts
import { describe, it, expect } from 'vitest';
import { __test__ } from '@/lib/soar/nodes/shodan';

describe('Shodan node', () => {
  it('has a valid manifest', () => {
    expect(__test__.shodanManifest.id).toBe('shodan');
    expect(__test__.shodanManifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('builds the correct URL', () => {
    expect(__test__.buildShodanUrl('8.8.8.8', 'fakekey'))
      .toBe('https://api.shodan.io/shodan/host/8.8.8.8?key=fakekey');
  });
  // ...
});
```

**Security tests** verify the node refuses to fetch arbitrary URLs:

```typescript
// tests/security/shodan.test.ts
describe('Shodan SSRF protection', () => {
  it('rejects IPs that resolve to private ranges', async () => {
    // Even if api.shodan.io is hijacked, safeFetch blocks the request.
  });
});
```

### 4.6 Run Tests

```bash
npx vitest run tests/unit/nodes/shodan.test.ts
npx vitest run tests/integration/nodes/shodan.test.ts
npx vitest run tests/security/shodan.test.ts
```

### 4.7 Verify the Manifest Surfaces

Start the app and confirm your node appears in the registry:

```bash
curl http://localhost:3000/api/nodes | jq '.[] | select(.id=="shodan")'
curl http://localhost:3000/api/nodes/shodan/openapi | jq .
```

---

## 5. Common Pitfalls

### 5.1 Don't interpolate user input into the URL host

```typescript
// ❌ BAD — SSRF vulnerability
const url = `https://${userInput}/api/lookup`;

// ✅ GOOD — host is hardcoded, user input is the path/query
const url = `https://api.shodan.io/shodan/host/${encodeURIComponent(userInput)}`;
```

### 5.2 Always use safeFetch

`fetch()` does not protect against SSRF. Use `safeFetch` from
`@/lib/soar/security/ssrf-guard` — it blocks private IPs, cloud metadata
endpoints, DNS rebinding, and redirect chains to internal hosts.

### 5.3 Don't log secrets

```typescript
// ❌ BAD — leaks the API key to stdout
logger.info('Calling Shodan', { url });

// ✅ GOOD — pass through redactSecrets first
logger.info('Calling Shodan', { url: redactSecrets(url) });
```

### 5.4 Don't retry 4xx

A 401 means "bad API key" — retrying 3 times just wastes time and might lock the account. Only retry on 429, 5xx, timeout, ECONNRESET.

### 5.5 Don't block on audit writes

If the audit DB is down, the SOAR node should still succeed. Audit writes are
best-effort — wrap them in `.catch(() => {})` and log a warning.

### 5.6 Always hash PII in audit entries

```typescript
resourceId: hashIoc(iocValue),  // ✅ SHA-256 truncated
// not
resourceId: iocValue,            // ❌ leaks PII to audit log
```

---

## 6. Checklist Before Merging a New Node

- [ ] Manifest validates against `NodeManifestSchema`
- [ ] All 40 spec points addressed (commented in source)
- [ ] Input + Output Zod schemas
- [ ] SSRF guard on every outbound call
- [ ] Rate limiter enforced
- [ ] Circuit breaker wraps the integration call
- [ ] Retry only on 5xx / 429 / network / timeout
- [ ] Per-call timeout via AbortController
- [ ] Audit entry written (PII hashed)
- [ ] Metrics recorded (counter + histogram)
- [ ] Logs structured (correlation ID, sanitized)
- [ ] Unit tests pass (mock fetch)
- [ ] Integration tests pass (real API key from env)
- [ ] Security tests pass (SSRF + injection)
- [ ] Load test runs (100 RPS for 60s, circuit opens on 429)
- [ ] Node registered in `bootstrap.ts`
- [ ] `/api/nodes/{id}` returns the manifest
- [ ] `/api/nodes/{id}/openapi` returns valid OpenAPI 3.1
- [ ] UI palette shows the new node with the right icon + color
- [ ] Config form renders without errors
- [ ] Code reviewed by security team
