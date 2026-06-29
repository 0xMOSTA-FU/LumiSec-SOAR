# CyberSOAR — Deployment Runbook

> **Audience**: DevOps / SRE / Platform engineers responsible for deploying, upgrading, and operating CyberSOAR in production.
>
> **Scope**: Covers local dev → staging → production deployments, including rollback, scaling, observability, and incident response.

---

## 1. Architecture Recap

```
                        ┌──────────────────────────┐
                        │   Ingress (nginx / ALB)  │
                        │   TLS termination, WAF   │
                        └────────────┬─────────────┘
                                     │
            ┌────────────────────────┴────────────────────────┐
            │                                                  │
   ┌────────▼────────┐                          ┌─────────────▼────────────┐
   │  soar-web (×N)  │  Next.js 16 standalone   │   soar-backend (×N)     │
   │  port 3000      │  Web + API + Webhook     │   port 4000              │
   └────────┬────────┘                          └─────────────┬────────────┘
            │                                                  │
            └───────────────┬──────────────┬───────────────────┘
                            │              │
                  ┌─────────▼──────┐  ┌────▼─────────┐  ┌──────────────────┐
                  │  MongoDB RS    │  │   Redis      │  │  Prometheus +    │
                  │  (3 members)   │  │   (HA)       │  │  Grafana         │
                  └────────────────┘  └──────────────┘  └──────────────────┘
```

| Component | Image | Port | Replicas (prod) |
|-----------|-------|------|-----------------|
| soar-web  | `ghcr.io/cybersoar/web:TAG`     | 3000 | 5 (auto-scaled to 50) |
| soar-backend | `ghcr.io/cybersoar/backend:TAG` | 4000 | 2 |
| MongoDB   | `mongo:7-jammy`                 | 27017 | 3 (replica set) |
| Redis     | `redis:7-alpine`                | 6379 | 1 primary + 2 replicas |
| Prometheus | `prom/prometheus:latest`        | 9090 | 1 |
| Grafana   | `grafana/grafana:latest`        | 3000 | 1 |

---

## 2. Prerequisites

### 2.1 Local Development

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20.x | LTS — match the Dockerfile |
| npm | 10.x | Bun works too but use npm for CI parity |
| Docker | 24+ | Required for `docker compose` |
| MongoDB | 7.x | Local or via docker compose |
| Redis | 7.x | Local or via docker compose |

### 2.2 Production Cluster

| Requirement | Min | Recommended |
|-------------|-----|-------------|
| Kubernetes  | 1.27 | 1.30+ |
| Worker nodes | 3 | 5+ across AZs |
| CPU per node | 4 vCPU | 8+ vCPU |
| Memory per node | 16 GiB | 32+ GiB |
| Storage class | gp3 | gp3-encrypted |
| Ingress controller | nginx | nginx + cert-manager |
| DNS provider | Route53 / CloudDNS | With external-dns |

Required cluster add-ons:
- **cert-manager** (for TLS cert issuance)
- **external-dns** (for DNS record sync)
- **ingress-nginx** (for L7 ingress)
- **Prometheus operator** (for metrics scrape)
- **ExternalSecrets Operator** (for Vault-backed secrets, optional)

---

## 3. Local Development

### 3.1 Quickstart

```bash
git clone https://github.com/cybersoar/platform.git
cd platform
cp .env.example .env
# Edit .env — at minimum set ENCRYPTION_KEY and JWT_SECRET
# Generate with: openssl rand -base64 32

npm install --legacy-peer-deps
npx prisma generate
npm run db:push         # Create schema in SQLite (dev)

# Start everything (web + backend + mongo + redis)
docker compose -f deploy/docker/docker-compose.yml up -d

# In a separate terminal:
npm run dev
# → http://localhost:3000
```

### 3.2 Run Tests

```bash
npm test                    # All tests
npm run test:unit           # Pure logic (fast)
npm run test:integration    # Engine end-to-end
npm run test:security       # SSRF + injection
npm run test:coverage       # Coverage report → coverage/index.html
```

### 3.3 Build Verification

```bash
npm run build               # Next.js standalone build
# Verify standalone output exists:
ls -la .next/standalone/server.js
```

---

## 4. Staging Deployment

### 4.1 Via Helm (recommended)

```bash
# Configure kubeconfig
export KUBECONFIG=~/.kube/staging.yaml

# Create namespace (if not exists)
kubectl create namespace soar-staging --dry-run=client -o yaml | kubectl apply -f -

# Generate secrets (NEVER commit real values)
helm upgrade --install cybersoar deploy/helm/cybersoar \
  --namespace soar-staging \
  --create-namespace \
  --values deploy/helm/cybersoar/values-staging.yaml \
  --set secrets.mongodbUri="mongodb://soar:$(openssl rand -hex 16)@cybersoar-mongodb.staging.svc:27017/soar" \
  --set secrets.redisUrl="redis://:$(openssl rand -hex 16)@cybersoar-redis-master.staging.svc:6379" \
  --set secrets.webhookSecret="$(openssl rand -hex 32)" \
  --set secrets.encryptionKey="$(openssl rand -hex 32)" \
  --set secrets.nextauthSecret="$(openssl rand -hex 32)" \
  --set secrets.jwtSecret="$(openssl rand -hex 32)" \
  --set web.image.tag=sha-$(git rev-parse --short HEAD) \
  --wait --timeout 5m
```

### 4.2 Smoke Test

```bash
# 1. Pods are Ready
kubectl -n soar-staging rollout status deployment/cybersoar-web

# 2. Health endpoint responds
curl -s https://staging.soar.example.com/api/health | jq
# Expected: { "status": "alive", "version": "2.0.0", "uptime": ... }

# 3. Metrics endpoint emits Prometheus format
curl -s https://staging.soar.example.com/api/metrics | head -20

# 4. Webhook endpoint accepts POSTs
curl -X POST https://staging.soar.example.com/api/webhook/smoke-test?workflow=<wf-id> \
  -H 'content-type: application/json' \
  -d '{"ip":"8.8.8.8"}'
# Expected: { "ok": true, "executionId": "exec-..." }
```

### 4.3 Via docker-compose (alternative)

For single-host staging without Kubernetes:

```bash
docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.staging.yml up -d
```

---

## 5. Production Deployment

### 5.1 Tag a Release

```bash
git checkout main
git pull
npm version <patch|minor|major>      # bumps package.json + creates tag
git push --follow-tags
```

The GitHub Actions pipeline (`.github/workflows/ci-cd.yml`) will:

1. Run lint + typecheck + unit tests
2. Run SAST (Semgrep + CodeQL)
3. Build the container image, push to GHCR
4. Scan the image with Trivy (CRITICAL/HIGH fail the build)
5. Generate SBOM (CycloneDX) + upload to GitHub Dependency Graph
6. Deploy to staging (on `main` branch)
7. Deploy to production (on `v*` tags)

### 5.2 Deploy to Production

```bash
export KUBECONFIG=~/.kube/production.yaml

# Pull the latest Helm chart
helm repo add cybersoar https://cybersoar.github.io/charts
helm dependency update deploy/helm/cybersoar

# Dry-run first — verify templates render correctly
helm upgrade --install cybersoar deploy/helm/cybersoar \
  --namespace soar-production \
  --values deploy/helm/cybersoar/values-production.yaml \
  --set web.image.tag=v2.0.1 \
  --dry-run

# Real deploy
helm upgrade --install cybersoar deploy/helm/cybersoar \
  --namespace soar-production \
  --create-namespace \
  --values deploy/helm/cybersoar/values-production.yaml \
  --set web.image.tag=v2.0.1 \
  --wait --timeout 10m

# Post-deploy verification
helm status cybersoar -n soar-production
kubectl -n soar-production get pods
kubectl -n soar-production rollout status deployment/cybersoar-web
```

### 5.3 Production Secrets

**Never commit real secrets to git.** Use one of:

**Option A: ExternalSecrets + Vault (recommended)**

```yaml
# deploy/helm/cybersoar/values-production.secrets.yaml (NOT committed)
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: cybersoar-secrets
spec:
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: cybersoar-secrets
  data:
    - secretKey: mongodb-uri
      remoteRef:
        key: secret/data/soar/production
        property: mongodb_uri
    # ... etc
```

**Option B: Sealed Secrets**

```bash
echo -n "mongodb://soar:..." > /tmp/mongodb-uri
kubeseal --format yaml --namespace soar-production \
  --name cybersoar-secrets \
  --controller-name=sealed-secrets-controller \
  < /tmp/mongodb-uri > deploy/helm/cybersoar/templates/sealed-secret.yaml
```

**Option C: --set at deploy time (only for ad-hoc)**

```bash
helm upgrade ... \
  --set secrets.mongodbUri="mongodb://..." \
  --set secrets.encryptionKey="$(openssl rand -hex 32)"
```

### 5.4 Production Health Checks

```bash
# 1. All pods Ready
kubectl -n soar-production get pods -l app.kubernetes.io/instance=cybersoar

# 2. Ingress responds
curl -sf https://soar.example.com/api/health | jq -e '.status == "alive"'

# 3. HPA is functioning
kubectl -n soar-production get hpa

# 4. No crashlooping
kubectl -n soar-production get events --sort-by='.lastTimestamp' | tail -20

# 5. Logs are flowing
kubectl -n soar-production logs -l app.kubernetes.io/component=web --tail=50

# 6. Prometheus is scraping
kubectl -n soar-production port-forward svc/cybersoar-prometheus 9090
# Open http://localhost:9090/targets — soar-web should be UP

# 7. MongoDB replica set is healthy
kubectl -n soar-production exec -it cybersoar-mongodb-0 -- \
  mongosh --eval "rs.status().myState"  # Should print 1 (PRIMARY) or 2 (SECONDARY)
```

---

## 6. Rolling Updates & Rollback

### 6.1 Rolling Update

The Deployment uses `strategy: RollingUpdate` with `maxSurge: 1, maxUnavailable: 0`. This means a new pod is created before the old one is removed — zero downtime.

```bash
# Trigger a new deploy
helm upgrade cybersoar deploy/helm/cybersoar \
  --namespace soar-production \
  --values deploy/helm/cybersoar/values-production.yaml \
  --set web.image.tag=v2.0.2

# Watch the rollout
kubectl -n soar-production rollout status deployment/cybersoar-web --watch
```

### 6.2 Rollback

If the new version is broken:

```bash
# Quick Helm rollback (returns to previous release)
helm rollback cybersoar -n soar-production

# Or pin to a specific older image
helm upgrade cybersoar deploy/helm/cybersoar \
  --namespace soar-production \
  --values deploy/helm/cybersoar/values-production.yaml \
  --set web.image.tag=v2.0.0   # previous known-good version
```

For Kubernetes-native rollback (without Helm):

```bash
kubectl -n soar-production rollout undo deployment/cybersoar-web
kubectl -n soar-production rollout status deployment/cybersoar-web
```

### 6.3 Rollback Caveats

- **Database migrations**: if the new version ran `prisma migrate deploy` or applied MongoDB schema changes, rolling back the app image does NOT roll back the DB schema. Always test migrations on a staging copy first.
- **Webhook in-flight**: in-flight workflow executions continue with the old pod's process. New executions use the new image. The `idempotency_keys` collection prevents duplicate execution if a webhook is retried mid-rollout.

---

## 7. Scaling

### 7.1 Horizontal Pod Autoscaler

The HPA scales `soar-web` based on three signals:
- CPU utilization (target: 65%)
- Memory utilization (target: 75%)
- Custom metric `soar_active_executions` (target: 8 per pod)

```bash
# Check current HPA status
kubectl -n soar-production get hpa cybersoar-web

# Tune thresholds
helm upgrade cybersoar deploy/helm/cybersoar \
  --namespace soar-production \
  --reuse-values \
  --set web.hpa.cpuUtilization=60 \
  --set web.hpa.activeExecutionsPerPod=5 \
  --set web.maxReplicas=30
```

### 7.2 Manual Scaling (emergency)

```bash
kubectl -n soar-production scale deployment/cybersoar-web --replicas=10
```

### 7.3 MongoDB Scaling

Adding a new replica set member:

```bash
# Increase replica count via Helm
helm upgrade cybersoar deploy/helm/cybersoar \
  --namespace soar-production \
  --reuse-values \
  --set mongodb.replicaCount=5

# Verify the new member joins + syncs
kubectl -n soar-production exec -it cybersoar-mongodb-0 -- \
  mongosh --eval "rs.status()"
```

### 7.4 Redis Scaling

```bash
helm upgrade cybersoar deploy/helm/cybersoar \
  --namespace soar-production \
  --reuse-values \
  --set redis.replica.replicaCount=3
```

---

## 8. Observability

### 8.1 Prometheus Metrics

Available at `/api/metrics` on each `soar-web` pod:

| Metric | Type | Labels |
|--------|------|--------|
| `soar_workflow_executions_total` | counter | `workflow_id, status, tenant_id` |
| `soar_workflow_execution_duration_seconds` | histogram | `workflow_id` |
| `soar_node_executions_total` | counter | `node_subtype, status` |
| `soar_node_execution_duration_seconds` | histogram | `node_subtype` |
| `soar_integration_calls_total` | counter | `integration_type, status` |
| `soar_integration_errors_total` | counter | `integration_type, error_code` |
| `soar_circuit_breaker_state` | gauge | `integration_type` (0=closed, 1=open, 2=half_open) |
| `soar_active_executions` | gauge | (none) |
| `soar_webhook_triggers_total` | counter | `workflow_id, status` |
| `soar_http_request_duration_seconds` | histogram | `method, route, status` |

### 8.2 Grafana Dashboards

Pre-provisioned dashboards (in `deploy/docker/grafana-dashboards/`):

1. **SOAR Overview** — workflow executions/sec, success rate, p95 latency
2. **SOAR Nodes** — per-node execution time, error rate, circuit state
3. **SOAR Integrations** — per-integration call rate, error rate, rate-limit hits

Access:
```bash
kubectl -n soar-production port-forward svc/cybersoar-grafana 3000:80
# Open http://localhost:3000 — admin / (password from secrets)
```

### 8.3 Structured Logs

Logs are emitted as JSON to stdout (Pino). Each line carries:

```json
{
  "level": "info",
  "time": "2026-06-27T10:30:00.000Z",
  "service": "soar-platform",
  "version": "2.0.0",
  "env": "production",
  "correlationId": "uuid-v4",
  "workflowId": "wf-5",
  "executionId": "exec-123",
  "nodeId": "n1",
  "tenantId": "tenant-1",
  "component": "node.virustotal",
  "msg": "VirusTotal lookup complete",
  "ioc": "8.8.8.8",
  "detections": 0
}
```

Query with `kubectl logs` or your log aggregator (ELK, Loki, CloudWatch, Datadog).

### 8.4 Distributed Tracing

Every node execution emits a span:

- Span name: `node.{id}.execute`
- Attributes: `node_id`, `execution_id`, `ioc_type`, `ioc_value` (hashed), `attempt_count`, `status_code`, `duration_ms`

Configure your tracer (OpenTelemetry, Jaeger, Honeycomb) via `OTEL_EXPORTER_OTLP_ENDPOINT`.

### 8.5 Audit Log

Tamper-evident hash-chained ledger in MongoDB `audit_logs` collection. Each entry:

```json
{
  "_id": "...",
  "tenantId": "tenant-1",
  "actor": "system",
  "action": "virustotal.lookup",
  "resource": "ioc",
  "resourceId": "hashed-ioc-sha256-truncated",
  "description": "VT lookup: ip=8.8.8.8 → benign (score=0%)",
  "metadata": { ... },
  "prevHash": "abc123...",
  "hash": "def456...",
  "createdAt": "..."
}
```

To verify integrity:

```bash
kubectl -n soar-production exec -it svc/cybersoar-mongodb -- \
  mongosh soar --eval "
    const cursor = db.audit_logs.find().sort({ createdAt: 1 });
    let prev = null;
    while (cursor.hasNext()) {
      const e = cursor.next();
      const expected = crypto.createHash('sha256')
        .update((prev ? prev.hash : '') + JSON.stringify({...e, hash: ''}))
        .digest('hex');
      if (e.hash !== expected) print('TAMPER DETECTED at ' + e._id);
      prev = e;
    }
    print('Audit log verified — chain intact');
  "
```

---

## 9. Backup & Restore

### 9.1 MongoDB Backup

```bash
# Daily snapshot (cron job in Kubernetes)
kubectl -n soar-production create job --from=cronjob/cybersoar-mongo-backup manual-backup

# Restore from snapshot
mongorestore --uri="$MONGODB_URI" --gzip --archive=/backups/soar-2026-06-27.gz
```

### 9.2 Redis Backup

Redis AOF + RDB snapshots are enabled by default. For ad-hoc backup:

```bash
kubectl -n soar-production exec -it svc/cybersoar-redis-master -- redis-cli SAVE
kubectl -n soar-production cp cybersoar-redis-master-0:/data/dump.rdb /tmp/dump.rdb
```

### 9.3 Configuration Backup

The Helm `values-production.yaml` is the source of truth for configuration. It MUST be in git (minus secrets). For secrets, back up Vault / ExternalSecrets separately.

---

## 10. Incident Response

### 10.1 Severity Levels

| Severity | Definition | Examples | Response time |
|----------|------------|----------|---------------|
| SEV-1 | Production down, data loss risk | MongoDB unreachable, all web pods crashloop | < 15 min |
| SEV-2 | Major functionality broken | Webhooks not processing, all integrations failing | < 1 hour |
| SEV-3 | Minor functionality broken | One integration down, slow UI | < 4 hours |
| SEV-4 | Cosmetic / non-urgent | UI bug, missing translation | Next sprint |

### 10.2 Common Incidents

#### MongoDB unreachable

```bash
# 1. Check replica set state
kubectl -n soar-production exec -it cybersoar-mongodb-0 -- mongosh --eval "rs.status()"

# 2. If primary is down, force election
kubectl -n soar-production exec -it cybersoar-mongodb-1 -- \
  mongosh --eval "rs.stepDown(120)"

# 3. If quorum lost, force reconfig
kubectl -n soar-production exec -it cybersoar-mongodb-0 -- \
  mongosh --eval "
    const cfg = rs.conf();
    cfg.members = cfg.members.filter(m => ['mongo-0', 'mongo-1'].includes(m.host.split('.')[0]));
    rs.reconfig(cfg, { force: true });
  "
```

#### Webhook queue backing up

```bash
# Check active executions
kubectl -n soar-production exec -it svc/cybersoar-prometheus -- \
  promtool query instant http://localhost:9090 'soar_active_executions'

# Scale up web pods
kubectl -n soar-production scale deployment/cybersoar-web --replicas=20

# If still backing up, the rate limiter on a popular integration might be the bottleneck:
# Check circuit breaker state
kubectl -n soar-production exec -it svc/cybersoar-prometheus -- \
  promtool query instant http://localhost:9090 'soar_circuit_breaker_state'
```

#### Integration auth failures spike

```bash
# 1. Verify which integration is failing
kubectl -n soar-production logs -l app.kubernetes.io/component=web --tail=1000 | \
  grep "AUTH_FAILED" | jq -r '.integration_type' | sort | uniq -c

# 2. Check if the API key was rotated (Slack/VirusTotal sometimes rotate)
# 3. Update the integration config via the UI (Integrations page)
# 4. Force a re-test
curl -X POST https://soar.example.com/api/integrations/test \
  -H 'authorization: Bearer ...' \
  -H 'content-type: application/json' \
  -d '{"type":"virustotal","config":{...}}'
```

#### Audit log tamper alert

```bash
# 1. Identify the broken entry
kubectl -n soar-production exec -it svc/cybersoar-mongodb -- \
  mongosh soar --eval "..." # see §8.5

# 2. Page the security on-call immediately (SEV-1)
# 3. Preserve the broken entry for forensic analysis — do NOT delete
# 4. Snapshot the entire audit_logs collection to immutable storage
```

### 10.3 Post-Incident

1. Within 24 hours: hold a blameless post-mortem
2. Within 72 hours: publish a written incident report
3. Within 2 weeks: implement action items, link them in the report
4. Quarterly: review all SEV-1/2 incidents for patterns

---

## 11. Security Operations

### 11.1 Secret Rotation Schedule

| Secret | Rotation cadence | Owner |
|--------|------------------|-------|
| MongoDB root password | 90 days | DBA |
| MongoDB app user password | 90 days | Platform |
| Redis password | 90 days | Platform |
| `ENCRYPTION_KEY` (AES-256-GCM for integration configs) | 180 days | Security |
| `JWT_SECRET` | 90 days | Security |
| `WEBHOOK_SECRET` | 90 days | Security |
| External API keys (VT, Slack, etc.) | Per vendor policy | Integration owner |

> ⚠️ **Rotating `ENCRYPTION_KEY`** requires re-encrypting every integration config.
> Use the `npm run rotate-encryption-key` script (TODO) — it reads with the old key, writes with the new key in a single transaction.

### 11.2 Access Control

| Role | RBAC | What they can do |
|------|------|------------------|
| `soar-admin` | clusterrole | Read/write workflows, integrations, cases, audit |
| `soar-analyst` | role | Read/write cases, alerts; read workflows; no integrations |
| `soar-viewer` | role | Read-only everything |
| `soar-webhook` | serviceaccount | Used by the webhook ingestion path only |

### 11.3 Network Policy

Default deny all ingress + egress. Explicit allowlist (see `deploy/helm/cybersoar/templates/network-policy.yaml`):

- DNS (UDP/TCP 53) to kube-system
- MongoDB (27017) to pods labeled `app.kubernetes.io/name=mongodb`
- Redis (6379) to pods labeled `app.kubernetes.io/name=redis`
- HTTPS (443) to internet, EXCEPT private IP ranges (RFC 1918, RFC 6598, RFC 3927)

### 11.4 Pod Security Admission

The `soar` namespace enforces the **restricted** profile:
- `runAsNonRoot: true` (no root)
- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`
- `capabilities.drop: ["ALL"]`
- `seccompProfile: RuntimeDefault`

Any pod that violates these is rejected at admission time.

---

## 12. Useful Commands Cheat Sheet

```bash
# ─── Deployment ─────────────────────────────────────────────
helm list -n soar-production                              # List releases
helm history cybersoar -n soar-production                  # Release history
helm rollback cybersoar -n soar-production                 # Rollback to prev
helm get values cybersoar -n soar-production               # See applied values
helm get manifest cybersoar -n soar-production             # See rendered YAML

# ─── Pods ──────────────────────────────────────────────────
kubectl -n soar-production get pods -l app.kubernetes.io/instance=cybersoar
kubectl -n soar-production top pod -l app.kubernetes.io/component=web
kubectl -n soar-production describe pod <pod-name>
kubectl -n soar-production logs <pod-name> -c web --previous   # Crashloop logs

# ─── Database ──────────────────────────────────────────────
kubectl -n soar-production exec -it svc/cybersoar-mongodb -- mongosh soar
kubectl -n soar-production exec -it svc/cybersoar-mongodb -- mongosh --eval "rs.status()"

# ─── Redis ─────────────────────────────────────────────────
kubectl -n soar-production exec -it svc/cybersoar-redis-master -- redis-cli
kubectl -n soar-production exec -it svc/cybersoar-redis-master -- redis-cli INFO memory

# ─── Observability ─────────────────────────────────────────
kubectl -n soar-production port-forward svc/cybersoar-prometheus 9090
kubectl -n soar-production port-forward svc/cybersoar-grafana 3000:80
kubectl -n soar-production port-forward svc/cybersoar-web 8080:80

# ─── Debug ─────────────────────────────────────────────────
kubectl -n soar-production debug -it <pod-name> --image=nicolaka/netshoot
kubectl -n soar-production run debug-shell --rm -it --image=nicolaka/netshoot -- bash
```
