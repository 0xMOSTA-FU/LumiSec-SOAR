// Incidents API — CRUD with Mongo + in-memory fallback.

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getIncidentModel, useMongo, getMemoryStores } from '../models.js';
import { asyncHandler, paginate } from '../middleware/util.js';

const router = express.Router();

// GET /api/incidents
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, severity, status, source, q } = req.query;

  if (useMongo() && getIncidentModel()) {
    const filter = {};
    if (severity) filter.severity = severity;
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (q) filter.$text = { $search: String(q) };

    const total = await getIncidentModel().countDocuments(filter);
    const items = await getIncidentModel()
      .find(filter)
      .sort({ updatedAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();
    return res.json({
      data: items,
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
    });
  }

  // In-memory fallback
  const stores = getMemoryStores();
  let items = [...stores.incidents].sort((a, b) =>
    new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
  );
  if (severity) items = items.filter(i => i.severity === severity);
  if (status) items = items.filter(i => i.status === status);
  if (source) items = items.filter(i => i.source === source);
  if (q) {
    const ql = String(q).toLowerCase();
    items = items.filter(i =>
      (i.title || '').toLowerCase().includes(ql) ||
      (i.description || '').toLowerCase().includes(ql)
    );
  }
  res.json(paginate(items, Number(page), Number(limit)));
}));

// GET /api/incidents/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (useMongo() && getIncidentModel()) {
    const incident = await getIncidentModel().findById(id).lean();
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    return res.json(incident);
  }

  const stores = getMemoryStores();
  const incident = stores.incidents.find(i => i.id === id || i._id === id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });
  res.json(incident);
}));

// POST /api/incidents
router.post('/', asyncHandler(async (req, res) => {
  const { title, description = '', severity = 'medium', status = 'open', source = 'manual', soarCaseId, tags = [], artifacts = [], raw = {} } = req.body;

  if (!title) return res.status(400).json({ error: 'title is required' });

  if (useMongo() && getIncidentModel()) {
    const created = await getIncidentModel().create({
      title, description, severity, status, source,
      soarCaseId: soarCaseId || null,
      externalId: uuidv4(),
      tags, artifacts, raw,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });
    return res.status(201).json(created);
  }

  // In-memory
  const newIncident = {
    _id: uuidv4(),
    id: uuidv4(),
    externalId: uuidv4(),
    title, description, severity, status, source,
    soarCaseId: soarCaseId || null,
    tags, artifacts, raw,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  getMemoryStores().incidents.push(newIncident);
  res.status(201).json(newIncident);
}));

// PUT /api/incidents/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  delete updates._id;
  delete updates.id;
  updates.updatedAt = new Date();
  if (updates.status === 'closed' || updates.status === 'resolved') {
    updates.closedAt = new Date();
  }
  updates.lastSeenAt = new Date();

  if (useMongo() && getIncidentModel()) {
    const updated = await getIncidentModel().findByIdAndUpdate(id, updates, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Incident not found' });
    return res.json(updated);
  }

  const stores = getMemoryStores();
  const idx = stores.incidents.findIndex(i => i.id === id || i._id === id);
  if (idx === -1) return res.status(404).json({ error: 'Incident not found' });
  stores.incidents[idx] = { ...stores.incidents[idx], ...updates };
  res.json(stores.incidents[idx]);
}));

// POST /api/incidents/:id/mirror
// Next.js pushes status/timeline updates after local incident response (no executor here).
router.post('/:id/mirror', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, timelineEvent, lastAction, soarCaseId } = req.body || {};

  const applyMirror = (incident) => {
    if (status) incident.status = status;
    if (timelineEvent) {
      incident.timeline = Array.isArray(incident.timeline) ? incident.timeline : [];
      incident.timeline.push({ time: new Date().toISOString(), event: timelineEvent });
    }
    if (lastAction) incident.lastAction = lastAction;
    if (soarCaseId) incident.soarCaseId = soarCaseId;
    incident.updatedAt = new Date();
    incident.lastSeenAt = new Date();
    return incident;
  };

  if (useMongo() && getIncidentModel()) {
    const orClause = [{ _id: id }, { id }, { soarCaseId: id }];
    if (soarCaseId) orClause.push({ soarCaseId });
    const existing = await getIncidentModel().findOne({ $or: orClause }).lean();
    if (!existing) {
      return res.status(404).json({ error: 'Incident not found for mirror', soarCaseId: id });
    }
    const setFields = {
      updatedAt: new Date(),
      lastSeenAt: new Date(),
    };
    if (status) setFields.status = status;
    if (lastAction) setFields.lastAction = lastAction;
    if (soarCaseId) setFields.soarCaseId = soarCaseId;

    const updateDoc = { $set: setFields };
    if (timelineEvent) {
      updateDoc.$push = { timeline: { time: new Date().toISOString(), event: timelineEvent } };
    }

    const updated = await getIncidentModel().findByIdAndUpdate(existing._id, updateDoc, { new: true }).lean();
    return res.json({ ok: true, mirrored: true, incident: updated });
  }

  const stores = getMemoryStores();
  const idx = stores.incidents.findIndex(i =>
    i.id === id || i._id === id || i.soarCaseId === id || i.soarCaseId === (soarCaseId || id),
  );
  if (idx === -1) {
    return res.status(404).json({ error: 'Incident not found for mirror', soarCaseId: id });
  }
  stores.incidents[idx] = applyMirror({ ...stores.incidents[idx] });
  res.json({ ok: true, mirrored: true, incident: stores.incidents[idx] });
}));

// DELETE /api/incidents/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (useMongo() && getIncidentModel()) {
    const result = await getIncidentModel().findByIdAndDelete(id);
    if (!result) return res.status(404).json({ error: 'Incident not found' });
    return res.json({ ok: true, deleted: id });
  }

  const stores = getMemoryStores();
  const idx = stores.incidents.findIndex(i => i.id === id || i._id === id);
  if (idx === -1) return res.status(404).json({ error: 'Incident not found' });
  stores.incidents.splice(idx, 1);
  res.json({ ok: true, deleted: id });
}));

export default router;
