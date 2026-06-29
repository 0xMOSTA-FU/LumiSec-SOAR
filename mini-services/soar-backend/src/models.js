// Mongoose models for the external SOAR backend.

import mongoose from 'mongoose';
import { isMongoConnected, isMongoConfigured, connectMongo } from './mongo.js';

// ============================================================================
// INCIDENT
// ============================================================================

const IncidentSchema = new mongoose.Schema({
  externalId: { type: String, index: true, sparse: true },
  soarCaseId: { type: String, index: true, sparse: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium', index: true },
  status: { type: String, enum: ['open', 'investigating', 'contained', 'resolved', 'closed'], default: 'open', index: true },
  source: { type: String, default: 'manual', index: true },
  assignee: { type: String, default: null },
  tags: { type: [String], default: [] },
  artifacts: { type: [String], default: [] },
  raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
}, { timestamps: true });

// ============================================================================
// ASSET
// ============================================================================

const AssetSchema = new mongoose.Schema({
  hostname: { type: String, required: true, index: true },
  ip: { type: String, index: true, sparse: true },
  mac: { type: String, default: null },
  type: { type: String, enum: ['server', 'workstation', 'network', 'cloud', 'container', 'iot', 'mobile', 'unknown'], default: 'unknown' },
  os: { type: String, default: null },
  osVersion: { type: String, default: null },
  location: { type: String, default: null },
  criticality: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  owner: { type: String, default: null },
  tags: { type: [String], default: [] },
  status: { type: String, enum: ['active', 'decommissioned', 'quarantined', 'isolated'], default: 'active', index: true },
  lastSeenAt: { type: Date, default: Date.now },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

// ============================================================================
// THREAT INTEL (cached IOC verdicts)
// ============================================================================

const ThreatIntelSchema = new mongoose.Schema({
  ioc: { type: String, required: true, index: true },
  iocType: { type: String, enum: ['ip', 'domain', 'url', 'hash', 'email'], required: true },
  verdict: { type: String, enum: ['clean', 'suspicious', 'malicious', 'unknown'], default: 'unknown' },
  confidence: { type: Number, min: 0, max: 100, default: 0 },
  source: { type: String, default: 'internal' },
  tags: { type: [String], default: [] },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now, index: true },
  ttl: { type: Number, default: 86400 }, // seconds, 24h default
  raw: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

ThreatIntelSchema.index({ ioc: 1, iocType: 1 }, { unique: true });

// ============================================================================
// SOAR EVENT (ingestion queue from main app)
// ============================================================================

const SoarEventSchema = new mongoose.Schema({
  type: { type: String, enum: ['workflow_executed', 'alert_created', 'case_created', 'case_updated', 'integration_tested'], required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  ts: { type: Date, default: Date.now, index: true },
  sourceIp: { type: String, default: null },
  processed: { type: Boolean, default: false, index: true },
}, { timestamps: true });

// ============================================================================
// EXPORTS (with in-memory fallback if Mongo not connected)
// ============================================================================

let IncidentModel = null;
let AssetModel = null;
let ThreatIntelModel = null;
let SoarEventModel = null;

// In-memory stores (used when Mongo isn't available)
const memoryStores = {
  incidents: [],
  assets: [],
  threatIntel: [],
  soarEvents: [],
};

export async function ensureModels() {
  if (isMongoConnected()) {
    IncidentModel = mongoose.model('Incident', IncidentSchema);
    AssetModel = mongoose.model('Asset', AssetSchema);
    ThreatIntelModel = mongoose.model('ThreatIntel', ThreatIntelSchema);
    SoarEventModel = mongoose.model('SoarEvent', SoarEventSchema);
  }
}

export function getIncidentModel() {
  return IncidentModel;
}
export function getAssetModel() {
  return AssetModel;
}
export function getThreatIntelModel() {
  return ThreatIntelModel;
}
export function getSoarEventModel() {
  return SoarEventModel;
}

export function getMemoryStores() {
  return memoryStores;
}

// Helper: is Mongo available for queries?
export function useMongo() {
  return isMongoConnected();
}

export { connectMongo, isMongoConnected, isMongoConfigured };
