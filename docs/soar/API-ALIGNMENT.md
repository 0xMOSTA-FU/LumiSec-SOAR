# API Alignment — UI Folder ↔ LumiSec Backend (Colleague)

> **المرجع الرسمي من فريق الباك اند:**  
> `docs/soar/reference/SOAR_API_Reference.md`  
> `docs/soar/reference/LumiSec_SOAR.postman_collection.json`

**79 endpoint** تحت prefix **`/api/soar/*`** على الـ API Gateway (مش بالضرورة نفس مسارات فولدر الـ UI الحالي).

---

## 1. ثلاث طبقات — لا تخلط بينهم

| طبقة | Prefix | الغرض | الحالة |
|------|--------|--------|--------|
| **A) LumiSec Backend (المنشور)** | `/api/soar/*` | Incidents, connectors, playbooks, firewall/EDR actions | **مرجع الزميل — المصدر بعد الدمج** |
| **B) فولدر UI الحالي (Next.js)** | `/api/cases`, `/api/workflows`, `/api/incidents/:id/respond` | تطوير محلي + engine + UI | **مؤقت / BFF حتى الدمج** |
| **C) mini-services/soar-backend** | `/api/incidents` (بدون soar) | Mirror + Shuffle + events | **مساعد — ليس نفس API الزميل** |

```
┌──────────────────┐     JWT / X-Internal-Api-Key      ┌─────────────────────────┐
│  React UI        │ ───────────────────────────────► │  LumiSec API Gateway    │
│  (هذا الفولدر)   │     /api/soar/*                  │  (فولدر الباك اند)      │
└────────┬─────────┘                                  └─────────────────────────┘
         │ dev / fallback
         ▼
┌──────────────────┐
│  Next.js BFF     │  /api/cases, /api/incidents/[id]/respond
│  + Prisma engine │
└──────────────────┘
```

---

## 2. Auth — فرق مهم

| | LumiSec Backend | فولدر UI الحالي |
|---|-----------------|-----------------|
| Login | `POST /api/auth/login` → `{ data: { token, user } }` | `POST /api/auth/login` → cookie session |
| Profile | `GET /api/auth/profile` | `GET /api/auth/me` |
| Service calls | `X-Internal-Api-Key` أو `x-service-key` | `WORKER_API_KEY` على internal routes |
| Response shape | `{ data: { _id, ... } }` (Mongo) | Prisma objects / flat JSON |

**عند الدمج:** وحّد الـ UI على JWT من gateway، أو خلّي Next.js BFF يترجم cookie → JWT للباك اند.

---

## 3. خريطة Incidents — الأهم للـ merge

### الباك اند (Zamil) — `/api/soar/incidents`

| Method | Endpoint | الوظيفة |
|--------|----------|---------|
| GET | `/api/soar/incidents` | قائمة (page, limit) |
| GET | `/api/soar/incidents/:id` | تفاصيل |
| GET | `/api/soar/incidents/:id/timeline` | Timeline منفصل |
| GET | `/api/soar/incidents/:id/artifacts` | Artifacts |
| GET | `/api/soar/incidents/:id/notes` | ملاحظات |
| GET | `/api/soar/incidents/:id/related` | مرتبطة |
| POST | `/api/soar/incidents` | إنشاء |
| PATCH | `/api/soar/incidents/:id` | تحديث |
| PATCH | `/api/soar/incidents/:id/close` | إغلاق |
| POST | `/api/soar/incidents/:id/notes` | إضافة note |
| POST | `/api/soar/incidents/:id/playbooks/run` | تشغيل playbook |
| POST | `/api/soar/incidents/:incidentId/playbook/:playbookId` | playbook محدد |

### فولدر UI الحالي — مسارات مختلفة

| Method | Endpoint | ملاحظة |
|--------|----------|--------|
| GET | `/api/cases`, `/api/alerts` | Prisma — ليس `/api/soar/incidents` |
| GET | `/api/incidents/:id` | **BFF مجمّع** (cases+alerts+recommendations) — **لا يوجد في مرجع الزميل** |
| POST | `/api/incidents/:id/respond` | **إجراءات موحّدة** — **لا يوجد في مرجع الزميل** |

**قرار الدمج:**

- إما **نقل** `GET /api/incidents/:id` logic للباك اند كـ `GET /api/soar/incidents/:id` + sub-resources  
- أو **BFF** في Next يجمع sub-resources من `/api/soar/incidents/:id/*` للـ UI

---

## 4. Containment actions — أين التنفيذ الحقيقي؟

| إجراء UI (`respond`) | LumiSec Backend | فولدر UI (engine محلي) |
|---------------------|-----------------|-------------------------|
| `block_ip` | `POST /api/soar/integrations/firewall/block-ip` `{ ip, comment, incidentId }` | `executeBlock` → FortiGate/pfSense |
| `isolate_host` | `POST /api/soar/integrations/edr/isolate-host` `{ host, os, incidentId }` | `executeIsolate` → CrowdStrike |
| | `POST /api/soar/integrations/network/isolate-host` (SSH/WinRM) | — |
| `run_enrichment_playbook` | `POST /api/soar/incidents/:id/playbooks/run` | `startWorkflowExecution` wf-5 |
| `enrich_ip` / `scan_hash` | `POST /api/soar/artifacts/:id/enrich` | VirusTotal executor |
| `mark_contained` | `PATCH .../close` أو `PATCH` status | تحديث Prisma case |

**تم تجهيز:** `src/lib/lumisec-api/client.ts` — لما تضبط:

```bash
LUMISEC_API_URL=https://your-gateway
LUMISEC_INTERNAL_API_KEY=...
```

الإجراءات `block_ip`, `isolate_host`, `run_enrichment_playbook`, `mark_*` تتوجّه تلقائياً لـ API الزميل (بدل الـ executors المحلية).

---

## 5. جدول موارد كامل — موجود / ناقص في UI folder

| مجموعة LumiSec | Endpoints | في UI folder؟ |
|----------------|-----------|---------------|
| Incidents | 16 | ⚠️ جزئي — BFF مختلف |
| Analytics | 4 | ❌ UI محلي فقط |
| Artifacts | 6 | ❌ |
| Connectors | 7 | ⚠️ `/api/integrations` مختلف |
| Playbooks | 5 | ⚠️ `/api/playbooks` + `/api/workflows` |
| Playbook Runs | 5 | ⚠️ `/api/workflow-executions` |
| Vault | 5 | ❌ |
| Dashboard | 6 | ⚠️ `/api/dashboard` واحد |
| Notifications | 4 | ❌ |
| Webhooks | 6 | ⚠️ `/api/webhook/[path]` |
| GRC / UCTC / Phishing | 5 | ❌ |
| SIEM / Firewall / Network / EDR | 5 | ⚠️ داخل workflow executors فقط |
| Alerts | 2 | ✅ `/api/alerts` (مسار مختلف) |

---

## 6. Naming collisions — تجنبها وقت الدمج

| مفهوم | LumiSec Backend | UI Folder |
|-------|-----------------|-----------|
| Incident ID | Mongo `_id` | `case-1` / `alert-2` (Prisma) |
| Connector | `/api/soar/connectors` | `/api/integrations` |
| Playbook | `/api/soar/playbooks` | `/api/playbooks` + `workflows` |
| Workflow run | `/api/soar/playbook-runs` | `workflow-executions` |

احفظ mapping table في DB: `soarCaseId` ↔ `lumisecIncidentId`.

---

## 7. خطوات عملية للفريق

### للباك اند (Zamil)

1. تأكيد Joi schemas لـ `block-ip`, `isolate-host`, `playbooks/run` (Postman فيها placeholders).
2. إضافة endpoint موحّد اختياري: `POST /api/soar/incidents/:id/respond` يوجّه داخلياً لـ firewall/edr/playbooks — أو اعتماد الـ client الحالي.
3. `GET /api/soar/incidents/:id/recommendations` — نقل logic من `recommended-actions.ts` (أو استيراد shared package).
4. OpenAPI: `GET /api/soar/docs/openapi.json` — مرجع للـ UI codegen.

### للـ UI (هذا الفولدر)

1. ضبط `LUMISEC_API_URL` + `LUMISEC_INTERNAL_API_KEY` في staging.
2. تحويل `IncidentDetailView` ليقرأ من `/api/soar/incidents/:id/*` عند `SOAR_DATA_SOURCE=lumisec`.
3. توحيد Auth: login يخزّن JWT + cookie.
4. Postman collection في `docs/soar/reference/` — regression tests.

### Checklist اختبار بعد الربط

- [ ] Login → JWT في Postman يعمل على gateway
- [ ] `GET /api/soar/incidents` يرجع بيانات
- [ ] Incident Detail → Block IP يضرب `/integrations/firewall/block-ip`
- [ ] `playbooks/run` يشتغل من Recommended Actions
- [ ] IDs متطابقة أو mapping table شغال

---

## 8. ملفات الكود ذات الصلة

| ملف | الدور |
|-----|--------|
| `src/lib/lumisec-api/client.ts` | عميل API الزميل |
| `src/lib/incidents/run-action.ts` | يفوّض لـ LumiSec لو env مضبوط |
| `src/lib/external-api.ts` | mini-services mirror (طبقة C) |
| `docs/soar/BACKEND-MERGE.md` | دليل دمج الفولدرين |

---

*مستند حي — حدّثه لما Zamil يضيف endpoints أو يثبّت الـ schemas.*
