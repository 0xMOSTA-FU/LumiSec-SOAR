import mongoose from 'mongoose';
import { getSoarModels } from '../models/soar.js';
import { incidentToApi } from '../lib/mappers.js';
import { paginated } from '../lib/envelope.js';
import { buildRecommendations, executeAction } from './recommendations.js';
import { proxyToSoarGateway } from '../lib/gateway-proxy.js';

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function normalizeTimeline(entries) {
  return (entries || []).map((e, i) => ({
    id: `tl-${i}`,
    type: e.type || (e.body ? 'note' : 'event'),
    description: e.message || e.event || e.body || '',
    actor: e.actor || 'System',
    timestamp: (e.time instanceof Date ? e.time.toISOString() : e.time) || new Date().toISOString(),
  }));
}

export async function listIncidents(ctx, page, limit, filters = {}) {
  const { Incident } = getSoarModels();
  const where = { tenantId: ctx.tenantId };
  if (filters.status) where.status = filters.status;
  if (filters.severity) where.severity = filters.severity;
  if (filters.assigned_to) where.assigned_to = filters.assigned_to;

  const skip = (page - 1) * limit;
  const [total, rows] = await Promise.all([
    Incident.countDocuments(where),
    Incident.find(where).sort({ updatedAt: -1 }).skip(skip).limit(limit),
  ]);
  return paginated(rows.map(incidentToApi), page, limit, total, 'incidents');
}

export async function getIncidentById(id, ctx) {
  if (!isValidId(id)) return null;
  const { Incident } = getSoarModels();
  const row = await Incident.findOne({ _id: id, tenantId: ctx.tenantId });
  return row ? incidentToApi(row) : null;
}

export async function getIncidentDoc(id, ctx) {
  if (!isValidId(id)) return null;
  const { Incident } = getSoarModels();
  return Incident.findOne({ _id: id, tenantId: ctx.tenantId });
}

export async function createIncident(ctx, body) {
  const { Incident, Alert } = getSoarModels();
  const row = await Incident.create({
    tenantId: ctx.tenantId,
    title: body.title,
    description: body.description || '',
    severity: body.severity || 'medium',
    status: 'open',
    assigned_to: body.assigned_to || body.assignee || null,
    source: body.source || 'manual',
    source_alert_id: body.source_alert_id || null,
    tags: body.tags || [],
    timeline: [{
      time: new Date(),
      actor: 'System',
      actorType: 'system',
      message: 'Incident created',
      type: 'event',
    }],
  });

  if (body.source_alert_id && isValidId(body.source_alert_id)) {
    await Alert.updateOne(
      { _id: body.source_alert_id, tenantId: ctx.tenantId },
      { incident_id: String(row._id), status: 'escalated' },
    );
  }

  return incidentToApi(row);
}

export async function patchIncident(id, ctx, patch) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return null;

  if (patch.status) doc.status = patch.status;
  if (patch.severity) doc.severity = patch.severity;
  if (patch.title) doc.title = patch.title;
  if (patch.description !== undefined) doc.description = patch.description;
  if (patch.assigned_to !== undefined) doc.assigned_to = patch.assigned_to;
  if (patch.assignee !== undefined) doc.assigned_to = patch.assignee;
  if (patch.tags) doc.tags = patch.tags;

  if (patch.status) {
    doc.timeline.push({
      time: new Date(),
      actor: ctx.userEmail || ctx.userId,
      actorType: 'analyst',
      message: `Status changed to ${patch.status}`,
      type: 'status',
    });
  }

  await doc.save();
  return incidentToApi(doc);
}

export async function closeIncident(id, ctx) {
  return patchIncident(id, ctx, { status: 'closed' });
}

export async function deleteIncident(id, ctx) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return false;
  const { Alert, Artifact } = getSoarModels();
  await Alert.updateMany({ incident_id: String(id) }, { incident_id: null });
  await Artifact.deleteMany({ incidentId: String(id), tenantId: ctx.tenantId });
  await doc.deleteOne();
  return true;
}

export async function getTimeline(id, ctx) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return null;
  return normalizeTimeline(doc.timeline);
}

export async function getNotes(id, ctx) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return null;
  return (doc.notes || []).map((n) => ({
    id: String(n._id),
    author: n.author,
    body: n.body,
    created_at: (n.created_at instanceof Date ? n.created_at : new Date(n.created_at)).toISOString(),
  }));
}

export async function addNote(id, ctx, body, author) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return null;
  doc.notes.push({ author, body, created_at: new Date() });
  doc.timeline.push({
    time: new Date(),
    actor: author,
    actorType: 'analyst',
    message: body,
    type: 'note',
  });
  await doc.save();
  return getNotes(id, ctx);
}

export async function getIncidentArtifacts(id, ctx) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return null;
  const { Artifact } = getSoarModels();
  const global = await Artifact.find({ incidentId: String(id), tenantId: ctx.tenantId });
  const embedded = (doc.artifacts || []).map((a, i) => ({
    id: `emb-${i}`,
    type: a.type,
    value: a.value,
    tlp: a.tlp || 'amber',
    enriched: !!a.enriched,
    incident_id: String(id),
    created_at: a.createdAt?.toISOString?.() || new Date().toISOString(),
  }));
  const fromDb = global.map((a) => ({
    id: String(a._id),
    type: a.type,
    value: a.value,
    tlp: a.tlp,
    enriched: a.enriched,
    incident_id: a.incidentId,
    created_at: a.createdAt.toISOString(),
  }));
  return [...embedded, ...fromDb];
}

export async function addIncidentArtifact(id, ctx, body) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return null;
  const { Artifact } = getSoarModels();
  const art = {
    type: body.type,
    value: body.value,
    description: body.description,
    tlp: body.tlp || 'amber',
  };
  doc.artifacts.push(art);
  doc.timeline.push({
    time: new Date(),
    actor: ctx.userEmail || ctx.userId,
    actorType: 'analyst',
    message: `Artifact added: ${body.type} ${body.value}`,
    type: 'artifact',
  });
  await doc.save();
  const global = await Artifact.create({
    tenantId: ctx.tenantId,
    incidentId: String(id),
    ...art,
  });
  return {
    id: String(global._id),
    type: global.type,
    value: global.value,
    incident_id: String(id),
    created_at: global.createdAt.toISOString(),
  };
}

export async function getRelatedIncidents(id, ctx) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return [];
  const { Incident } = getSoarModels();
  const ids = doc.related_incident_ids || [];
  if (!ids.length) {
    const related = await Incident.find({
      _id: { $ne: doc._id },
      tenantId: ctx.tenantId,
    }).sort({ updatedAt: -1 }).limit(10);
    return related.map(incidentToApi);
  }
  const related = await Incident.find({
    _id: { $in: ids.filter(isValidId) },
    tenantId: ctx.tenantId,
  });
  return related.map(incidentToApi);
}

export async function linkRelatedIncident(id, ctx, relatedId) {
  const doc = await getIncidentDoc(id, ctx);
  const related = await getIncidentDoc(relatedId, ctx);
  if (!doc || !related) return null;

  if (!doc.related_incident_ids.includes(String(related._id))) {
    doc.related_incident_ids.push(String(related._id));
  }
  if (!related.related_incident_ids.includes(String(doc._id))) {
    related.related_incident_ids.push(String(doc._id));
  }

  doc.timeline.push({
    time: new Date(),
    actor: ctx.userEmail || ctx.userId,
    actorType: 'analyst',
    message: `Linked to incident: ${related.title}`,
    type: 'related',
  });

  await Promise.all([doc.save(), related.save()]);
  return incidentToApi(related);
}

export async function getIncidentSummary(id, ctx) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return null;
  const artifacts = await getIncidentArtifacts(id, ctx);
  return {
    id: String(doc._id),
    title: doc.title,
    severity: doc.severity,
    status: doc.status,
    source: doc.source,
    artifact_count: artifacts.length,
    timeline_count: (doc.timeline || []).length,
    note_count: (doc.notes || []).length,
    tags: doc.tags || [],
    assigned_to: doc.assigned_to,
    created_at: doc.createdAt.toISOString(),
    updated_at: doc.updatedAt.toISOString(),
  };
}

export async function getRecommendations(id, ctx) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return null;
  const { Connector } = getSoarModels();
  const connectors = await Connector.find({ tenantId: ctx.tenantId });
  const actions = buildRecommendations(
    { ...doc.toObject(), artifacts: doc.artifacts },
    connectors.map((c) => c.toObject()),
  );
  return { actions, incident_id: String(id) };
}

export async function respondToIncident(id, ctx, actionId, params, authHeader) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return null;
  const result = await executeAction(doc, actionId, params, ctx.userEmail || ctx.userId, authHeader);
  return result;
}


export async function runPlaybookOnIncident(id, ctx, body, authHeader) {
  const doc = await getIncidentDoc(id, ctx);
  if (!doc) return { ok: false, message: 'Incident not found' };

  const proxied = await proxyToSoarGateway(`/api/soar/incidents/${id}/playbooks/run`, {
    body,
    authHeader,
  });
  if (proxied.ok) {
    doc.timeline.push({
      time: new Date(),
      actor: ctx.userEmail || ctx.userId,
      actorType: 'automation',
      message: proxied.message || `Playbook executed via SOAR gateway`,
      type: 'playbook',
    });
    await doc.save();
    return {
      ok: true,
      message: proxied.message,
      ...(proxied.data && typeof proxied.data === 'object' ? proxied.data : { data: proxied.data }),
    };
  }

  return {
    ok: false,
    message:
      proxied.message ||
      'Workflow engine requires Prisma SOAR gateway. Set SOAR_WORKFLOW_GATEWAY_URL=http://localhost:3000 and SOAR_INTERNAL_API_KEY, or disable SOAR_USE_NODE_BACKEND.',
  };
}
