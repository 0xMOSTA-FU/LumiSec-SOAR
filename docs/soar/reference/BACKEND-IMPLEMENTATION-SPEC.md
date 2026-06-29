# LumiSec SOAR — مواصفات الباك اند الناقصة (للفريق Backend)

> **المستلم:** Zamil / فريق LumiSec Backend  
> **المرجع الحالي:** `SOAR_API_Reference.md` (79 endpoint) + `LumiSec_SOAR.postman_collection.json`  
> **الغرض:** تنفيذ **كل** ما ينقص بحيث الـ UI يكون عميل رفيع فقط — **ممنوع** تقسيم اللوجيك بين فولدر الـ UI والباك اند.

---

## 0. قاعدة معمارية إلزامية

```
┌─────────────────────────────────────────────────────────────┐
│  React / Next.js UI  —  عرض + forms + استدعاء API فقط       │
│  (لا Prisma، لا executors، لا recommended-actions محلية)   │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS + JWT
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  LumiSec API Gateway  —  /api/soar/*  +  /api/auth/*         │
│  • MongoDB (أو DB موحّد)                                    │
│  • RBAC + Audit                                             │
│  • Workflow execution engine                                │
│  • Integration connectors (FortiGate, VT, CrowdStrike, …)     │
│  • Incident parsing + recommendations + respond             │
└─────────────────────────────────────────────────────────────┘
```

**بعد الدمج:**
- أي route في فولدر الـ UI تحت `/api/cases`, `/api/workflows`, `/api/incidents/...` **يُلغى** أو يصبح proxy شفاف فقط.
- التنفيذ الحقيقي (block IP, isolate, enrich, playbook run) **كله** على الباك اند.

**Response envelope موحّد (مثل Postman الحالي):**
```json
{
  "success": true,
  "data": { ... },
  "message": "optional"
}
```

**Auth:**
- User: `Authorization: Bearer <jwt>`
- Service/worker: `X-Internal-Api-Key` أو `x-service-key`
- Permissions: انظر [القسم 12](#12-rbac--permissions)

---

## 1. ما هو موجود عندك بالفعل (لا تعيده)

من `SOAR_API_Reference.md` — **79 endpoint** شغالين أو معرّفين:

| المجموعة | العدد | ملاحظة |
|----------|-------|--------|
| Incidents CRUD + timeline/notes/artifacts/related | 16 | ناقص respond + recommendations |
| Analytics | 4 | |
| Artifacts CRUD + enrich | 6 | |
| Connectors CRUD + test | 7 | |
| Playbooks CRUD | 5 | مختلف عن Workflow graph |
| Playbook runs | 5 | يحتاج ربط بـ workflow engine |
| Vault | 5 | |
| Dashboard | 6 | |
| Notifications | 4 | |
| Alerts | 2 | **GET فقط** — ناقص write |
| Integration actions (firewall, network, edr, siem, grc, …) | 12 | جزء من respond |
| Webhooks ingress | 6 | |
| Docs OpenAPI | 1 | |

---

## 2. ملخص الناقص — عدد Endpoints المطلوب تنفيذها

| الأولوية | المجموعة | endpoints جديدة تقريباً |
|----------|----------|-------------------------|
| **P0** | Incident respond + recommendations + summary | 3 |
| **P0** | Cases (كامل) | 5 |
| **P0** | Alerts (write) | 3 |
| **P0** | Integration actions (threat-intel, identity, email, notify) | 6 |
| **P1** | Workflows (visual graph) + executions | 8 |
| **P1** | Playbooks ↔ workflows linking | 2 |
| **P1** | Approvals | 5 |
| **P1** | Connectors actions catalog (توسيع) | 1 |
| **P2** | Nodes registry (Connector SDK) | 2 |
| **P2** | Attack patterns (MITRE) | 3 |
| **P2** | Auth aliases + seed/dev | 3 |
| **P2** | System status + audit read | 2 |
| **P2** | Dynamic webhook trigger | 1 |

**المجموع التقريبي: ~48 endpoint جديد** (بالإضافة لتوسيع الموجود).

---

## 3. P0 — Incident Response (أولوية قصوى)

### 3.1 `GET /api/soar/incidents/:id/summary`

**الغرض:** شاشة Incident Detail تحمّل كل شيء في طلب واحد (أو الـ UI يستدعي sub-resources — هذا أسرع للـ UX).

**Auth:** Bearer JWT — permission `incident:read`

**Response `data`:**
```json
{
  "incident": {
    "_id": "…",
    "title": "…",
    "description": "…",
    "severity": "high",
    "status": "investigating",
    "source": "CrowdStrike EDR",
    "tags": ["malware", "endpoint"],
    "caseId": null,
    "createdAt": "…",
    "updatedAt": "…"
  },
  "parsedContext": {
    "ips": ["203.0.113.42"],
    "hostnames": ["WKS-042"],
    "hashes": ["abc…"],
    "domains": [],
    "users": [],
    "emails": []
  },
  "artifacts": [{ "type": "ip", "value": "203.0.113.42" }],
  "timeline": [{ "time": "…", "actor": "System", "actorType": "system", "message": "…" }],
  "linkedAlerts": [{ "_id": "…", "title": "…", "severity": "high", "source": "…" }],
  "relatedIncidents": [{ "_id": "…", "title": "…", "date": "…" }],
  "recommendations": [ "... see 3.2 ..." ],
  "connectedIntegrations": {
    "firewall": true,
    "edr": true,
    "virustotal": false,
    "slack": true,
    "entra": false
  }
}
```

**Business logic على الباك اند (إلزامي):**
1. Parse IOCs من: `raw`, `artifacts`, `title`, `description`, `source`, linked alerts.
2. Regex: IPv4, SHA256/MD5, hostnames (`WKS-*`, `SRV-*`), emails, domains.
3. Merge linked alerts لو الـ incident مربوط بـ case.
4. استدعاء `buildRecommendations()` داخلياً (القسم 3.2).

---

### 3.2 `GET /api/soar/incidents/:id/recommendations`

**Auth:** Bearer JWT — `incident:read`

**Response `data`:**
```json
{
  "recommendations": [
    {
      "id": "block_ip",
      "label": "Block IP 203.0.113.42",
      "description": "Add deny rule on FortiGate/pfSense",
      "category": "contain",
      "destructive": true,
      "available": true,
      "unavailableReason": null,
      "requiresIntegrations": ["fortigate", "pfsense"],
      "params": { "ip": "203.0.113.42" },
      "score": 75
    }
  ],
  "connectedIntegrations": { "...": true }
}
```

**`actionId` المسموحة:**
| id | category | destructive | يتطلب |
|----|----------|-------------|--------|
| `block_ip` | contain | yes | IP + firewall connected |
| `isolate_host` | contain | yes | hostname/IP + edr/network |
| `enrich_ip` | investigate | no | IP + VT/AbuseIPDB |
| `scan_hash` | investigate | no | hash + VirusTotal |
| `disable_user` | remediate | yes | upn + Entra |
| `notify_soc_slack` | notify | no | Slack |
| `run_enrichment_playbook` | investigate | no | IP أو hash |
| `mark_investigating` | status | no | — |
| `mark_contained` | status | no | — |

**خوارزمية التسجيل (minimum score = 35 للإظهار):**

```
scoreBlockIp:
  +45 if ips.length
  +35 if tags: brute-force|network|vpn|scan
  +30 if source matches firewall|palo|vpn|brute
  +20 if title/description matches brute|scan|firewall
  +10 if severity critical|high

scoreIsolate:
  +45 if hostnames
  +40 if tags: malware|endpoint|ransomware
  +35 if source/title matches crowdstrike|edr|workstation
  +15 if hashes present

scoreDisableUser:
  +40 if users or emails
  +35 if tags: credential-access|privilege-escalation|insider-threat
  +30 if AD/Entra/privilege in text

scoreEnrichIp: +35 ip, +25 phishing|exfil|network tags, +20 SIEM/C2 keywords
scoreScanHash: +50 valid hash (len>=32), +25 malware|phishing tags
scoreNotify: +50 critical, +35 high, +20 if block/isolate also scored high

Tag inference من النص: brute-force, malware, phishing, scan, exfiltration,
privilege-escalation, credential-access, network, cloud, endpoint
```

**`available: false`** مع `unavailableReason` لو الـ connector غير `connected` في vault/connectors.

---

### 3.3 `POST /api/soar/incidents/:id/respond`

**الغرض:** نقطة دخول **وحيدة** لتنفيذ إجراء من الـ UI (بدل ما الـ frontend ينادي firewall/edr منفصلين).

**Auth:** Bearer JWT — permission حسب `actionId` (القسم 12)

**Request:**
```json
{
  "actionId": "block_ip",
  "params": {
    "ip": "203.0.113.42",
    "hostname": "WKS-042",
    "hash": "…",
    "upn": "user@corp.com",
    "playbookId": "optional",
    "comment": "SOC analyst initiated"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "ok": true,
    "actionId": "block_ip",
    "message": "Blocked 203.0.113.42 on FortiGate",
    "logs": [
      { "time": "2026-06-27T12:00:00Z", "message": "…", "level": "success" }
    ],
    "executionId": "playbook-run-id-if-any",
    "statusUpdated": "investigating"
  }
}
```

**Routing داخلي (إلزامي على الباك اند):**

| actionId | ينفّذ |
|----------|--------|
| `block_ip` | `POST /api/soar/integrations/firewall/block-ip` `{ ip, incidentId, comment }` |
| `isolate_host` | `POST …/edr/isolate-host` أو `…/network/isolate-host` حسب وجود hostname vs IP |
| `enrich_ip` | `POST …/integrations/threat-intel/enrich-ip` (جديد — §4) |
| `scan_hash` | `POST …/integrations/threat-intel/scan-hash` (جديد) |
| `disable_user` | `POST …/integrations/identity/disable-user` (جديد) |
| `notify_soc_slack` | `POST …/integrations/notify/slack` (جديد) |
| `run_enrichment_playbook` | `POST /api/soar/incidents/:id/playbooks/run` |
| `mark_investigating` | `PATCH /api/soar/incidents/:id` `{ status: "investigating" }` + timeline |
| `mark_contained` | `PATCH` status + timeline (أو `…/close` لو السياسة كذلك) |

**Side effects إلزامية:**
1. Append `timeline` entry.
2. `audit` log: `incident.respond.{actionId}`.
3. لو `destructive` + سياسة الموافقة → أنشئ approval أولاً (§8) أو ارفض بـ `409 APPROVAL_REQUIRED`.

**Errors:**
| Code | معنى |
|------|------|
| 400 | `ACTION_NOT_APPLICABLE` — الإجراء غير مناسب لهذا الحادث |
| 403 | صلاحية ناقصة |
| 422 | `INTEGRATION_REQUIRED` — connector غير متصل |
| 409 | `APPROVAL_REQUIRED` |
| 502 | فشل التنفيذ على integration خارجي |

---

## 4. P0 — Integration actions ناقصة

عندك `firewall/block-ip` و `edr/isolate-host`. **أضف:**

### 4.1 `POST /api/soar/integrations/threat-intel/enrich-ip`
```json
{ "ip": "8.8.8.8", "incidentId": "…", "sources": ["virustotal", "abuseipdb"] }
```
**Response:** scores, geo, malicious counts, يُخزَّن على artifact/incident.

### 4.2 `POST /api/soar/integrations/threat-intel/scan-hash`
```json
{ "hash": "sha256…", "incidentId": "…" }
```

### 4.3 `POST /api/soar/integrations/identity/disable-user`
```json
{ "upn": "user@corp.com", "incidentId": "…" }
```
Entra ID / Graph / AD حسب connector.

### 4.4 `POST /api/soar/integrations/identity/enable-user`
```json
{ "upn": "user@corp.com", "incidentId": "…" }
```

### 4.5 `POST /api/soar/integrations/notify/slack`
```json
{ "channel": "#soc-alerts", "message": "…", "incidentId": "…" }
```

### 4.6 `POST /api/soar/integrations/email/send`
```json
{
  "to": "analyst@corp.com",
  "subject": "…",
  "body": "…",
  "incidentId": "…"
}
```
SMTP من vault — **مطلوب لـ email workflows**.

**Auth:** JWT أو `X-Internal-Api-Key` لكل integration routes.

---

## 5. P0 — Cases (مش موجود في الرفرنس)

الـ UI يفرّق بين **Case** (تحقيق) و **Alert** (حدث). مطلوب CRUD كامل:

| Method | Endpoint | Body / Notes |
|--------|----------|--------------|
| `GET` | `/api/soar/cases` | `?page&limit&status&severity` |
| `GET` | `/api/soar/cases/:id` | includes `alerts[]`, `timeline`, `artifacts` |
| `POST` | `/api/soar/cases` | see schema below |
| `PATCH` | `/api/soar/cases/:id` | |
| `DELETE` | `/api/soar/cases/:id` | soft-delete مفضّل |

**POST/PATCH schema:**
```json
{
  "title": "string",
  "description": "string",
  "severity": "low|medium|high|critical",
  "status": "open|investigating|contained|resolved|closed",
  "priority": "p1|p2|p3|p4",
  "assigneeId": "userId",
  "tags": ["brute-force", "network"],
  "artifacts": ["file.csv", { "type": "ip", "value": "1.2.3.4" }],
  "timeline": [{ "time": "ISO", "event": "string" }]
}
```

**قرار معماري:** إما `cases` منفصلة عن `incidents` مع `incident.caseId`، أو دمجهم — لو دمج، وثّق أن `GET /incidents` يرجع النوعين.

---

## 6. P0 — Alerts (توسيع الموجود)

| Method | Endpoint | الحالة |
|--------|----------|--------|
| `GET` | `/api/soar/alerts` | ✅ موجود |
| `GET` | `/api/soar/alerts/:id` | ✅ موجود |
| `POST` | `/api/soar/alerts` | ❌ **مطلوب** |
| `PATCH` | `/api/soar/alerts/:id` | ❌ **مطلوب** |
| `DELETE` | `/api/soar/alerts/:id` | ❌ **مطلوب** |

**POST schema:**
```json
{
  "title": "string",
  "description": "string",
  "source": "splunk|crowdstrike|manual|…",
  "severity": "low|medium|high|critical",
  "status": "new|triaging|investigating|escalated|closed|false_positive",
  "caseId": "optional",
  "raw": { "source_ip": "…", "hostname": "…" },
  "iocs": [{ "type": "ip", "value": "1.2.3.4" }],
  "dedupKey": "optional"
}
```

**Side effect:** alert جديد قد يُشغّل playbooks تلقائياً (§7.4).

---

## 7. P1 — Workflows (محرك الأتمتة — graph)

`/api/soar/playbooks` عندك **ليس** نفس **Workflow Builder** (nodes + edges JSON).

### 7.1 CRUD

| Method | Endpoint |
|--------|----------|
| `GET` | `/api/soar/workflows` |
| `GET` | `/api/soar/workflows/:id` |
| `POST` | `/api/soar/workflows` |
| `PATCH` | `/api/soar/workflows/:id` |
| `DELETE` | `/api/soar/workflows/:id` |

**Workflow document:**
```json
{
  "name": "IP Enrichment",
  "description": "…",
  "status": "draft|active|paused|archived",
  "nodes": [
    {
      "id": "n1",
      "type": "trigger|action|condition|output",
      "subtype": "manual|virustotal|slack|block|…",
      "position": { "x": 0, "y": 0 },
      "data": {
        "label": "VT Lookup",
        "config": { "subtype": "virustotal", "ioc_type": "ip", "ioc_value": "{{trigger.ip}}" }
      }
    }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "label": "Yes" }
  ],
  "trigger": { "type": "manual|alert|webhook|schedule" },
  "tags": ["enrichment"],
  "requiresApproval": false,
  "maxExecutionsPerHour": 100
}
```

### 7.2 التنفيذ

| Method | Endpoint | Body |
|--------|----------|------|
| `POST` | `/api/soar/workflows/:id/execute` | `{ "trigger": { "ip": "…" }, "testRun": false }` |
| `GET` | `/api/soar/workflow-executions` | `?workflowId&status` |
| `GET` | `/api/soar/workflow-executions/:id` | logs + outputs |

**Response execute:**
```json
{
  "executionId": "…",
  "mode": "inline|queue",
  "status": "running|queued|completed|failed"
}
```

### 7.3 محرك التنفيذ (يجب أن يعيش على الباك اند بالكامل)

ينفّذ على الأقل هذه الـ node subtypes (من Connector SDK):

`virustotal`, `abuseipdb`, `slack`, `email`, `block`, `isolate`, `crowdstrike`,
`fortigate`, `pfsense`, `opnsense`, `entra_id`, `condition`, `log`, `http`,
`webhook`, `telegram`, `opencti`, `elastic`, `splunk`, `teams`, `pagerduty`, …

**قواعد:**
- Parameter templating: `{{trigger.ip}}`, `{{outputs.n2.virustotal.score}}`
- Retry + timeout per node
- Audit كل execution
- Queue worker (BullMQ/Redis أو Mongo queue) للإنتاج

### 7.4 `POST /api/soar/internal/alert-trigger` (service only)

**Auth:** `X-Internal-Api-Key` فقط

```json
{ "alertId": "…", "severity": "high", "source": "…", "raw": {} }
```
يطابق alerts جديدة بـ workflows ذات trigger `alert` ويشغّلها.

### 7.5 ربط Playbooks الإجرائية

| Method | Endpoint |
|--------|----------|
| `PATCH` | `/api/soar/playbooks/:id` — حقل `workflowId` |
| `POST` | `/api/soar/playbooks/:id/execute` — يشغّل الـ workflow المربوط |

---

## 8. P1 — Approvals

| Method | Endpoint |
|--------|----------|
| `GET` | `/api/soar/approvals` — `?status=pending` |
| `GET` | `/api/soar/approvals/:id` |
| `POST` | `/api/soar/approvals` |
| `POST` | `/api/soar/approvals/:id/approve` |
| `POST` | `/api/soar/approvals/:id/reject` |

**POST create:**
```json
{
  "action": "block_ip|isolate_host|disable_user|reset_password|firewall_rule",
  "targetType": "ip|host|user",
  "targetValue": "203.0.113.42",
  "reason": "…",
  "riskLevel": "medium|high|critical",
  "workflowExecutionId": "optional",
  "incidentId": "optional",
  "expiresInSeconds": 86400
}
```

**عند approve:** ينفّذ الإجراء فعلياً (نفس routing §3.3).

---

## 9. P1 — Connectors / Integrations

عندك `/api/soar/connectors`. **أضف/وثّق:**

### 9.1 `GET /api/soar/connectors/:id/actions`
يرجع actions المدعومة لكل connector (مثلاً `block_ip`, `isolate_host`, `enrich_ip`).

### 9.2 توحيد مع Vault
- Secrets في `/api/soar/vault` — الـ connectors يقرأوا منه.
- `POST /api/soar/connectors/:id/test` — يحدّث `status: connected|disconnected|error`.

### 9.3 قائمة أنواع connectors المطلوبة (minimum)

`virustotal`, `abuseipdb`, `slack`, `email`, `fortigate`, `pfsense`, `opnsense`,
`crowdstrike`, `entra_id`, `msgraph`, `splunk`, `elastic`, `telegram`, `opencti`,
`wazuh`, `teams`, `shodan`, `greynoise`

---

## 10. P2 — Nodes registry (Connector SDK / Workflow palette)

| Method | Endpoint |
|--------|----------|
| `GET` | `/api/soar/nodes` — `?category=threat_intel` |
| `GET` | `/api/soar/nodes/:id` |
| `GET` | `/api/soar/nodes/:id/openapi` — OpenAPI 3.1 لكل node |

**Manifest shape (لكل node):**
```json
{
  "id": "virustotal",
  "name": "VirusTotal Lookup",
  "version": "2.0.0",
  "category": "threat_intel",
  "config": [{ "key": "ioc_type", "type": "select", "options": ["ip","hash","domain"] }],
  "credentials": [{ "kind": "api_key", "vaultKey": "api_key" }],
  "retry": { "maxAttempts": 3 },
  "timeout": { "ms": 30000 }
}
```

---

## 11. P2 — Attack patterns (MITRE)

| Method | Endpoint |
|--------|----------|
| `GET` | `/api/soar/attack-patterns` — `?q=&page&limit` |
| `GET` | `/api/soar/attack-patterns/:id` |
| `POST` | `/api/soar/attack-patterns/map` |

**POST map:**
```json
{
  "caseId": "optional",
  "alertId": "optional",
  "incidentId": "optional",
  "techniqueId": "T1110",
  "confidence": 0.8
}
```

---

## 12. RBAC + Permissions

**Roles:** `superadmin`, `admin`, `analyst`, `responder`, `viewer`, `api`

| Permission | يستخدم في |
|------------|-----------|
| `incident:read` | GET incidents/summary/recommendations |
| `incident:write` | PATCH incident, notes |
| `incident:respond` | POST respond (أو per-action أدناه) |
| `contain:block_ip` | block_ip |
| `contain:isolate_host` | isolate_host |
| `contain:disable_user` | disable_user |
| `case:read/write/delete` | cases |
| `alert:read/write` | alerts |
| `workflow:read/write/execute/delete` | workflows |
| `connector:read/write/test` | connectors |
| `approval:request/approve/reject` | approvals |
| `audit:read` | audit logs |

---

## 13. P2 — Auth (توحيد مع UI)

| Method | Endpoint | ملاحظة |
|--------|----------|--------|
| `GET` | `/api/auth/me` | **alias** لـ `/api/auth/profile` — نفس الـ response |
| `POST` | `/api/auth/logout` | invalidate token/session |

**Login response (موجود):** `{ data: { token, user: { _id, email, role } } }`

---

## 14. P2 — System

### 14.1 `GET /api/soar/system/status`
```json
{
  "database": { "ok": true },
  "queue": { "ok": true, "mode": "bullmq" },
  "connectors": { "connected": 12, "total": 28 },
  "workers": { "ok": true }
}
```

### 14.2 `GET /api/soar/audit` — `?resource=incident&resourceId=…`
قراءة audit log (صلاحية `audit:read`).

---

## 15. P2 — Webhook ديناميكي للـ workflows

| Method | Endpoint |
|--------|----------|
| `POST` | `/api/soar/webhooks/incoming/:hookId` |

HMAC signature اختياري. يمرّر body كـ `trigger` لـ workflow مربوط.

*(عندك webhooks لـ crowdstrike/splunk/… — أضف generic hook للـ builder)*

---

## 16. ما يُلغى من فولدر الـ UI بعد التنفيذ

| مسار UI الحالي | البديل على الباك اند |
|----------------|----------------------|
| `/api/cases/*` | `/api/soar/cases/*` |
| `/api/alerts/*` | `/api/soar/alerts/*` |
| `/api/incidents/:id` | `/api/soar/incidents/:id/summary` |
| `/api/incidents/:id/respond` | `/api/soar/incidents/:id/respond` |
| `/api/workflows/*` | `/api/soar/workflows/*` |
| `/api/workflow-executions/*` | `/api/soar/workflow-executions/*` |
| `/api/integrations/*` | `/api/soar/connectors/*` + vault |
| `/api/playbooks/*` | `/api/soar/playbooks/*` |
| `/api/approvals/*` | `/api/soar/approvals/*` |
| `/api/nodes/*` | `/api/soar/nodes/*` |
| `/api/attack-patterns/*` | `/api/soar/attack-patterns/*` |
| `/api/dashboard` | `/api/soar/dashboard/overview` (+ sub) |
| `/api/auth/me` | `/api/auth/profile` أو alias |
| Executors في `src/lib/executors/*` | **ينقل كامل** لباك اند |
| `src/lib/incidents/*` | **ينقل كامل** لباك اند |

**فولدر الـ UI بعد الدمج:** `fetch(LUMISEC_API_URL + '/api/soar/...')` فقط.

---

## 17. خطة تنفيذ مقترحة للباك اند

### Sprint 1 (P0)
1. Cases CRUD
2. Alerts POST/PATCH/DELETE
3. `recommendations` + `respond` + `summary`
4. Integration actions: threat-intel, identity, slack, email

### Sprint 2 (P1)
5. Workflows CRUD + execute + executions
6. Workflow engine (core nodes)
7. Approvals
8. Alert → workflow auto-trigger

### Sprint 3 (P2)
9. Nodes registry
10. Attack patterns
11. System status + audit read
12. OpenAPI update + Postman collection v2

---

## 18. مراجع كود (للنقل — ليس للتشغيل من UI)

| Logic | مسار في فولدر UI (ينقل للباك اند) |
|-------|----------------------------------|
| IOC parsing | `src/lib/incidents/parse-context.ts` |
| Recommended actions | `src/lib/incidents/recommended-actions.ts` |
| Action execution | `src/lib/incidents/run-action.ts` |
| Workflow engine | `src/lib/executors/engine.ts` + `nodes/*` |
| Connector SDK | `src/lib/soar/nodes/*`, `docs/soar/CONNECTOR-SDK.md` |
| RBAC | `src/lib/auth.ts` |

---

## 19. تحديث Postman

بعد التنفيذ: أضف folder **"SOAR — Missing (v2)"** في collection جديد يغطي الـ 48 endpoint أعلاه.

---

*آخر تحديث: يونيو 2026 — مبني على مقارنة `SOAR_API_Reference.md` مع فولدر UI الحالي.*
