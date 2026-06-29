/**
 * Real dashboard & analytics metrics computed from Prisma models.
 * Shared by /api/soar/* (gateway) and /api/analytics (legacy).
 */
import { db } from '@/lib/db';

export type TenantWhere = Record<string, unknown>;

const CLOSED_STATUSES = ['closed', 'resolved'] as const;

export function parseAnalyticsDays(raw: string | null | undefined): number {
  const n = Number(raw);
  if ([7, 14, 30, 90].includes(n)) return n;
  return 30;
}

export function periodBounds(days: number) {
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const prevSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);
  return { now, since, prevSince };
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  const seconds = Math.floor((ms % 60_000) / 1000);
  return totalMinutes === 0 && seconds > 0 ? `${seconds}s` : `${minutes}m`;
}

export function pctDelta(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}

function avgResolveMs(
  cases: Array<{ createdAt: Date; closedAt: Date | null }>,
): number {
  const closed = cases.filter(c => c.closedAt);
  if (closed.length === 0) return 0;
  return closed.reduce((sum, c) => sum + (c.closedAt!.getTime() - c.createdAt.getTime()), 0) / closed.length;
}

function avgRespondMs(
  cases: Array<{ createdAt: Date; updatedAt: Date; status: string }>,
): number {
  const acted = cases.filter(c => !['open', 'new'].includes(c.status));
  if (acted.length === 0) return 0;
  return acted.reduce((sum, c) => sum + (c.updatedAt.getTime() - c.createdAt.getTime()), 0) / acted.length;
}

async function periodStats(tenantWhere: TenantWhere, from: Date, to: Date) {
  const caseWhere = { ...tenantWhere, createdAt: { gte: from, lt: to } };
  const execWhere = { ...tenantWhere, startedAt: { gte: from, lt: to } };
  const alertWhere = { ...tenantWhere, createdAt: { gte: from, lt: to } };
  const closedWhere = { ...tenantWhere, closedAt: { gte: from, lt: to } };

  const [
    totalIncidents,
    totalAlerts,
    totalAutomations,
    falsePositiveAlerts,
    alertTotalInPeriod,
    resolvedInPeriod,
    casesForRespond,
    successfulExecs,
  ] = await Promise.all([
    db.case.count({ where: caseWhere }),
    db.alert.count({ where: alertWhere }),
    db.workflowExecution.count({ where: execWhere }),
    db.alert.count({ where: { ...alertWhere, status: 'false_positive' } }),
    db.alert.count({ where: alertWhere }),
    db.case.findMany({
      where: closedWhere,
      select: { createdAt: true, closedAt: true },
    }),
    db.case.findMany({
      where: caseWhere,
      select: { createdAt: true, updatedAt: true, status: true },
    }),
    db.workflowExecution.findMany({
      where: { ...execWhere, status: 'success' },
      select: { durationMs: true },
    }),
  ]);

  const mttrResolveMs = avgResolveMs(resolvedInPeriod);
  const mttrRespondMs = avgRespondMs(casesForRespond);
  const automationRoiHours = successfulExecs.reduce(
    (sum, e) => sum + (e.durationMs ?? 0),
    0,
  ) / 3_600_000;

  return {
    total_incidents: totalIncidents,
    total_alerts: totalAlerts,
    total_automations: totalAutomations,
    mttr_hours: mttrResolveMs / 3_600_000,
    mttr_respond_ms: mttrRespondMs,
    mttr_resolve_ms: mttrResolveMs,
    false_positive_rate: alertTotalInPeriod
      ? Math.round((falsePositiveAlerts / alertTotalInPeriod) * 100)
      : 0,
    resolved_count: resolvedInPeriod.length,
    automation_roi_hours: Math.round(automationRoiHours * 10) / 10,
  };
}

export async function getDashboardOverview(tenantWhere: TenantWhere) {
  const [openCases, critical, totalExec, successExec, runningExec, connectedIntegrations, recentResolved] = await Promise.all([
    db.case.count({
      where: { ...tenantWhere, status: { notIn: [...CLOSED_STATUSES] } },
    }),
    db.case.count({
      where: {
        ...tenantWhere,
        severity: 'critical',
        status: { notIn: [...CLOSED_STATUSES] },
      },
    }),
    db.workflowExecution.count({ where: tenantWhere }),
    db.workflowExecution.count({ where: { ...tenantWhere, status: 'success' } }),
    db.workflowExecution.count({ where: { ...tenantWhere, status: 'running' } }),
    db.integration.count({ where: { ...tenantWhere, status: 'connected' } }),
    db.case.findMany({
      where: { ...tenantWhere, closedAt: { not: null } },
      select: { createdAt: true, closedAt: true },
      orderBy: { closedAt: 'desc' },
      take: 200,
    }),
  ]);

  const mttrMs = avgResolveMs(recentResolved);
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentAlerts, recentCases] = await Promise.all([
    db.alert.count({ where: { ...tenantWhere, createdAt: { gte: last24h } } }),
    db.case.count({ where: { ...tenantWhere, createdAt: { gte: last24h } } }),
  ]);

  return {
    open_incidents: openCases,
    critical_count: critical,
    mttr: formatDurationMs(mttrMs),
    mttr_hours: Math.round((mttrMs / 3_600_000) * 100) / 100,
    automation_success_rate: totalExec ? Math.round((successExec / totalExec) * 100) : 0,
    total_executions: totalExec,
    running_executions: runningExec,
    connected_integrations: connectedIntegrations,
    recent_alerts_24h: recentAlerts,
    recent_cases_24h: recentCases,
  };
}

export async function getDashboardPlaybooks(tenantWhere: TenantWhere) {
  const pbs = await db.playbook.findMany({
    where: { ...tenantWhere, status: 'active' },
    take: 10,
    orderBy: { updatedAt: 'desc' },
    select: { name: true, workflowId: true },
  });

  const workflowIds = pbs.map(p => p.workflowId).filter((id): id is string => Boolean(id));
  const executions = workflowIds.length
    ? await db.workflowExecution.findMany({
        where: { ...tenantWhere, workflowId: { in: workflowIds } },
        select: { workflowId: true, status: true, durationMs: true },
      })
    : [];

  const byWorkflow = new Map<string, { total: number; success: number; savedMs: number }>();
  for (const exec of executions) {
    const cur = byWorkflow.get(exec.workflowId) ?? { total: 0, success: 0, savedMs: 0 };
    cur.total += 1;
    if (exec.status === 'success') {
      cur.success += 1;
      cur.savedMs += exec.durationMs ?? 0;
    }
    byWorkflow.set(exec.workflowId, cur);
  }

  return {
    playbooks: pbs.map(p => {
      const stats = p.workflowId ? byWorkflow.get(p.workflowId) : undefined;
      const total = stats?.total ?? 0;
      const success = stats?.success ?? 0;
      const savedHours = stats ? Math.round((stats.savedMs / 3_600_000) * 10) / 10 : 0;
      return {
        name: p.name,
        total_runs: total,
        successful_runs: success,
        failed_runs: total - success,
        success_rate: total ? Math.round((success / total) * 100) : 0,
        time_saved_hours: savedHours,
      };
    }),
  };
}

export async function getDashboardAutomation(tenantWhere: TenantWhere) {
  const total = await db.workflowExecution.count({ where: tenantWhere });
  const success = await db.workflowExecution.count({
    where: { ...tenantWhere, status: 'success' },
  });
  return {
    success_rate: total ? Math.round((success / total) * 100) : 0,
    triggered_count: total,
  };
}

export async function getDashboardAnalysts(tenantWhere: TenantWhere) {
  const users = await db.user.findMany({
    take: 20,
    orderBy: { lastLoginAt: 'desc' },
    select: { id: true, fullName: true, email: true, lastLoginAt: true },
  });

  const analysts = await Promise.all(
    users.map(async (user) => {
      const [openAssignments, resolvedCases] = await Promise.all([
        db.case.count({
          where: {
            ...tenantWhere,
            assigneeId: user.id,
            status: { notIn: [...CLOSED_STATUSES] },
          },
        }),
        db.case.findMany({
          where: {
            ...tenantWhere,
            assigneeId: user.id,
            closedAt: { not: null },
          },
          select: { createdAt: true, closedAt: true },
          orderBy: { closedAt: 'desc' },
          take: 100,
        }),
      ]);

      return {
        id: user.id,
        name: user.fullName,
        email: user.email,
        resolved_count: resolvedCases.length,
        open_assignments: openAssignments,
        avg_response_time: formatDurationMs(avgResolveMs(resolvedCases)),
        last_active_at: user.lastLoginAt?.toISOString() ?? null,
      };
    }),
  );

  const active = analysts
    .filter(a => a.open_assignments > 0 || a.resolved_count > 0)
    .sort((a, b) => b.open_assignments - a.open_assignments || b.resolved_count - a.resolved_count);

  return { analysts: (active.length > 0 ? active : analysts).slice(0, 10) };
}

export async function getAnalyticsKpis(tenantWhere: TenantWhere, days: number) {
  const { since, prevSince, now } = periodBounds(days);
  const [current, previous] = await Promise.all([
    periodStats(tenantWhere, since, now),
    periodStats(tenantWhere, prevSince, since),
  ]);

  return {
    days,
    total_incidents: {
      value: current.total_incidents,
      delta: pctDelta(current.total_incidents, previous.total_incidents),
    },
    total_alerts: {
      value: current.total_alerts,
      delta: pctDelta(current.total_alerts, previous.total_alerts),
    },
    total_automations: {
      value: current.total_automations,
      delta: pctDelta(current.total_automations, previous.total_automations),
    },
    mttr_hours: {
      value: Math.round(current.mttr_hours * 10) / 10,
      delta: pctDelta(current.mttr_hours, previous.mttr_hours),
    },
    false_positive_rate: {
      value: current.false_positive_rate,
      delta: pctDelta(current.false_positive_rate, previous.false_positive_rate),
    },
    resolved_count: {
      value: current.resolved_count,
      delta: pctDelta(current.resolved_count, previous.resolved_count),
    },
    automation_roi_hours: {
      value: current.automation_roi_hours,
      delta: pctDelta(current.automation_roi_hours, previous.automation_roi_hours),
    },
  };
}

export async function getAnalyticsSnapshots(tenantWhere: TenantWhere, days: number) {
  const { since } = periodBounds(days);

  const [cases, executions, severityDist] = await Promise.all([
    db.case.findMany({
      where: { ...tenantWhere, createdAt: { gte: since } },
      select: { createdAt: true, severity: true },
    }),
    db.workflowExecution.findMany({
      where: { ...tenantWhere, startedAt: { gte: since } },
      select: { startedAt: true, status: true },
    }),
    db.case.groupBy({
      by: ['severity'],
      where: tenantWhere,
      _count: true,
    }),
  ]);

  type Bucket = {
    date: string;
    incidents_opened: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    executions_triggered: number;
    executions_success: number;
  };

  const buckets = new Map<string, Bucket>();

  function bucketFor(date: Date): Bucket {
    const key = date.toISOString().slice(0, 10);
    let row = buckets.get(key);
    if (!row) {
      row = {
        date: key,
        incidents_opened: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        executions_triggered: 0,
        executions_success: 0,
      };
      buckets.set(key, row);
    }
    return row;
  }

  for (const c of cases) {
    const b = bucketFor(c.createdAt);
    b.incidents_opened += 1;
    if (c.severity === 'critical') b.critical += 1;
    else if (c.severity === 'high') b.high += 1;
    else if (c.severity === 'medium') b.medium += 1;
    else b.low += 1;
  }

  for (const e of executions) {
    const b = bucketFor(e.startedAt);
    b.executions_triggered += 1;
    if (e.status === 'success') b.executions_success += 1;
  }

  return {
    incidents_over_time: Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date)),
    severity_distribution: severityDist.map(d => ({ severity: d.severity, count: d._count })),
  };
}

export async function getAnalyticsReport(tenantWhere: TenantWhere, days: number) {
  const { since } = periodBounds(days);

  const [bySeverity, alertSources, analysts, playbooks, snapshots, period] = await Promise.all([
    db.case.groupBy({
      by: ['severity'],
      where: { ...tenantWhere, createdAt: { gte: since } },
      _count: true,
    }),
    db.alert.groupBy({
      by: ['source'],
      where: { ...tenantWhere, createdAt: { gte: since } },
      _count: true,
    }),
    getDashboardAnalysts(tenantWhere),
    getDashboardPlaybooks(tenantWhere),
    getAnalyticsSnapshots(tenantWhere, days),
    periodStats(tenantWhere, since, new Date()),
  ]);

  const openedInPeriod = snapshots.incidents_over_time.reduce(
    (sum, row) => sum + row.incidents_opened,
    0,
  );

  return {
    generated_at: new Date().toISOString(),
    days,
    summary: `Last ${days} days: ${openedInPeriod} incidents opened, ${period.resolved_count} resolved, ${period.total_automations} automations triggered, false-positive rate ${period.false_positive_rate}%.`,
    by_severity: bySeverity.map(r => ({ severity: r.severity, count: r._count })),
    by_type: alertSources.map(r => ({ type: r.source, count: r._count })),
    analyst_performance: analysts.analysts.map(a => ({
      name: a.name,
      resolved: a.resolved_count,
      open: a.open_assignments,
      avg_response: a.avg_response_time,
    })),
    top_playbooks: playbooks.playbooks.map(p => ({
      name: p.name,
      runs: p.total_runs,
      success_rate: `${p.success_rate}%`,
    })),
    incidents_over_time: snapshots.incidents_over_time,
  };
}

/** Legacy AnalyticsView shape — built from real DB metrics. */
export async function getLegacyAnalyticsView(tenantWhere: TenantWhere, days: number) {
  const { since, prevSince, now } = periodBounds(days);
  const [current, previous, snapshots, analysts, playbooks, alertSources] = await Promise.all([
    periodStats(tenantWhere, since, now),
    periodStats(tenantWhere, prevSince, since),
    getAnalyticsSnapshots(tenantWhere, days),
    getDashboardAnalysts(tenantWhere),
    getDashboardPlaybooks(tenantWhere),
    db.alert.groupBy({
      by: ['source'],
      where: { ...tenantWhere, createdAt: { gte: since } },
      _count: true,
    }),
  ]);

  const typeColors = ['#3b82f6', '#10b981', '#ec4899', '#8b5cf6', '#f97316', '#64748b'];
  const sortedTypes = [...alertSources].sort((a, b) => b._count - a._count);
  const typeTotal = sortedTypes.reduce((s, r) => s + r._count, 0) || 1;

  const playbookColors = [
    'bg-blue-500/15 text-blue-500',
    'bg-red-500/15 text-red-500',
    'bg-purple-500/15 text-purple-500',
    'bg-orange-500/15 text-orange-500',
    'bg-emerald-500/15 text-emerald-500',
  ];

  const weeklyBuckets = new Map<string, { critical: number; high: number; medium: number }>();
  for (const row of snapshots.incidents_over_time) {
    const weekStart = new Date(row.date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    const cur = weeklyBuckets.get(key) ?? { critical: 0, high: 0, medium: 0 };
    cur.critical += row.critical;
    cur.high += row.high;
    cur.medium += row.medium;
    weeklyBuckets.set(key, cur);
  }

  return {
    mttr: formatDurationMs(current.mttr_respond_ms),
    mttrChange: pctDelta(current.mttr_respond_ms, previous.mttr_respond_ms),
    mttrResolve: formatDurationMs(current.mttr_resolve_ms),
    mttrResolveChange: pctDelta(current.mttr_resolve_ms, previous.mttr_resolve_ms),
    totalResolved: current.resolved_count,
    totalResolvedChange: pctDelta(current.resolved_count, previous.resolved_count),
    falsePositiveRate: current.false_positive_rate,
    falsePositiveChange: pctDelta(current.false_positive_rate, previous.false_positive_rate),
    automationRoi: Math.round(current.automation_roi_hours),
    automationRoiChange: pctDelta(current.automation_roi_hours, previous.automation_roi_hours),
    incidentsOverTime: Array.from(weeklyBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, counts], i) => ({
        week: `Week ${i + 1}`,
        critical: counts.critical,
        high: counts.high,
        medium: counts.medium,
      })),
    incidentTypes: sortedTypes.slice(0, 6).map((r, i) => ({
      label: r.source.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      value: Math.round((r._count / typeTotal) * 100),
      count: r._count,
      color: typeColors[i % typeColors.length],
    })),
    analystPerformance: analysts.analysts.map(a => ({
      name: a.name,
      resolved: a.resolved_count,
      avgResponse: a.avg_response_time,
    })),
    topPlaybooks: playbooks.playbooks.slice(0, 5).map((p, i) => ({
      name: p.name,
      executed: p.total_runs,
      timeSaved: p.time_saved_hours > 0 ? `${p.time_saved_hours}h` : '—',
      iconColor: playbookColors[i % playbookColors.length],
    })),
    days,
  };
}

export function buildAnalyticsCsv(report: Awaited<ReturnType<typeof getAnalyticsReport>>): string {
  const lines: string[] = [
    `LumiSec SOAR Analytics Report (${report.days} days)`,
    `Generated,${report.generated_at}`,
    '',
    'Summary',
    report.summary,
    '',
    'By Severity',
    'severity,count',
    ...report.by_severity.map(r => `${r.severity},${r.count}`),
    '',
    'By Source',
    'type,count',
    ...report.by_type.map(r => `${r.type},${r.count}`),
  ];
  return lines.join('\n');
}
