// Prepare workflow execution — snapshot + queue (Shuffle walkoff pattern)

import { randomUUID } from 'crypto';
import {
  getShuffleWorkflowModel,
  getWorkflowExecutionModel,
  getExecutionQueueModel,
  shuffleUseMongo,
  getShuffleMemory,
} from './models.js';

function generateToken() {
  return randomUUID().replace(/-/g, '');
}

export async function prepareWorkflowExecution({
  workflowId,
  orgId = 'default',
  environment = 'default',
  priority = 3,
  executionArgument = {},
  startNodeId,
}) {
  let workflow;
  if (shuffleUseMongo()) {
    workflow = await getShuffleWorkflowModel().findOne({ id_: workflowId }).lean();
  } else {
    workflow = getShuffleMemory().workflows.find(w => w.id_ === workflowId);
  }
  if (!workflow) {
    const err = new Error('Workflow not found');
    err.status = 404;
    throw err;
  }

  const executionId = randomUUID();
  const snapshot = JSON.parse(JSON.stringify(workflow));
  if (startNodeId) snapshot.start = startNodeId;

  const execution = {
    id_: executionId,
    workflow_id: workflowId,
    org_id: orgId,
    status: 'EXECUTING',
    workflow: snapshot,
    results: [],
    authorization: generateToken(),
    execution_argument: executionArgument,
    started_at: new Date(),
    completed_at: null,
    logs: [],
  };

  const queueItem = {
    execution_id: executionId,
    workflow_id: workflowId,
    org_id: orgId,
    environment,
    priority,
    status: 'pending',
  };

  if (shuffleUseMongo()) {
    await getWorkflowExecutionModel().create(execution);
    await getExecutionQueueModel().create(queueItem);
  } else {
    getShuffleMemory().executions.push(execution);
    getShuffleMemory().queue.push(queueItem);
  }

  return { execution, queueItem };
}

export async function getExecution(executionId) {
  if (shuffleUseMongo()) {
    return getWorkflowExecutionModel().findOne({ id_: executionId }).lean();
  }
  return getShuffleMemory().executions.find(e => e.id_ === executionId) ?? null;
}

export async function appendActionResult(executionId, { action_id, result, status }) {
  const entry = {
    action_id,
    result,
    status: status || 'SUCCESS',
    completed_at: new Date(),
  };

  if (shuffleUseMongo()) {
    await getWorkflowExecutionModel().updateOne(
      { id_: executionId },
      { $push: { results: entry } },
    );
  } else {
    const ex = getShuffleMemory().executions.find(e => e.id_ === executionId);
    if (ex) ex.results.push(entry);
  }
  return entry;
}

export async function finishExecution(executionId, status, extra = {}) {
  const patch = {
    status,
    completed_at: new Date(),
    ...extra,
  };
  if (shuffleUseMongo()) {
    await getWorkflowExecutionModel().updateOne({ id_: executionId }, { $set: patch });
  } else {
    const ex = getShuffleMemory().executions.find(e => e.id_ === executionId);
    if (ex) Object.assign(ex, patch);
  }
}

export async function pollQueue(environment, limit = 50) {
  const query = { environment, status: 'pending' };
  if (shuffleUseMongo()) {
    return getExecutionQueueModel()
      .find(query)
      .sort({ priority: -1, created_at: 1 })
      .limit(limit)
      .lean();
  }
  return getShuffleMemory().queue
    .filter(q => q.environment === environment && q.status === 'pending')
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

export async function markQueueProcessing(executionIds) {
  if (shuffleUseMongo()) {
    await getExecutionQueueModel().updateMany(
      { execution_id: { $in: executionIds } },
      { $set: { status: 'processing' } },
    );
  } else {
    for (const id of executionIds) {
      const q = getShuffleMemory().queue.find(x => x.execution_id === id);
      if (q) q.status = 'processing';
    }
  }
}

export async function confirmQueue(executionIds) {
  if (shuffleUseMongo()) {
    await getExecutionQueueModel().updateMany(
      { execution_id: { $in: executionIds } },
      { $set: { status: 'done' } },
    );
  } else {
    for (const id of executionIds) {
      const q = getShuffleMemory().queue.find(x => x.execution_id === id);
      if (q) q.status = 'done';
    }
  }
}
