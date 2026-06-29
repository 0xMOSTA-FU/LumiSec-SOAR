# LumiSec SOAR — Project Structure

```
LumiSec SOAR/
├── src/                          # Next.js web app (BFF + UI)
│   ├── app/
│   │   ├── api/
│   │   │   ├── soar/[...path]/   # SOAR API — Prisma OR proxy → Node backend
│   │   │   ├── gateway/[...path]/ # Remote lumisec.tech proxy
│   │   │   ├── workflows/        # Visual workflow builder (Prisma)
│   │   │   └── seed/             # Prisma demo seed
│   │   └── (pages)/
│   ├── components/
│   │   ├── soar/                 # Legacy local SOAR UI
│   │   └── gateway/              # Industry SOAR UI (Incidents hub)
│   └── lib/
│       ├── soar-api/             # Local Prisma router + Node proxy
│       ├── lumisec-api/          # Browser API client + gateway config
│       └── incidents/            # Response actions engine
│
├── mini-services/
│   └── soar-backend/             # Node.js + MongoDB (primary SOAR data plane)
│       └── src/
│           ├── server.js           # Express entry (port 4000)
│           ├── models/
│           │   └── soar.js       # Mongoose schemas (Incident, Alert, …)
│           ├── routes/
│           │   └── soar/         # /api/soar/* REST API
│           ├── services/           # Business logic
│           └── shuffle/          # Shuffle-compatible /api/v1/*
│
├── mini-services/soar-worker/    # Workflow worker
├── mini-services/soar-bull-worker/
├── mini-services/soar-event-processor/
│
├── prisma/                       # SQLite/Postgres (auth, workflows, legacy)
├── docs/soar/                    # Architecture & API specs
└── docker-compose.yml            # postgres, redis, mongo, backend, app
```

## Runtime modes

| Mode | Env | Data store |
|------|-----|------------|
| **Local Prisma** (default dev) | — | SQLite/Postgres via Prisma |
| **Node + Mongo** (recommended) | `SOAR_USE_NODE_BACKEND=1` | MongoDB via soar-backend |
| **Remote gateway** | `SOAR_USE_REMOTE_GATEWAY=1` | lumisec.tech |

## Request flow (Node + Mongo)

```
Browser (gateway UI)
  → apiClient.fetch('/api/soar/incidents')
  → Next.js BFF (auth, tenant headers)
  → http://localhost:4000/api/soar/incidents
  → MongoDB
```

## Industry SOAR mapping

| Concept | API path | Mongo model |
|---------|----------|-------------|
| Incidents (center of work) | `/api/soar/incidents` | `SoarIncident` |
| Alerts → escalate | `/api/soar/alerts` | `SoarAlert` |
| Connectors (inbound) | `/api/soar/connectors` | `Connector` |
| Vault (secrets) | `/api/soar/vault` | `VaultSecret` |
| Artifacts | `/api/soar/artifacts` | `SoarArtifact` |
| Playbooks | `/api/soar/playbooks` | `Playbook` |
| Playbook runs | `/api/soar/playbook-runs` | `PlaybookRun` |
| Outbound actions | `/api/soar/integrations/*` | via timeline + connectors |
| Visual workflows | `/api/workflows` | Prisma (until ported) |

## Quick start (full stack)

```bash
# Terminal 1 — Mongo (or docker-compose up mongo)
# Terminal 2
cd mini-services/soar-backend && cp .env.example .env && npm install && npm run dev

# Terminal 3 — seed Mongo
curl -X POST http://localhost:4000/api/soar/seed

# Root .env
SOAR_USE_NODE_BACKEND=1
SOAR_BACKEND_URL=http://localhost:4000
SOAR_INTERNAL_API_KEY=dev-soar-key

npm run dev
```

## Frontend (`src/`)

```
src/
├── features/soar/              # Public SOAR feature surface
│   ├── gateway/index.ts        # Re-exports industry UI components
│   ├── api/index.ts            # Re-exports browser SOAR API modules
│   └── app/nav-config.ts       # Gateway vs legacy sidebar config
├── components/
│   ├── gateway/                # Industry SOAR pages (Incidents hub, …)
│   └── soar/                   # App shell (SoarApp, modals, legacy UI)
├── lib/
│   ├── api/soar/envelope.ts    # Shared unwrapData / pagination helpers
│   ├── lumisec-api/browser/    # Per-domain API clients (soarIncidents, …)
│   └── soar-api/               # Server router + Node proxy
└── app/api/soar/               # Next.js BFF route
```

Gateway components import API via `@/features/soar/api` or `@/lib/lumisec-api/browser/*`.

