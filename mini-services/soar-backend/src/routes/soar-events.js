// SOAR Events API — ingestion endpoint.
// The main Next.js app pushes events here (workflow_executed, alert_created,
// case_created, case_updated, integration_tested) so the external backend
// has a real-time mirror of what's happening on the SOAR side.

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getSoarEventModel, useMongo, getMemoryStores } from '../models.js';
import { asyncHandler, paginate } from '../middleware/util.js';

const router = express.Router();

const VALID_TYPES = new Set([
  'workflow_executed',
  'alert_created',
  'case_created',
  'case_updated',
  'integration_tested',
  'incident_action_executed',
]);

// POST /api/soar-events
router.post('/', asyncHandler(async (req, res) => {
  const { type, payload, ts } = req.body;
  if (!type || !VALID_TYPES.has(type)) {
    return res.status(400).json({ error: `Invalid event type. Must be one of: ${[...VALID_TYPES].join(', ')}` });
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'payload is required (object)' });
  }

  const sourceIp = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || null;
  const eventTs = ts ? new Date(ts) : new Date();

  if (useMongo() && getSoarEventModel()) {
    const created = await getSoarEventModel().create({
      type, payload, ts: eventTs, sourceIp, processed: false,
    });
    return res.status(201).json({ ok: true, id: created._id });
  }

  const newEvent = {
    _id: uuidv4(), id: uuidv4(),
    type, payload, ts: eventTs.toISOString(),
    sourceIp, processed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  getMemoryStores().soarEvents.push(newEvent);
  res.status(201).json({ ok: true, id: newEvent.id });
}));

// GET /api/soar-events — list recent events
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, type, processed } = req.query;

  if (useMongo() && getSoarEventModel()) {
    const filter = {};
    if (type) filter.type = type;
    if (processed !== undefined) filter.processed = processed === 'true';
    const total = await getSoarEventModel().countDocuments(filter);
    const items = await getSoarEventModel()
      .find(filter)
      .sort({ ts: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();
    return res.json({ data: items, page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) });
  }

  const stores = getMemoryStores();
  let items = [...stores.soarEvents].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  if (type) items = items.filter(e => e.type === type);
  if (processed !== undefined) items = items.filter(e => e.processed === (processed === 'true'));
  res.json(paginate(items, Number(page), Number(limit)));
}));

// POST /api/soar-events/:id/process — mark as processed
router.post('/:id/process', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (useMongo() && getSoarEventModel()) {
    const updated = await getSoarEventModel().findByIdAndUpdate(id, { processed: true }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Event not found' });
    return res.json(updated);
  }
  const stores = getMemoryStores();
  const event = stores.soarEvents.find(e => e.id === id || e._id === id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  event.processed = true;
  res.json(event);
}));

export default router;
