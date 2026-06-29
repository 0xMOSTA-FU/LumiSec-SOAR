// Shuffle-compatible REST API — /api/v1/* (reference: TECHNICAL_DOCUMENTATION_AR.md §7)

import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  getShuffleWorkflowModel,
  getWorkflowExecutionModel,
  getHookModel,
  getAppModel,
  getScheduleModel,
  shuffleUseMongo,
  getShuffleMemory,
} from '../shuffle/models.js';
import {
  prepareWorkflowExecution,
  getExecution,
  appendActionResult,
  finishExecution,
  pollQueue,
  markQueueProcessing,
  confirmQueue,
} from '../shuffle/execution.service.js';
import {
  upsertSchedule,
  deleteSchedule,
  createScheduleDoc,
} from '../shuffle/scheduler.js';

const router = Router();

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function okShuffle(res, payload, status = 200) {
  return res.status(status).json({ success: true, ...payload });
}

function fail(res, reason, status = 400) {
  return res.status(status).json({ success: false, reason });
}

function orgFromReq(req) {
  return req.headers['org'] || req.headers['org-id'] || 'default';
}

// ── Workflows ─────────────────────────────────────────────────────────────

router.get('/workflows', async (req, res) => {
  try {
    const orgId = orgFromReq(req);
    let list;
    if (shuffleUseMongo()) {
      list = await getShuffleWorkflowModel().find({ org_id: orgId }).sort({ updated_at: -1 }).lean();
    } else {
      list = getShuffleMemory().workflows.filter(w => w.org_id === orgId);
    }
    return ok(res, list);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post('/workflows', async (req, res) => {
  try {
    const body = req.body || {};
    const id_ = body.id_ || randomUUID();
    const doc = {
      id_,
      org_id: body.org_id || orgFromReq(req),
      name: body.name || 'Untitled Workflow',
      description: body.description || '',
      start: body.start || '',
      is_valid: Boolean(body.is_valid),
      actions: body.actions || [],
      branches: body.branches || [],
      conditions: body.conditions || [],
      triggers: body.triggers || [],
      transforms: body.transforms || [],
      workflow_variables: body.workflow_variables || [],
      tags: body.tags || [],
      lumisec_nodes: body.lumisec_nodes || [],
      lumisec_edges: body.lumisec_edges || [],
    };
    if (shuffleUseMongo()) {
      await getShuffleWorkflowModel().create(doc);
    } else {
      getShuffleMemory().workflows.push(doc);
    }
    return ok(res, doc, 201);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

// ── Queue (Orborus / Worker) — MUST be before /workflows/:id ─────────────

router.get('/workflows/queue', async (req, res) => {
  try {
    const environment = req.headers['org-id'] || req.query.environment || 'default';
    const items = await pollQueue(environment);
    if (items.length) {
      await markQueueProcessing(items.map(i => i.execution_id));
    }
    return ok(res, items);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post('/workflows/queue/confirm', async (req, res) => {
  try {
    const ids = req.body?.execution_ids || req.body?.executionIds || [];
    if (!Array.isArray(ids) || !ids.length) {
      return fail(res, 'execution_ids required');
    }
    await confirmQueue(ids);
    return ok(res, { confirmed: ids.length });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get('/workflows/:id', async (req, res) => {
  try {
    let wf;
    if (shuffleUseMongo()) {
      wf = await getShuffleWorkflowModel().findOne({ id_: req.params.id }).lean();
    } else {
      wf = getShuffleMemory().workflows.find(w => w.id_ === req.params.id);
    }
    if (!wf) return fail(res, 'Workflow not found', 404);
    return ok(res, wf);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.put('/workflows/:id', async (req, res) => {
  try {
    const patch = { ...req.body, updated_at: new Date() };
    delete patch.id_;
    let wf;
    if (shuffleUseMongo()) {
      wf = await getShuffleWorkflowModel().findOneAndUpdate(
        { id_: req.params.id },
        { $set: patch },
        { returnDocument: 'after' },
      ).lean();
    } else {
      const idx = getShuffleMemory().workflows.findIndex(w => w.id_ === req.params.id);
      if (idx < 0) return fail(res, 'Workflow not found', 404);
      getShuffleMemory().workflows[idx] = { ...getShuffleMemory().workflows[idx], ...patch };
      wf = getShuffleMemory().workflows[idx];
    }
    if (!wf) return fail(res, 'Workflow not found', 404);
    return ok(res, wf);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.delete('/workflows/:id', async (req, res) => {
  try {
    if (shuffleUseMongo()) {
      await getShuffleWorkflowModel().deleteOne({ id_: req.params.id });
    } else {
      const mem = getShuffleMemory();
      mem.workflows = mem.workflows.filter(w => w.id_ !== req.params.id);
    }
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post('/workflows/:id/execute', async (req, res) => {
  try {
    const body = req.body || {};
    const { execution } = await prepareWorkflowExecution({
      workflowId: req.params.id,
      orgId: body.org_id || orgFromReq(req),
      environment: body.environment || 'default',
      priority: body.priority ?? 3,
      executionArgument: body.execution_argument || body.argument || body,
      startNodeId: body.start,
    });
    return okShuffle(res, {
      execution_id: execution.id_,
      status: execution.status,
      data: execution,
    }, 201);
  } catch (e) {
    return fail(res, e.message, e.status || 500);
  }
});

router.get('/workflows/:id/executions', async (req, res) => {
  try {
    let list;
    if (shuffleUseMongo()) {
      list = await getWorkflowExecutionModel()
        .find({ workflow_id: req.params.id })
        .sort({ started_at: -1 })
        .limit(100)
        .lean();
    } else {
      list = getShuffleMemory().executions.filter(e => e.workflow_id === req.params.id);
    }
    return okShuffle(res, { executions: list });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

// ── Streams (Worker callbacks) ─────────────────────────────────────────────

router.post('/streams', async (req, res) => {
  try {
    const executionId = req.body?.execution_id || req.body?.id_;
    if (!executionId) return fail(res, 'execution_id required');
    const execution = await getExecution(executionId);
    if (!execution) return fail(res, 'Execution not found', 404);
    return ok(res, execution);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post('/streams/results', async (req, res) => {
  try {
    const { execution_id, action_id, result, status } = req.body || {};
    if (!execution_id || !action_id) {
      return fail(res, 'execution_id and action_id required');
    }
    await appendActionResult(execution_id, { action_id, result, status });
    return ok(res, { saved: true });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post('/streams/finish', async (req, res) => {
  try {
    const { execution_id, status } = req.body || {};
    if (!execution_id || !status) {
      return fail(res, 'execution_id and status required');
    }
    await finishExecution(execution_id, status);
    return ok(res, { finished: true });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

// ── Hooks (webhook triggers) ─────────────────────────────────────────────

router.post('/hooks', async (req, res) => {
  try {
    const body = req.body || {};
    const hook = {
      id_: body.id_ || randomUUID(),
      org_id: body.org_id || orgFromReq(req),
      workflow_id: body.workflow_id,
      start_node_id: body.start_node_id || body.start || '',
      type: 'webhook',
      name: body.name || 'Webhook',
      secret: body.secret || '',
      active: body.active !== false,
    };
    if (!hook.workflow_id) return fail(res, 'workflow_id required');
    if (shuffleUseMongo()) {
      await getHookModel().create(hook);
    } else {
      getShuffleMemory().hooks.push(hook);
    }
    return ok(res, hook, 201);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post('/hooks/:key', async (req, res) => {
  try {
    let hook;
    if (shuffleUseMongo()) {
      hook = await getHookModel().findOne({ id_: req.params.key, active: true }).lean();
    } else {
      hook = getShuffleMemory().hooks.find(h => h.id_ === req.params.key && h.active);
    }
    if (!hook) return fail(res, 'Hook not found', 404);

    if (hook.secret) {
      const key = req.headers.authorization?.replace(/^Bearer\s+/i, '')
        || req.query.key
        || req.headers['x-hook-secret'];
      if (key !== hook.secret) return fail(res, 'Invalid hook secret', 401);
    }

    const executionArgument = {
      ...(typeof req.body === 'object' && req.body ? req.body : { body: req.body }),
      _webhook: { hook_id: hook.id_, path: req.params.key },
    };

    const { execution } = await prepareWorkflowExecution({
      workflowId: hook.workflow_id,
      orgId: hook.org_id,
      executionArgument,
      startNodeId: hook.start_node_id || undefined,
    });

    return okShuffle(res, {
      execution_id: execution.id_,
      status: execution.status,
    }, 201);
  } catch (e) {
    return fail(res, e.message, e.status || 500);
  }
});

router.get('/hooks/:key', (req, res) => {
  return ok(res, { hook_id: req.params.key, method: 'POST', note: 'Send JSON body to trigger workflow' });
});

// ── Schedules (cron triggers) ─────────────────────────────────────────────

router.post('/workflows/:id/schedule', async (req, res) => {
  try {
    const body = req.body || {};
    const cronExpr = body.cron || body.schedule;
    if (!cronExpr) return fail(res, 'cron expression required');
    const doc = createScheduleDoc({
      workflowId: req.params.id,
      cronExpr,
      orgId: body.org_id || orgFromReq(req),
      argument: body.argument || body.execution_argument || {},
      startNodeId: body.start || body.start_node_id,
    });
    await upsertSchedule(doc);
    return ok(res, doc, 201);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.delete('/workflows/:id/schedule/:schedId', async (req, res) => {
  try {
    await deleteSchedule(req.params.schedId);
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get('/schedules', async (req, res) => {
  try {
    const orgId = orgFromReq(req);
    let list;
    if (shuffleUseMongo()) {
      list = await getScheduleModel().find({ org_id: orgId }).lean();
    } else {
      list = getShuffleMemory().schedules.filter(s => s.org_id === orgId);
    }
    return ok(res, list);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

// ── Apps (metadata — Docker build in later phase) ────────────────────────

router.get('/apps', async (req, res) => {
  try {
    const orgId = orgFromReq(req);
    let list;
    if (shuffleUseMongo()) {
      list = await getAppModel().find({ org_id: orgId }).lean();
    } else {
      list = getShuffleMemory().apps.filter(a => a.org_id === orgId);
    }
    return ok(res, list);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.put('/apps', async (req, res) => {
  try {
    const body = req.body || {};
    const app = {
      id_: body.id_ || randomUUID(),
      org_id: body.org_id || orgFromReq(req),
      name: body.name,
      version: body.version || '1.0.0',
      description: body.description || '',
      docker_image: body.docker_image || '',
      categories: body.categories || [],
      active: Boolean(body.active),
      yaml_config: body.yaml_config || '',
    };
    if (!app.name) return fail(res, 'name required');
    if (shuffleUseMongo()) {
      await getAppModel().create(app);
    } else {
      getShuffleMemory().apps.push(app);
    }
    return ok(res, app, 201);
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

// ── Health / info ────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  return ok(res, {
    service: 'shuffle-v1-api',
    mongo: shuffleUseMongo(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
