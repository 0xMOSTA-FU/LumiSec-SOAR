// Cron scheduler — fires workflow executions on schedule (Shuffle pattern)

import cron from 'node-cron';
import { randomUUID } from 'crypto';
import {
  getScheduleModel,
  shuffleUseMongo,
  getShuffleMemory,
} from './models.js';
import { prepareWorkflowExecution } from './execution.service.js';

const jobs = new Map();

async function listActiveSchedules() {
  if (shuffleUseMongo()) {
    return getScheduleModel().find({ active: true }).lean();
  }
  return getShuffleMemory().schedules.filter(s => s.active);
}

async function runSchedule(schedule) {
  console.log(`[scheduler] firing workflow ${schedule.workflow_id} (cron=${schedule.cron})`);
  try {
    await prepareWorkflowExecution({
      workflowId: schedule.workflow_id,
      orgId: schedule.org_id || 'default',
      executionArgument: schedule.argument || {},
      startNodeId: schedule.start_node_id || undefined,
      priority: 3,
    });
    if (shuffleUseMongo()) {
      await getScheduleModel().updateOne(
        { id_: schedule.id_ },
        { $set: { last_run_at: new Date() } },
      );
    } else {
      const s = getShuffleMemory().schedules.find(x => x.id_ === schedule.id_);
      if (s) s.last_run_at = new Date();
    }
  } catch (e) {
    console.error(`[scheduler] failed workflow ${schedule.workflow_id}:`, e.message);
  }
}

function registerJob(schedule) {
  if (jobs.has(schedule.id_)) {
    jobs.get(schedule.id_).stop();
    jobs.delete(schedule.id_);
  }
  if (!schedule.active || !cron.validate(schedule.cron)) {
    console.warn(`[scheduler] invalid or inactive schedule ${schedule.id_}: ${schedule.cron}`);
    return;
  }
  const task = cron.schedule(schedule.cron, () => runSchedule(schedule));
  jobs.set(schedule.id_, task);
  console.log(`[scheduler] registered ${schedule.id_} → ${schedule.cron}`);
}

export async function initScheduler() {
  const schedules = await listActiveSchedules();
  for (const s of schedules) registerJob(s);
  console.log(`[scheduler] ${jobs.size} active cron job(s)`);
}

export async function upsertSchedule(schedule) {
  if (shuffleUseMongo()) {
    await getScheduleModel().findOneAndUpdate(
      { id_: schedule.id_ },
      { $set: schedule },
      { upsert: true },
    );
  } else {
    const mem = getShuffleMemory();
    const idx = mem.schedules.findIndex(s => s.id_ === schedule.id_);
    if (idx >= 0) mem.schedules[idx] = schedule;
    else mem.schedules.push(schedule);
  }
  registerJob(schedule);
  return schedule;
}

export async function deleteSchedule(scheduleId) {
  if (jobs.has(scheduleId)) {
    jobs.get(scheduleId).stop();
    jobs.delete(scheduleId);
  }
  if (shuffleUseMongo()) {
    await getScheduleModel().deleteOne({ id_: scheduleId });
  } else {
    getShuffleMemory().schedules = getShuffleMemory().schedules.filter(s => s.id_ !== scheduleId);
  }
}

export function createScheduleDoc({ workflowId, cronExpr, orgId, argument, startNodeId }) {
  return {
    id_: randomUUID(),
    org_id: orgId || 'default',
    workflow_id: workflowId,
    cron: cronExpr,
    start_node_id: startNodeId || '',
    argument: argument || {},
    active: true,
    last_run_at: null,
  };
}
