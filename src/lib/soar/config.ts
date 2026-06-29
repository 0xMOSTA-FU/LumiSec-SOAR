/** Platform runtime flags */

export type ExecutionMode = 'inline' | 'shuffle' | 'bullmq';

/** @deprecated Prefer getExecutionMode() === 'shuffle' */
export function useQueueExecution(): boolean {
  return getExecutionMode() === 'shuffle';
}

export function getExecutionMode(): ExecutionMode {
  const explicit = (process.env.SOAR_EXECUTION_MODE || '').toLowerCase();
  if (explicit === 'bullmq') return 'bullmq';
  if (explicit === 'shuffle') return 'shuffle';
  if (explicit === 'inline') return 'inline';
  // Legacy flag
  if (process.env.SOAR_QUEUE_EXECUTION === '1' || process.env.SOAR_QUEUE_EXECUTION === 'true') {
    return 'shuffle';
  }
  return 'inline';
}

export function useBullMqExecution(): boolean {
  return getExecutionMode() === 'bullmq';
}

export function isRedisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}
