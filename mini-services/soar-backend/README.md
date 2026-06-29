# SOAR Node Backend (Node.js + MongoDB)

Secondary SOAR data plane + REST mirror. The main app is Next.js at the repo root.

> **Full handoff:** [`docs/TEAM-HANDOFF.md`](../../docs/TEAM-HANDOFF.md) §4.3  
> **Env template:** [`.env.example`](.env.example)

## Role

| Component | Responsibility |
|-----------|----------------|
| **Next.js (`:3000`)** | UI, auth, `/api/soar/*` BFF, Prisma, workflow engine |
| **This service (`:4000`)** | Mongo incidents, forensic data, `/api/soar/*` mirror when `SOAR_USE_NODE_BACKEND=1` |
| **LumiSec monolith** | GRC / UCTC / Phishing — via `LUMISEC_PLATFORM_URL` (NOT this service) |

When `SOAR_USE_NODE_BACKEND=1`, Next.js proxies `/api/soar/*` here. Connector actions proxy back to Next via `SOAR_WORKFLOW_GATEWAY_URL`.

## Quick start

```bash
cd mini-services/soar-backend
cp .env.example .env
npm install
npm run dev
# → http://localhost:4000
```

Root `.env` (when using node backend):

```env
SOAR_USE_NODE_BACKEND=1
SOAR_BACKEND_URL=http://localhost:4000
SOAR_WORKFLOW_GATEWAY_URL=http://localhost:3000
SOAR_INTERNAL_API_KEY=dev-soar-key
MONGODB_URI=mongodb://127.0.0.1:27017/soar_backend
```

Or from repo root: `npm run backend:dev`

## Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness + MongoDB ping |
| GET/POST | `/api/soar/incidents/*` | Incidents mirror + respond |
| POST | `/api/soar/integrations/*` | Proxy to Next gateway (elastic, notify, block-ip, …) |
| GET | `/api/incidents` | Legacy incidents list |
| POST | `/api/soar-events` | Event ingest from workflow engine |

All protected routes require `X-API-Key` = `EXTERNAL_API_KEY` / `SOAR_INTERNAL_API_KEY`.

## Deployment

Docker: see root `docker-compose.yml` service `backend`.  
Kubernetes: [`deploy/helm/cybersoar/`](../../deploy/helm/cybersoar/)

## License

Proprietary — internal use only.
