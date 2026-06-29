// Assets API — CMDB-style asset inventory.

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getAssetModel, useMongo, getMemoryStores } from '../models.js';
import { asyncHandler, paginate } from '../middleware/util.js';

const router = express.Router();

// GET /api/assets
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, type, status, criticality, q } = req.query;

  if (useMongo() && getAssetModel()) {
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (criticality) filter.criticality = criticality;
    if (q) filter.$or = [
      { hostname: { $regex: String(q), $options: 'i' } },
      { ip: { $regex: String(q), $options: 'i' } },
    ];

    const total = await getAssetModel().countDocuments(filter);
    const items = await getAssetModel()
      .find(filter)
      .sort({ updatedAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();
    return res.json({ data: items, page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) });
  }

  const stores = getMemoryStores();
  let items = [...stores.assets];
  if (type) items = items.filter(a => a.type === type);
  if (status) items = items.filter(a => a.status === status);
  if (criticality) items = items.filter(a => a.criticality === criticality);
  if (q) {
    const ql = String(q).toLowerCase();
    items = items.filter(a => (a.hostname || '').toLowerCase().includes(ql) || (a.ip || '').includes(ql));
  }
  res.json(paginate(items, Number(page), Number(limit)));
}));

// GET /api/assets/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (useMongo() && getAssetModel()) {
    const asset = await getAssetModel().findById(id).lean();
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    return res.json(asset);
  }
  const asset = getMemoryStores().assets.find(a => a.id === id || a._id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(asset);
}));

// POST /api/assets — create or upsert
router.post('/', asyncHandler(async (req, res) => {
  const { hostname, ip, type, os, location, criticality, tags = [], metadata = {} } = req.body;
  if (!hostname) return res.status(400).json({ error: 'hostname is required' });

  if (useMongo() && getAssetModel()) {
    // Upsert by hostname
    const updated = await getAssetModel().findOneAndUpdate(
      { hostname },
      { $set: { hostname, ip, type, os, location, criticality, tags, metadata, lastSeenAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json(updated);
  }

  const stores = getMemoryStores();
  const existing = stores.assets.find(a => a.hostname === hostname);
  if (existing) {
    Object.assign(existing, { hostname, ip, type, os, location, criticality, tags, metadata, lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return res.json(existing);
  }
  const newAsset = {
    _id: uuidv4(), id: uuidv4(),
    hostname, ip, type: type || 'unknown', os, location,
    criticality: criticality || 'medium',
    tags, metadata,
    status: 'active',
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  stores.assets.push(newAsset);
  res.status(201).json(newAsset);
}));

// PUT /api/assets/:id/status — update status (e.g., quarantine, isolate)
router.put('/:id/status', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const validStatuses = ['active', 'decommissioned', 'quarantined', 'isolated'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  if (useMongo() && getAssetModel()) {
    const updated = await getAssetModel().findByIdAndUpdate(id, { status, lastSeenAt: new Date() }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Asset not found' });
    return res.json(updated);
  }

  const stores = getMemoryStores();
  const asset = stores.assets.find(a => a.id === id || a._id === id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  asset.status = status;
  asset.lastSeenAt = new Date().toISOString();
  asset.updatedAt = new Date().toISOString();
  res.json(asset);
}));

export default router;
