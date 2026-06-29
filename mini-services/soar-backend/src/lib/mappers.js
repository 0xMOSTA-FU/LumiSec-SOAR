/** Map Mongo documents → SOAR API contract (matches Next mappers.ts) */

export function incidentToApi(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    _id: String(o._id),
    title: o.title,
    description: o.description || '',
    severity: o.severity,
    status: o.status,
    assigned_to: o.assigned_to,
    assignee: o.assigned_to,
    source: o.source,
    source_alert_id: o.source_alert_id,
    tags: o.tags || [],
    created_at: o.createdAt?.toISOString?.() || o.created_at,
    updated_at: o.updatedAt?.toISOString?.() || o.updated_at,
    createdAt: o.createdAt?.toISOString?.() || o.created_at,
    updatedAt: o.updatedAt?.toISOString?.() || o.updated_at,
  };
}

export function alertToApi(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    _id: String(o._id),
    title: o.title,
    description: o.description,
    severity: o.severity,
    status: o.status,
    source: o.source,
    incident_id: o.incident_id,
    case_id: o.incident_id,
    created_at: o.createdAt?.toISOString?.(),
    updated_at: o.updatedAt?.toISOString?.(),
    createdAt: o.createdAt?.toISOString?.(),
    updatedAt: o.updatedAt?.toISOString?.(),
  };
}

export function connectorToApi(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  const status = o.status === 'connected' ? 'active' : o.status === 'error' ? 'error' : 'inactive';
  return {
    id: String(o._id),
    _id: String(o._id),
    name: o.name,
    type: o.type,
    category: o.category,
    description: o.description,
    status,
    created_at: o.createdAt?.toISOString?.(),
    updated_at: o.updatedAt?.toISOString?.(),
  };
}

export function playbookToApi(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    _id: String(o._id),
    name: o.name,
    description: o.description,
    category: o.category,
    status: o.status,
    trigger_type: o.trigger || 'manual',
    step_count: Array.isArray(o.steps) ? o.steps.length : 0,
    steps: o.steps || [],
    workflow_id: o.workflow_id,
    created_at: o.createdAt?.toISOString?.(),
    updated_at: o.updatedAt?.toISOString?.(),
  };
}

export function playbookRunToApi(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  const durationMs = o.duration_ms ?? (
    o.completed_at && o.started_at
      ? new Date(o.completed_at) - new Date(o.started_at)
      : null
  );
  return {
    id: String(o._id),
    playbook_id: o.playbook_id,
    playbook_name: o.playbook_name,
    incident_id: o.incident_id,
    status: o.status === 'success' ? 'completed' : o.status,
    started_at: o.started_at?.toISOString?.() || o.createdAt?.toISOString?.(),
    completed_at: o.completed_at?.toISOString?.() || null,
    triggered_by: o.triggered_by,
    duration: durationMs != null ? `${Math.round(durationMs / 1000)}s` : null,
    steps: (o.logs || []).map((log, i) => ({
      id: `${o._id}-step-${i}`,
      name: log.nodeLabel || log.message || `Step ${i + 1}`,
      status: log.level === 'error' ? 'failed' : 'completed',
      output: log.message || null,
      logs: log.message || null,
      order: i,
    })),
  };
}

export function artifactToApi(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    type: o.type,
    value: o.value,
    tlp: o.tlp || 'amber',
    enriched: !!o.enriched,
    incident_id: o.incidentId,
    created_at: o.createdAt?.toISOString?.(),
  };
}
