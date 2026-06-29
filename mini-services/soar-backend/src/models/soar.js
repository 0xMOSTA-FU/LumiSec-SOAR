/**
 * Industry SOAR domain models (MongoDB / Mongoose).
 */
import mongoose from 'mongoose';
import { isMongoConnected } from '../mongo.js';
import { soarErr } from '../lib/envelope.js';

// ── Incident (Cases in industry SOAR) ─────────────────────────
const TimelineEntrySchema = new mongoose.Schema({
  time: { type: Date, default: Date.now },
  actor: { type: String, default: 'System' },
  actorType: { type: String, default: 'system' },
  message: { type: String, default: '' },
  type: { type: String, default: 'event' },
}, { _id: false });

const NoteSchema = new mongoose.Schema({
  author: { type: String, required: true },
  body: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
}, { _id: true });

const IncidentArtifactSchema = new mongoose.Schema({
  type: { type: String, required: true },
  value: { type: String, required: true },
  description: { type: String },
  tlp: { type: String, default: 'amber' },
  enriched: { type: Boolean, default: false },
  enrichment: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

const SoarIncidentSchema = new mongoose.Schema({
  tenantId: { type: String, index: true, default: 'default' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium', index: true },
  status: { type: String, default: 'open', index: true },
  assigned_to: { type: String, default: null },
  source: { type: String, default: 'manual' },
  source_alert_id: { type: String, index: true, sparse: true },
  tags: { type: [String], default: [] },
  timeline: { type: [TimelineEntrySchema], default: [] },
  notes: { type: [NoteSchema], default: [] },
  artifacts: { type: [IncidentArtifactSchema], default: [] },
  related_incident_ids: { type: [String], default: [] },
  raw: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

SoarIncidentSchema.index({ title: 'text', description: 'text' });

// ── Alert ─────────────────────────────────────────────────────
const SoarAlertSchema = new mongoose.Schema({
  tenantId: { type: String, index: true, default: 'default' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  severity: { type: String, default: 'medium', index: true },
  status: { type: String, default: 'new', index: true },
  source: { type: String, default: 'manual' },
  incident_id: { type: String, index: true, sparse: true },
  assignee: { type: String },
  iocs: { type: [mongoose.Schema.Types.Mixed], default: [] },
  raw: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

// ── Connector (inbound integrations) ──────────────────────────
const ConnectorSchema = new mongoose.Schema({
  tenantId: { type: String, index: true, default: 'default' },
  name: { type: String, required: true },
  type: { type: String, required: true, index: true },
  category: { type: String, default: 'other' },
  description: { type: String },
  status: { type: String, default: 'inactive', index: true },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

// ── Vault ─────────────────────────────────────────────────────
const VaultSecretSchema = new mongoose.Schema({
  tenantId: { type: String, index: true, default: 'default' },
  name: { type: String, required: true },
  type: { type: String, default: 'api_key' },
  description: { type: String },
  valueEnc: { type: String, required: true },
  lastUsedAt: { type: Date },
}, { timestamps: true });

// ── Global artifact registry ───────────────────────────────────
const SoarArtifactSchema = new mongoose.Schema({
  tenantId: { type: String, index: true, default: 'default' },
  incidentId: { type: String, index: true, sparse: true },
  type: { type: String, required: true, index: true },
  value: { type: String, required: true, index: true },
  description: { type: String },
  tlp: { type: String, default: 'amber' },
  enriched: { type: Boolean, default: false },
  enrichment: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

// ── Playbook ──────────────────────────────────────────────────
const PlaybookSchema = new mongoose.Schema({
  tenantId: { type: String, index: true, default: 'default' },
  name: { type: String, required: true },
  description: { type: String },
  category: { type: String, default: 'incident_response' },
  status: { type: String, default: 'draft', index: true },
  workflow_id: { type: String },
  trigger: { type: String, default: 'manual' },
  steps: { type: [mongoose.Schema.Types.Mixed], default: [] },
  tags: { type: [String], default: [] },
}, { timestamps: true });

// ── Playbook run (workflow execution mirror) ───────────────────
const PlaybookRunSchema = new mongoose.Schema({
  tenantId: { type: String, index: true, default: 'default' },
  playbook_id: { type: String, index: true },
  playbook_name: { type: String },
  incident_id: { type: String, index: true, sparse: true },
  workflow_id: { type: String },
  status: { type: String, default: 'running', index: true },
  triggered_by: { type: String, default: 'System' },
  started_at: { type: Date, default: Date.now },
  completed_at: { type: Date },
  duration_ms: { type: Number },
  logs: { type: [mongoose.Schema.Types.Mixed], default: [] },
  result: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

// ── Notification ──────────────────────────────────────────────
const NotificationSchema = new mongoose.Schema({
  tenantId: { type: String, index: true, default: 'default' },
  userId: { type: String, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  read: { type: Boolean, default: false, index: true },
  resource_type: { type: String },
  resource_id: { type: String },
}, { timestamps: true });

// ── Webhook source ────────────────────────────────────────────
const WebhookSourceSchema = new mongoose.Schema({
  tenantId: { type: String, index: true, default: 'default' },
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  secret: { type: String },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

let models = null;

export async function ensureSoarModels() {
  if (!isMongoConnected()) return null;
  if (models) return models;

  models = {
    Incident: mongoose.models.SoarIncident || mongoose.model('SoarIncident', SoarIncidentSchema),
    Alert: mongoose.models.SoarAlert || mongoose.model('SoarAlert', SoarAlertSchema),
    Connector: mongoose.models.SoarConnector || mongoose.model('SoarConnector', ConnectorSchema),
    VaultSecret: mongoose.models.VaultSecret || mongoose.model('VaultSecret', VaultSecretSchema),
    Artifact: mongoose.models.SoarArtifact || mongoose.model('SoarArtifact', SoarArtifactSchema),
    Playbook: mongoose.models.SoarPlaybook || mongoose.model('SoarPlaybook', PlaybookSchema),
    PlaybookRun: mongoose.models.PlaybookRun || mongoose.model('PlaybookRun', PlaybookRunSchema),
    Notification: mongoose.models.SoarNotification || mongoose.model('SoarNotification', NotificationSchema),
    WebhookSource: mongoose.models.WebhookSource || mongoose.model('WebhookSource', WebhookSourceSchema),
  };
  return models;
}

export function getSoarModels() {
  return models;
}

export function requireMongo(res) {
  if (!isMongoConnected() || !models) {
    soarErr(res, 'MongoDB required — set MONGODB_URI and restart backend', 503);
    return false;
  }
  return true;
}
