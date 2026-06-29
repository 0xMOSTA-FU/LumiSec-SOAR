# LumiSec SOAR — API Reference

> **Team handoff (DevOps · Backend · Frontend):** [`TEAM-HANDOFF.md`](TEAM-HANDOFF.md)  
> **Base URL (dev):** `http://localhost:3000`  
> **آخر تحديث:** يونيو 2026

---

## المحتويات

1. [نظرة عامة](#نظرة-عامة)
2. [المصادقة](#المصادقة)
3. [Gateway API — `/api/soar/*`](#gateway-api--apisoar)
4. [Legacy REST API — `/api/*`](#legacy-rest-api--api)
5. [Webhooks — `/api/webhook/*`](#webhooks--apiwebhook)
6. [Auth — `/api/auth/*`](#auth--apiauth)
7. [Governance — `/api/approvals`](#governance--apiapprovals)
8. [Platform & Internal](#platform--internal)
9. [External Proxies](#external-proxies)
10. [Health & Metrics](#health--metrics)
11. [أكواد الأخطاء الشائعة](#أكواد-الأخطاء-الشائعة)

---

## نظرة عامة

المنصة تعمل بوضعين:

| الوضع | الوصف | الـ UI الافتراضي |
|--------|--------|------------------|
| **Gateway** | `NEXT_PUBLIC_SOAR_GATEWAY=1` (افتراضي) | يستخدم `/api/soar/*` عبر BFF |
| **Legacy** | `NEXT_PUBLIC_SOAR_GATEWAY=0` | يستخدم `/api/*` مباشرة |

### تنسيق الاستجابة — Gateway

```json
{
  "success": true,
  "data": { },
  "message": "optional"
}
```

عند الخطأ:

```json
{
  "success": false,
  "message": "Human-readable message",
  "error": "ERROR_CODE"
}
```

### Pagination (Gateway)

Query: `?page=1&limit=20` (حد أقصى `limit=100`)

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 42,
      "totalPages": 3
    }
  }
}
```

### تنسيق الاستجابة — Legacy

غالباً **مصفوفة أو كائن مباشر** بدون envelope `{ success, data }` — ما عدا بعض المسارات الحديثة.

### المصادقة

- **Session cookie:** `soar_session` (بعد `POST /api/auth/login`)
- **API Key:** `Authorization: Bearer <key>` أو `X-API-Key`
- كل مسار محمي بـ **RBAC permissions** (انظر `src/lib/auth.ts`)

### Tenant scoping

البيانات معزولة حسب `tenantId` للمستخدم. Superadmin يرى كل الـ tenants.

---

## Gateway API — `/api/soar/*`

**Entry point:** `src/app/api/soar/[...path]/route.ts` → `src/lib/soar-api/router.ts`

> Alias: `/api/soar/cases/*` يُحوَّل تلقائياً إلى `/api/soar/incidents/*`

---

### Incidents (Cases)

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/incidents` | `CASE_READ` | قائمة incidents مع pagination |
| `POST` | `/api/soar/incidents` | `CASE_WRITE` | إنشاء incident |
| `GET` | `/api/soar/incidents/:id` | `CASE_READ` | تفاصيل incident |
| `PATCH`/`PUT` | `/api/soar/incidents/:id` | `CASE_WRITE` | تحديث (status, severity, assigned_to, …) |
| `DELETE` | `/api/soar/incidents/:id` | `CASE_DELETE` | حذف |
| `PATCH` | `/api/soar/incidents/:id/close` | `CASE_CLOSE` | إغلاق incident |
| `GET` | `/api/soar/incidents/:id/timeline` | `CASE_READ` | سجل الأحداث |
| `GET` | `/api/soar/incidents/:id/notes` | `CASE_READ` | الملاحظات |
| `POST` | `/api/soar/incidents/:id/notes` | `CASE_WRITE` | إضافة ملاحظة |
| `GET` | `/api/soar/incidents/:id/artifacts` | `CASE_READ` | artifacts المرتبطة |
| `POST` | `/api/soar/incidents/:id/artifacts` | `CASE_WRITE` | إضافة artifact |
| `GET` | `/api/soar/incidents/:id/related` | `CASE_READ` | incidents مرتبطة |
| `POST` | `/api/soar/incidents/:id/related` | `CASE_WRITE` | ربط incident آخر |
| `GET` | `/api/soar/incidents/:id/summary` | `CASE_READ` | ملخص تنفيذي |
| `GET` | `/api/soar/incidents/:id/recommendations` | `CASE_READ` | إجراءات مقترحة |
| `POST` | `/api/soar/incidents/:id/respond` | حسب `actionId` | تنفيذ إجراء استجابة |
| `POST` | `/api/soar/incidents/:id/playbooks/run` | `WORKFLOW_EXECUTE` | تشغيل playbook على incident |

**Query `GET /incidents`:** `status`, `severity`, `assigned_to`, `date_from`, `date_to`, `page`, `limit`

**Body `POST /incidents`:**
```json
{
  "title": "string",
  "severity": "low|medium|high|critical",
  "description": "string?",
  "assigned_to": "user-id?",
  "source": "string?",
  "source_alert_id": "alert-id?"
}
```

**Body `POST /incidents/:id/respond`:**
```json
{
  "actionId": "block_ip|isolate_host|enrich_ip|scan_hash|disable_user|notify_soc_slack|run_enrichment_playbook|mark_investigating|mark_contained",
  "params": { "ip": "1.2.3.4" },
  "approvalId": "optional-for-destructive-actions"
}
```

> الإجراءات التدميرية تتطلب **approval** و**blast-radius check**. أخطاء: `428 APPROVAL_REQUIRED`, `429 BLAST_RADIUS_EXCEEDED`, `422 INTEGRATION_REQUIRED`

**Body `POST /incidents/:id/playbooks/run`:**
```json
{ "playbook_id": "cuid" }
```

---

### Alerts

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/alerts` | `ALERT_READ` | قائمة alerts |
| `POST` | `/api/soar/alerts` | `ALERT_WRITE` | إنشاء / ingest alert |
| `GET` | `/api/soar/alerts/:id` | `ALERT_READ` | تفاصيل + raw_event + related incidents |
| `PATCH`/`PUT` | `/api/soar/alerts/:id` | `ALERT_WRITE` | تحديث status/severity |
| `DELETE` | `/api/soar/alerts/:id` | `ALERT_WRITE` | حذف |

**Query:** `page`, `limit`

---

### Connectors (Integrations inbound)

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/connectors` | `INTEGRATION_READ` | قائمة connectors |
| `POST` | `/api/soar/connectors` | `INTEGRATION_WRITE` | إنشاء connector |
| `GET` | `/api/soar/connectors/:id` | `INTEGRATION_READ` | تفاصيل (config مموّه) |
| `PATCH`/`PUT` | `/api/soar/connectors/:id` | `INTEGRATION_WRITE` | تحديث |
| `DELETE` | `/api/soar/connectors/:id` | `INTEGRATION_DELETE` | حذف |
| `POST` | `/api/soar/connectors/:id/test` | `INTEGRATION_TEST` | اختبار الاتصال |
| `GET` | `/api/soar/connectors/:id/actions` | `INTEGRATION_READ` | كتالوج actions المتاحة |

**Body `POST`:**
```json
{
  "name": "FortiGate Edge",
  "type": "fortigate",
  "description": "optional",
  "config": { "host": "...", "api_key": "..." }
}
```

---

### Vault (Secrets)

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/vault` | `INTEGRATION_READ` | قائمة الأسرار (بدون القيم) |
| `POST` | `/api/soar/vault` | `INTEGRATION_WRITE` | إنشاء سر |
| `GET` | `/api/soar/vault/:id` | `INTEGRATION_READ` | metadata |
| `PATCH`/`PUT` | `/api/soar/vault/:id` | `INTEGRATION_WRITE` | تحديث |
| `DELETE` | `/api/soar/vault/:id` | `INTEGRATION_DELETE` | حذف |
| `GET` | `/api/soar/vault/:id/reveal` | `INTEGRATION_READ` | كشف القيمة (مرة واحدة) |

---

### Artifacts

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/artifacts` | `EVIDENCE_READ` | قائمة global artifacts |
| `POST` | `/api/soar/artifacts` | `EVIDENCE_WRITE` | إنشاء artifact |
| `GET` | `/api/soar/artifacts/:id` | `EVIDENCE_READ` | تفاصيل |
| `PATCH` | `/api/soar/artifacts/:id` | `EVIDENCE_WRITE` | تحديث TLP/type/value |
| `DELETE` | `/api/soar/artifacts/:id` | `EVIDENCE_WRITE` | حذف |
| `POST` | `/api/soar/artifacts/:id/enrich` | `WORKFLOW_EXECUTE` | enrich واحد (VT/IPInfo/AbuseIPDB) |
| `POST` | `/api/soar/artifacts/enrich/bulk` | `WORKFLOW_EXECUTE` | enrich جماعي |

**Query `GET`:** `page`, `limit`, `search`

---

### Playbooks

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/playbooks` | `WORKFLOW_READ` | قائمة playbooks |
| `POST` | `/api/soar/playbooks` | `WORKFLOW_WRITE` | إنشاء |
| `GET` | `/api/soar/playbooks/:id` | `WORKFLOW_READ` | تفاصيل |
| `PATCH`/`PUT` | `/api/soar/playbooks/:id` | `WORKFLOW_WRITE` | تحديث (+ `workflow_id`) |
| `DELETE` | `/api/soar/playbooks/:id` | `WORKFLOW_DELETE` | حذف |

**Body `POST`/`PATCH`:**
```json
{
  "name": "Block Malicious IP",
  "description": "optional",
  "workflow_id": "workflow-cuid",
  "steps": [{ "type": "block_ip", "order": 0, "params": {} }],
  "triggers": [{ "type": "manual" }],
  "status": "active"
}
```

> التنفيذ الفعلي يتم عبر workflow مربوط — استخدم `POST /api/playbooks/:id/execute` (legacy) أو `POST /api/soar/incidents/:id/playbooks/run`

---

### Playbook Runs (Workflow Executions)

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/playbook-runs` | `WORKFLOW_READ` | قائمة runs |
| `GET` | `/api/soar/playbook-runs/:id` | `WORKFLOW_READ` | تفاصيل + steps + enrichment |
| `POST` | `/api/soar/playbook-runs/:id/pause` | `WORKFLOW_EXECUTE` | إيقاف مؤقت |
| `POST` | `/api/soar/playbook-runs/:id/resume` | `WORKFLOW_EXECUTE` | استئناف |
| `POST` | `/api/soar/playbook-runs/:id/cancel` | `WORKFLOW_EXECUTE` | إلغاء |

**Query `GET`:** `playbook_id`, `page`, `limit` — يستبعد `testRun` من الـ builder

---

### Dashboard

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/dashboard/overview` | `CASE_READ` | KPIs: open incidents, critical, MTTR, executions, … |
| `GET` | `/api/soar/dashboard/incidents` | `CASE_READ` | incidents حديثة |
| `GET` | `/api/soar/dashboard/playbooks` | `WORKFLOW_READ` | ملخص playbooks |
| `GET` | `/api/soar/dashboard/automation` | `WORKFLOW_READ` | success rate / triggered count |
| `GET` | `/api/soar/dashboard/analysts` | `CASE_READ` | محللو SOC |
| `GET` | `/api/soar/dashboard/connectors` | `INTEGRATION_READ` | حالة connectors |

---

### Analytics

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/analytics/kpis?days=7\|14\|30\|90` | `CASE_READ` | مؤشرات KPI |
| `GET` | `/api/soar/analytics/snapshots?days=` | `CASE_READ` | سلاسل زمنية |
| `GET` | `/api/soar/analytics/report?days=` | `CASE_READ` | تقرير نصي/جداول |
| `POST` | `/api/soar/analytics/export` | `CASE_READ` | تصدير CSV/JSON |

**Body `POST /export`:**
```json
{ "format": "csv|json", "days": 30 }
```

---

### Notifications

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/notifications/unread-count` | `CASE_READ` | عدد غير المقروء |
| `GET` | `/api/soar/notifications` | `CASE_READ` | قائمة (pagination) |
| `PATCH` | `/api/soar/notifications/read-all` | `CASE_WRITE` | تعليم الكل مقروء |
| `PATCH` | `/api/soar/notifications/:id/read` | `CASE_WRITE` | تعليم واحد مقروء |

> تُنشأ تلقائياً عند ingest alert جديد أو فتح incident

---

### Webhook Sources (Registry)

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/webhook-sources` | `INTEGRATION_READ` | مصادر مسجّلة |
| `POST` | `/api/soar/webhook-sources` | `INTEGRATION_WRITE` | تسجيل مصدر |
| `PATCH` | `/api/soar/webhook-sources/:id` | `INTEGRATION_WRITE` | تحديث (enabled, workflow_id, name) |
| `DELETE` | `/api/soar/webhook-sources/:id` | `INTEGRATION_WRITE` | حذف |

**Body `POST`:**
```json
{
  "name": "Production CrowdStrike",
  "slug": "crowdstrike",
  "workflow_id": "optional",
  "secret": "optional-hmac-secret",
  "enabled": true
}
```

**URL الفعلي للاستقبال:** `POST /api/webhook/{slug}`

---

### Outbound Integration Actions

| Method | Endpoint | Permission | الحالة |
|--------|----------|------------|--------|
| `POST` | `/api/soar/integrations/siem/event` | `INTEGRATION_WRITE` | ✅ ingest alert حقيقي |
| `POST` | `/api/soar/integrations/elastic/event` | `INTEGRATION_WRITE` | ✅ ingest من Elastic Security |
| `POST` | `/api/soar/integrations/elastic/poll` | `INTEGRATION_WRITE` | ✅ poll كل connectors `elastic` المتصلة |
| `POST` | `/api/soar/integrations/modules/incident` | `INTEGRATION_WRITE` | ✅ reverse ingest من GRC/UCTC/Phishing/LumiNet |
| `POST` | `/api/soar/integrations/network/block-ip` | `CONTAIN_BLOCK_IP` | ✅ مع governance |
| `POST` | `/api/soar/integrations/network/isolate-host` | `CONTAIN_ISOLATE_HOST` | ✅ مع governance |
| `POST` | `/api/soar/integrations/firewall/block-ip` | `CONTAIN_BLOCK_IP` | ✅ مع governance |
| `POST` | `/api/soar/integrations/edr/isolate-host` | `CONTAIN_ISOLATE_HOST` | ✅ مع governance |
| `POST` | `/api/soar/integrations/threat-intel/enrich-ip` | `WORKFLOW_EXECUTE` | ✅ |
| `POST` | `/api/soar/integrations/threat-intel/scan-hash` | `WORKFLOW_EXECUTE` | ✅ |
| `POST` | `/api/soar/integrations/notify/slack` | `INTEGRATION_WRITE` | ✅ |
| `POST` | `/api/soar/integrations/notify/email` | `INTEGRATION_WRITE` | ✅ SMTP connector |
| `POST` | `/api/soar/integrations/notify/telegram` | `INTEGRATION_WRITE` | ✅ bot + chat_id map |
| `POST` | `/api/soar/integrations/grc/finding` | `INTEGRATION_WRITE` | ✅ عبر `LUMISEC_PLATFORM_URL` |
| `POST` | `/api/soar/integrations/grc/risk` | `INTEGRATION_WRITE` | ✅ عبر monolith |
| `POST` | `/api/soar/integrations/uctc/rule` | `INTEGRATION_WRITE` | ✅ عبر monolith |
| `POST` | `/api/soar/integrations/uctc/rule-trigger` | `INTEGRATION_WRITE` | ✅ عبر monolith |
| `POST` | `/api/soar/integrations/phishing/campaign` | `INTEGRATION_WRITE` | ✅ عبر monolith |

**مثال `block-ip`:**
```json
{
  "ip": "203.0.113.99",
  "incidentId": "optional",
  "reason": "SOAR automated block",
  "approvalId": "optional"
}
```

---

### System

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/soar/system/status` | `INTEGRATION_READ` | حالة DB + workflow engine |
| `GET` | `/api/soar/platform/status` | `INTEGRATION_READ` | probe `LUMISEC_PLATFORM_URL` |

**جدولة Elastic poll (داخلي):** `POST /api/internal/jobs/elastic-poll` مع `Authorization: Bearer SOAR_INTERNAL_API_KEY`

---

## Legacy REST API — `/api/*`

يُستخدم عندما `NEXT_PUBLIC_SOAR_GATEWAY=0` أو من Workflow Builder مباشرة.

### Workflows

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/workflows` | `WORKFLOW_READ` | قائمة workflows |
| `POST` | `/api/workflows` | `WORKFLOW_WRITE` | إنشاء |
| `PUT` | `/api/workflows` | `WORKFLOW_WRITE` | تحديث (يتطلب `id` في body) |
| `DELETE` | `/api/workflows?id=` | `WORKFLOW_DELETE` | حذف |
| `POST` | `/api/workflows/:id/shuffle` | `WORKFLOW_WRITE` | تصدير/تكامل Shuffle |

### Workflow Executions

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `POST` | `/api/workflow-executions` | `WORKFLOW_EXECUTE` | بدء تنفيذ workflow |
| `GET` | `/api/workflow-executions` | `WORKFLOW_READ` | قائمة executions |
| `GET` | `/api/workflow-executions/:id` | `WORKFLOW_READ` | تفاصيل + enrichment + node outputs |

**Body `POST`:**
```json
{
  "workflowId": "cuid",
  "trigger": { "ip": "8.8.8.8" },
  "testRun": false
}
```

### Playbooks (Legacy)

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/playbooks` | `WORKFLOW_READ` | قائمة |
| `POST` | `/api/playbooks` | `WORKFLOW_WRITE` | إنشاء |
| `PUT` | `/api/playbooks` | `WORKFLOW_WRITE` | تحديث |
| `DELETE` | `/api/playbooks?id=` | `WORKFLOW_DELETE` | حذف |
| `POST` | `/api/playbooks/:id/execute` | `WORKFLOW_EXECUTE` | تشغيل workflow المربوط |

**Body `POST /execute`:**
```json
{ "trigger": { "ip": "1.2.3.4" } }
```

### Cases

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/cases` | `CASE_READ` | قائمة (camelCase) |
| `POST` | `/api/cases` | `CASE_WRITE` | إنشاء |
| `PUT` | `/api/cases` | `CASE_WRITE` | تحديث |
| `DELETE` | `/api/cases?id=` | `CASE_DELETE` | حذف |

### Alerts (Legacy)

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/alerts` | `ALERT_READ` | قائمة |
| `POST` | `/api/alerts` | `ALERT_WRITE` | إنشاء |
| `PUT` | `/api/alerts` | `ALERT_WRITE` | تحديث |
| `DELETE` | `/api/alerts?id=` | `ALERT_WRITE` | حذف |
| `GET` | `/api/alerts/:id/raw` | `ALERT_READ` | raw payload |

### Integrations (Legacy)

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/integrations` | `INTEGRATION_READ` | قائمة |
| `POST` | `/api/integrations` | `INTEGRATION_WRITE` | إنشاء |
| `PUT` | `/api/integrations` | `INTEGRATION_WRITE` | تحديث |
| `DELETE` | `/api/integrations?id=` | `INTEGRATION_DELETE` | حذف |
| `GET` | `/api/integrations/:id` | `INTEGRATION_READ` | تفاصيل |
| `PUT` | `/api/integrations/:id` | `INTEGRATION_WRITE` | تحديث جزئي |
| `POST` | `/api/integrations/test` | `INTEGRATION_TEST` | اختبار credentials |

### Incidents (Legacy respond)

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/incidents/:id` | `CASE_READ` | سياق incident كامل |
| `POST` | `/api/incidents/:id/respond` | حسب action | نفس governed respond (بدون envelope) |

### Dashboard & Analytics (Legacy)

| Method | Endpoint | الوصف |
|--------|----------|--------|
| `GET` | `/api/dashboard` | metrics legacy للـ UI القديم |
| `GET` | `/api/analytics?days=30` | analytics view |

### Nodes & Attack Patterns

| Method | Endpoint | الوصف |
|--------|----------|--------|
| `GET` | `/api/nodes` | كتالوج node executors |
| `GET` | `/api/nodes/:id/openapi` | OpenAPI schema للـ node |
| `GET` | `/api/attack-patterns` | MITRE / attack patterns |
| `POST` | `/api/attack-patterns` | إضافة pattern |

### Seed

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `POST` | `/api/seed` | `USER_WRITE` | بيانات demo (معطّل في production) |
| `POST` | `/api/seed?force=1` | `USER_WRITE` | إعادة seed كاملة |

---

## Webhooks — `/api/webhook/*`

| Method | Endpoint | Auth | الوصف |
|--------|----------|------|--------|
| `POST` | `/api/webhook/:slug` | HMAC / API key | تشغيل workflow أو ingest alert |
| `GET` | `/api/webhook/:slug` | — | health/ping |

**Query:** `?workflow=<workflowId>` (اختياري إذا مُعرَّف في WebhookSource)

**Auth headers (أحدها):**
1. `X-Webhook-Signature: t=<unix>,v1=<hmac-sha256>` (مُفضّل)
2. `X-Webhook-Key: <secret>`
3. `?key=<secret>` (legacy — غير مُوصى به)

**Slugs المدمجة:** `crowdstrike`, `defender`, `fortigate`, `splunk`, `wazuh`, `custom`, + المصادر المسجّلة في DB

**Body:** JSON حر — يُمرَّر كـ `trigger` للـ workflow أو يُ normalّ كـ alert

---

## Auth — `/api/auth/*`

| Method | Endpoint | الوصف |
|--------|----------|--------|
| `POST` | `/api/auth/login` | `{ email, password }` → session cookie |
| `POST` | `/api/auth/logout` | إنهاء الجلسة |
| `GET` | `/api/auth/me` | المستخدم الحالي + roles + permissions |

**مستخدم dev افتراضي:** `admin@soar.local` / `admin123`

---

## Governance — `/api/approvals`

| Method | Endpoint | Permission | الوصف |
|--------|----------|------------|--------|
| `GET` | `/api/approvals?status=pending` | `APPROVAL_REQUEST` | قائمة الموافقات |
| `POST` | `/api/approvals` | `APPROVAL_REQUEST` | طلب موافقة لإجراء تدميري |
| `POST` | `/api/approvals/:id/approve` | `APPROVAL_APPROVE` | موافقة |
| `POST` | `/api/approvals/:id/reject` | `APPROVAL_REJECT` | رفض |

---

## Platform & Internal

| Method | Endpoint | Auth | الوصف |
|--------|----------|------|--------|
| `POST` | `/api/platform/graduation-demo` | Session | demo TI enrichment (يتطلب `NEXT_PUBLIC_SOAR_DEMO_CATALOG=1`) |
| `POST` | `/api/platform/quick-fix` | Session | إصلاحات تشخيصية سريعة |
| `POST` | `/api/internal/workflow-run` | Internal key | تشغيل workflow من worker |
| `POST` | `/api/internal/trigger-alert-workflows` | Internal key | ربط alerts بـ workflows |

### Proxies

| Method | Endpoint | الوصف |
|--------|----------|--------|
| `*` | `/api/gateway/[...path]` | Proxy لـ remote SOAR backend |
| `*` | `/api/v1/[...path]` | Proxy لـ Shuffle SOAR backend |
| `GET` | `/api/system/gateway` | معلومات وضع الـ gateway |

---

## External Proxies

تتطلب `NEXT_PUBLIC_EXTERNAL_API_URL` — تُمرِّر للـ backend الخارجي:

| Method | Endpoint | الوصف |
|--------|----------|--------|
| `GET` | `/api/external/health` | health الخدمة الخارجية |
| `GET` | `/api/external/info` | معلومات الإصدار |
| `GET` | `/api/external/threat-intel?ioc=` | بحث threat intel |
| `GET` | `/api/external/incidents` | incidents من backend خارجي |
| `GET` | `/api/external/assets` | assets |

---

## Health & Metrics

| Method | Endpoint | الوصف |
|--------|----------|--------|
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/health?check=ready` | Readiness (DB check) |
| `GET` | `/api/metrics` | Prometheus-style metrics |
| `GET` | `/api` | API root / version info |
| `GET` | `/api/system/status` | حالة النظام التفصيلية |

---

## أكواد الأخطاء الشائعة

| HTTP | Code | المعنى |
|------|------|--------|
| `401` | — | غير مصادق |
| `403` | — | صلاحية غير كافية |
| `404` | — | المورد غير موجود |
| `422` | `INTEGRATION_REQUIRED` | connector غير مُفعَّل |
| `428` | `APPROVAL_REQUIRED` | إجراء تدميري يحتاج موافقة |
| `429` | `BLAST_RADIUS_EXCEEDED` | تجاوز حد الإجراءات |
| `501` | — | تكامل خارجي غير مُكوَّن (GRC/UCTC/Phishing) |
| `502` | — | فشل تنفيذ الإجراء / integration |

---

## متغيرات البيئة ذات الصلة

```env
# Gateway
NEXT_PUBLIC_SOAR_GATEWAY=1
NEXT_PUBLIC_SOAR_USE_REMOTE_GATEWAY=0

# Demo (اختياري)
NEXT_PUBLIC_SOAR_DEMO_CATALOG=0

# Dev governance bypass (لا تستخدم في production)
SOAR_APPROVAL_BYPASS=1
SOAR_ALLOW_DRY_RUN=1

# Database
DATABASE_URL=file:./prisma/dev.db
```

---

## ملاحظات للمطورين

1. **الـ UI الافتراضي (Gateway)** يستهلك `/api/soar/*` عبر `src/lib/lumisec-api/browser/*`
2. **Workflow Builder** يستخدم `/api/workflows` و `/api/workflow-executions` مباشرة
3. **Envelope helpers:** `src/lib/lumisec-api/browser/envelope.ts`
4. **Router المصدر:** `src/lib/soar-api/router.ts`
5. عند إضافة endpoint جديد — أضفه هنا وفي `router.ts` أو `src/app/api/`
