# LumiSec SOAR — Architecture

> **Team handoff (deploy):** [`TEAM-HANDOFF.md`](../TEAM-HANDOFF.md)

## Industry model (Splunk SOAR / XSOAR)

| Concept | This platform |
|--------|----------------|
| **Incidents** | Center of work — local `Case` rows exposed as `/api/soar/incidents` |
| **Alerts** | Triage queue → escalate to Incident (`source_alert_id`) |
| **Playbooks** | Automation on incidents (`/api/soar/playbooks`, runs → `WorkflowExecution`) |
| **Connectors** | Inbound sources (SIEM, EDR webhooks) — `/api/soar/connectors` |
| **Integrations / Outbound Actions** | Block IP, isolate host, enrich — `/api/soar/integrations/*` |
| **Vault** | Encrypted connector secrets — `VaultSecret` |
| **Visual Workflows** | Local only (`/api/workflows`) until remote backend adds parity |

## Runtime modes

```
┌─────────────────────────────────────────────────────────────┐
│  SoarApp (gateway UI ON when NEXT_PUBLIC_SOAR_GATEWAY≠0)   │
└───────────────────────────┬─────────────────────────────────┘
                            │
         ┌──────────────────┴──────────────────┐
         │                                     │
   Local backend                         Remote backend
   (default)                            (optional)
         │                                     │
         ▼                                     ▼
  /api/soar/*                         /api/gateway/api/soar/*
  Prisma router                       → LUMISEC_API_URL
  src/lib/soar-api/router.ts          (lumisec.tech)
```

### Env cheat sheet

**Local (pilot / dev):**
```env
NEXT_PUBLIC_SOAR_GATEWAY=1
```

**Remote colleague API:**
```env
NEXT_PUBLIC_SOAR_GATEWAY=1
NEXT_PUBLIC_SOAR_USE_REMOTE_GATEWAY=1
SOAR_USE_REMOTE_GATEWAY=1
LUMISEC_API_URL=https://lumisec.tech
LUMISEC_INTERNAL_API_KEY=...
```

**Legacy Cases UI:**
```env
NEXT_PUBLIC_SOAR_GATEWAY=0
```

## SPA navigation

Gateway pages live inside `SoarApp` state — use `SoarNavigate` (`src/lib/soar/mode.ts`), not Next.js `/incidents/[id]` routes.

## Dev

```bash
npm run dev   # uses --webpack (Turbopack breaks dynamic API routes on Windows)
```

Login: `admin@soar.local` / `admin123`
