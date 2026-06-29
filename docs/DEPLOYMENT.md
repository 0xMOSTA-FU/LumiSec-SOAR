# Production Deployment Guide

> **للفرق الثلاثة (DevOps · Backend · Frontend):** ابدأ من [`TEAM-HANDOFF.md`](TEAM-HANDOFF.md) — يحتوي architecture، env matrix، checklists، وروابط كل الوثائق.

## Architecture (industry SOAR model)

Aligned with [Cortex XSOAR](https://docs-cortex.paloaltonetworks.com/r/Cortex-XSOAR/8/Cortex-XSOAR-Administrator-Guide/Concepts) and Splunk SOAR:

| Concept | Our implementation |
|---------|-------------------|
| Incidents (center of work) | `/api/soar/incidents` |
| Alerts → escalate | `/api/soar/alerts` + `POST .../escalate` |
| Integrations (inbound) | Connectors `/api/soar/connectors` |
| Outbound actions | `/api/soar/integrations/*` → `LUMISEC_PLATFORM_URL` |
| Playbooks | `/api/soar/playbooks` + playbook-runs |
| Vault (secrets) | `/api/soar/vault` |
| Visual workflows | `/api/workflows` (Prisma) |
| Elastic ingest | `POST /api/soar/integrations/elastic/poll` + CronJob |

## Deployment modes

See [`TEAM-HANDOFF.md` §2](TEAM-HANDOFF.md#2-وضعا-النشر) for full detail.

### Mode A — Single stack (pilot / small team)

- **Web + SOAR API:** Next.js with Prisma (SQLite or PostgreSQL)
- **No Mongo required**
- Set `DATABASE_URL`, `ENCRYPTION_KEY`, `JWT_SECRET`
- **Production:** `SOAR_DISABLE_DEV_AUTH=1` (mandatory)

### Mode B — Production SOAR data plane (recommended)

- **Web:** Next.js BFF (auth, sessions, workflows)
- **SOAR API:** `mini-services/soar-backend` (Node + MongoDB)
- Set `SOAR_USE_NODE_BACKEND=1`, `SOAR_BACKEND_URL`, `SOAR_INTERNAL_API_KEY`
- MongoDB with auth, TLS, private network

### Mode C — Remote monolith API

- `NEXT_PUBLIC_SOAR_USE_REMOTE_GATEWAY=1` + `LUMISEC_API_URL`
- UI stays in this repo; data from remote LumiSec backend

## Pre-deploy checklist

### Security (required)

- [ ] `SOAR_DISABLE_DEV_AUTH=1`
- [ ] `ENCRYPTION_KEY` — 64 hex chars (`openssl rand -hex 32`)
- [ ] `JWT_SECRET` — strong random string
- [ ] `SOAR_INTERNAL_API_KEY` / `EXTERNAL_API_KEY` — not `dev-soar-key`
- [ ] `LUMISEC_INTERNAL_API_KEY` — for platform outbound (if used)
- [ ] CSP: production build does **not** need `unsafe-eval`
- [ ] `CORS_ORIGIN` — your domain only (not `*`)
- [ ] HTTPS via reverse proxy (Nginx / Traefik / Ingress)
- [ ] `npm audit` reviewed

### Infrastructure

- [ ] Health: `GET /api/health` (web), `GET /api/health` (backend if used)
- [ ] `npm run smoke` — BFF SOAR routes green
- [ ] `npm run stack:verify` — connectors + DB status
- [ ] MongoDB running if `SOAR_USE_NODE_BACKEND=1` or `MONGODB_URI` set
- [ ] PostgreSQL for production Prisma (`provider = postgresql` in schema)
- [ ] Redis for sessions/rate-limit (docker-compose includes it)
- [ ] CronJob for Elastic poll (`POST /api/internal/jobs/elastic-poll`)

### Node.js backend hardening

Already in `soar-backend`: Helmet, rate-limit, API key auth, 10mb body limit.

Add for production:

- Process manager (PM2 / Kubernetes)
- Graceful shutdown on SIGTERM
- Structured JSON logging
- Readiness probe must check Mongo ping

## Quick start (Docker)

```bash
cp deploy/.env.compose.example .env
# Edit ENCRYPTION_KEY, JWT_SECRET, passwords, LUMISEC_PLATFORM_URL

docker compose up -d postgres redis mongo backend app worker
```

Ensure `.env` has `ENCRYPTION_KEY` and `JWT_SECRET` before compose.

## Smoke test

```bash
npm run dev          # or docker compose up
npm run smoke
npm run stack:verify
```

> **No demo seed** — `POST /api/seed` returns `410 DEMO_SEED_DISABLED`.  
> Operational data comes from Elastic / SIEM / webhooks / monolith ingest only.  
> To clear old data: `npm run db:purge`

## Login

| Environment | Auth |
|-------------|------|
| Dev (`SOAR_DISABLE_DEV_AUTH=0`) | `admin@soar.local` / `admin123` |
| Production | OIDC (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`) |

## CI/CD

Reference pipeline: [`deploy/ci/ci-cd.yml`](../deploy/ci/ci-cd.yml)

```bash
npm run verify   # typecheck + lint + test + build
```

## Related docs

| Document | Audience |
|----------|----------|
| [`TEAM-HANDOFF.md`](TEAM-HANDOFF.md) | All teams |
| [`API.md`](API.md) | Backend + Frontend |
| [`LUMISEC-PLATFORM-INTEGRATION-BRIEF.md`](LUMISEC-PLATFORM-INTEGRATION-BRIEF.md) | Monolith backend |
| [`deploy/.env.compose.example`](../deploy/.env.compose.example) | DevOps |
| [`deploy/helm/cybersoar/`](../deploy/helm/cybersoar/) | Kubernetes |

## Known gaps for full production

| Item | Status |
|------|--------|
| OIDC / SSO | Env vars ready, wire `extractAuthContext` |
| Monolith outbound | Requires `LUMISEC_PLATFORM_URL` on monolith team |
| Mongo without Docker on Windows | Install MongoDB Community or use Atlas |
| MTTR / analytics | Computed from real data when Mongo has history |
