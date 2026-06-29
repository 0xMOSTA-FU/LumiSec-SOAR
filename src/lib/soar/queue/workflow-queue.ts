/**
 * BullMQ workflow execution queue — durable, retryable job processing.
 */
import { Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import { WORKFLOW_QUEUE_NAME, type WorkflowJobPayload } from './types';
import { isRedisEnabled } from '../config';

let workflowQueue: Queue<WorkflowJobPayload> | null = null;

export function getWorkflowQueue(): Queue<WorkflowJobPayload> {
  if (!isRedisEnabled()) {
    throw new Error('BullMQ requires REDIS_URL');
  }
  if (!workflowQueue) {
    workflowQueue = new Queue<WorkflowJobPayload>(WORKFLOW_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return workflowQueue;
}

export async function enqueueWorkflowJob(payload: WorkflowJobPayload): Promise<string> {
  const queue = getWorkflowQueue();
  const job = await queue.add('run', payload, { jobId: payload.executionId });
  return job.id || payload.executionId;
}

export async function getWorkflowQueueStats() {
  const queue = getWorkflowQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}
