# LumiSec Platform ↔ SOAR Outbound Actions — Backend Integration Brief

> **Deploy / env vars:** [`TEAM-HANDOFF.md`](TEAM-HANDOFF.md) · **API reference:** [`API.md`](API.md)

**Audience:** LumiSec monolith backend team (`LumiSec-Backendzz` / Node + Express + MongoDB)  
**From:** SOAR frontend team (Next.js gateway at `http://localhost:3000`)  
**Purpose:** Define the exact APIs, payloads, and lookup data needed so **Outbound Actions** (GRC · UCTC · Phishing tabs) work end-to-end with the SOAR UI.

---

## 1. Architecture (target state)

```mermaid
flowchart LR
  UI[SOAR UI Outbound Actions] --> GW[Next.js /api/soar/*]
  GW -->|X-Internal-Api-Key + optional JWT| MONO[LumiSec Monolith :4000]
  MONO --> GRC[/api/grc]
  MONO --> UCTC[/api/uctc]
  MONO --> PHISH[/api/phishing]
  MONO --> SOAR[/api/soar]
  SOAR -->|integrationClient| GRC & UCTC & PHISH
```

The SOAR gateway **does not** talk to GRC/UCTC/Phishing modules directly today. It calls **SOAR integration routes** on the monolith:

| SOAR UI action | Gateway route (Next.js) | Expected monolith route |
|----------------|-------------------------|-------------------------|
| Submit GRC finding | `POST /api/soar/integrations/grc/finding` | Must create/link GRC finding |
| Submit GRC risk | `POST /api/soar/integrations/grc/risk` | Must create GRC risk |
| Push / deploy UCTC rule | `POST /api/soar/integrations/uctc/rule` | Must create or deploy Sigma rule |
| Trigger UCTC rule | `POST /api/soar/integrations/uctc/rule-trigger` | Must run rule workflow / deploy job |
| Link phishing campaign | `POST /api/soar/integrations/phishing/campaign` | Must create/link campaign to incident |

**Auth:** `Authorization: Bearer <JWT>` **or** `X-Internal-Api-Key: <SERVICE_API_KEY>`  
**Response envelope (required):**

```json
{
  "success": true,
  "message": "Human-readable result",
  "data": { }
}
```

On error: HTTP 4xx/5xx + `{ "success": false, "message": "...", "error": "CODE" }`

---

## 2. Environment (both sides)

| Variable | SOAR gateway | Monolith |
|----------|--------------|----------|
| Base URL | `SOAR_BACKEND_URL=http://localhost:4000` | `npm run dev` on :4000 |
| Service key | `SOAR_INTERNAL_API_KEY=dev-soar-key` | Must match `SERVICE_API_KEY` / internal auth middleware |

SOAR gateway health probe uses: `GET /api/health`, plus module dashboards listed in §6.

---

## 3. Outbound action contracts — **please confirm or provide OpenAPI**

### 3.1 GRC — Submit Finding

**Route:** `POST /api/soar/integrations/grc/finding`

**Request body (SOAR sends after mapping):**

```json
{
  "title": "Suspicious lateral movement",
  "description": "Synced from SOAR incident IR-1042",
  "severity": "high",
  "asset": "server-01.example.com",
  "sourceModule": "soar",
  "sourceId": "<soar_incident_id>",
  "incidentId": "<soar_incident_id>",
  "createRisk": false
}
```

**We need from backend:**

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Maps to GRC Finding.title |
| `description` | no | |
| `severity` | yes | `low \| medium \| high \| critical` |
| `asset` | no | Hostname/IP/asset identifier |
| `sourceModule` | yes | Always `"soar"` for idempotency |
| `sourceId` | yes | SOAR incident UUID — **idempotent key** with `sourceModule` |
| `createRisk` | no | If true, also open linked risk |

**Expected success `data`:**

```json
{
  "ok": true,
  "finding_id": "<mongo_id>",
  "reference": "<mongo_id>",
  "risk_id": "<optional if createRisk>"
}
```

**Questions for backend:**

1. Exact Joi validation schema for this route?
2. Does it call `POST /api/grc/findings` internally or write Finding model directly?
3. Idempotency: return existing finding on duplicate `(sourceModule, sourceId)`?
4. Which GRC statuses are set on create (`open`)?

---

### 3.2 GRC — Submit Risk

**Route:** `POST /api/soar/integrations/grc/risk`

**Request body:**

```json
{
  "title": "Unpatched critical vulnerability",
  "description": "...",
  "severity": "high",
  "likelihood": "medium",
  "impact": "high",
  "asset": "server-01.example.com",
  "sourceModule": "soar",
  "sourceId": "<soar_incident_id>",
  "incidentId": "<soar_incident_id>"
}
```

**Expected success `data`:**

```json
{
  "ok": true,
  "risk_id": "<mongo_id>",
  "reference": "<mongo_id>"
}
```

**Questions:**

1. Valid enum values for `likelihood` and `impact`?
2. Link to existing finding if `findingId` provided — do you want us to add that field?

---

### 3.3 UCTC — Push / Deploy Rule

**Route:** `POST /api/soar/integrations/uctc/rule`

**Request body (two modes):**

**A) Deploy existing rule**

```json
{
  "ruleId": "<uctc_sigma_rule_id>",
  "incidentId": "<optional_soar_incident_id>"
}
```

**B) Create + push new Sigma rule**

```json
{
  "name": "Suspicious PowerShell",
  "description": "From SOAR playbook step",
  "yaml": "title: ...\nlogsource:\n  ...",
  "incidentId": "<optional>"
}
```

**Expected success `data`:**

```json
{
  "ok": true,
  "rule_id": "<mongo_id>",
  "reference": "<mongo_id>",
  "deploy_status": "queued | deployed | mock",
  "job_id": "<optional bull job id>"
}
```

**Questions:**

1. Does this route call `POST /api/uctc/rules` then `POST /api/uctc/rules/:id/deploy`?
2. Required Sigma YAML fields / validation errors format?
3. Async deploy via `lumisec.soar.integration` worker — how does UI poll status?

---

### 3.4 UCTC — Trigger Rule

**Route:** `POST /api/soar/integrations/uctc/rule-trigger` (alias of `/uctc/rule` in docs)

**Request body:**

```json
{
  "ruleId": "<uctc_sigma_rule_id>",
  "incidentId": "<optional>",
  "context": { "ip": "203.0.113.1", "host": "workstation-07" }
}
```

**Expected success `data`:**

```json
{
  "ok": true,
  "reference": "<job_or_run_id>",
  "rule_id": "<ruleId>"
}
```

---

### 3.5 Phishing — Link / Create Campaign

**Route:** `POST /api/soar/integrations/phishing/campaign`

**Request body:**

```json
{
  "name": "Post-incident awareness — finance",
  "description": "Triggered from SOAR IR-1042",
  "templateId": "<phishing_template_id>",
  "landingPageId": "<optional_landing_page_id>",
  "incidentId": "<soar_incident_id>",
  "targetGroup": "finance-team",
  "launchDate": "2026-06-27T10:00:00.000Z",
  "autoLaunch": false
}
```

**Expected success `data`:**

```json
{
  "ok": true,
  "campaign_id": "<mongo_id>",
  "reference": "<mongo_id>",
  "status": "draft | scheduled | running"
}
```

**Questions:**

1. Should `targetGroup` map to recipient filter, department tag, or CSV group name?
2. If `autoLaunch=true`, do you call `POST /api/phishing/campaigns/:id/launch` inline or queue?
3. How is campaign linked back to SOAR incident in Mongo (field name)?

---

## 4. Lookup APIs needed by SOAR UI (dropdowns)

SOAR gateway proxies these when monolith is up. **Please confirm paths and list response shape.**

| Lookup | Monolith path (expected) | Used in UI |
|--------|--------------------------|------------|
| Phishing templates | `GET /api/phishing/templates?limit=100` | Template picker |
| Phishing landing pages | `GET /api/phishing/landing-pages?limit=100` | Landing page picker |
| UCTC rules | `GET /api/uctc/rules?limit=100` | Rule picker (deploy/trigger) |
| GRC frameworks (future) | `GET /api/grc/compliance/controls` | Map finding → control |
| Phishing recipients (future) | `GET /api/phishing/recipients?department=` | Target group picker |

**Minimum list item shape:**

```json
{
  "_id": "665abc...",
  "name": "Credential harvest template",
  "status": "active"
}
```

Paginated lists must include:

```json
{
  "success": true,
  "data": [ /* or direct array */ ],
  "pagination": { "page": 1, "limit": 100, "total": 12, "pages": 1 }
}
```

---

## 5. Reverse integrations (monolith → SOAR) — for playbook automation

Documented in your modules; SOAR UI will surface as **recommended actions** when wired:

| Source | Monolith route | Purpose |
|--------|----------------|---------|
| Network | `POST /api/luminet/integrations/soar/incident` | Asset misconfig → incident |
| UCTC | `POST /api/uctc/integrations/soar/incident` | Detection gap → incident |
| Phishing | `POST /api/phishing/integrations/soar/incident` | High-risk user → incident |
| GRC | `POST /api/grc/integrations/soar/incidents` | Finding escalation → incident |

**We need:** canonical incident create payload your SOAR module expects when ingesting from other modules.

---

## 6. Health / connectivity checks

SOAR gateway calls on page load (`GET /api/soar/platform/status`):

| Probe | Path | Pass condition |
|-------|------|----------------|
| Health | `GET /api/health` | HTTP 200 |
| SOAR | `GET /api/soar/dashboard/overview` | HTTP 200 + `success: true` |
| GRC | `GET /api/grc/dashboard/overview` | HTTP 200 |
| UCTC | `GET /api/uctc/dashboard/stats` | HTTP 200 |
| Phishing | `GET /api/phishing/dashboard/overview` | HTTP 200 |
| LumiNet | `GET /api/luminet/assets/inventory?limit=1` | HTTP 200 |

If any module uses different dashboard paths, **please list corrections**.

---

## 7. Error codes SOAR UI handles

| HTTP | Meaning | UI behavior |
|------|---------|-------------|
| 501 | Platform not configured / stub | Show setup instructions |
| 502 | Monolith unreachable | Toast: platform down |
| 422 | Validation failed | Field-level errors (`details[]` or `errors{}`) |
| 428 | Approval required | N/A for outbound tabs today (used on destructive network actions) |

**Validation error format (preferred):**

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "title": "Title is required",
    "severity": "Must be one of low, medium, high, critical"
  }
}
```

---

## 8. Deliverables requested from backend team

Please reply with:

1. **OpenAPI snippets** (or Postman collection) for the 5 SOAR integration routes in §3.
2. **Confirmed request/response JSON** for each route (copy-paste examples from running server).
3. **Lookup endpoints** + sample list responses for templates, landing pages, rules.
4. **Internal API key** value for dev/staging and which env var name you use.
5. **Idempotency rules** for GRC finding ingest from SOAR.
6. **Async job IDs** for UCTC deploy / phishing launch if not synchronous.
7. **Field mapping table** from SOAR incident → GRC finding / UCTC context / phishing campaign link.

---

## 9. Reference — documented monolith modules

From LumiSec platform docs (already shared):

| Module | Base path | Integration routes |
|--------|-----------|-------------------|
| GRC | `/api/grc` | `/integrations/network/findings`, `/integrations/soar/incidents`, … |
| Phishing | `/api/phishing` | `/integrations/grc/risk`, `/integrations/soar/incident`, … |
| SOAR | `/api/soar` | `/integrations/grc/finding`, `/integrations/uctc/rule`, `/integrations/phishing/campaign`, … |
| UCTC | `/api/uctc` | `/integrations/grc/gap`, `/integrations/soar/incident`, `/integrations/siem/deploy`, … |
| LumiNet | `/api/luminet` | `/integrations/grc/finding`, `/integrations/soar/incident`, … |

OpenAPI (if available):

- `GET /api/grc/docs/openapi.json`
- `GET /api/soar/docs/openapi.json`

---

## 10. SOAR gateway implementation status

Implemented on SOAR side (this repo) — **no mocks, no demo seed**:

| Area | Status |
|------|--------|
| Platform client | `src/lib/lumisec-api/platform-outbound.ts` — `LUMISEC_PLATFORM_URL`, native API fallback |
| Outbound routes | `POST /api/soar/integrations/grc/*`, `uctc/*`, `phishing/campaign` |
| Reverse ingest | `POST /api/soar/integrations/modules/incident` — GRC/UCTC/Phishing/LumiNet → alert (+ optional case) |
| SIEM ingest | `POST /api/soar/integrations/siem/event` |
| Platform status | `GET /api/soar/platform/status` |
| Lookups | `GET /api/soar/platform/lookups/*` |
| Incident actions | Recommended actions + `respond` for GRC/UCTC/Phishing/LumiNet |
| Workflow nodes | `lumisec_grc`, `lumisec_uctc`, `lumisec_phishing`, `lumisec_network` |
| Mongo audit | `platform_integration_calls`, `connector_calls` (when `MONGODB_URI` set) |
| Elastic ingest | `POST /api/soar/integrations/elastic/event` + `elastic/poll` |
| Elastic scheduler | `POST /api/internal/jobs/elastic-poll` + `npm run jobs:elastic-poll-loop` |
| Priority stack | Elastic → Firewall → VirusTotal → Email → Telegram (`src/lib/integrations/catalog.ts`) |
| Notify actions | `notify_email`, `notify_telegram` — incident respond + `/integrations/notify/*` |
| Demo data | Disabled — `npm run db:purge` clears operational SQLite data |

**Requires monolith** at `LUMISEC_PLATFORM_URL` for outbound actions to succeed. Until then UI shows real errors (501/502), not fake success.

UI: **Outbound Actions** + incident recommended platform actions in `IntegrationsManagement.tsx` / `IncidentDetailPage.tsx`.

---

## 11. Contact / next steps

1. Backend fills §3 confirmation tables + sample responses.
2. SOAR team aligns form validation to Joi schemas.
3. Joint test: start monolith + SOAR `:3000`, run smoke checklist:

**Priority stack (SOC):**
- [ ] Elastic connector — URL + API key + `alerts_index` → Test → Poll Elastic alerts
- [ ] Firewall (FortiGate/OPNsense) — block-ip test from incident
- [ ] VirusTotal — enrich IP / scan hash
- [ ] Email SMTP — `notify_email` from incident respond
- [ ] Telegram — bot token + `phone_contacts` JSON → `notify_telegram`

**Platform outbound (requires `LUMISEC_PLATFORM_URL`):**
- [ ] GRC finding from incident ID → appears in GRC findings list
- [ ] GRC risk with likelihood/impact → appears in risk register
- [ ] UCTC deploy existing rule by ID → rule status `deployed`
- [ ] UCTC trigger rule → job/run recorded
- [ ] Phishing campaign with template + incident link → campaign visible in Phishing module
- [ ] Duplicate GRC finding same `sourceId` → idempotent (no duplicate)

---

*Document version: 2026-06-27 — generated for LumiSec SOAR Outbound Actions integration.*
