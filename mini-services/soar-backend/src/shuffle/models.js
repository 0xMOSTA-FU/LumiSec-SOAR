// Mongoose models for Shuffle-compatible SOAR API (MongoDB primary store)

import mongoose from 'mongoose';

const ShuffleWorkflowSchema = new mongoose.Schema({
  id_: { type: String, required: true, unique: true, index: true },
  org_id: { type: String, index: true, default: 'default' },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  start: { type: String, default: '' },
  is_valid: { type: Boolean, default: false },
  actions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  branches: { type: [mongoose.Schema.Types.Mixed], default: [] },
  conditions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  triggers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  transforms: { type: [mongoose.Schema.Types.Mixed], default: [] },
  workflow_variables: { type: [mongoose.Schema.Types.Mixed], default: [] },
  tags: { type: [String], default: [] },
  lumisec_nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
  lumisec_edges: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const WorkflowExecutionSchema = new mongoose.Schema({
  id_: { type: String, required: true, unique: true, index: true },
  workflow_id: { type: String, required: true, index: true },
  org_id: { type: String, index: true, default: 'default' },
  status: {
    type: String,
    enum: ['EXECUTING', 'FINISHED', 'FAILED', 'ABORTED', 'WAITING'],
    default: 'EXECUTING',
    index: true,
  },
  workflow: { type: mongoose.Schema.Types.Mixed, required: true },
  results: { type: [mongoose.Schema.Types.Mixed], default: [] },
  authorization: { type: String, default: '' },
  execution_argument: { type: mongoose.Schema.Types.Mixed, default: {} },
  started_at: { type: Date, default: Date.now },
  completed_at: { type: Date, default: null },
  logs: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: false });

const ExecutionQueueSchema = new mongoose.Schema({
  execution_id: { type: String, required: true, unique: true, index: true },
  workflow_id: { type: String, required: true, index: true },
  org_id: { type: String, index: true, default: 'default' },
  environment: { type: String, default: 'default', index: true },
  priority: { type: Number, default: 3, index: true },
  status: {
    type: String,
    enum: ['pending', 'processing', 'done'],
    default: 'pending',
    index: true,
  },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

const HookSchema = new mongoose.Schema({
  id_: { type: String, required: true, unique: true, index: true },
  org_id: { type: String, index: true, default: 'default' },
  workflow_id: { type: String, required: true, index: true },
  start_node_id: { type: String, default: '' },
  type: { type: String, default: 'webhook' },
  name: { type: String, default: 'Webhook' },
  secret: { type: String, default: '' },
  active: { type: Boolean, default: true },
}, { timestamps: true });

const ScheduleSchema = new mongoose.Schema({
  id_: { type: String, required: true, unique: true, index: true },
  org_id: { type: String, index: true, default: 'default' },
  workflow_id: { type: String, required: true, index: true },
  cron: { type: String, required: true },
  start_node_id: { type: String, default: '' },
  argument: { type: mongoose.Schema.Types.Mixed, default: {} },
  active: { type: Boolean, default: true, index: true },
  last_run_at: { type: Date, default: null },
}, { timestamps: true });

const AppSchema = new mongoose.Schema({
  id_: { type: String, required: true, unique: true, index: true },
  org_id: { type: String, index: true, default: 'default' },
  name: { type: String, required: true },
  version: { type: String, default: '1.0.0' },
  description: { type: String, default: '' },
  docker_image: { type: String, default: '' },
  categories: { type: [String], default: [] },
  active: { type: Boolean, default: false },
  yaml_config: { type: String, default: '' },
}, { timestamps: true });

const memoryShuffle = {
  workflows: [],
  executions: [],
  queue: [],
  hooks: [],
  schedules: [],
  apps: [],
};

let ShuffleWorkflowModel = null;
let WorkflowExecutionModel = null;
let ExecutionQueueModel = null;
let HookModel = null;
let ScheduleModel = null;
let AppModel = null;

export async function ensureShuffleModels() {
  if (mongoose.connection.readyState === 1) {
    ShuffleWorkflowModel = mongoose.models.ShuffleWorkflow
      || mongoose.model('ShuffleWorkflow', ShuffleWorkflowSchema);
    WorkflowExecutionModel = mongoose.models.ShuffleWorkflowExecution
      || mongoose.model('ShuffleWorkflowExecution', WorkflowExecutionSchema);
    ExecutionQueueModel = mongoose.models.ExecutionQueue
      || mongoose.model('ExecutionQueue', ExecutionQueueSchema);
    HookModel = mongoose.models.Hook || mongoose.model('Hook', HookSchema);
    ScheduleModel = mongoose.models.Schedule || mongoose.model('Schedule', ScheduleSchema);
    AppModel = mongoose.models.ShuffleApp || mongoose.model('ShuffleApp', AppSchema);
  }
}

export function shuffleUseMongo() {
  return mongoose.connection.readyState === 1 && ShuffleWorkflowModel;
}

export function getShuffleWorkflowModel() { return ShuffleWorkflowModel; }
export function getWorkflowExecutionModel() { return WorkflowExecutionModel; }
export function getExecutionQueueModel() { return ExecutionQueueModel; }
export function getHookModel() { return HookModel; }
export function getScheduleModel() { return ScheduleModel; }
export function getAppModel() { return AppModel; }
export function getShuffleMemory() { return memoryShuffle; }
