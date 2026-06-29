// GET /api/dashboard
// Returns aggregated metrics + activity feed for the calling user's tenant.
//
// SECURITY FIX (AUDIT-2 finding #1 — CRITICAL):
// Previously this route had ZERO authentication. Anyone with network access
// could see the entire dashboard: all workflows, cases, alerts, integrations,
// executions, AND the topology of the external backend (via externalIncidents
// / externalAssets counts). This was a major data leak.
//
// Now enforces:
//   1. extractAuthContext() — must be authenticated
//   2. At least one of CASE_READ / ALERT_READ / WORKFLOW_READ (analyst+)
//   3. All queries scoped to caller's tenant (superadmin sees all)
//   4. Per-caller rate limit

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  isExternalBackendEnabled,
  listExternalIncidents,
  listExternalAssets,
} from '@/lib/external-api';
import {
  extractAuthContext,
  hasAnyPermission,
  PERMISSIONS,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const ctx = await extractAuthContext(req);
    if (ctx.authMethod === 'anonymous') {
      throw new AuthenticationError('Authentication required');
    }
    if (!hasAnyPermission(ctx, [PERMISSIONS.CASE_READ, PERMISSIONS.ALERT_READ, PERMISSIONS.WORKFLOW_READ])) {
      throw new AuthorizationError('Insufficient permissions to view dashboard');
    }

    const rl = rateLimit(ctx.userId || ctx.actorIp || 'anon', 'default');
    const rlResp = rateLimitResponse(rl);
    if (rlResp) return rlResp;

    const tenantWhere = ctx.tenantId ? { tenantId: ctx.tenantId } : {};

    const [workflows, cases, alerts, integrations, playbooks, executions] = await Promise.all([
      db.workflow.findMany({ where: tenantWhere, orderBy: { updatedAt: 'desc' } }),
      db.case.findMany({ where: tenantWhere, orderBy: { updatedAt: 'desc' } }),
      db.alert.findMany({ where: tenantWhere, orderBy: { createdAt: 'desc' }, take: 500 }),
      db.integration.findMany({ where: tenantWhere }),
      db.playbook.findMany({ orderBy: { updatedAt: 'desc' } }),
      db.workflowExecution.findMany({ where: tenantWhere, orderBy: { startedAt: 'desc' }, take: 20 }),
    ]);

    // Pull incidents + assets from the external Node.js + MongoDB backend.
    // These calls are best-effort: if the backend is offline we still return
    // the local dashboard data, just without the external counts.
    let externalIncidents = 0;
    let externalAssets = 0;
    let externalBackendOk = false;
    if (isExternalBackendEnabled()) {
      try {
        const [incidents, assets] = await Promise.all([
          listExternalIncidents(50),
          listExternalAssets(),
        ]);
        externalIncidents = incidents.length;
        externalAssets = assets.length;
        externalBackendOk = true;
      } catch {
        // Backend unreachable — counts stay at 0
      }
    }

    const openCases = cases.filter(c => c.status === 'open').length;
    const criticalCases = cases.filter(c => c.severity === 'critical').length;
    const activeWorkflows = workflows.filter(w => w.status === 'active').length;
    const newAlerts = alerts.filter(a => a.status === 'new').length;
    const connectedIntegrations = integrations.filter(i => i.status === 'connected').length;
    const runningExecutions = executions.filter(e => e.status === 'running').length;

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentAlerts = alerts.filter(a => new Date(a.createdAt) > last24h).length;
    const recentCases = cases.filter(c => new Date(c.createdAt) > last24h).length;
    const recentExecutions = executions.filter(e => new Date(e.startedAt) > last24h).length;

    const severityDist = {
      critical: alerts.filter(a => a.severity === 'critical').length,
      high: alerts.filter(a => a.severity === 'high').length,
      medium: alerts.filter(a => a.severity === 'medium').length,
      low: alerts.filter(a => a.severity === 'low').length,
    };

    const activityFeed = [
      ...alerts.slice(0, 3).map(a => ({ type: 'alert' as const, message: `New alert: ${a.title}`, time: a.createdAt, severity: a.severity })),
      ...cases.slice(0, 3).map(c => ({ type: 'case' as const, message: `Case ${c.status}: ${c.title}`, time: c.updatedAt, severity: c.severity })),
      ...executions.slice(0, 3).map(e => ({ type: 'execution' as const, message: `Workflow ${e.status}`, time: e.startedAt, severity: 'info' })),
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8);

    return NextResponse.json({
      metrics: {
        openCases, criticalCases, activeWorkflows, newAlerts,
        connectedIntegrations, runningExecutions, recentAlerts,
        recentCases, recentExecutions, totalWorkflows: workflows.length,
        totalCases: cases.length, totalAlerts: alerts.length, totalPlaybooks: playbooks.length,
        externalIncidents,
        externalAssets,
        externalBackendOk,
      },
      severityDistribution: severityDist,
      activityFeed,
      recentExecutions: executions.slice(0, 10),
      workflows: workflows.slice(0, 5),
      cases: cases.slice(0, 5),
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    logger.error({ err: error }, 'Dashboard error');
    return NextResponse.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
}
