# Backend Merge Guide — دمج فولدر Next.js مع الباك اند الخارجي

> **اقرأ قبل الدمج.**  
> **مرجع API الباك اند الرسمي (Zamil):** [`SOAR_API_Reference.md`](reference/SOAR_API_Reference.md)  
> **مواصفات الناقص للتنفيذ (أرسلها للباك اند):** [`BACKEND-IMPLEMENTATION-SPEC.md`](reference/BACKEND-IMPLEMENTATION-SPEC.md)  
> **خريطة المقارنة:** [`../API-ALIGNMENT.md`](../API-ALIGNMENT.md)

---

## 1. الوضع الحالي (ثلاث طبقات — لا تخلط)

```
┌─────────────────────────────┐
│  A) LumiSec Backend المنشور │  /api/soar/*  — 79 endpoints — JWT + Mongo
│     (فولدر الزميل)           │  block-ip, isolate-host, incidents, playbooks
└──────────────▲──────────────┘
               │  LUMISEC_API_URL + LUMISEC_INTERNAL_API_KEY
               │  (src/lib/lumisec-api/client.ts)
┌──────────────┴──────────────┐
│  B) فولدر UI (Next.js دا)    │  /api/cases, /api/incidents/:id/respond
│     Prisma + workflow engine  │  UI + BFF مؤقت حتى الدمج
└──────────────▲──────────────┘
               │  NEXT_PUBLIC_EXTERNAL_API_URL (اختياري)
┌──────────────┴──────────────┐
│  C) mini-services/soar-backend│  /api/incidents mirror + Shuffle /api/v1
└─────────────────────────────┘
```

| المصدر الحقيقي (بعد الدمج النهائي) | أين اليوم |
|-----------------------------------|-----------|
| Incidents + containment | **LumiSec** `/api/soar/*` |
| Cases / Alerts (انتقالي) | Prisma في Next.js |
| Workflows + Executions | Prisma + engine (ينتقل أو يُستدعى عبر gateway) |
| Connectors config | **LumiSec** `/api/soar/connectors` + `/vault` |
| Auth | **Gateway JWT** (`/api/auth/login`) |
| Event mirror / Shuffle | mini-services (طبقة C) |

---

## 2. ما أُضيف هنا ومش موجود في الباك اند الخارجي بعد

هذه إضافات من جلسات الـ UI/SOAR — **لازم تتعامل معاها وقت الدمج**:

### أ) Incident Response (جديد — أولوية عالية)

| مكوّن | المسار | في الباك اند الخارجي؟ |
|--------|--------|------------------------|
| تحليل سياق الحادث | `src/lib/incidents/parse-context.ts` | ❌ |
| إجراءات مقترحة ديناميكية | `src/lib/incidents/recommended-actions.ts` | ❌ |
| تنفيذ إجراء (block/isolate/VT/…) | `src/lib/incidents/run-action.ts` | ❌ |
| تحميل case + alerts مدمجة | `src/lib/incidents/load-context.ts` | ❌ |
| API تفاصيل + respond | `src/app/api/incidents/[id]/*` | ❌ (فقط CRUD بسيط) |
| مزامنة للخارج | `src/lib/incidents/sync-external.ts` | ✅ جزئي (mirror + event) |

**قرار الدمج المقترح:**

- **المرحلة 1 (الحالية):** التنفيذ يبقى في Next.js؛ الباك اند يستقبل `incident_action_executed` + `POST /api/incidents/:id/mirror`.
- **المرحلة 2:** نقل `recommended-actions` + `parse-context` لمكتبة مشتركة (`packages/soar-domain`) يستوردها الطرفان.
- **المرحلة 3 (اختياري):** `POST /api/incidents/:id/respond` في Express يستدعي نفس الـ engine عبر `POST /api/internal/workflow-run` أو worker.

### ب) Auth + UI

| مكوّن | المسار | ملاحظة للدمج |
|--------|--------|----------------|
| Login / sessions | `src/app/api/auth/*`, `AuthProvider` | الباك اند يستخدم `X-API-Key` فقط — وحّد JWT أو gateway |
| SoarApp modular | `src/components/soar/*` | UI فقط — لا ينقل للباك اند |
| Email workflow fixes | `executors/nodes/email.ts`, seed | تأكد إن نفس الـ executor موجود في الفولدر التاني |

### ج) Connectors / Wave 1

| مكوّن | المسار |
|--------|--------|
| Connector SDK | `docs/soar/CONNECTOR-SDK.md` |
| Certified nodes | `src/lib/soar/nodes/wave1-certified.ts` |
| OSS catalog | `docs/soar/connectors/OSS-CATALOG.md` |

إذا الباك اند التاني فيه نسخة قديمة من الـ executors — **قارن ملف بملف** قبل overwrite.

---

## 3. خريطة الـ Endpoints — تجنب التعارض

### Next.js فقط (لا تحذفها عند الدمج)

```
POST   /api/auth/login|logout
GET    /api/auth/me
GET    /api/incidents/:id              ← تفاصيل + recommendations (جديد)
POST   /api/incidents/:id/respond      ← تنفيذ إجراء (جديد)
GET    /api/workflows, /api/cases, /api/alerts, ...
POST   /api/workflow-executions
POST   /api/integrations/test
GET    /api/system/status
```

### الباك اند الخارجي

```
GET    /api/info, /api/health
GET|POST|PUT|DELETE  /api/incidents
POST   /api/incidents/:id/mirror       ← جديد — mirror من Next.js
GET    /api/assets
GET    /api/threat-intel/lookup
POST   /api/soar-events                ← يقبل incident_action_executed الآن
GET|POST /api/v1/*                     ← Shuffle-compatible
```

### Proxies في Next.js (للـ UI بدون CORS)

```
GET /api/external/incidents|assets|health|info|threat-intel
```

**قاعدة:** الـ UI يتصل دائماً بـ **Next.js**؛ Next.js يقرر يخدم محلياً أو يدمج مع الخارج.

---

## 4. ربط الهوية بين النظامين

عند `POST /api/cases`، Next.js يدفع للخارج:

```json
{ "soarCaseId": "case-2", "title": "...", "severity": "high", "source": "soar" }
```

احفظ في Mongo:

- `soarCaseId` = معرف Prisma
- `_id` أو `id` في Mongo قد يختلف

عند incident respond:

1. `forwardSoarEvent({ type: 'incident_action_executed', ... })`
2. `POST /api/incidents/{caseId}/mirror` لتحديث status + timeline

**عند الدمج:** أضف جدول/حقل `externalIncidentId` في Prisma Case لو الـ IDs مختلفة.

---

## 5. خطوات الدمج المقترحة (Checklist)

### قبل الدمج

- [ ] صدّر `.env` من الفولدرين (URLs, keys, Mongo, Prisma DB)
- [ ] شغّل `npm test` في Next.js (126 tests)
- [ ] شغّل health على الباك اند: `GET /api/health`
- [ ] فعّل `NEXT_PUBLIC_EXTERNAL_API_URL` واختبر Settings → External backend Connected

### أثناء الدمج

- [ ] **لا** تحذف `src/lib/incidents/*` — انقلها لـ `packages/` أو انسخ للباك اند
- [ ] وحّد `forwardSoarEvent` types في الطرفين (`incident_action_executed`)
- [ ] وحّد نماذج Incident في Mongo مع حقول `timeline`, `tags`, `artifacts`, `soarCaseId`
- [ ] قرر: executors في Next فقط أم shared package
- [ ] قرر: Prisma يبقى لـ cases أم يتحول كله Mongo (غير موصى به قصير المدى)

### بعد الدمج

- [ ] Incident Detail → Recommended Actions تعمل مع integrations متصلة
- [ ] `case_created` / `incident_action_executed` تظهر في `GET /api/soar-events`
- [ ] Threat Ops يعرض cases + external incidents مدمجة
- [ ] Workflow execution عبر المسار المختار (inline / shuffle / bullmq)

---

## 6. متغيرات البيئة الموحّدة

```bash
# LumiSec production backend (Zamil) — أولوية بعد الدمج
LUMISEC_API_URL=https://api.your-gateway.example
LUMISEC_INTERNAL_API_KEY=same-as-service_api_key-in-postman

# Optional: force UI BFF to read incidents from LumiSec (future)
SOAR_DATA_SOURCE=lumisec   # lumisec | local

# Legacy mirror / Shuffle (طبقة C)
NEXT_PUBLIC_EXTERNAL_API_URL=http://localhost:4000
EXTERNAL_API_KEY=...

# Local dev DB (طبقة B)
DATABASE_URL=file:./dev.db
```

---

## 7. ملفات مرجعية

| ملف | الغرض |
|-----|--------|
| `docs/soar/API-ALIGNMENT.md` | **مقارنة 79 endpoint مع فولدر UI** |
| `docs/soar/reference/SOAR_API_Reference.md` | مرجع Zamil |
| `docs/soar/reference/LumiSec_SOAR.postman_collection.json` | Postman |
| `src/lib/lumisec-api/client.ts` | عميل `/api/soar/*` |
| `src/lib/incidents/sync-external.ts` | مزامنة بعد respond |
| `docs/AI_AGENT_BRIEFING.md` | Shuffle patterns + workers |
| `docs/soar/ARCHITECTURE.md` | معمارية كاملة |
| `mini-services/soar-backend/README.md` | تشغيل الباك اند المحلي |

---

## 8. أسئلة قرار (حلّوها قبل merge نهائي)

1. **أين يعيش التنفيذ؟** Next engine vs worker في الباك اند؟
2. **هل Mongo أو Prisma هو master للـ incidents؟** (الموصى به: Prisma للعمليات، Mongo للمرآة والأحداث)
3. **Auth واحد؟** JWT من Next يمر على Express middleware؟
4. **هل الباك اند المنشور عنده `/api/v1` Shuffle؟** إذا نعم — اربط `SHUFFLE_BACKEND_URL`.

---

*آخر تحديث: يونيو 2026 — بعد إضافة Incident Response + sync-external*
