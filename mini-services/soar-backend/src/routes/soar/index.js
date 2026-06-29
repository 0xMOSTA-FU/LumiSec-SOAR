/**
 * Industry SOAR API — /api/soar/*
 * MongoDB-backed; contract matches Next.js src/lib/soar-api/router.ts
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import { soarOk, soarErr, paginated, queryPageLimit } from '../../lib/envelope.js';
import { requireMongo, getSoarModels } from '../../models/soar.js';
import { getRequestContext } from '../../lib/tenant.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import {
  incidentToApi,
  alertToApi,
  connectorToApi,
  playbookToApi,
  playbookRunToApi,
  artifactToApi,
} from '../../lib/mappers.js';
import {
  listIncidents,
  getIncidentById,
  createIncident,
  patchIncident,
  closeIncident,
  deleteIncident,
  getTimeline,
  getNotes,
  addNote,
  getIncidentArtifacts,
  addIncidentArtifact,
  getRelatedIncidents,
  linkRelatedIncident,
  getIncidentSummary,
  getRecommendations,
  respondToIncident,
  runPlaybookOnIncident,
  getIncidentDoc,
} from '../../services/incidents.js';
import { executeAction } from '../../services/recommendations.js';
import { forwardPlatformIntegration } from '../../lib/platform-forward.js';
import seedRouter from './seed.js';

const router = Router();
router.use(seedRouter);

function ctx(req) {
  return getRequestContext(req);
}

function guard(res) {
  return requireMongo(res);
}

function oid(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function testConnector(row) {
  const cfg = row.config || {};
  const hasCreds = Boolean(cfg.api_key || cfg.host || cfg.url || cfg.webhook_url || Object.keys(cfg).length);
  return {
    ok: hasCreds || row.status === 'connected',
    message: hasCreds ? 'Connection parameters present' : 'No configuration — add host or API key',
  };
}

// ── INCIDENTS ─────────────────────────────────────────────────
router.get('/incidents', async (req, res) => {
  if (!guard(res)) return;
  const c = ctx(req);
  const { page, limit } = queryPageLimit(req.query);
  const data = await listIncidents(c, page, limit, {
    status: req.query.status,
    severity: req.query.severity,
    assigned_to: req.query.assigned_to,
  });
  return soarOk(res, data);
});

router.post('/incidents', async (req, res) => {
  if (!guard(res)) return;
  const data = await createIncident(ctx(req), req.body);
  return soarOk(res, data, 'Incident created', 201);
});

router.get('/incidents/:id', async (req, res) => {
  if (!guard(res)) return;
  const data = await getIncidentById(req.params.id, ctx(req));
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, data);
});

router.patch('/incidents/:id', async (req, res) => {
  if (!guard(res)) return;
  const data = await patchIncident(req.params.id, ctx(req), req.body);
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, data);
});

router.put('/incidents/:id', async (req, res) => {
  if (!guard(res)) return;
  const data = await patchIncident(req.params.id, ctx(req), req.body);
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, data);
});

router.delete('/incidents/:id', async (req, res) => {
  if (!guard(res)) return;
  const ok = await deleteIncident(req.params.id, ctx(req));
  if (!ok) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, { deleted: true });
});

router.patch('/incidents/:id/close', async (req, res) => {
  if (!guard(res)) return;
  const data = await closeIncident(req.params.id, ctx(req));
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, data);
});

router.get('/incidents/:id/timeline', async (req, res) => {
  if (!guard(res)) return;
  const data = await getTimeline(req.params.id, ctx(req));
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, { timeline: data, events: data });
});

router.get('/incidents/:id/notes', async (req, res) => {
  if (!guard(res)) return;
  const data = await getNotes(req.params.id, ctx(req));
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, { notes: data });
});

router.post('/incidents/:id/notes', async (req, res) => {
  if (!guard(res)) return;
  const c = ctx(req);
  const text = String(req.body.body || req.body.content || req.body.note || '');
  const data = await addNote(req.params.id, c, text, c.userEmail || c.userId);
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, { notes: data });
});

router.get('/incidents/:id/artifacts', async (req, res) => {
  if (!guard(res)) return;
  const data = await getIncidentArtifacts(req.params.id, ctx(req));
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, { artifacts: data });
});

router.post('/incidents/:id/artifacts', async (req, res) => {
  if (!guard(res)) return;
  const data = await addIncidentArtifact(req.params.id, ctx(req), req.body);
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, data, 'Artifact added', 201);
});

router.get('/incidents/:id/related', async (req, res) => {
  if (!guard(res)) return;
  const data = await getRelatedIncidents(req.params.id, ctx(req));
  return soarOk(res, { related: data });
});

router.post('/incidents/:id/related', async (req, res) => {
  if (!guard(res)) return;
  const relatedId = String(req.body.related_incident_id || req.body.relatedIncidentId || '');
  if (!relatedId) return soarErr(res, 'related_incident_id required', 400);
  const data = await linkRelatedIncident(req.params.id, ctx(req), relatedId);
  if (!data) return soarErr(res, 'Incident or related incident not found', 404);
  return soarOk(res, data, 'Incidents linked');
});

router.get('/incidents/:id/summary', async (req, res) => {
  if (!guard(res)) return;
  const data = await getIncidentSummary(req.params.id, ctx(req));
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, data);
});

router.get('/incidents/:id/recommendations', async (req, res) => {
  if (!guard(res)) return;
  const data = await getRecommendations(req.params.id, ctx(req));
  if (!data) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, data);
});

router.post('/incidents/:id/respond', async (req, res) => {
  if (!guard(res)) return;
  const actionId = String(req.body.actionId || req.body.action_id || '');
  const result = await respondToIncident(req.params.id, ctx(req), actionId, req.body.params || {}, req.headers.authorization);
  if (!result) return soarErr(res, 'Incident not found', 404);
  return soarOk(res, result, result.message);
});

router.post('/incidents/:id/playbooks/run', async (req, res) => {
  if (!guard(res)) return;
  const result = await runPlaybookOnIncident(req.params.id, ctx(req), req.body, req.headers.authorization);
  return soarOk(res, result, result.message);
});

// ── ALERTS ────────────────────────────────────────────────────
router.get('/alerts', async (req, res) => {
  if (!guard(res)) return;
  const c = ctx(req);
  const { Alert } = getSoarModels();
  const { page, limit, skip } = queryPageLimit(req.query);
  const where = { tenantId: c.tenantId };
  if (req.query.status) where.status = req.query.status;
  const [total, rows] = await Promise.all([
    Alert.countDocuments(where),
    Alert.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  return soarOk(res, paginated(rows.map(alertToApi), page, limit, total, 'alerts'));
});

router.post('/alerts', async (req, res) => {
  if (!guard(res)) return;
  const c = ctx(req);
  const { Alert } = getSoarModels();
  const row = await Alert.create({
    tenantId: c.tenantId,
    title: req.body.title,
    description: req.body.description,
    source: req.body.source || 'manual',
    severity: req.body.severity || 'medium',
    status: 'new',
    iocs: req.body.iocs || [],
    raw: req.body.raw || {},
  });
  return soarOk(res, alertToApi(row), 'Alert created', 201);
});

router.get('/alerts/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Alert } = getSoarModels();
  const row = await Alert.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Alert not found', 404);
  return soarOk(res, alertToApi(row));
});

router.patch('/alerts/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Alert } = getSoarModels();
  const existing = await Alert.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!existing) return soarErr(res, 'Alert not found', 404);
  if (req.body.status) existing.status = req.body.status;
  if (req.body.severity) existing.severity = req.body.severity;
  if (req.body.title) existing.title = req.body.title;
  if (req.body.case_id || req.body.incident_id) {
    existing.incident_id = req.body.case_id || req.body.incident_id;
  }
  await existing.save();
  return soarOk(res, alertToApi(existing));
});

router.put('/alerts/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Alert } = getSoarModels();
  const existing = await Alert.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!existing) return soarErr(res, 'Alert not found', 404);
  if (req.body.status) existing.status = req.body.status;
  if (req.body.severity) existing.severity = req.body.severity;
  if (req.body.title) existing.title = req.body.title;
  if (req.body.case_id || req.body.incident_id) {
    existing.incident_id = req.body.case_id || req.body.incident_id;
  }
  await existing.save();
  return soarOk(res, alertToApi(existing));
});

router.delete('/alerts/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Alert } = getSoarModels();
  const existing = await Alert.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!existing) return soarErr(res, 'Alert not found', 404);
  await existing.deleteOne();
  return soarOk(res, { deleted: true });
});

router.post('/alerts/:id/escalate', async (req, res) => {
  if (!guard(res)) return;
  const c = ctx(req);
  const { Alert } = getSoarModels();
  const alert = await Alert.findOne({ _id: req.params.id, tenantId: c.tenantId });
  if (!alert) return soarErr(res, 'Alert not found', 404);
  const incident = await createIncident(c, {
    title: alert.title,
    description: alert.description,
    severity: alert.severity,
    source: alert.source,
    source_alert_id: String(alert._id),
  });
  return soarOk(res, { incident, alert_id: String(alert._id) }, 'Alert escalated to incident', 201);
});

// ── CONNECTORS ────────────────────────────────────────────────
router.get('/connectors', async (req, res) => {
  if (!guard(res)) return;
  const { Connector } = getSoarModels();
  const { page, limit, skip } = queryPageLimit(req.query);
  const where = { tenantId: ctx(req).tenantId };
  const [total, rows] = await Promise.all([
    Connector.countDocuments(where),
    Connector.find(where).sort({ name: 1 }).skip(skip).limit(limit),
  ]);
  return soarOk(res, paginated(rows.map(connectorToApi), page, limit, total, 'connectors'));
});

router.post('/connectors', async (req, res) => {
  if (!guard(res)) return;
  const { Connector } = getSoarModels();
  const row = await Connector.create({
    tenantId: ctx(req).tenantId,
    name: req.body.name,
    type: req.body.type,
    description: req.body.description,
    category: req.body.category || 'security',
    config: req.body.config || {},
    status: 'inactive',
  });
  return soarOk(res, connectorToApi(row), 'Connector created', 201);
});

router.get('/connectors/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Connector } = getSoarModels();
  const row = await Connector.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Connector not found', 404);
  return soarOk(res, connectorToApi(row));
});

router.patch('/connectors/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Connector } = getSoarModels();
  const row = await Connector.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Connector not found', 404);
  if (req.body.name) row.name = req.body.name;
  if (req.body.type) row.type = req.body.type;
  if (req.body.description !== undefined) row.description = req.body.description;
  if (req.body.config) row.config = req.body.config;
  if (req.body.status) row.status = req.body.status;
  await row.save();
  return soarOk(res, connectorToApi(row));
});

router.delete('/connectors/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Connector } = getSoarModels();
  const row = await Connector.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Connector not found', 404);
  await row.deleteOne();
  return soarOk(res, { deleted: true });
});

router.post('/connectors/:id/test', async (req, res) => {
  if (!guard(res)) return;
  const { Connector } = getSoarModels();
  const row = await Connector.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Connector not found', 404);
  const result = await testConnector(row);
  row.status = result.ok ? 'connected' : 'error';
  await row.save();
  return soarOk(res, {
    success: result.ok,
    status: result.ok ? 'active' : 'error',
    message: result.message,
    last_tested_at: new Date().toISOString(),
  });
});

router.get('/connectors/:id/actions', async (req, res) => {
  if (!guard(res)) return;
  const { Connector } = getSoarModels();
  const row = await Connector.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Connector not found', 404);
  return soarOk(res, {
    actions: [
      { id: 'test', name: 'Test connection', description: 'Verify credentials', type: row.type },
      { id: 'sync', name: 'Sync', description: 'Pull latest events', type: row.type },
    ],
  });
});

// ── VAULT ─────────────────────────────────────────────────────
router.get('/vault', async (req, res) => {
  if (!guard(res)) return;
  const { VaultSecret } = getSoarModels();
  const { page, limit, skip } = queryPageLimit(req.query);
  const where = { tenantId: ctx(req).tenantId };
  const [total, rows] = await Promise.all([
    VaultSecret.countDocuments(where),
    VaultSecret.find(where).sort({ name: 1 }).skip(skip).limit(limit),
  ]);
  const items = rows.map((r) => ({
    id: String(r._id),
    name: r.name,
    type: r.type,
    description: r.description,
    created_at: r.createdAt.toISOString(),
    last_used_at: r.lastUsedAt?.toISOString() ?? null,
    has_value: Boolean(r.valueEnc),
  }));
  return soarOk(res, paginated(items, page, limit, total, 'entries'));
});

router.post('/vault', async (req, res) => {
  if (!guard(res)) return;
  const { VaultSecret } = getSoarModels();
  const row = await VaultSecret.create({
    tenantId: ctx(req).tenantId,
    name: req.body.name,
    type: req.body.type || 'api_key',
    description: req.body.description,
    valueEnc: encrypt(req.body.value || req.body.plaintext || ''),
  });
  return soarOk(res, {
    id: String(row._id),
    name: row.name,
    type: row.type,
    created_at: row.createdAt.toISOString(),
    has_value: true,
  }, 'Vault entry created', 201);
});

router.get('/vault/:id', async (req, res) => {
  if (!guard(res)) return;
  const { VaultSecret } = getSoarModels();
  const row = await VaultSecret.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Vault entry not found', 404);
  return soarOk(res, {
    id: String(row._id),
    name: row.name,
    type: row.type,
    description: row.description,
    created_at: row.createdAt.toISOString(),
    has_value: Boolean(row.valueEnc),
  });
});

router.patch('/vault/:id', async (req, res) => {
  if (!guard(res)) return;
  const { VaultSecret } = getSoarModels();
  const row = await VaultSecret.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Vault entry not found', 404);
  if (req.body.name) row.name = req.body.name;
  if (req.body.type) row.type = req.body.type;
  if (req.body.description !== undefined) row.description = req.body.description;
  if (req.body.value) row.valueEnc = encrypt(req.body.value);
  if (req.body.plaintext) row.valueEnc = encrypt(req.body.plaintext);
  await row.save();
  return soarOk(res, { id: String(row._id), name: row.name });
});

router.get('/vault/:id/reveal', async (req, res) => {
  if (!guard(res)) return;
  const { VaultSecret } = getSoarModels();
  const row = await VaultSecret.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Vault entry not found', 404);
  row.lastUsedAt = new Date();
  await row.save();
  let value = '';
  try { value = decrypt(row.valueEnc) || ''; } catch { value = ''; }
  return soarOk(res, { id: String(row._id), name: row.name, value });
});

router.delete('/vault/:id', async (req, res) => {
  if (!guard(res)) return;
  const { VaultSecret } = getSoarModels();
  const row = await VaultSecret.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Vault entry not found', 404);
  await row.deleteOne();
  return soarOk(res, { deleted: true });
});

// ── ARTIFACTS ─────────────────────────────────────────────────
router.get('/artifacts', async (req, res) => {
  if (!guard(res)) return;
  const { Artifact } = getSoarModels();
  const { page, limit, skip } = queryPageLimit(req.query);
  const where = { tenantId: ctx(req).tenantId };
  if (req.query.incident_id) where.incidentId = req.query.incident_id;
  const [total, rows] = await Promise.all([
    Artifact.countDocuments(where),
    Artifact.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  return soarOk(res, paginated(rows.map(artifactToApi), page, limit, total, 'artifacts'));
});

router.post('/artifacts', async (req, res) => {
  if (!guard(res)) return;
  const { Artifact } = getSoarModels();
  const row = await Artifact.create({
    tenantId: ctx(req).tenantId,
    incidentId: req.body.incident_id || req.body.incidentId,
    type: req.body.type,
    value: req.body.value,
    description: req.body.description,
    tlp: req.body.tlp || 'amber',
  });
  return soarOk(res, artifactToApi(row), 'Artifact created', 201);
});

router.post('/artifacts/enrich/bulk', async (req, res) => {
  if (!guard(res)) return;
  const { Artifact } = getSoarModels();
  const ids = req.body.artifact_ids || req.body.artifactIds || [];
  const results = [];
  for (const artId of ids) {
    const art = await Artifact.findOne({ _id: artId, tenantId: ctx(req).tenantId });
    if (!art) continue;
    art.enriched = true;
    art.enrichment = { ok: true, queued: true };
    await art.save();
    results.push({ id: String(art._id), enriched: true });
  }
  return soarOk(res, { enriched: results.length, results });
});

router.get('/artifacts/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Artifact } = getSoarModels();
  const row = await Artifact.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Artifact not found', 404);
  return soarOk(res, artifactToApi(row));
});

router.patch('/artifacts/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Artifact } = getSoarModels();
  const row = await Artifact.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Artifact not found', 404);
  if (req.body.type) row.type = req.body.type;
  if (req.body.value) row.value = req.body.value;
  if (req.body.tlp) row.tlp = req.body.tlp;
  if (req.body.description !== undefined) row.description = req.body.description;
  await row.save();
  return soarOk(res, artifactToApi(row));
});

router.delete('/artifacts/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Artifact } = getSoarModels();
  const row = await Artifact.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Artifact not found', 404);
  await row.deleteOne();
  return soarOk(res, { deleted: true });
});

router.post('/artifacts/:id/enrich', async (req, res) => {
  if (!guard(res)) return;
  const { Artifact } = getSoarModels();
  const art = await Artifact.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!art) return soarErr(res, 'Artifact not found', 404);
  const actionId = art.type === 'hash' ? 'scan_hash' : 'enrich_ip';
  const params = art.type === 'hash' ? { hash: art.value } : { ip: art.value };
  let result = { ok: true, message: `Enrichment queued for ${art.value}`, actionId };
  if (art.incidentId && oid(art.incidentId)) {
    const doc = await getIncidentDoc(art.incidentId, ctx(req));
    if (doc) result = await executeAction(doc, actionId, params, ctx(req).userId);
  }
  if (result.ok) {
    art.enriched = true;
    art.enrichment = result;
    await art.save();
  }
  return soarOk(res, { enriched: result.ok, result });
});

// ── PLAYBOOKS ─────────────────────────────────────────────────
router.get('/playbooks', async (req, res) => {
  if (!guard(res)) return;
  const { Playbook } = getSoarModels();
  const rows = await Playbook.find({ tenantId: ctx(req).tenantId }).sort({ name: 1 });
  const items = rows.map(playbookToApi);
  return soarOk(res, { playbooks: items, items });
});

router.get('/playbooks/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Playbook } = getSoarModels();
  const row = await Playbook.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Playbook not found', 404);
  return soarOk(res, playbookToApi(row));
});

router.post('/playbooks', async (req, res) => {
  if (!guard(res)) return;
  const { Playbook } = getSoarModels();
  const row = await Playbook.create({
    tenantId: ctx(req).tenantId,
    name: req.body.name,
    description: req.body.description,
    category: req.body.category || 'incident_response',
    status: req.body.status || 'active',
    workflow_id: req.body.workflow_id || req.body.workflowId,
    steps: req.body.steps || [],
  });
  return soarOk(res, playbookToApi(row), 'Playbook created', 201);
});

router.patch('/playbooks/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Playbook } = getSoarModels();
  const row = await Playbook.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Playbook not found', 404);
  if (req.body.name) row.name = req.body.name;
  if (req.body.status) row.status = req.body.status;
  if (req.body.workflow_id || req.body.workflowId) {
    row.workflow_id = req.body.workflow_id || req.body.workflowId;
  }
  await row.save();
  return soarOk(res, playbookToApi(row));
});

router.delete('/playbooks/:id', async (req, res) => {
  if (!guard(res)) return;
  const { Playbook } = getSoarModels();
  const row = await Playbook.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Playbook not found', 404);
  await row.deleteOne();
  return soarOk(res, { deleted: true });
});

// ── PLAYBOOK RUNS ─────────────────────────────────────────────
router.get('/playbook-runs', async (req, res) => {
  if (!guard(res)) return;
  const { PlaybookRun } = getSoarModels();
  const { page, limit, skip } = queryPageLimit(req.query);
  const where = { tenantId: ctx(req).tenantId };
  const [total, rows] = await Promise.all([
    PlaybookRun.countDocuments(where),
    PlaybookRun.find(where).sort({ started_at: -1 }).skip(skip).limit(limit),
  ]);
  return soarOk(res, paginated(rows.map(playbookRunToApi), page, limit, total, 'runs'));
});

router.get('/playbook-runs/:id', async (req, res) => {
  if (!guard(res)) return;
  const { PlaybookRun } = getSoarModels();
  const row = await PlaybookRun.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Run not found', 404);
  return soarOk(res, playbookRunToApi(row));
});

router.post('/playbook-runs/:id/cancel', async (req, res) => {
  if (!guard(res)) return;
  const { PlaybookRun } = getSoarModels();
  const row = await PlaybookRun.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Run not found', 404);
  row.status = 'cancelled';
  row.completed_at = new Date();
  await row.save();
  return soarOk(res, playbookRunToApi(row), 'Run cancelled');
});

router.post('/playbook-runs/:id/pause', async (req, res) => {
  if (!guard(res)) return;
  const { PlaybookRun } = getSoarModels();
  const row = await PlaybookRun.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Run not found', 404);
  row.status = 'paused';
  await row.save();
  return soarOk(res, playbookRunToApi(row), 'Run paused');
});

router.post('/playbook-runs/:id/resume', async (req, res) => {
  if (!guard(res)) return;
  const { PlaybookRun } = getSoarModels();
  const row = await PlaybookRun.findOne({ _id: req.params.id, tenantId: ctx(req).tenantId });
  if (!row) return soarErr(res, 'Run not found', 404);
  row.status = 'running';
  await row.save();
  return soarOk(res, playbookRunToApi(row), 'Run resumed');
});

function formatDurationMs(ms) {
  if (!ms || ms <= 0) return '0m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function computeAvgMttrMs(Incident, where) {
  const rows = await Incident.find({
    ...where,
    status: { $in: ['closed', 'resolved'] },
  })
    .select('createdAt closedAt updatedAt resolvedAt')
    .limit(500)
    .lean();
  if (!rows.length) return 0;
  let total = 0;
  let count = 0;
  for (const row of rows) {
    const start = row.createdAt ? new Date(row.createdAt).getTime() : 0;
    const end = row.closedAt
      ? new Date(row.closedAt).getTime()
      : row.resolvedAt
        ? new Date(row.resolvedAt).getTime()
        : row.updatedAt
          ? new Date(row.updatedAt).getTime()
          : 0;
    if (start && end && end >= start) {
      total += end - start;
      count += 1;
    }
  }
  return count ? total / count : 0;
}

// ── DASHBOARD ─────────────────────────────────────────────────
router.get('/dashboard/overview', async (req, res) => {
  if (!guard(res)) return;
  const { Incident, PlaybookRun } = getSoarModels();
  const where = { tenantId: ctx(req).tenantId };
  const [openInc, critical, executions, successExec, mttrMs] = await Promise.all([
    Incident.countDocuments({ ...where, status: { $ne: 'closed' } }),
    Incident.countDocuments({ ...where, severity: 'critical', status: { $ne: 'closed' } }),
    PlaybookRun.countDocuments(where),
    PlaybookRun.countDocuments({ ...where, status: 'success' }),
    computeAvgMttrMs(Incident, where),
  ]);
  return soarOk(res, {
    open_incidents: openInc,
    critical_count: critical,
    mttr: formatDurationMs(mttrMs),
    mttr_hours: Math.round((mttrMs / 3600000) * 100) / 100,
    automation_success_rate: executions ? Math.round((successExec / executions) * 100) : 0,
    total_executions: executions,
  });
});

router.get('/dashboard/incidents', async (req, res) => {
  if (!guard(res)) return;
  const { Incident } = getSoarModels();
  const { page, limit, skip } = queryPageLimit(req.query);
  const where = { tenantId: ctx(req).tenantId };
  const [total, rows] = await Promise.all([
    Incident.countDocuments(where),
    Incident.find(where).sort({ updatedAt: -1 }).skip(skip).limit(limit),
  ]);
  return soarOk(res, paginated(
    rows.map((c) => ({
      id: String(c._id),
      title: c.title,
      severity: c.severity,
      status: c.status,
      assigned_to: c.assigned_to,
      created_at: c.createdAt.toISOString(),
    })),
    page,
    limit,
    total,
    'incidents',
  ));
});

router.get('/dashboard/playbooks', async (req, res) => {
  if (!guard(res)) return;
  const { Playbook, PlaybookRun } = getSoarModels();
  const where = { tenantId: ctx(req).tenantId };
  const pbs = await Playbook.find({ ...where, status: 'active' }).limit(10);
  const stats = await Promise.all(pbs.map(async (p) => {
    const total = await PlaybookRun.countDocuments({ ...where, playbook_id: String(p._id) });
    const success = await PlaybookRun.countDocuments({ ...where, playbook_id: String(p._id), status: 'success' });
    return { name: p.name, total_runs: total, success_rate: total ? Math.round((success / total) * 100) : 0 };
  }));
  return soarOk(res, { playbooks: stats });
});

router.get('/dashboard/automation', async (req, res) => {
  if (!guard(res)) return;
  const { PlaybookRun } = getSoarModels();
  const where = { tenantId: ctx(req).tenantId };
  const total = await PlaybookRun.countDocuments(where);
  const success = await PlaybookRun.countDocuments({ ...where, status: 'success' });
  return soarOk(res, {
    success_rate: total ? Math.round((success / total) * 100) : 0,
    triggered_count: total,
  });
});

router.get('/dashboard/analysts', async (req, res) => {
  if (!guard(res)) return;
  const { Incident } = getSoarModels();
  const tenantId = ctx(req).tenantId;
  const closed = await Incident.aggregate([
    { $match: { tenantId, status: { $in: ['closed', 'resolved'] }, assigned_to: { $ne: null } } },
    {
      $group: {
        _id: '$assigned_to',
        resolved_count: { $sum: 1 },
        avg_response_ms: {
          $avg: {
            $subtract: [
              { $ifNull: ['$closedAt', { $ifNull: ['$resolvedAt', '$updatedAt'] }] },
              '$createdAt',
            ],
          },
        },
      },
    },
    { $sort: { resolved_count: -1 } },
    { $limit: 10 },
  ]);
  return soarOk(res, {
    analysts: closed.map((a) => ({
      id: a._id,
      name: a._id,
      email: a._id,
      resolved_count: a.resolved_count,
      avg_response_time:
        a.avg_response_ms && a.avg_response_ms > 0
          ? formatDurationMs(a.avg_response_ms)
          : '—',
    })),
  });
});

router.get('/dashboard/connectors', async (req, res) => {
  if (!guard(res)) return;
  const { Connector } = getSoarModels();
  const rows = await Connector.find({ tenantId: ctx(req).tenantId }).limit(20);
  return soarOk(res, {
    connectors: rows.map((i) => ({
      name: i.name,
      type: i.type,
      status: i.status === 'connected' ? 'active' : 'inactive',
      last_seen: i.updatedAt.toISOString(),
    })),
  });
});

// ── ANALYTICS ─────────────────────────────────────────────────
router.get('/analytics/kpis', async (req, res) => {
  if (!guard(res)) return;
  const { Incident, Alert, PlaybookRun } = getSoarModels();
  const where = { tenantId: ctx(req).tenantId };
  const [incidents, alerts, execs, fpAlerts, mttrMs] = await Promise.all([
    Incident.countDocuments(where),
    Alert.countDocuments(where),
    PlaybookRun.countDocuments(where),
    Alert.countDocuments({ ...where, status: 'false_positive' }),
    computeAvgMttrMs(Incident, where),
  ]);
  return soarOk(res, {
    total_incidents: incidents,
    total_alerts: alerts,
    total_automations: execs,
    mttr_hours: Math.round((mttrMs / 3600000) * 100) / 100,
    false_positive_rate: alerts ? Math.round((fpAlerts / alerts) * 100) : 0,
  });
});

router.get('/analytics/snapshots', async (req, res) => {
  if (!guard(res)) return;
  const { Incident } = getSoarModels();
  const dist = await Incident.aggregate([
    { $match: { tenantId: ctx(req).tenantId } },
    { $group: { _id: '$severity', count: { $sum: 1 } } },
  ]);
  return soarOk(res, {
    severity_distribution: dist.map((d) => ({ severity: d._id, count: d.count })),
  });
});

router.get('/analytics/report', async (req, res) => {
  if (!guard(res)) return;
  const { Incident, Alert, PlaybookRun } = getSoarModels();
  const where = { tenantId: ctx(req).tenantId };
  const [incidents, alerts, execs, openInc, mttrMs] = await Promise.all([
    Incident.countDocuments(where),
    Alert.countDocuments(where),
    PlaybookRun.countDocuments(where),
    Incident.countDocuments({ ...where, status: { $nin: ['closed', 'resolved'] } }),
    computeAvgMttrMs(Incident, where),
  ]);
  return soarOk(res, {
    generated_at: new Date().toISOString(),
    summary: `${incidents} incidents, ${openInc} open, ${alerts} alerts, ${execs} automations, MTTR ${formatDurationMs(mttrMs)}`,
    totals: { incidents, open_incidents: openInc, alerts, automations: execs, mttr_hours: Math.round((mttrMs / 3600000) * 100) / 100 },
  });
});

router.post('/analytics/export', async (req, res) => {
  if (!guard(res)) return;
  return soarOk(res, {
    export_url: '/api/soar/analytics/report',
    format: req.body?.format || 'json',
    message: 'GET export_url to download the analytics report JSON',
  });
});

// ── NOTIFICATIONS ─────────────────────────────────────────────
router.get('/notifications/unread-count', async (req, res) => {
  if (!guard(res)) return;
  const { Notification } = getSoarModels();
  const count = await Notification.countDocuments({ tenantId: ctx(req).tenantId, read: false });
  return soarOk(res, { count });
});

router.get('/notifications', async (req, res) => {
  if (!guard(res)) return;
  const { Notification } = getSoarModels();
  const rows = await Notification.find({ tenantId: ctx(req).tenantId }).sort({ createdAt: -1 }).limit(50);
  return soarOk(res, {
    notifications: rows.map((n) => ({
      id: String(n._id),
      title: n.title,
      message: n.message,
      read: n.read,
      created_at: n.createdAt.toISOString(),
    })),
  });
});

router.patch('/notifications/read-all', async (req, res) => {
  if (!guard(res)) return;
  const { Notification } = getSoarModels();
  await Notification.updateMany({ tenantId: ctx(req).tenantId }, { read: true });
  return soarOk(res, { updated: true });
});

router.patch('/notifications/:id/read', async (req, res) => {
  if (!guard(res)) return;
  const { Notification } = getSoarModels();
  await Notification.updateOne({ _id: req.params.id, tenantId: ctx(req).tenantId }, { read: true });
  return soarOk(res, { read: true });
});

// ── WEBHOOK SOURCES ───────────────────────────────────────────
router.get('/webhook-sources', async (req, res) => {
  if (!guard(res)) return;
  const { WebhookSource } = getSoarModels();
  const rows = await WebhookSource.find({ tenantId: ctx(req).tenantId });
  return soarOk(res, {
    sources: rows.map((w) => ({
      id: String(w._id),
      name: w.name,
      slug: w.slug,
      enabled: w.enabled,
      url: `/api/webhook/${w.slug}`,
      created_at: w.createdAt.toISOString(),
    })),
  });
});

router.post('/webhook-sources', async (req, res) => {
  if (!guard(res)) return;
  const { WebhookSource } = getSoarModels();
  const slug = String(req.body.slug || req.body.name || 'source').toLowerCase().replace(/\s+/g, '-');
  const row = await WebhookSource.create({
    tenantId: ctx(req).tenantId,
    name: req.body.name || slug,
    slug,
    secret: req.body.secret || null,
    enabled: req.body.enabled !== false,
  });
  return soarOk(res, {
    id: String(row._id),
    name: row.name,
    slug: row.slug,
    url: `/api/webhook/${row.slug}`,
  }, 'Webhook source created', 201);
});

// ── INTEGRATION ACTIONS (outbound) ────────────────────────────

router.post('/integrations/grc/:action', async (req, res) => {
  if (!guard(res)) return;
  const result = await forwardPlatformIntegration(`/api/soar/integrations/grc/${req.params.action}`, {
    body: req.body,
    authHeader: req.headers.authorization,
  });
  if (!result.ok) return soarErr(res, result.message, result.status >= 400 ? result.status : 502);
  return soarOk(res, result.data || { ok: true }, result.message);
});

router.post('/integrations/uctc/:action', async (req, res) => {
  if (!guard(res)) return;
  const result = await forwardPlatformIntegration(`/api/soar/integrations/uctc/${req.params.action}`, {
    body: req.body,
    authHeader: req.headers.authorization,
  });
  if (!result.ok) return soarErr(res, result.message, result.status >= 400 ? result.status : 502);
  return soarOk(res, result.data || { ok: true }, result.message);
});

router.post('/integrations/phishing/campaign', async (req, res) => {
  if (!guard(res)) return;
  const result = await forwardPlatformIntegration('/api/soar/integrations/phishing/campaign', {
    body: req.body,
    authHeader: req.headers.authorization,
  });
  if (!result.ok) return soarErr(res, result.message, result.status >= 400 ? result.status : 502);
  return soarOk(res, result.data || { ok: true }, result.message);
});

router.post('/integrations/modules/incident', async (req, res) => {
  if (!guard(res)) return;
  const { proxyToSoarGateway } = await import('../../lib/gateway-proxy.js');
  const proxied = await proxyToSoarGateway('/api/soar/integrations/modules/incident', {
    body: req.body,
    authHeader: req.headers.authorization,
  });
  if (!proxied.ok) return soarErr(res, proxied.message, proxied.status >= 400 ? proxied.status : 502);
  return soarOk(res, proxied.data, proxied.message, 201);
});

router.post('/integrations/elastic/event', async (req, res) => {
  if (!guard(res)) return;
  const { proxyToSoarGateway } = await import('../../lib/gateway-proxy.js');
  const proxied = await proxyToSoarGateway('/api/soar/integrations/elastic/event', {
    body: req.body,
    authHeader: req.headers.authorization,
  });
  if (!proxied.ok) return soarErr(res, proxied.message, proxied.status >= 400 ? proxied.status : 502);
  return soarOk(res, proxied.data, proxied.message, 201);
});

router.post('/integrations/elastic/poll', async (req, res) => {
  if (!guard(res)) return;
  const { proxyToSoarGateway } = await import('../../lib/gateway-proxy.js');
  const proxied = await proxyToSoarGateway('/api/soar/integrations/elastic/poll', {
    body: req.body,
    authHeader: req.headers.authorization,
  });
  if (!proxied.ok) return soarErr(res, proxied.message, proxied.status >= 400 ? proxied.status : 502);
  return soarOk(res, proxied.data, proxied.message);
});

router.post('/integrations/siem/event', async (req, res) => {
  if (!guard(res)) return;
  const { Alert } = getSoarModels();
  const payload = req.body && typeof req.body === 'object' ? req.body : { raw: req.body };
  const row = await Alert.create({
    tenantId: ctx(req).tenantId,
    title: String(payload.title || payload.message || payload.eventType || 'SIEM event'),
    severity: String(payload.severity || 'medium'),
    source: String(payload.source || 'siem'),
    status: 'new',
    raw: payload,
  });
  return soarOk(res, {
    ok: true,
    message: 'SIEM event ingested',
    event_id: String(row._id),
    alert_id: String(row._id),
  });
});

router.post('/integrations/network/block-ip', async (req, res) => {
  if (!guard(res)) return;
  if (!req.body?.incidentId) {
    return soarErr(res, 'incidentId is required for governed network block', 400);
  }
  const c = ctx(req);
  const doc = await getIncidentDoc(req.body.incidentId, c);
  if (!doc) return soarErr(res, 'Incident not found', 404);
  const result = await executeAction(doc, 'block_ip', { ip: req.body.ip, ...req.body }, c.userId);
  return soarOk(res, result, result.message);
});

router.post('/integrations/network/isolate-host', async (req, res) => {
  if (!guard(res)) return;
  if (!req.body?.incidentId) {
    return soarErr(res, 'incidentId is required for governed host isolation', 400);
  }
  const c = ctx(req);
  const host = req.body.host || req.body.hostname;
  const doc = await getIncidentDoc(req.body.incidentId, c);
  if (!doc) return soarErr(res, 'Incident not found', 404);
  const result = await executeAction(doc, 'isolate_host', { host, ...req.body }, c.userId);
  return soarOk(res, result, result.message);
});

router.post('/integrations/firewall/block-ip', async (req, res) => {
  if (!guard(res)) return;
  if (!req.body?.incidentId) {
    return soarErr(res, 'incidentId is required for governed firewall block', 400);
  }
  const c = ctx(req);
  const doc = await getIncidentDoc(req.body.incidentId, c);
  if (!doc) return soarErr(res, 'Incident not found', 404);
  const result = await executeAction(doc, 'block_ip', { ip: req.body.ip, ...req.body }, c.userId);
  return soarOk(res, result, result.message);
});

router.post('/integrations/edr/isolate-host', async (req, res) => {
  if (!guard(res)) return;
  if (!req.body?.incidentId) {
    return soarErr(res, 'incidentId is required for governed host isolation', 400);
  }
  const c = ctx(req);
  const host = req.body.host || req.body.hostname;
  const doc = await getIncidentDoc(req.body.incidentId, c);
  if (!doc) return soarErr(res, 'Incident not found', 404);
  const result = await executeAction(doc, 'isolate_host', { host, ...req.body }, c.userId);
  return soarOk(res, result, result.message);
});

router.post('/integrations/threat-intel/enrich-ip', async (req, res) => {
  if (!guard(res)) return;
  if (!req.body?.incidentId) {
    return soarErr(res, 'incidentId is required for enrichment', 400);
  }
  const c = ctx(req);
  const doc = await getIncidentDoc(req.body.incidentId, c);
  if (!doc) return soarErr(res, 'Incident not found', 404);
  const result = await executeAction(doc, 'enrich_ip', req.body, c.userId);
  return soarOk(res, result, result.message);
});

router.post('/integrations/threat-intel/scan-hash', async (req, res) => {
  if (!guard(res)) return;
  if (!req.body?.incidentId) {
    return soarErr(res, 'incidentId is required for hash scan', 400);
  }
  const c = ctx(req);
  const doc = await getIncidentDoc(req.body.incidentId, c);
  if (!doc) return soarErr(res, 'Incident not found', 404);
  const result = await executeAction(doc, 'scan_hash', req.body, c.userId);
  return soarOk(res, result, result.message);
});

router.post('/integrations/notify/slack', async (req, res) => {
  if (!guard(res)) return;
  if (!req.body?.incidentId) {
    return soarErr(res, 'incidentId is required for Slack notification', 400);
  }
  const c = ctx(req);
  const doc = await getIncidentDoc(req.body.incidentId, c);
  if (!doc) return soarErr(res, 'Incident not found', 404);
  const result = await executeAction(doc, 'notify_soc_slack', req.body, c.userId, req.headers.authorization);
  return soarOk(res, result, result.message);
});

router.post('/integrations/notify/email', async (req, res) => {
  if (!guard(res)) return;
  if (!req.body?.incidentId) {
    return soarErr(res, 'incidentId is required for email notification', 400);
  }
  const c = ctx(req);
  const doc = await getIncidentDoc(req.body.incidentId, c);
  if (!doc) return soarErr(res, 'Incident not found', 404);
  const result = await executeAction(doc, 'notify_email', req.body, c.userId, req.headers.authorization);
  return soarOk(res, result, result.message);
});

router.post('/integrations/notify/telegram', async (req, res) => {
  if (!guard(res)) return;
  if (!req.body?.incidentId) {
    return soarErr(res, 'incidentId is required for Telegram notification', 400);
  }
  const c = ctx(req);
  const doc = await getIncidentDoc(req.body.incidentId, c);
  if (!doc) return soarErr(res, 'Incident not found', 404);
  const result = await executeAction(doc, 'notify_telegram', req.body, c.userId, req.headers.authorization);
  return soarOk(res, result, result.message);
});

// ── SYSTEM ────────────────────────────────────────────────────
router.get('/system/status', async (req, res) => {
  const { isMongoConnected } = await import('../../mongo.js');
  return soarOk(res, {
    ok: true,
    mode: 'node-mongo',
    services: {
      database: { ok: isMongoConnected() },
      workflow_engine: { ok: true },
    },
  });
});

export default router;
