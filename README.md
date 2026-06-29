# LumiSec SOAR

Enterprise Security Orchestration, Automation & Response platform.

## Quick start (development)

```bash
cp .env.example .env
# Edit ENCRYPTION_KEY (openssl rand -hex 32)

npm ci --legacy-peer-deps
npm run db:push
npm run dev
```

Open `http://localhost:3000` — dev login: `admin@soar.local` / `admin123` (only when `SOAR_DISABLE_DEV_AUTH=0`).

## Team handoff (DevOps · Backend · Frontend)

**Start here:** [`docs/TEAM-HANDOFF.md`](docs/TEAM-HANDOFF.md)

| Team | Documents |
|------|-----------|
| **DevOps** | [TEAM-HANDOFF §3](docs/TEAM-HANDOFF.md#3-devops--دليل-النشر) · [DEPLOYMENT.md](docs/DEPLOYMENT.md) · [deploy/.env.compose.example](deploy/.env.compose.example) |
| **Backend** | [TEAM-HANDOFF §4](docs/TEAM-HANDOFF.md#4-backend--مسؤوليات-الفريق) · [API.md](docs/API.md) · [LUMISEC-PLATFORM-INTEGRATION-BRIEF.md](docs/LUMISEC-PLATFORM-INTEGRATION-BRIEF.md) |
| **Frontend** | [TEAM-HANDOFF §5](docs/TEAM-HANDOFF.md#5-frontend--مسؤوليات-الفريق) · [soar/ARCHITECTURE.md](docs/soar/ARCHITECTURE.md) |

## Verify

```bash
npm test                 # 157 tests
npm run verify           # typecheck + lint + test + build
npm run smoke            # API smoke (app must be running)
npm run stack:verify     # live stack + connector status
```

## Architecture

- **Default:** Next.js BFF + Prisma (`/api/soar/*`) — no mocks, no demo seed
- **Optional:** `mini-services/soar-backend` (Node + Mongo) when `SOAR_USE_NODE_BACKEND=1`
- **Platform outbound:** `LUMISEC_PLATFORM_URL` → LumiSec monolith (GRC / UCTC / Phishing / LumiNet)

Priority SOC connectors: **Elasticsearch → Firewall → VirusTotal → Email → Telegram**
