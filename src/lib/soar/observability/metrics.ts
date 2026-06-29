/**
 * Prometheus Metrics — workflow + node + integration metrics
 * ---------------------------------------------------------------------------
 * Exposes Prometheus-format metrics on /api/metrics. Tracks:
 *
 *  - soar_workflow_executions_total{workflow_id, status, tenant_id}
 *  - soar_workflow_execution_duration_seconds{workflow_id}
 *  - soar_node_executions_total{node_subtype, status}
 *  - soar_node_execution_duration_seconds{node_subtype}
 *  - soar_integration_calls_total{integration_type, status}
 *  - soar_integration_call_duration_seconds{integration_type}
 *  - soar_integration_errors_total{integration_type, error_code}
 *  - soar_circuit_breaker_state{integration_type}  (0=closed, 1=open, 2=half_open)
 *  - soar_active_executions (gauge)
 *  - soar_webhook_triggers_total{workflow_id, status}
 *  - soar_http_request_duration_seconds{method, route, status}
 *
 * Compliance: SOC2 CC7.1 (system monitoring), ISO27001 A.12.1.3 (capacity)
 */

type LabelSet = Record<string, string>;


class MetricsRegistry {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, { sum: number; count: number; buckets: Map<number, number> }>();
  private histogramConfigs = new Map<string, { buckets: number[]; help: string }>();

  /** Increment a counter by 1 (or by `inc`). */
  inc(name: string, labels: LabelSet = {}, inc = 1): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + inc);
    this.registerMetric(name, 'counter', `Counter ${name}`);
  }

  /** Set a gauge to a value. */
  set(name: string, labels: LabelSet = {}, value: number): void {
    const key = this.key(name, labels);
    this.gauges.set(key, value);
    this.registerMetric(name, 'gauge', `Gauge ${name}`);
  }

  /** Observe a value in a histogram. */
  observe(name: string, labels: LabelSet = {}, value: number): void {
    const key = this.key(name, labels);
    if (!this.histograms.has(key)) {
      const cfg = this.histogramConfigs.get(name) || {
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        help: `Histogram ${name}`,
      };
      this.histogramConfigs.set(name, cfg);
      this.histograms.set(key, {
        sum: 0, count: 0,
        buckets: new Map(cfg.buckets.map(b => [b, 0])),
      });
      this.registerMetric(name, 'histogram', cfg.help);
    }
    const h = this.histograms.get(key)!;
    h.sum += value;
    h.count += 1;
    for (const bucket of h.buckets.keys()) {
      if (value <= bucket) h.buckets.set(bucket, h.buckets.get(bucket)! + 1);
    }
  }

  /** Increment a counter with timing — convenience for `inc + observe(duration)`. */
  time(name: string, labels: LabelSet = {}, durationMs: number): void {
    this.inc(`${name}_total`, labels);
    this.observe(`${name}_duration_seconds`, labels, durationMs / 1000);
  }

  /** Render all metrics in Prometheus exposition format. */
  render(): string {
    const lines: string[] = [];
    const seen = new Set<string>();

    // Group by metric name to emit HELP/TYPE once per metric
    const allNames = new Set<string>();
    for (const k of this.counters.keys()) allNames.add(k.split('{')[0]);
    for (const k of this.gauges.keys()) allNames.add(k.split('{')[0]);
    for (const k of this.histograms.keys()) allNames.add(k.split('{')[0]);

    for (const name of allNames) {
      const meta = this.metricMetadata.get(name);
      if (!seen.has(name)) {
        if (meta) {
          lines.push(`# HELP ${name} ${meta.help}`);
          lines.push(`# TYPE ${name} ${meta.type}`);
        }
        seen.add(name);
      }

      // Counters — emit `name{labels} value` (NOT `name[object Object]{labels} value`)
      // BUGFIX (AUDIT-3 finding #2): previously `${name}${labels}` interpolated
      // the LabelSet object as `[object Object]`, producing malformed Prometheus
      // output that scrape targets would reject.
      for (const [k, v] of this.counters.entries()) {
        if (!k.startsWith(name)) continue;
        const labels = this.extractLabels(k);
        const labelStr = this.renderLabels(labels);
        lines.push(labelStr ? `${name}{${labelStr}} ${v}` : `${name} ${v}`);
      }
      // Gauges — same fix as counters
      for (const [k, v] of this.gauges.entries()) {
        if (!k.startsWith(name)) continue;
        const labels = this.extractLabels(k);
        const labelStr = this.renderLabels(labels);
        lines.push(labelStr ? `${name}{${labelStr}} ${v}` : `${name} ${v}`);
      }
      // Histograms — buckets, sum, count
      for (const [k, h] of this.histograms.entries()) {
        if (!k.startsWith(name)) continue;
        const labels = this.extractLabels(k);
        const cfg = this.histogramConfigs.get(name)!;
        for (const bucket of cfg.buckets) {
          const le = bucket.toString();
          const count = h.buckets.get(bucket) || 0;
          const bucketLabels = { ...labels, le };
          lines.push(`${name}_bucket{${this.renderLabels(bucketLabels)}} ${count}`);
        }
        const infLabels = { ...labels, le: '+Inf' };
        lines.push(`${name}_bucket{${this.renderLabels(infLabels)}} ${h.count}`);
        lines.push(`${name}_sum{${this.renderLabels(labels)}} ${h.sum}`);
        lines.push(`${name}_count{${this.renderLabels(labels)}} ${h.count}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  private metricMetadata = new Map<string, { help: string; type: string }>();

  private registerMetric(name: string, type: string, help: string): void {
    if (!this.metricMetadata.has(name)) {
      this.metricMetadata.set(name, { help, type });
    }
  }

  private key(name: string, labels: LabelSet): string {
    const labelStr = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`).join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  private extractLabels(key: string): LabelSet {
    const match = key.match(/\{(.+)\}$/);
    if (!match) return {};
    const labels: LabelSet = {};
    for (const pair of match[1].split(',')) {
      const [k, v] = pair.split('=');
      labels[k] = v.replace(/^"|"$/g, '');
    }
    return labels;
  }

  private renderLabels(labels: LabelSet): string {
    return Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`).join(',');
  }

  /** Reset all metrics — used by tests. */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.metricMetadata.clear();
  }
}

export const metrics = new MetricsRegistry();

// ============================================================================
// Helper functions — domain-specific metric reporters
// ============================================================================

export function recordWorkflowStart(workflowId: string, tenantId = 'default'): void {
  metrics.inc('soar_workflow_executions_total', { workflow_id: workflowId, status: 'started', tenant_id: tenantId });
  // BUGFIX (AUDIT-3 finding #3): operator precedence was wrong.
  // `current || 0 + 1` evaluates as `current || (0 + 1)` = `current || 1`,
  // so the gauge was ALWAYS 1 when undefined and NEVER incremented.
  // Correct: `(current || 0) + 1`.
  const gaugeKey = `soar_active_executions{tenant_id="${tenantId}"}`;
  const current = (metrics as unknown as { gauges: Map<string, number> }).gauges.get(gaugeKey) || 0;
  metrics.set('soar_active_executions', { tenant_id: tenantId }, current + 1);
}

export function recordWorkflowComplete(workflowId: string, status: 'success' | 'failed' | 'cancelled', durationMs: number, tenantId = 'default'): void {
  metrics.inc('soar_workflow_executions_total', { workflow_id: workflowId, status, tenant_id: tenantId });
  metrics.observe('soar_workflow_execution_duration_seconds', { workflow_id: workflowId }, durationMs / 1000);
  metrics.inc('soar_active_executions', { tenant_id: tenantId }, -1);
}

export function recordNodeExecution(nodeSubtype: string, success: boolean, durationMs: number): void {
  metrics.inc('soar_node_executions_total', { node_subtype: nodeSubtype, status: success ? 'success' : 'failed' });
  metrics.observe('soar_node_execution_duration_seconds', { node_subtype: nodeSubtype }, durationMs / 1000);
}

export function recordIntegrationCall(integrationType: string, success: boolean, durationMs: number, errorCode?: string): void {
  metrics.inc('soar_integration_calls_total', {
    integration_type: integrationType,
    status: success ? 'success' : 'failed',
  });
  metrics.observe('soar_integration_call_duration_seconds', { integration_type: integrationType }, durationMs / 1000);
  if (!success && errorCode) {
    metrics.inc('soar_integration_errors_total', { integration_type: integrationType, error_code: errorCode });
  }
}

export function recordCircuitBreakerState(integrationType: string, state: 'closed' | 'open' | 'half_open'): void {
  const val = state === 'closed' ? 0 : state === 'open' ? 1 : 2;
  metrics.set('soar_circuit_breaker_state', { integration_type: integrationType }, val);
}

export function recordWebhookTrigger(workflowId: string, success: boolean): void {
  metrics.inc('soar_webhook_triggers_total', { workflow_id: workflowId, status: success ? 'success' : 'failed' });
}

export function recordHttpRequest(method: string, route: string, status: number, durationMs: number): void {
  metrics.inc('soar_http_requests_total', { method, route, status: String(status) });
  metrics.observe('soar_http_request_duration_seconds', { method, route, status: String(status) }, durationMs / 1000);
}
