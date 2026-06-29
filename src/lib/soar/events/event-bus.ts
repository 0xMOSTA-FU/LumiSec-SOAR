/**
 * Redis pub/sub event bus — decouples alert ingestion from workflow triggering.
 */
import { createRedisSubscriber, getRedisConnection } from '../queue/connection';
import { isRedisEnabled } from '../config';
import { SOAR_EVENTS_CHANNEL, type SoarEvent } from './types';

export async function publishSoarEvent(event: SoarEvent): Promise<boolean> {
  if (!isRedisEnabled()) return false;
  const redis = getRedisConnection();
  await redis.publish(SOAR_EVENTS_CHANNEL, JSON.stringify(event));
  return true;
}

export function subscribeSoarEvents(
  handler: (event: SoarEvent) => void | Promise<void>,
): { close: () => Promise<void> } {
  if (!isRedisEnabled()) {
    throw new Error('REDIS_URL is required for event subscription');
  }
  const sub = createRedisSubscriber();
  sub.subscribe(SOAR_EVENTS_CHANNEL).catch(err => {
    console.error('[event-bus] subscribe failed:', err.message);
  });
  sub.on('message', (_channel, message) => {
    try {
      const event = JSON.parse(message) as SoarEvent;
      void Promise.resolve(handler(event)).catch(err => {
        console.error('[event-bus] handler error:', err.message);
      });
    } catch (err) {
      console.error('[event-bus] invalid message:', err);
    }
  });
  return {
    close: async () => {
      await sub.unsubscribe(SOAR_EVENTS_CHANNEL).catch(() => {});
      await sub.quit().catch(() => {});
    },
  };
}
