import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, internalErrorResponse } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/auth';
import {
  ACTION_PERMISSIONS,
  RespondSchema,
} from '@/lib/incidents/governed-respond';
import { encrypt } from '@/lib/crypto';
import { mergeIntegrationConfig, decryptIntegrationConfig, encryptIntegrationConfig, maskIntegrationConfig } from '@/lib/integrations/config-secrets';
import { resolveExecutorType } from '@/lib/integrations/catalog';
import { executeGovernedIntegrationAction } from '@/lib/incidents/governed-integration-action';
import type { ResponseActionId } from '@/lib/incidents/types';
import { runIncidentAction } from '@/lib/incidents/run-action';
import type { ArtifactType } from '@/lib/incidents/types';
import { loadFullIncidentContext } from '@/lib/incidents/load-context';
import { resolveConnectedIntegrations } from '@/lib/incidents/recommended-actions';
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
} from './incidents-service';
import { escalateAlert, bulkAlertAction } from './alerts-service';
import { bulkIncidentAction } from './bulk-service';
import { globalSearch } from './search-service';
import { listApprovals, approveApproval, rejectApproval } from './approvals-service';
import { soarOk, soarErr, queryPageLimit, paginated, parseJson } from './envelope';
import {
  alertToSoar,
  integrationToConnector,
  playbookToSoar,
  executionToPlaybookRun,
  caseToIncident,
} from './mappers';
import {
  parseAnalyticsDays,
  getDashboardOverview,
  getDashboardPlaybooks,
  getDashboardAutomation,
  getDashboardAnalysts,
  getAnalyticsKpis,
  getAnalyticsSnapshots,
  getAnalyticsReport,
  buildAnalyticsCsv,
} from '@/lib/soar/metrics/dashboard-metrics';
import { afterAlertIngested } from '@/lib/soar/alerts/ingest-alert';
import {
  callPlatformOutbound,
  fetchPlatformLookup,
  isPlatformOutboundConfigured,
  pingPlatformModules,
  platformFetch,
} from '@/lib/lumisec-api/platform-outbound';

type Ctx = { tenantWhere: Record<string, unknown>; userId: string; requestId?: string; ctx: import('@/lib/auth').AuthContext };

async function auth(req: NextRequest, permission: string) {
  const authed = await requireAuth(req, permission as never);
  if (authed instanceof NextResponse) return authed;
  return {
    tenantWhere: authed.tenantWhere,
    userId: authed.ctx.userId || 'local-admin',
    requestId: authed.ctx.requestId,
    ctx: authed.ctx,
  } satisfies Ctx & { ctx: typeof authed.ctx };
}

async function runGovernedIntegrationRoute(
  req: NextRequest,
  actionId: ResponseActionId,
  permission: string,
): Promise<NextResponse> {
  const authed = await requireAuth(req, permission as never);
  if (authed instanceof NextResponse) return authed;
  const body = await req.json();
  const outcome = await executeGovernedIntegrationAction(
    actionId,
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {},
    authed.ctx,
    authed.tenantWhere,
  );
  if (outcome.kind === 'error') {
    return soarErr(outcome.message, outcome.status, outcome.error);
  }
  if (!outcome.result.ok) {
    return soarErr(outcome.result.message || 'Action failed', 502);
  }
  return soarOk(outcome.result, outcome.result.message);
}

export async function handleSoarRequest(
  req: NextRequest,
  pathSegments: string[],
): Promise<NextResponse> {
  const segments = pathSegments[0] === 'cases'
    ? ['incidents', ...pathSegments.slice(1)]
    : pathSegments;
  const method = req.method;
  const [a, b, c, d] = segments;

  try {
    // ── INCIDENTS ─────────────────────────────────────────────
    if (a === 'incidents' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const sp = req.nextUrl.searchParams;
      const { page, limit } = queryPageLimit(sp);
      const data = await listIncidents(ctx.tenantWhere, page, limit, {
        status: sp.get('status') || undefined,
        severity: sp.get('severity') || undefined,
        assigned_to: sp.get('assigned_to') || undefined,
        date_from: sp.get('date_from') || undefined,
        date_to: sp.get('date_to') || undefined,
      });
      return soarOk(data);
    }

    if (a === 'incidents' && !b && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const data = await createIncident(ctx.tenantWhere, body);
      return soarOk(data, 'Incident created', 201);
    }

    if (a === 'incidents' && b === 'bulk' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const result = await bulkIncidentAction(ctx.tenantWhere, body, ctx.userId);
      return soarOk(result, `Processed ${result.processed} incident(s)`);
    }

    if (a === 'incidents' && b && !c && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const data = await getIncidentById(b, ctx.tenantWhere);
      if (!data) return soarErr('Incident not found', 404);
      return soarOk(data);
    }

    if (a === 'incidents' && b && !c && (method === 'PATCH' || method === 'PUT')) {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const data = await patchIncident(b, ctx.tenantWhere, body);
      if (!data) return soarErr('Incident not found', 404);
      return soarOk(data);
    }

    if (a === 'incidents' && b && !c && method === 'DELETE') {
      const ctx = await auth(req, PERMISSIONS.CASE_DELETE);
      if (ctx instanceof NextResponse) return ctx;
      const ok = await deleteIncident(b, ctx.tenantWhere);
      if (!ok) return soarErr('Incident not found', 404);
      return soarOk({ deleted: true });
    }

    if (a === 'incidents' && b && c === 'close' && method === 'PATCH') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const data = await closeIncident(b, ctx.tenantWhere);
      if (!data) return soarErr('Incident not found', 404);
      return soarOk(data);
    }

    if (a === 'incidents' && b && c === 'timeline' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const data = await getTimeline(b, ctx.tenantWhere);
      if (!data) return soarErr('Incident not found', 404);
      return soarOk({ timeline: data, events: data });
    }

    if (a === 'incidents' && b && c === 'notes' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const data = await getNotes(b, ctx.tenantWhere);
      if (!data) return soarErr('Incident not found', 404);
      return soarOk({ notes: data });
    }

    if (a === 'incidents' && b && c === 'notes' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const text = String(body.body || body.content || body.note || '');
      const data = await addNote(b, ctx.tenantWhere, text, ctx.userId);
      if (!data) return soarErr('Incident not found', 404);
      return soarOk({ notes: data });
    }

    if (a === 'incidents' && b && c === 'artifacts' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const data = await getIncidentArtifacts(b, ctx.tenantWhere);
      if (!data) return soarErr('Incident not found', 404);
      return soarOk({ artifacts: data });
    }

    if (a === 'incidents' && b && c === 'artifacts' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const data = await addIncidentArtifact(b, ctx.tenantWhere, body);
      if (!data) return soarErr('Incident not found', 404);
      return soarOk(data, 'Artifact added', 201);
    }

    if (a === 'incidents' && b && c === 'related' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const data = await getRelatedIncidents(b, ctx.tenantWhere);
      return soarOk({ related: data });
    }

    if (a === 'incidents' && b && c === 'related' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const relatedId = String(body.related_incident_id || body.relatedIncidentId || '');
      if (!relatedId) return soarErr('related_incident_id required', 400);
      const data = await linkRelatedIncident(b, ctx.tenantWhere, relatedId, ctx.userId);
      if (!data) return soarErr('Incident or related incident not found', 404);
      return soarOk(data, 'Incidents linked');
    }

    if (a === 'incidents' && b && c === 'summary' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const data = await getIncidentSummary(b, ctx.tenantWhere);
      if (!data) return soarErr('Incident not found', 404);
      return soarOk(data);
    }

    if (a === 'incidents' && b && c === 'recommendations' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const data = await getRecommendations(b, ctx.tenantWhere);
      if (!data) return soarErr('Incident not found', 404);
      return soarOk(data);
    }

    if (a === 'incidents' && b && c === 'respond' && method === 'POST') {
      let body;
      try {
        body = RespondSchema.parse(await req.json());
      } catch {
        return soarErr('Invalid request body', 400);
      }
      const authed = await requireAuth(req, ACTION_PERMISSIONS[body.actionId]);
      if (authed instanceof NextResponse) return authed;
      const result = await respondToIncident(b, authed.tenantWhere, body, authed.ctx);
      if (!result) return soarErr('Incident not found', 404);
      if ('error' in result && result.error) {
        const status = typeof result.status === 'number' ? result.status : 400;
        return soarErr(result.message, status, String(result.error));
      }
      if (!result.ok) return soarErr(result.message || 'Action failed', 502);
      return soarOk(result, result.message);
    }

    if (a === 'incidents' && b && c === 'playbooks' && d === 'run' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_EXECUTE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const result = await runPlaybookOnIncident(b, ctx.tenantWhere, body, ctx.userId, ctx.requestId);
      return soarOk(result, result.message);
    }

    // ── ALERTS ──────────────────────────────────────────────
    if (a === 'alerts' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.ALERT_READ);
      if (ctx instanceof NextResponse) return ctx;
      const sp = req.nextUrl.searchParams;
      const { page, limit } = queryPageLimit(sp);
      const skipVal = (page - 1) * limit;
      const where = { ...ctx.tenantWhere };
      if (sp.get('status')) (where as Record<string, string>).status = sp.get('status')!;
      const [total, rows] = await Promise.all([
        db.alert.count({ where }),
        db.alert.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipVal, take: limit }),
      ]);
      return soarOk(paginated(rows.map((a) => alertToSoar(a)), page, limit, total, 'alerts'));
    }

    if (a === 'alerts' && !b && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.ALERT_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const row = await db.alert.create({
        data: {
          tenantId: (ctx.tenantWhere.tenantId as string) || null,
          title: body.title,
          description: body.description,
          source: body.source || 'manual',
          severity: body.severity || 'medium',
          status: body.status || 'new',
          assigneeId: body.assigned_to || body.assigneeId || null,
          caseId: body.case_id || body.caseId || null,
          raw: JSON.stringify(body.raw || {}),
          iocs: JSON.stringify(body.iocs || []),
        },
      });
      await afterAlertIngested(row, ctx.tenantWhere);
      return soarOk(alertToSoar(row), 'Alert created', 201);
    }

    if (a === 'alerts' && b === 'bulk' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.ALERT_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const result = await bulkAlertAction(ctx.tenantWhere, body);
      return soarOk(result, `Processed ${result.processed} alert(s)`);
    }

    if (a === 'alerts' && b && !c && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.ALERT_READ);
      if (ctx instanceof NextResponse) return ctx;
      const row = await db.alert.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Alert not found', 404);
      return soarOk(alertToSoar(row));
    }

    if (a === 'alerts' && b && c === 'escalate' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.ALERT_ESCALATE);
      if (ctx instanceof NextResponse) return ctx;
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const result = await escalateAlert(b, ctx.tenantWhere, {
        title: body.title ? String(body.title) : undefined,
        severity: body.severity ? String(body.severity) : undefined,
        assigned_to: body.assigned_to ? String(body.assigned_to) : null,
      });
      if (!result) return soarErr('Alert not found', 404);
      return soarOk(result, result.deduplicated ? 'Already escalated' : 'Escalated to incident', 201);
    }

    if (a === 'alerts' && b && !c && (method === 'PATCH' || method === 'PUT')) {
      const ctx = await auth(req, PERMISSIONS.ALERT_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const existing = await db.alert.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Alert not found', 404);
      const row = await db.alert.update({
        where: { id: b },
        data: {
          ...(body.status ? { status: body.status } : {}),
          ...(body.severity ? { severity: body.severity } : {}),
          ...(body.title ? { title: body.title } : {}),
          ...(body.case_id || body.incident_id ? { caseId: body.case_id || body.incident_id } : {}),
        },
      });
      return soarOk(alertToSoar(row));
    }

    if (a === 'alerts' && b && !c && method === 'DELETE') {
      const ctx = await auth(req, PERMISSIONS.ALERT_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const existing = await db.alert.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Alert not found', 404);
      await db.alert.delete({ where: { id: b } });
      return soarOk({ deleted: true });
    }

    // ── CONNECTORS (= Integration) ────────────────────────────
    if (a === 'connectors' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      const sp = req.nextUrl.searchParams;
      const { page, limit } = queryPageLimit(sp);
      const skip = (page - 1) * limit;
      const [total, rows] = await Promise.all([
        db.integration.count({ where: ctx.tenantWhere }),
        db.integration.findMany({ where: ctx.tenantWhere, skip, take: limit, orderBy: { name: 'asc' } }),
      ]);
      const items = rows.map(i => ({ ...integrationToConnector(i), raw: { type: i.type, category: i.category } }));
      return soarOk(paginated(items, page, limit, total, 'connectors'));
    }

    if (a === 'connectors' && !b && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const row = await db.integration.create({
        data: {
          tenantId: (ctx.tenantWhere.tenantId as string) || null,
          name: body.name,
          type: body.type,
          description: body.description,
          category: body.category || 'security',
          config: encryptIntegrationConfig((body.config || {}) as Record<string, unknown>),
          status: 'disconnected',
        },
      });
      let testResult = null;
      if (body.config && Object.keys(body.config as object).length > 0) {
        const { testAndUpdateIntegrationStatus } = await import('@/lib/integrations/integration-runtime');
        testResult = await testAndUpdateIntegrationStatus(row.id);
        const refreshed = await db.integration.findUnique({ where: { id: row.id } });
        return soarOk(
          {
            ...integrationToConnector(refreshed ?? row),
            test: testResult,
            connected: testResult.ok,
          },
          'Connector created',
          201,
        );
      }
      return soarOk(integrationToConnector(row), 'Connector created', 201);
    }

    if (a === 'connectors' && b && !c && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      const row = await db.integration.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Connector not found', 404);
      const cfg = decryptIntegrationConfig(row.config);
      return soarOk({
        ...integrationToConnector(row),
        config: maskIntegrationConfig(cfg),
        has_config: Object.values(cfg).some(v => typeof v === 'string' && v.length > 0),
      });
    }

    if (a === 'connectors' && b && !c && (method === 'PATCH' || method === 'PUT')) {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const existing = await db.integration.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Connector not found', 404);
      const data: Record<string, unknown> = {};
      if (body.name) data.name = body.name;
      if (body.type) data.type = body.type;
      if (body.description !== undefined) data.description = body.description;
      if (body.config) {
        const stored = decryptIntegrationConfig(existing.config);
        data.config = encryptIntegrationConfig(
          mergeIntegrationConfig(stored, body.config as Record<string, unknown>),
        );
      }
      const row = await db.integration.update({ where: { id: b }, data });
      let testResult = null;
      if (body.config) {
        const { testAndUpdateIntegrationStatus } = await import('@/lib/integrations/integration-runtime');
        testResult = await testAndUpdateIntegrationStatus(b);
        const refreshed = await db.integration.findUnique({ where: { id: b } });
        return soarOk({
          ...integrationToConnector(refreshed ?? row),
          test: testResult,
          connected: testResult.ok,
        });
      }
      return soarOk(integrationToConnector(row));
    }

    if (a === 'connectors' && b && !c && method === 'DELETE') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_DELETE);
      if (ctx instanceof NextResponse) return ctx;
      const existing = await db.integration.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Connector not found', 404);
      await db.integration.delete({ where: { id: b } });
      return soarOk({ deleted: true });
    }

    if (a === 'connectors' && b && c === 'test' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const { testIntegrationConnectivity } = await import('@/lib/integrations/test-connectivity');
      const row = await db.integration.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Connector not found', 404);
      const config = decryptIntegrationConfig(row.config);
      const result = await testIntegrationConnectivity(
        resolveExecutorType(row.type, row.name),
        config,
        row.name,
      );
      await db.integration.update({
        where: { id: b },
        data: {
          status: result.ok ? 'connected' : 'error',
          lastTestedAt: new Date(),
          lastTestResult: result as object,
        },
      });
      return soarOk({
        success: result.ok,
        status: result.ok ? 'active' : 'error',
        message: result.message,
        last_tested_at: new Date().toISOString(),
      });
    }

    if (a === 'connectors' && b && c === 'actions' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      const row = await db.integration.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Connector not found', 404);
      const { getConnectorActionsForIntegration } = await import('@/lib/integrations/connector-actions');
      const actions = getConnectorActionsForIntegration(row.type, row.name);
      return soarOk({ actions });
    }

    // ── VAULT ─────────────────────────────────────────────────
    if (a === 'vault' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      const sp = req.nextUrl.searchParams;
      const { page, limit } = queryPageLimit(sp);
      const skip = (page - 1) * limit;
      const [total, rows] = await Promise.all([
        db.vaultSecret.count({ where: ctx.tenantWhere }),
        db.vaultSecret.findMany({ where: ctx.tenantWhere, skip, take: limit, orderBy: { name: 'asc' } }),
      ]);
      const items = rows.map(r => ({
        id: r.id,
        name: r.name,
        type: r.type,
        description: r.description,
        created_at: r.createdAt.toISOString(),
        last_used_at: r.lastUsedAt?.toISOString() ?? null,
        has_value: Boolean(r.valueEnc),
      }));
      return soarOk(paginated(items, page, limit, total, 'entries'));
    }

    if (a === 'vault' && !b && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const row = await db.vaultSecret.create({
        data: {
          tenantId: (ctx.tenantWhere.tenantId as string) || null,
          name: body.name,
          type: body.type || 'api_key',
          description: body.description,
          valueEnc: encrypt(body.value || body.plaintext || ''),
        },
      });
      return soarOk({
        id: row.id,
        name: row.name,
        type: row.type,
        created_at: row.createdAt.toISOString(),
        has_value: true,
      }, 'Vault entry created', 201);
    }

    if (a === 'vault' && b && !c && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      const row = await db.vaultSecret.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Vault entry not found', 404);
      return soarOk({
        id: row.id,
        name: row.name,
        type: row.type,
        description: row.description,
        created_at: row.createdAt.toISOString(),
        has_value: Boolean(row.valueEnc),
      });
    }

    if (a === 'vault' && b && !c && (method === 'PATCH' || method === 'PUT')) {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const existing = await db.vaultSecret.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Vault entry not found', 404);
      const row = await db.vaultSecret.update({
        where: { id: b },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.type ? { type: body.type } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.value || body.plaintext ? { valueEnc: encrypt(body.value || body.plaintext) } : {}),
        },
      });
      return soarOk({ id: row.id, name: row.name });
    }

    if (a === 'vault' && b && c === 'reveal' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      const { decrypt } = await import('@/lib/crypto');
      const row = await db.vaultSecret.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Vault entry not found', 404);
      await db.vaultSecret.update({ where: { id: b }, data: { lastUsedAt: new Date() } });
      let value = '';
      try { value = decrypt(row.valueEnc) || ''; } catch { value = ''; }
      return soarOk({ id: row.id, value, name: row.name });
    }

    if (a === 'vault' && b && !c && method === 'DELETE') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_DELETE);
      if (ctx instanceof NextResponse) return ctx;
      const existing = await db.vaultSecret.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Vault entry not found', 404);
      await db.vaultSecret.delete({ where: { id: b } });
      return soarOk({ deleted: true });
    }

    // ── ARTIFACTS (global) ────────────────────────────────────
    if (a === 'artifacts' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const sp = req.nextUrl.searchParams;
      const { page, limit } = queryPageLimit(sp);
      const skip = (page - 1) * limit;
      const where = { ...ctx.tenantWhere };
      if (sp.get('incident_id')) (where as Record<string, string>).incidentId = sp.get('incident_id')!;
      const [total, rows] = await Promise.all([
        db.soarArtifact.count({ where }),
        db.soarArtifact.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      ]);
      const incidentIds = [...new Set(rows.map(r => r.incidentId).filter((id): id is string => Boolean(id)))];
      const incidentTitles = incidentIds.length
        ? new Map(
            (await db.case.findMany({
              where: { id: { in: incidentIds }, ...ctx.tenantWhere },
              select: { id: true, title: true },
            })).map(c => [c.id, c.title] as const),
          )
        : new Map<string, string>();
      const items = rows.map(r => ({
        id: r.id,
        type: r.type,
        value: r.value,
        tlp: r.tlp,
        description: r.description,
        enriched: r.enriched,
        incident_id: r.incidentId,
        source_incident: r.incidentId,
        source_incident_title: r.incidentId ? incidentTitles.get(r.incidentId) ?? null : null,
        created_at: r.createdAt.toISOString(),
      }));
      return soarOk(paginated(items, page, limit, total, 'artifacts'));
    }

    if (a === 'artifacts' && !b && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const row = await db.soarArtifact.create({
        data: {
          tenantId: (ctx.tenantWhere.tenantId as string) || null,
          incidentId: body.incident_id || body.incidentId || null,
          type: body.type,
          value: body.value,
          description: body.description,
          tlp: body.tlp || 'amber',
        },
      });
      return soarOk({
        id: row.id,
        type: row.type,
        value: row.value,
        incident_id: row.incidentId,
        enriched: row.enriched,
        created_at: row.createdAt.toISOString(),
      }, 'Artifact created', 201);
    }

    if (a === 'artifacts' && b === 'enrich' && c === 'bulk' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_EXECUTE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const ids = (body.artifact_ids || body.artifactIds || []) as string[];
      const results: Array<{ id: string; enriched: boolean; message?: string }> = [];
      for (const artId of ids) {
        const art = await db.soarArtifact.findFirst({ where: { id: artId, ...ctx.tenantWhere } });
        if (!art) continue;
        const incident = art.incidentId
          ? await loadFullIncidentContext(art.incidentId, ctx.tenantWhere)
          : null;
        const params: Record<string, unknown> = { hash: art.value, ip: art.value };
        const actionId = art.type === 'hash' ? 'scan_hash' : 'enrich_ip';
        const result = incident
          ? await runIncidentAction(actionId as never, incident, { userId: ctx.userId, params })
          : await runIncidentAction(actionId as never, {
            id: artId, kind: 'case', title: art.value, description: '', severity: 'medium',
            status: 'open', source: 'artifact', tags: [], artifacts: [{ type: art.type as ArtifactType, value: art.value }],
            ips: art.type === 'ip' ? [art.value] : [], hostnames: [], hashes: art.type === 'hash' ? [art.value] : [],
            domains: art.type === 'domain' ? [art.value] : [], users: [], emails: [], raw: {}, timeline: [], caseId: null,
          }, { userId: ctx.userId, params });
        if (result.ok) {
          await db.soarArtifact.update({
            where: { id: artId },
            data: { enriched: true, enrichment: JSON.stringify(result) },
          });
        }
        results.push({ id: artId, enriched: result.ok, message: result.message });
      }
      return soarOk({ enriched: results.filter(r => r.enriched).length, results });
    }

    if (a === 'artifacts' && b && !c && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const art = await db.soarArtifact.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!art) return soarErr('Artifact not found', 404);
      return soarOk({
        id: art.id,
        type: art.type,
        value: art.value,
        incident_id: art.incidentId,
        enriched: art.enriched,
        created_at: art.createdAt.toISOString(),
      });
    }

    if (a === 'artifacts' && b && !c && method === 'PATCH') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const existing = await db.soarArtifact.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Artifact not found', 404);
      const row = await db.soarArtifact.update({
        where: { id: b },
        data: {
          ...(body.type ? { type: body.type } : {}),
          ...(body.value ? { value: body.value } : {}),
          ...(body.tlp ? { tlp: body.tlp } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
        },
      });
      return soarOk({
        id: row.id,
        type: row.type,
        value: row.value,
        incident_id: row.incidentId,
        enriched: row.enriched,
        created_at: row.createdAt.toISOString(),
      });
    }

    if (a === 'artifacts' && b && !c && method === 'DELETE') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const existing = await db.soarArtifact.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Artifact not found', 404);
      await db.soarArtifact.delete({ where: { id: b } });
      return soarOk({ deleted: true });
    }

    if (a === 'artifacts' && b && c === 'enrich' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_EXECUTE);
      if (ctx instanceof NextResponse) return ctx;
      const art = await db.soarArtifact.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!art) return soarErr('Artifact not found', 404);
      const incident = art.incidentId
        ? await loadFullIncidentContext(art.incidentId, ctx.tenantWhere)
        : null;
      const params: Record<string, unknown> = { hash: art.value, ip: art.value };
      const actionId = art.type === 'hash' ? 'scan_hash' : 'enrich_ip';
      const result = incident
        ? await runIncidentAction(actionId as never, incident, { userId: ctx.userId, params })
        : await runIncidentAction(actionId as never, {
          id: b, kind: 'case', title: art.value, description: '', severity: 'medium',
          status: 'open', source: 'artifact', tags: [], artifacts: [{ type: art.type as ArtifactType, value: art.value }],
          ips: art.type === 'ip' ? [art.value] : [], hostnames: [], hashes: art.type === 'hash' ? [art.value] : [],
          domains: art.type === 'domain' ? [art.value] : [], users: [], emails: [], raw: {}, timeline: [], caseId: null,
        }, { userId: ctx.userId, params });
      if (result.ok) {
        await db.soarArtifact.update({
          where: { id: b },
          data: { enriched: true, enrichment: JSON.stringify(result) },
        });
      }
      return soarOk({ enriched: result.ok, result });
    }

    // ── PLAYBOOKS ─────────────────────────────────────────────
    if (a === 'playbooks' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_READ);
      if (ctx instanceof NextResponse) return ctx;
      const rows = await db.playbook.findMany({ where: ctx.tenantWhere, orderBy: { name: 'asc' } });
      return soarOk({ playbooks: rows.map(playbookToSoar), items: rows.map(playbookToSoar) });
    }

    if (a === 'playbooks' && b && !c && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_READ);
      if (ctx instanceof NextResponse) return ctx;
      const row = await db.playbook.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Playbook not found', 404);
      return soarOk(playbookToSoar(row));
    }

    if (a === 'playbooks' && !b && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const steps = body.steps ?? body.actions ?? [];
      const triggers = body.triggers ?? (body.trigger ? [body.trigger] : []);
      const row = await db.playbook.create({
        data: {
          tenantId: (ctx.tenantWhere.tenantId as string) || null,
          name: body.name,
          description: body.description,
          category: body.category || 'incident_response',
          status: body.status || 'active',
          workflowId: body.workflow_id || body.workflowId || null,
          steps: JSON.stringify(Array.isArray(steps) ? steps : []),
          triggers: JSON.stringify(Array.isArray(triggers) ? triggers : []),
          tags: JSON.stringify(body.tags || []),
        },
      });
      return soarOk(playbookToSoar(row), 'Playbook created', 201);
    }

    if (a === 'playbooks' && b && !c && (method === 'PATCH' || method === 'PUT')) {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const existing = await db.playbook.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Playbook not found', 404);
      const updateData: Record<string, unknown> = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.category !== undefined) updateData.category = body.category;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.workflow_id !== undefined || body.workflowId !== undefined) {
        updateData.workflowId = body.workflow_id || body.workflowId || null;
      }
      if (body.steps !== undefined || body.actions !== undefined) {
        const steps = body.steps ?? body.actions ?? [];
        updateData.steps = JSON.stringify(Array.isArray(steps) ? steps : []);
      }
      if (body.triggers !== undefined) {
        updateData.triggers = JSON.stringify(Array.isArray(body.triggers) ? body.triggers : []);
      }
      if (body.tags !== undefined) {
        updateData.tags = JSON.stringify(Array.isArray(body.tags) ? body.tags : []);
      }
      const row = await db.playbook.update({
        where: { id: b },
        data: updateData,
      });
      return soarOk(playbookToSoar(row));
    }

    if (a === 'playbooks' && b && !c && method === 'DELETE') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_DELETE);
      if (ctx instanceof NextResponse) return ctx;
      const existing = await db.playbook.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Playbook not found', 404);
      await db.playbook.delete({ where: { id: b } });
      return soarOk({ deleted: true });
    }

    // ── PLAYBOOK RUNS ─────────────────────────────────────────
    if (a === 'playbook-runs' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_READ);
      if (ctx instanceof NextResponse) return ctx;
      const sp = req.nextUrl.searchParams;
      const { page, limit } = queryPageLimit(sp);
      const playbookId = sp.get('playbook_id') || sp.get('playbookId');
      const skip = (page - 1) * limit;

      const rows = await db.workflowExecution.findMany({
        where: ctx.tenantWhere,
        orderBy: { startedAt: 'desc' },
        take: 500,
      });

      const filtered = rows.filter((e) => {
        const trigger = parseJson<Record<string, unknown>>(e.trigger, {});
        if (trigger.testRun === true) return false;
        if (playbookId) {
          return String(trigger.playbook_id || '') === playbookId;
        }
        return Boolean(trigger.playbook_id);
      });

      const total = filtered.length;
      const pageRows = filtered.slice(skip, skip + limit);
      const items = pageRows.map(e => executionToPlaybookRun(e));
      return soarOk(paginated(items, page, limit, total, 'runs'));
    }

    if (a === 'playbook-runs' && b && c === 'cancel' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_EXECUTE);
      if (ctx instanceof NextResponse) return ctx;
      const row = await db.workflowExecution.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Run not found', 404);
      const updated = await db.workflowExecution.update({
        where: { id: b },
        data: { status: 'cancelled', endedAt: new Date() },
      });
      return soarOk(executionToPlaybookRun(updated), 'Run cancelled');
    }

    if (a === 'playbook-runs' && b && c === 'pause' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_EXECUTE);
      if (ctx instanceof NextResponse) return ctx;
      const row = await db.workflowExecution.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Run not found', 404);
      const updated = await db.workflowExecution.update({
        where: { id: b },
        data: { status: 'paused' },
      });
      return soarOk(executionToPlaybookRun(updated), 'Run paused');
    }

    if (a === 'playbook-runs' && b && c === 'resume' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_EXECUTE);
      if (ctx instanceof NextResponse) return ctx;
      const row = await db.workflowExecution.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Run not found', 404);
      const updated = await db.workflowExecution.update({
        where: { id: b },
        data: { status: 'running' },
      });
      return soarOk(executionToPlaybookRun(updated), 'Run resumed');
    }

    if (a === 'playbook-runs' && b && !c && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_READ);
      if (ctx instanceof NextResponse) return ctx;
      const row = await db.workflowExecution.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!row) return soarErr('Run not found', 404);
      return soarOk(executionToPlaybookRun(row));
    }

    // ── DASHBOARD ─────────────────────────────────────────────
    if (a === 'dashboard' && b === 'overview' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      return soarOk(await getDashboardOverview(ctx.tenantWhere));
    }

    if (a === 'dashboard' && b === 'incidents' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const sp = req.nextUrl.searchParams;
      const { page, limit } = queryPageLimit(sp);
      const skip = (page - 1) * limit;
      const [total, rows] = await Promise.all([
        db.case.count({ where: ctx.tenantWhere }),
        db.case.findMany({
          where: ctx.tenantWhere,
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
          include: { assignee: { select: { email: true, fullName: true } } },
        }),
      ]);
      return soarOk(paginated(
        rows.map(c => ({
          id: c.id,
          title: c.title,
          severity: c.severity,
          status: c.status,
          assigned_to: c.assignee?.fullName || c.assignee?.email || c.assigneeId,
          created_at: c.createdAt.toISOString(),
        })),
        page,
        limit,
        total,
        'incidents',
      ));
    }

    if (a === 'dashboard' && b === 'playbooks' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_READ);
      if (ctx instanceof NextResponse) return ctx;
      return soarOk(await getDashboardPlaybooks(ctx.tenantWhere));
    }

    if (a === 'dashboard' && b === 'automation' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.WORKFLOW_READ);
      if (ctx instanceof NextResponse) return ctx;
      return soarOk(await getDashboardAutomation(ctx.tenantWhere));
    }

    if (a === 'dashboard' && b === 'analysts' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      return soarOk(await getDashboardAnalysts(ctx.tenantWhere));
    }

    if (a === 'dashboard' && b === 'connectors' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      const rows = await db.integration.findMany({ where: ctx.tenantWhere, take: 20 });
      return soarOk({
        connectors: rows.map(i => ({
          name: i.name,
          type: i.type,
          status: i.status === 'connected' ? 'active' : 'inactive',
          last_seen: i.lastTestedAt?.toISOString() ?? null,
        })),
      });
    }

    // ── ANALYTICS ─────────────────────────────────────────────
    if (a === 'analytics' && b === 'kpis' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const days = parseAnalyticsDays(req.nextUrl.searchParams.get('days'));
      return soarOk(await getAnalyticsKpis(ctx.tenantWhere, days));
    }

    if (a === 'analytics' && b === 'snapshots' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const days = parseAnalyticsDays(req.nextUrl.searchParams.get('days'));
      return soarOk(await getAnalyticsSnapshots(ctx.tenantWhere, days));
    }

    if (a === 'analytics' && b === 'report' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const days = parseAnalyticsDays(req.nextUrl.searchParams.get('days'));
      return soarOk(await getAnalyticsReport(ctx.tenantWhere, days));
    }

    if (a === 'analytics' && b === 'export' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json().catch(() => ({})) as { format?: string; days?: number };
      const days = parseAnalyticsDays(String(body.days ?? '30'));
      const report = await getAnalyticsReport(ctx.tenantWhere, days);
      const format = body.format === 'csv' ? 'csv' : 'json';
      if (format === 'csv') {
        return soarOk({
          format: 'csv',
          filename: `lumisec-analytics-${days}d.csv`,
          content: buildAnalyticsCsv(report),
        });
      }
      return soarOk({ format: 'json', filename: `lumisec-analytics-${days}d.json`, content: report });
    }

    // ── NOTIFICATIONS ─────────────────────────────────────────
    if (a === 'notifications' && b === 'unread-count' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const count = await db.soarNotification.count({
        where: { ...ctx.tenantWhere, read: false },
      });
      return soarOk({ count });
    }

    if (a === 'notifications' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const { page, limit, skip } = queryPageLimit(req.nextUrl.searchParams);
      const where = ctx.tenantWhere;
      const [total, rows] = await Promise.all([
        db.soarNotification.count({ where }),
        db.soarNotification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);
      return soarOk(
        paginated(
          rows.map(n => ({
            id: n.id,
            type: n.title.toLowerCase().includes('alert') ? 'alert' : 'incident',
            title: n.title,
            message: n.message,
            body: n.message,
            read: n.read,
            created_at: n.createdAt.toISOString(),
            resource_type: n.title.toLowerCase().includes('alert') ? 'alert' : 'incident',
            resource_id: null,
          })),
          page,
          limit,
          total,
          'notifications',
        ),
      );
    }

    if (a === 'notifications' && b === 'read-all' && method === 'PATCH') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      await db.soarNotification.updateMany({ where: ctx.tenantWhere, data: { read: true } });
      return soarOk({ updated: true });
    }

    if (a === 'notifications' && b && c === 'read' && method === 'PATCH') {
      const ctx = await auth(req, PERMISSIONS.CASE_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      await db.soarNotification.updateMany({
        where: { id: b, ...ctx.tenantWhere },
        data: { read: true },
      });
      return soarOk({ read: true });
    }

    // ── WEBHOOK SOURCES ───────────────────────────────────────
    if (a === 'webhook-sources' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      const rows = await db.webhookSource.findMany({ where: ctx.tenantWhere });
      return soarOk({
        sources: rows.map(w => ({
          id: w.id,
          name: w.name,
          slug: w.slug,
          type: w.slug,
          enabled: w.enabled,
          status: w.enabled ? 'active' : 'inactive',
          workflow_id: w.workflowId,
          webhook_url: `/api/webhook/${w.slug}`,
          url: `/api/webhook/${w.slug}`,
          created_at: w.createdAt.toISOString(),
        })),
      });
    }

    if (a === 'webhook-sources' && !b && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const slug = String(body.slug || body.name || 'source').toLowerCase().replace(/\s+/g, '-');
      const row = await db.webhookSource.create({
        data: {
          tenantId: (ctx.tenantWhere.tenantId as string) || null,
          name: body.name || slug,
          slug,
          secret: body.secret || null,
          workflowId: body.workflow_id || body.workflowId || null,
          enabled: body.enabled !== false,
        },
      });
      return soarOk({
        id: row.id,
        name: row.name,
        slug: row.slug,
        workflow_id: row.workflowId,
        webhook_url: `/api/webhook/${row.slug}`,
        url: `/api/webhook/${row.slug}`,
      }, 'Webhook source created', 201);
    }

    if (a === 'webhook-sources' && b && !c && method === 'PATCH') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const existing = await db.webhookSource.findFirst({ where: { id: b, ...ctx.tenantWhere } });
      if (!existing) return soarErr('Webhook source not found', 404);
      const body = await req.json();
      const row = await db.webhookSource.update({
        where: { id: b },
        data: {
          ...(body.name != null ? { name: String(body.name) } : {}),
          ...(body.enabled != null ? { enabled: Boolean(body.enabled) } : {}),
          ...(body.workflow_id != null || body.workflowId != null
            ? { workflowId: body.workflow_id ?? body.workflowId ?? null }
            : {}),
        },
      });
      return soarOk({
        id: row.id,
        name: row.name,
        slug: row.slug,
        enabled: row.enabled,
        workflow_id: row.workflowId,
        webhook_url: `/api/webhook/${row.slug}`,
      });
    }

    if (a === 'webhook-sources' && b && !c && method === 'DELETE') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      await db.webhookSource.deleteMany({ where: { id: b, ...ctx.tenantWhere } });
      return soarOk({ deleted: true });
    }

    // ── LUMISEC PLATFORM (status + lookups) ───────────────────
    if (a === 'platform' && b === 'status' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      if (!isPlatformOutboundConfigured()) {
        return soarOk({
          configured: false,
          ok: false,
          message: 'Set LUMISEC_PLATFORM_URL to connect LumiSec platform modules (GRC, UCTC, Phishing, LumiNet).',
          modules: {},
        });
      }
      const status = await pingPlatformModules();
      return soarOk({
        configured: true,
        ok: status.ok,
        base_url: status.baseUrl,
        modules: status.modules,
      });
    }

    if (a === 'platform' && b === 'lookups' && c === 'phishing-templates' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      if (!isPlatformOutboundConfigured()) return soarErr('Platform backend not configured', 501);
      const r = await fetchPlatformLookup('/api/phishing/templates?limit=100', req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null);
      if (!r.ok) return soarErr(r.message, r.status >= 400 ? r.status : 502);
      return soarOk(r.data || []);
    }

    if (a === 'platform' && b === 'lookups' && c === 'phishing-landing-pages' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      if (!isPlatformOutboundConfigured()) return soarErr('Platform backend not configured', 501);
      const r = await fetchPlatformLookup('/api/phishing/landing-pages?limit=100', req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null);
      if (!r.ok) return soarErr(r.message, r.status >= 400 ? r.status : 502);
      return soarOk(r.data || []);
    }

    if (a === 'platform' && b === 'lookups' && c === 'uctc-rules' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      if (!isPlatformOutboundConfigured()) return soarErr('Platform backend not configured', 501);
      const r = await fetchPlatformLookup('/api/uctc/rules?limit=100', req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null);
      if (!r.ok) return soarErr(r.message, r.status >= 400 ? r.status : 502);
      return soarOk(r.data || []);
    }

    if (a === 'platform' && b === 'luminet' && c === 'context' && d && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      if (!isPlatformOutboundConfigured()) return soarErr('Platform backend not configured', 501);
      const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
      const r = await platformFetch<Record<string, unknown>>(
        `/api/luminet/assets/context/${encodeURIComponent(d)}`,
        { jwt, audit: { module: 'luminet', action: 'context' } },
      );
      if (!r.ok) return soarErr(r.message, r.status >= 400 ? r.status : 502);
      return soarOk(r.data || {});
    }

    // ── INTEGRATION ACTIONS ───────────────────────────────────
    if (a === 'integrations' && b === 'grc' && (c === 'finding' || c === 'risk') && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      if (!isPlatformOutboundConfigured()) {
        return soarErr(
          'LumiSec GRC backend not configured. Set LUMISEC_PLATFORM_URL to the monolith in .env.',
          501,
        );
      }
      const body = (await req.json()) as Record<string, unknown>;
      const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
      const result = await callPlatformOutbound('grc', c, body, jwt);
      if (!result.ok) return soarErr(result.message, result.status >= 400 ? result.status : 502);
      await writeAudit(ctx.ctx, {
        action: `integration.grc.${c}`,
        resource: 'grc',
        resourceId: String((result.data as Record<string, unknown> | null)?.reference || c),
        description: result.message,
        metadata: { module: 'grc', action: c, source: 'outbound_actions' },
      });
      return soarOk(result.data || { ok: true }, result.message);
    }

    if (a === 'integrations' && b === 'uctc' && (c === 'rule' || c === 'rule-trigger') && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      if (!isPlatformOutboundConfigured()) {
        return soarErr(
          'LumiSec UCTC backend not configured. Set LUMISEC_PLATFORM_URL to the monolith in .env.',
          501,
        );
      }
      const body = (await req.json()) as Record<string, unknown>;
      const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
      const result = await callPlatformOutbound('uctc', c, body, jwt);
      if (!result.ok) return soarErr(result.message, result.status >= 400 ? result.status : 502);
      await writeAudit(ctx.ctx, {
        action: `integration.uctc.${c}`,
        resource: 'uctc',
        resourceId: String((result.data as Record<string, unknown> | null)?.reference || c),
        description: result.message,
        metadata: { module: 'uctc', action: c, source: 'outbound_actions' },
      });
      return soarOk(result.data || { ok: true }, result.message);
    }

    if (a === 'integrations' && b === 'phishing' && c === 'campaign' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      if (!isPlatformOutboundConfigured()) {
        return soarErr(
          'LumiSec Phishing backend not configured. Set LUMISEC_PLATFORM_URL to the monolith in .env.',
          501,
        );
      }
      const body = (await req.json()) as Record<string, unknown>;
      const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
      const result = await callPlatformOutbound('phishing', 'campaign', body, jwt);
      if (!result.ok) return soarErr(result.message, result.status >= 400 ? result.status : 502);
      await writeAudit(ctx.ctx, {
        action: 'integration.phishing.campaign',
        resource: 'phishing',
        resourceId: String(
          (result.data as Record<string, unknown> | null)?.campaign_id ||
            (result.data as Record<string, unknown> | null)?.reference ||
            'campaign',
        ),
        description: result.message,
        metadata: { module: 'phishing', action: 'campaign', source: 'outbound_actions' },
      });
      return soarOk(result.data || { ok: true }, result.message);
    }

    if (a === 'integrations' && b === 'elastic' && c === 'event' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = (await req.json()) as Record<string, unknown>;
      const { ingestElasticEvent } = await import('@/lib/integrations/elastic-ingest');
      const result = await ingestElasticEvent(body, ctx.tenantWhere);
      return soarOk(result, result.deduplicated ? 'Elastic alert deduplicated' : 'Elastic alert ingested', 201);
    }

    if (a === 'integrations' && b === 'elastic' && c === 'poll' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = (await req.json().catch(() => ({}))) as { minutes?: number; limit?: number };
      const { pollElasticIntegrations } = await import('@/lib/integrations/elastic-ingest');
      const result = await pollElasticIntegrations(ctx.tenantWhere, body);
      if (!result.ok && result.ingested === 0) {
        return soarErr(result.errors.join('; ') || 'Elastic poll failed', 502);
      }
      return soarOk(result, `Polled ${result.polled} integration(s); ${result.ingested} new alert(s)`);
    }

    if (a === 'integrations' && b === 'modules' && c === 'incident' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = (await req.json()) as Record<string, unknown>;
      const { ingestModuleIncident } = await import('@/lib/soar/ingest/module-incident');
      const result = await ingestModuleIncident(
        {
          module: String(body.module || body.sourceModule || 'platform'),
          title: String(body.title || 'Platform incident'),
          description: body.description ? String(body.description) : undefined,
          severity: body.severity ? String(body.severity) : undefined,
          sourceId: body.sourceId ? String(body.sourceId) : body.source_id ? String(body.source_id) : undefined,
          artifacts: Array.isArray(body.artifacts) ? body.artifacts as Array<{ type: string; value: string }> : undefined,
          escalate: body.escalate === true || body.createCase === true || body.create_case === true,
          assigned_to: body.assigned_to ? String(body.assigned_to) : null,
          raw: body.raw && typeof body.raw === 'object' ? body.raw as Record<string, unknown> : body,
        },
        ctx.tenantWhere,
      );
      await writeAudit(ctx.ctx, {
        action: 'integration.module.incident',
        resource: 'alert',
        resourceId: result.alert_id,
        description: result.deduplicated ? 'Module incident deduplicated' : 'Module incident ingested',
        metadata: { module: body.module, incident_id: result.incident_id },
      });
      return soarOk(result, result.deduplicated ? 'Event deduplicated' : 'Incident ingested', 201);
    }

    if (a === 'integrations' && b === 'siem' && c === 'event' && method === 'POST') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_WRITE);
      if (ctx instanceof NextResponse) return ctx;
      const body = await req.json();
      const { ingestAlertRecord } = await import('@/lib/soar/alerts/upsert-alert');
      const payload: Record<string, unknown> =
        body && typeof body === 'object' && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : { raw: body };
      const ingested = await ingestAlertRecord({
        payload: { ...payload, source: String(payload.source || 'siem') },
        tenantId: (ctx.tenantWhere.tenantId as string | null | undefined) ?? null,
        source: 'siem',
      });
      return soarOk({
        ok: true,
        message: ingested.deduplicated ? 'SIEM event deduplicated' : 'SIEM event ingested',
        event_id: ingested.alert.id,
        alert_id: ingested.alert.id,
        deduplicated: ingested.deduplicated,
        occurrence_count: ingested.alert.occurrenceCount,
        normalized: {
          title: ingested.normalized.title,
          severity: ingested.normalized.severity,
          dedup_key: ingested.normalized.dedupKey,
        },
      });
    }

    if (a === 'integrations' && b === 'network' && c === 'block-ip' && method === 'POST') {
      return runGovernedIntegrationRoute(req, 'block_ip', PERMISSIONS.CONTAIN_BLOCK_IP);
    }

    if (a === 'integrations' && b === 'network' && c === 'isolate-host' && method === 'POST') {
      return runGovernedIntegrationRoute(req, 'isolate_host', PERMISSIONS.CONTAIN_ISOLATE_HOST);
    }

    if (a === 'integrations' && b === 'firewall' && c === 'block-ip' && method === 'POST') {
      return runGovernedIntegrationRoute(req, 'block_ip', PERMISSIONS.CONTAIN_BLOCK_IP);
    }

    if (a === 'integrations' && b === 'edr' && c === 'isolate-host' && method === 'POST') {
      return runGovernedIntegrationRoute(req, 'isolate_host', PERMISSIONS.CONTAIN_ISOLATE_HOST);
    }

    if (a === 'integrations' && b === 'threat-intel' && c === 'enrich-ip' && method === 'POST') {
      return runGovernedIntegrationRoute(req, 'enrich_ip', PERMISSIONS.WORKFLOW_EXECUTE);
    }

    if (a === 'integrations' && b === 'threat-intel' && c === 'scan-hash' && method === 'POST') {
      return runGovernedIntegrationRoute(req, 'scan_hash', PERMISSIONS.WORKFLOW_EXECUTE);
    }

    if (a === 'integrations' && b === 'notify' && c === 'slack' && method === 'POST') {
      return runGovernedIntegrationRoute(req, 'notify_soc_slack', PERMISSIONS.INTEGRATION_WRITE);
    }

    if (a === 'integrations' && b === 'notify' && c === 'email' && method === 'POST') {
      return runGovernedIntegrationRoute(req, 'notify_email', PERMISSIONS.INTEGRATION_WRITE);
    }

    if (a === 'integrations' && b === 'notify' && c === 'telegram' && method === 'POST') {
      return runGovernedIntegrationRoute(req, 'notify_telegram', PERMISSIONS.INTEGRATION_WRITE);
    }

    // ── SEARCH ────────────────────────────────────────────────
    if (a === 'search' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.CASE_READ);
      if (ctx instanceof NextResponse) return ctx;
      const q = req.nextUrl.searchParams.get('q') || '';
      const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 20), 50);
      const data = await globalSearch(ctx.tenantWhere, q, limit);
      return soarOk(data);
    }

    // ── APPROVALS ─────────────────────────────────────────────
    if (a === 'approvals' && !b && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.APPROVAL_REQUEST);
      if (ctx instanceof NextResponse) return ctx;
      const status = req.nextUrl.searchParams.get('status') || 'pending';
      const approvals = await listApprovals(ctx.tenantWhere, status);
      return soarOk({ approvals });
    }

    if (a === 'approvals' && b && c === 'approve' && method === 'POST') {
      const authed = await requireAuth(req, PERMISSIONS.APPROVAL_APPROVE);
      if (authed instanceof NextResponse) return authed;
      const body = (await req.json().catch(() => ({}))) as { comment?: string };
      const result = await approveApproval(b, authed.ctx, body.comment);
      if (!result.ok) return soarErr(result.message, result.status || 400);
      return soarOk(result.data, result.message);
    }

    if (a === 'approvals' && b && c === 'reject' && method === 'POST') {
      const authed = await requireAuth(req, PERMISSIONS.APPROVAL_REJECT);
      if (authed instanceof NextResponse) return authed;
      const body = (await req.json().catch(() => ({}))) as { comment?: string };
      const result = await rejectApproval(b, authed.ctx, body.comment);
      if (!result.ok) return soarErr(result.message, result.status || 400);
      return soarOk(result.data, result.message);
    }

    // ── SYSTEM ────────────────────────────────────────────────
    if (a === 'system' && b === 'status' && method === 'GET') {
      const ctx = await auth(req, PERMISSIONS.INTEGRATION_READ);
      if (ctx instanceof NextResponse) return ctx;
      return soarOk({
        ok: true,
        mode: 'local',
        services: { database: { ok: true }, workflow_engine: { ok: true } },
      });
    }

    return soarErr(`Route not found: /api/soar/${segments.join('/')}`, 404);
  } catch (err) {
    return internalErrorResponse(err, 'SOAR API error') as NextResponse;
  }
}
