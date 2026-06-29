/**
 * SOAR event processor — subscribes to Redis pub/sub and triggers workflows.
 *
 * Env:
 *   REDIS_URL=redis://localhost:6379
 *   NEXT_APP_URL=http://localhost:3000
 *   WORKER_API_KEY=...
 */

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const NEXT_APP_URL = (process.env.NEXT_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const WORKER_API_KEY = process.env.WORKER_API_KEY || '';
const CHANNEL = 'soar:events';

const sub = new Redis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });

async function handleAlertCreated(payload, tenantId) {
  const res = await fetch(`${NEXT_APP_URL}/api/internal/trigger-alert-workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(WORKER_API_KEY ? { Authorization: `Bearer ${WORKER_API_KEY}` } : {}),
    },
    body: JSON.stringify({ ...payload, tenantId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.reason || `trigger-alert-workflows HTTP ${res.status}`);
  }
  console.log(`[event-processor] alert ${payload.alertId} → ${json.matched} workflow(s)`);
}

sub.subscribe(CHANNEL, err => {
  if (err) console.error('[event-processor] subscribe error:', err.message);
  else console.log(`[event-processor] subscribed to ${CHANNEL}`);
});

sub.on('message', (_channel, message) => {
  let event;
  try {
    event = JSON.parse(message);
  } catch {
    console.warn('[event-processor] invalid JSON');
    return;
  }

  if (event.type === 'alert.created') {
    handleAlertCreated(event.payload, event.tenantId).catch(err => {
      console.error('[event-processor] alert.created handler:', err.message);
    });
  }
});

console.log(`[event-processor] redis=${REDIS_URL} next=${NEXT_APP_URL}`);

async function shutdown() {
  await sub.unsubscribe(CHANNEL).catch(() => {});
  await sub.quit().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
