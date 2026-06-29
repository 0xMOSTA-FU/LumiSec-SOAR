/**
 * SOAR Node Manifest Type System
 * ---------------------------------------------------------------------------
 * Every node in the platform is described by a NodeManifest. This manifest:
 *   - Is the single source of truth for the node's identity, capabilities,
 *     security boundaries, and observability hooks.
 *   - Is machine-readable (JSON-serializable) so it can drive:
 *       * UI palette rendering
 *       * Config form auto-generation
 *       * Schema validation (input + output)
 *       * OpenAPI generation for the node's REST facade
 *       * Helm/K8s probes (if the node runs as a sidecar)
 *       * Plugin marketplaces
 *   - Follows semantic versioning (MAJOR.MINOR.PATCH).
 *   - Supports migration maps for backward compatibility.
 *
 * Inspired by: Cortex XSOAR Content Pack manifests, n8n node descriptions,
 * Backstage plugin manifests, OpenAPI 3.1 operation objects.
 */
import { z } from 'zod';

// ============================================================================
// CORE MANIFEST SCHEMA (Zod) — used for manifest validation on registration
// ============================================================================

export const NodeCategorySchema = z.enum([
  'trigger',
  'threat_intel',
  'siem',
  'edr',
  'ticketing',
  'itsm',
  'cloud_iam',
  'network',
  'firewall',
  'communication',
  'case_management',
  'logic',
  'output',
  'utility',
  'custom',
]);
export type NodeCategory = z.infer<typeof NodeCategorySchema>;

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

export const CredentialKindSchema = z.enum([
  'api_key',           // single bearer key
  'basic_auth',        // username + password
  'bearer_token',      // RFC 6750 bearer
  'oauth2_client_credentials',
  'oauth2_authorization_code',
  'oauth2_implicit',
  'hmac_signature',    // signing key for inbound webhooks
  'mtls',              // mutual TLS
  'custom',            // node-specific shape
]);
export type CredentialKind = z.infer<typeof CredentialKindSchema>;

export const ConfigFieldSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/, 'must be snake_case'),
  label: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  type: z.enum(['text', 'textarea', 'password', 'number', 'boolean', 'select', 'json', 'multiselect', 'datetime', 'url']),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  default: z.unknown().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  pattern: z.string().optional(), // regex for input validation
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  secret: z.boolean().default(false), // if true, value is masked in UI
  template: z.boolean().default(true), // if true, supports {{var}} interpolation
});
export type ConfigField = z.infer<typeof ConfigFieldSchema>;

export const CredentialDefinitionSchema = z.object({
  kind: CredentialKindSchema,
  fields: z.array(ConfigFieldSchema),
  // Where to send the credential in outbound requests
  placement: z.enum(['header', 'query', 'body', 'cookie']).default('header'),
  // Header name (if placement=header) or query param name (if query)
  fieldName: z.string().default('Authorization'),
  // Template for the value, e.g. "Bearer {api_key}" or "{username}:{password}" (base64-encoded if Basic)
  valueTemplate: z.string().default('Bearer {api_key}'),
});
export type CredentialDefinition = z.infer<typeof CredentialDefinitionSchema>;

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  backoff: z.enum(['fixed', 'linear', 'exponential', 'exponential_jitter']).default('exponential_jitter'),
  baseDelayMs: z.number().int().min(100).max(60_000).default(500),
  maxDelayMs: z.number().int().min(1000).max(300_000).default(10_000),
  // Only retry on these error codes / patterns
  retryOn: z.array(z.string()).default(['5xx', 'timeout', 'ECONNRESET', 'ETIMEDOUT']),
  // Never retry on these (e.g., 4xx authentication failures)
  noRetryOn: z.array(z.string()).default(['4xx', '401', '403']),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const TimeoutPolicySchema = z.object({
  // Per-call timeout (ms) — node is killed if it exceeds this
  callTimeoutMs: z.number().int().min(1000).max(300_000).default(30_000),
  // Total timeout across all retries
  totalTimeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
});
export type TimeoutPolicy = z.infer<typeof TimeoutPolicySchema>;

export const RateLimitPolicySchema = z.object({
  // Max requests per window per integration instance
  requestsPerWindow: z.number().int().min(1).max(10_000).default(60),
  windowMs: z.number().int().min(1000).max(3_600_000).default(60_000),
  // Burst allowance (token bucket)
  burst: z.number().int().min(1).max(100).default(10),
});
export type RateLimitPolicy = z.infer<typeof RateLimitPolicySchema>;

export const CircuitBreakerPolicySchema = z.object({
  enabled: z.boolean().default(true),
  // Open circuit after this many consecutive failures
  failureThreshold: z.number().int().min(3).max(100).default(5),
  // Stay open for this long before allowing a half-open probe
  resetTimeoutMs: z.number().int().min(5000).max(600_000).default(30_000),
  // Close circuit after this many half-open successes
  halfOpenSuccessThreshold: z.number().int().min(1).max(10).default(2),
});
export type CircuitBreakerPolicy = z.infer<typeof CircuitBreakerPolicySchema>;

export const ErrorTypeSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/, 'SCREAMING_SNAKE_CASE'),
  message: z.string(),
  httpStatus: z.number().int().min(400).max(599).optional(),
  retryable: z.boolean().default(false),
  userMessage: z.string().optional(), // safe to show end users
});
export type ErrorType = z.infer<typeof ErrorTypeSchema>;

export const PortSchema = z.object({
  id: z.string(),
  label: z.string(),
  // Schema that downstream nodes can rely on for this port's output
  schema: z.record(z.string(), z.unknown()).optional(),
});
export type Port = z.infer<typeof PortSchema>;

export const NodeManifestSchema = z.object({
  // Identity
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/, 'lowercase kebab-case'),
  name: z.string().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'semver'),
  category: NodeCategorySchema,
  description: z.string().min(10).max(500),
  icon: z.string().default('Circle'), // lucide-react icon name
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#3b82f6'),

  // Vendor / integration info
  vendor: z.string().default('CyberSOAR'),
  vendorUrl: z.string().url().optional(),
  docsUrl: z.string().url().optional(),
  sourceUrl: z.string().url().optional(),

  // Capabilities
  subtypes: z.array(z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    config: z.array(ConfigFieldSchema).default([]),
  })).default([]),

  // Config schema (used when no subtype matches)
  config: z.array(ConfigFieldSchema).default([]),

  // Credentials — what the node needs to authenticate
  credentials: z.array(CredentialDefinitionSchema).default([]),

  // Input/output ports (for visual builder)
  inputs: z.array(PortSchema).default([{ id: 'in', label: 'In' }]),
  outputs: z.array(PortSchema).default([{ id: 'out', label: 'Out' }]),

  // Resilience policies
  retry: RetryPolicySchema.optional(),
  timeout: TimeoutPolicySchema.optional(),
  rateLimit: RateLimitPolicySchema.optional(),
  circuitBreaker: CircuitBreakerPolicySchema.optional(),

  // Security
  requiresApproval: z.boolean().default(false),
  approvalRiskLevel: SeveritySchema.default('medium'),
  // What this node is allowed to do (least privilege)
  permissions: z.array(z.string()).default([]),
  // SSRF protection — restrict outbound URLs
  ssrfProtection: z.boolean().default(true),
  // Allowed outbound hosts (whitelist). Empty = unrestricted (but SSRF guard still applies)
  allowedHosts: z.array(z.string()).default([]),
  // Blocked outbound hosts (blacklist — applied after whitelist)
  blockedHosts: z.array(z.string()).default([
    '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
    '169.254.0.0/16', // link-local
    '0.0.0.0/8',
    '::1/128', 'fc00::/7', 'fe80::/10',
    '169.254.169.254', // cloud metadata endpoints
  ]),

  // Error catalog
  errors: z.array(ErrorTypeSchema).default([]),

  // Observability
  emitMetrics: z.boolean().default(true),
  emitAuditEvents: z.boolean().default(true),
  emitTraceSpans: z.boolean().default(true),

  // Idempotency
  supportsIdempotency: z.boolean().default(false),
  idempotencyKeyTemplate: z.string().optional(),

  // Versioning / migration
  deprecated: z.boolean().default(false),
  deprecatedBy: z.string().optional(), // id of replacement node
  sunsetDate: z.string().optional(),
  migrations: z.array(z.object({
    fromVersion: z.string(),
    toVersion: z.string(),
    description: z.string(),
  })).default([]),

  // Compliance
  compliance: z.object({
    dataClassification: z.enum(['public', 'internal', 'confidential', 'restricted']).default('confidential'),
    piiHandling: z.boolean().default(false),
    gdprRelevant: z.boolean().default(false),
    retentionDays: z.number().int().min(1).max(3650).default(90),
  }).optional(),

  // Examples (rendered in UI + used as test fixtures)
  examples: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    input: z.record(z.string(), z.unknown()),
    expectedOutput: z.record(z.string(), z.unknown()),
  })).default([]),
});
export type NodeManifest = z.infer<typeof NodeManifestSchema>;

// ============================================================================
// NODE EXECUTOR INTERFACE
// Every node must implement this. The engine calls execute() with a validated
// context and expects a NodeResult back.
// ============================================================================

export interface NodeExecutionContext {
  // The workflow trigger payload (immutable)
  trigger: Record<string, unknown>;
  // Outputs from upstream nodes (keyed by nodeId)
  outputs: Record<string, unknown>;
  // Resolved integration config (decrypted in-memory)
  getIntegration: (key: string) => {
    id: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    status: string;
  } | null;
  // Workflow metadata
  workflowId: string;
  workflowName: string;
  executionId: string;
  correlationId?: string;
  tenantId?: string;
  startedBy?: string;
  // Side-effect hooks (so the engine can record them)
  createCase?: (data: Record<string, unknown>) => Promise<string | null>;
  createAlert?: (data: Record<string, unknown>) => Promise<string | null>;
  requestApproval?: (data: {
    action: string;
    targetType: string;
    targetValue: string;
    reason: string;
    riskLevel: Severity;
  }) => Promise<string | null>;
  // Structured logger scoped to this execution
  log: (level: 'info' | 'success' | 'warning' | 'error', message: string, data?: unknown) => void;
}

export interface NodeResult {
  success: boolean;
  output?: Record<string, unknown>;
  branch?: string;
  logs?: Array<{
    time: string;
    nodeId?: string;
    nodeLabel?: string;
    message: string;
    level: 'info' | 'success' | 'warning' | 'error';
    duration?: number;
    data?: unknown;
  }>;
  // For idempotent nodes: the key used to dedupe (returned so the engine can cache)
  idempotencyKey?: string;
  // Error code (from the manifest's error catalog) — null on success
  errorCode?: string;
}

export interface NodeExecutor {
  manifest: NodeManifest;
  execute(node: {
    id: string;
    type: 'trigger' | 'action' | 'condition' | 'output';
    subtype?: string;
    data: { label: string; config: Record<string, unknown> };
  }, ctx: NodeExecutionContext): Promise<NodeResult>;
}

// ============================================================================
// HELPERS
// ============================================================================

export function validateManifest(m: unknown): NodeManifest {
  return NodeManifestSchema.parse(m) as NodeManifest;
}

export function safeValidateManifest(m: unknown): { ok: true; manifest: NodeManifest } | { ok: false; error: string } {
  const result = NodeManifestSchema.safeParse(m);
  if (result.success) return { ok: true, manifest: result.data as NodeManifest };
  return { ok: false, error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

/** Resolves {{template.var}} placeholders against the execution context. */
export function resolveTemplate(template: string, ctx: NodeExecutionContext): string {
  if (!template) return '';
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const k = key.trim();
    if (k.startsWith('trigger.')) {
      const subPath = k.slice('trigger.'.length);
      const val = subPath.split('.').reduce(
        (acc: unknown, p: string) => (acc == null ? acc : (acc as Record<string, unknown>)[p]),
        ctx.trigger as unknown,
      );
      if (val == null) return '';
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    }
    if (k.startsWith('outputs.')) {
      const parts = k.split('.');
      const nodeId = parts[1];
      const out = ctx.outputs[nodeId];
      if (out == null) return '';
      let cur: unknown = out;
      for (let i = 2; i < parts.length; i++) {
        cur = cur == null ? cur : (cur as Record<string, unknown>)[parts[i]];
      }
      if (cur == null) return '';
      return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
    }
    return '';
  });
}

/** Validates a config object against a manifest's config schema. */
export function validateConfig(
  manifest: NodeManifest,
  subtype: string | undefined,
  config: Record<string, unknown>,
): { ok: true } | { ok: false; errors: string[] } {
  const fields = subtype
    ? (manifest.subtypes.find(s => s.id === subtype)?.config || manifest.config)
    : manifest.config;
  const errors: string[] = [];
  for (const f of fields) {
    const val = config[f.key];
    if (f.required && (val == null || val === '')) {
      errors.push(`${f.key} is required`);
      continue;
    }
    if (val == null || val === '') continue;
    if (f.pattern) {
      try {
        if (!new RegExp(f.pattern).test(String(val))) {
          errors.push(`${f.key} does not match required pattern`);
        }
      } catch { /* */ }
    }
    if (f.minLength && String(val).length < f.minLength) {
      errors.push(`${f.key} must be at least ${f.minLength} characters`);
    }
    if (f.maxLength && String(val).length > f.maxLength) {
      errors.push(`${f.key} must be at most ${f.maxLength} characters`);
    }
    if (f.type === 'select' && f.options && !f.options.some(o => o.value === String(val))) {
      errors.push(`${f.key} must be one of: ${f.options.map(o => o.value).join(', ')}`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
