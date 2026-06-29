# AI Agent Briefing — من Shuffle إلى LumiSec SOAR

> **اقرأ هذا الملف أولاً قبل أي كود.**  
> يوجّه الـ AI agent لدمج أنماط **Shuffle** في مشروعنا بـ **Node.js + MongoDB + React/Next.js**.

## القرار الأساسي

| Layer | التقنية |
|-------|---------|
| Frontend | Next.js + React (WorkflowBuilder) |
| Backend API | Node.js Express (`mini-services/soar-backend`) + Next.js API routes |
| Database | MongoDB (workflows, executions, queue, apps) + Prisma (cases/alerts) |
| Queue / Worker | **BullMQ + Redis** (`SOAR_EXECUTION_MODE=bullmq`) أو Mongo queue + `soar-worker` (`shuffle`) |
| Events | Redis pub/sub `soar:events` + `soar-event-processor` → alert triggers workflows |
| Execution | Worker → Next.js engine (27 executors حقيقية) |

## لا تنسخ من Shuffle

- ❌ Go backend كـ API رئيسي
- ❌ OpenSearch
- ❌ `shuffle-shared` import
- ❌ Frontend copy-paste كامل

## نعم — انقل الأنماط

- ✅ نفس مسارات API: `/api/v1/workflows`, `/api/v1/streams/results`, `/api/v1/workflows/queue`
- ✅ Workflow document: `actions[]`, `branches[]`, `triggers[]`, `conditions[]`
- ✅ Parameter templating: `$exec.field`, `$action_name.field`, `{{trigger.ip}}`
- ✅ Execution snapshot + queue async
- ✅ Webhook hooks: `POST /api/v1/hooks/:id`

## المعمارية

```
React/Next.js UI ──► /api/v1/* (proxy) ──► soar-backend (MongoDB)
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
   soar-worker          soar-bull-worker    soar-event-processor
   (shuffle queue)      (BullMQ/Redis)      (alert → workflows)
         │                    │                    │
         └────────────────────┴────────────────────┘
                              ▼
              POST /api/internal/workflow-run (Next.js engine)
```

## مراجع

| ملف | الاستخدام |
|-----|-----------|
| `TECHNICAL_DOCUMENTATION_AR.md` (Shuffle) | APIs §7, §21 — execution flow §6 |
| `docs/soar/ARCHITECTURE.md` | معمارية LumiSec الحالية |
| `docs/soar/BACKEND-MERGE.md` | **دمج فولدر Next.js مع الباك اند الخارجي — اقرأه قبل merge** |
| `docs/soar/reference/BACKEND-IMPLEMENTATION-SPEC.md` | **مواصفات كاملة للـ endpoints الناقصة — للباك اند** |
| `docs/soar/API-ALIGNMENT.md` | **مقارنة 79 endpoint (Zamil) مع فولدر UI** |
| `src/lib/shuffle/adapter.ts` | تحويل nodes/edges ↔ Shuffle format |

## متغيرات البيئة

```bash
# soar-backend
PORT=5001
MONGODB_URI=mongodb://localhost:27017/soar
WORKER_API_KEY=...
NEXT_APP_URL=http://localhost:3000

# worker
BACKEND_URL=http://localhost:5001
ENVIRONMENT_NAME=default
ORG_ID=default

# Next.js
SHUFFLE_BACKEND_URL=http://localhost:5001
WORKER_API_KEY=...  # same as backend

# Phase 2 — durable execution (BullMQ + events)
REDIS_URL=redis://localhost:6379
SOAR_EXECUTION_MODE=inline   # inline | shuffle | bullmq
SOAR_QUEUE_EXECUTION=1       # legacy alias → shuffle mode
BULL_WORKER_CONCURRENCY=5
```

*آخر تحديث: يونيو 2026*
