/**
 * BullMQ worker — consumes soar-workflow-executions jobs.
 *
 * Env:
 *   REDIS_URL=redis://localhost:6379
 *   NEXT_APP_URL=http://localhost:3000
 *   WORKER_API_KEY=...
 *   BULL_WORKER_CONCURRENCY=5
 */

import { Worker } from 'bullmq';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const NEXT_APP_URL = (process.env.NEXT_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const WORKER_API_KEY = process.env.WORKER_API_KEY || '';
const CONCURRENCY = Number(process.env.BULL_WORKER_CONCURRENCY) || 5;
const QUEUE_NAME = 'soar-workflow-executions';

const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

async function processJob(job) {
  const data = job.data;
  console.log(`[bull-worker] job ${job.id} execution=${data.executionId} workflow=${data.workflowId}`);

  const res = await fetch(`${NEXT_APP_URL}/api/internal/workflow-run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(WORKER_API_KEY ? { Authorization: `Bearer ${WORKER_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      executionId: data.executionId,
      workflowId: data.workflowId,
      workflowName: data.workflowName,
      nodes: data.nodes,
      edges: data.edges,
      trigger: data.trigger,
      tenantId: data.tenantId,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.reason || json.error || `Engine HTTP ${res.status}`);
  }
  return json;
}

const worker = new Worker(QUEUE_NAME, processJob, {
  connection,
  concurrency: CONCURRENCY,
});

worker.on('completed', (job, result) => {
  console.log(`[bull-worker] completed ${job.id} success=${result?.success}`);
});

worker.on('failed', (job, err) => {
  console.error(`[bull-worker] failed ${job?.id}:`, err.message);
});

console.log(`[bull-worker] listening on ${QUEUE_NAME} redis=${REDIS_URL} next=${NEXT_APP_URL} concurrency=${CONCURRENCY}`);

async function shutdown() {
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
