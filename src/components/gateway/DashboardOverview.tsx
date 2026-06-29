'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Clock,
  FolderOpen,
  GitBranch,
  Plug,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import {
  fetchDashboardAnalysts,
  fetchDashboardAutomation,
  fetchDashboardConnectors,
  fetchDashboardIncidents,
  fetchDashboardOverview,
  fetchDashboardPlaybooks,
  type DashboardAnalyst,
  type DashboardAutomation,
  type DashboardConnector,
  type DashboardIncident,
  type DashboardOverview,
  type DashboardPlaybookSummary,
  type PaginatedResult,
  type PaginationMeta,
} from '@/lib/lumisec-api/browser/soarDashboard';
import { useAuth } from '@/components/auth/AuthProvider';
import { SoarEmptyPlatformBanner } from '@/components/gateway/SoarEmptyPlatformBanner';

type WidgetState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

const initialWidgetState = <T,>(): WidgetState<T> => ({
  data: null,
  loading: true,
  error: null,
});

function formatLabel(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatMetricValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}

function severityClass(severity: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    case 'high':
      return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    case 'medium':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'low':
      return 'bg-green-500/10 text-green-600 border-green-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
}

function statusClass(status: string): string {
  switch (status?.toLowerCase()) {
    case 'open':
    case 'new':
    case 'active':
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'investigating':
    case 'in_progress':
      return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    case 'resolved':
    case 'closed':
      return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'error':
    case 'failed':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
}

function WidgetErrorBanner({ title, message }: { title: string; message: string }) {
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-4 w-28" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }).map((_, row) => (
        <Skeleton key={row} className="h-10 w-full" style={{ opacity: 1 - row * 0.08 }} />
      ))}
      <div className="flex justify-end pt-2">
        <Skeleton className="h-8 w-40" />
      </div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

const KPI_CONFIG: {
  key: keyof DashboardOverview | string;
  label: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}[] = [
  {
    key: 'open_incidents',
    label: 'Open Incidents',
    icon: <FolderOpen className="h-5 w-5" />,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  {
    key: 'critical_count',
    label: 'Critical Count',
    icon: <AlertTriangle className="h-5 w-5" />,
    color: 'text-red-500',
    bg: 'bg-red-500/10',
  },
  {
    key: 'running_executions',
    label: 'Running Executions',
    icon: <Activity className="h-5 w-5" />,
    color: 'text-violet-500',
    bg: 'bg-violet-500/10',
  },
  {
    key: 'recent_alerts_24h',
    label: 'Alerts (24h)',
    icon: <Bell className="h-5 w-5" />,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
  {
    key: 'connected_integrations',
    label: 'Connected Integrations',
    icon: <Plug className="h-5 w-5" />,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
  {
    key: 'automation_success_rate',
    label: 'Automation Success',
    icon: <GitBranch className="h-5 w-5" />,
    color: 'text-cyan-500',
    bg: 'bg-cyan-500/10',
  },
  {
    key: 'mttr',
    label: 'MTTR',
    icon: <Clock className="h-5 w-5" />,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
];

function OverviewKpiCards({ overview }: { overview: DashboardOverview }) {
  const cards = KPI_CONFIG.map((item) => ({
    label: item.label,
    value: formatMetricValue(overview[item.key]),
    icon: item.icon,
    color: item.color,
    bg: item.bg,
  })).slice(0, 8);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className={`p-2 rounded-lg w-fit ${card.bg} ${card.color}`}>{card.icon}</div>
            <div className="mt-3">
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function IncidentsTable({
  incidents,
  pagination,
  loading,
  onPageChange,
}: {
  incidents: DashboardIncident[];
  pagination: PaginationMeta;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const totalPages = pagination.totalPages ?? pagination.pages ?? 1;
  const canGoBack = pagination.page > 1;
  const canGoForward = pagination.page < totalPages;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Recent Incidents</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : (
          <>
            <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Created At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No incidents found
                    </TableCell>
                  </TableRow>
                ) : (
                  incidents.map((incident) => (
                    <TableRow key={incident.id}>
                      <TableCell className="font-mono text-xs">{incident.id}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">{incident.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={severityClass(incident.severity)}>
                          {incident.severity}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusClass(incident.status)}>
                          {incident.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{incident.assigned_to ?? 'Unassigned'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(incident.created_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>

            <Pagination className="mt-4 justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (canGoBack && !loading) onPageChange(pagination.page - 1);
                    }}
                    className={!canGoBack || loading ? 'pointer-events-none opacity-50' : ''}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="px-3 text-xs text-muted-foreground">
                    Page {pagination.page} of {totalPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (canGoForward && !loading) onPageChange(pagination.page + 1);
                    }}
                    className={!canGoForward || loading ? 'pointer-events-none opacity-50' : ''}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PlaybooksPanel({ playbooks }: { playbooks: DashboardPlaybookSummary[] }) {
  const maxRuns = useMemo(
    () => Math.max(...playbooks.map((item) => Number(item.total_runs ?? 0)), 1),
    [playbooks],
  );

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Bot className="h-4 w-4" /> Playbook Execution Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {playbooks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No playbook runs recorded</p>
        ) : (
          playbooks.map((playbook, index) => {
            const runs = Number(playbook.total_runs ?? 0);
            const progress = maxRuns > 0 ? (runs / maxRuns) * 100 : 0;
            return (
              <div key={`${playbook.name}-${index}`} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium truncate">{playbook.name}</span>
                  <span className="text-muted-foreground shrink-0">{runs} runs</span>
                </div>
                <Progress value={progress} className="h-2" />
                <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  {playbook.successful_runs !== undefined && (
                    <span>Success: {playbook.successful_runs}</span>
                  )}
                  {playbook.failed_runs !== undefined && (
                    <span>Failed: {playbook.failed_runs}</span>
                  )}
                  {playbook.success_rate !== undefined && (
                    <span>Rate: {playbook.success_rate}%</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function AutomationPanel({ automation }: { automation: DashboardAutomation }) {
  const successRate = Number(automation.success_rate);
  const triggeredCount = Number(automation.triggered_count);
  const safeSuccessRate = Number.isFinite(successRate) ? successRate : 0;
  const safeTriggeredCount = Number.isFinite(triggeredCount) ? triggeredCount : 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <RefreshCw className="h-4 w-4" /> Automation Stats
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Success Rate</p>
          <p className="text-3xl font-bold">{safeSuccessRate}%</p>
          <Progress value={safeSuccessRate} className="h-2 mt-3" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Triggered Count</p>
          <p className="text-3xl font-bold">{safeTriggeredCount.toLocaleString()}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalystsPanel({ analysts }: { analysts: DashboardAnalyst[] }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" /> Analyst Workload
        </CardTitle>
      </CardHeader>
      <CardContent>
        {analysts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No analyst data available</p>
        ) : (
          <div className="space-y-3">
            {analysts.map((analyst) => (
              <div
                key={analyst.id}
                className="flex items-start gap-3 rounded-lg border border-border/60 p-3"
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                    {analyst.initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{analyst.fullName}</span>
                    <Badge variant="outline" className="text-[10px] h-5">
                      {analyst.role}
                    </Badge>
                    {analyst.status === 'active' && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Active" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{analyst.email}</p>
                  <p className="text-[10px] text-muted-foreground line-clamp-1">{analyst.workloadFocus}</p>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Open</p>
                    <p className="text-sm font-semibold">{analyst.open_assignments}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Avg</p>
                    <p className="text-[11px] text-muted-foreground">{analyst.avg_response_time}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Active</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(analyst.lastActiveAt)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectorsPanel({
  connectors,
  pagination,
  loading,
}: {
  connectors: DashboardConnector[];
  pagination: PaginationMeta;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Plug className="h-4 w-4" /> Connector Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : (
          <div className="overflow-x-auto">
          <Table className="min-w-[480px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No connectors found
                  </TableCell>
                </TableRow>
              ) : (
                connectors.map((connector, index) => (
                  <TableRow key={`${connector.name}-${index}`}>
                    <TableCell className="font-medium max-w-[180px] truncate">{connector.name}</TableCell>
                    <TableCell>{connector.type}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusClass(connector.status)}>
                        {connector.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(connector.last_seen)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        )}
        {!loading && pagination.total > 0 && (
          <p className="text-xs text-muted-foreground mt-3 text-right">
            Showing {connectors.length} of {pagination.total} connectors
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardOverview() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<WidgetState<DashboardOverview>>(initialWidgetState);
  const [incidents, setIncidents] = useState<WidgetState<PaginatedResult<DashboardIncident>>>(
    initialWidgetState,
  );
  const [playbooks, setPlaybooks] = useState<WidgetState<DashboardPlaybookSummary[]>>(
    initialWidgetState,
  );
  const [automation, setAutomation] = useState<WidgetState<DashboardAutomation>>(initialWidgetState);
  const [analysts, setAnalysts] = useState<WidgetState<DashboardAnalyst[]>>(initialWidgetState);
  const [connectors, setConnectors] = useState<WidgetState<PaginatedResult<DashboardConnector>>>(
    initialWidgetState,
  );

  const loadIncidentsPage = useCallback(async (page: number) => {
    setIncidents((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetchDashboardIncidents(page, 20);
      setIncidents({ data, loading: false, error: null });
    } catch (error) {
      setIncidents((prev) => ({
        ...prev,
        loading: false,
        error: getApiErrorMessage(error),
      }));
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const loadDashboard = async () => {
      setOverview(initialWidgetState());
      setIncidents(initialWidgetState());
      setPlaybooks(initialWidgetState());
      setAutomation(initialWidgetState());
      setAnalysts(initialWidgetState());
      setConnectors(initialWidgetState());

      const [
        overviewResult,
        incidentsResult,
        playbooksResult,
        automationResult,
        analystsResult,
        connectorsResult,
      ] = await Promise.all([
        fetchDashboardOverview()
          .then((data) => ({ ok: true as const, data }))
          .catch((error) => ({ ok: false as const, error: getApiErrorMessage(error) })),
        fetchDashboardIncidents(1, 20)
          .then((data) => ({ ok: true as const, data }))
          .catch((error) => ({ ok: false as const, error: getApiErrorMessage(error) })),
        fetchDashboardPlaybooks()
          .then((data) => ({ ok: true as const, data }))
          .catch((error) => ({ ok: false as const, error: getApiErrorMessage(error) })),
        fetchDashboardAutomation()
          .then((data) => ({ ok: true as const, data }))
          .catch((error) => ({ ok: false as const, error: getApiErrorMessage(error) })),
        fetchDashboardAnalysts()
          .then((data) => ({ ok: true as const, data }))
          .catch((error) => ({ ok: false as const, error: getApiErrorMessage(error) })),
        fetchDashboardConnectors(1, 20)
          .then((data) => ({ ok: true as const, data }))
          .catch((error) => ({ ok: false as const, error: getApiErrorMessage(error) })),
      ]);

      if (cancelled) return;

      setOverview({
        data: overviewResult.ok ? overviewResult.data : null,
        loading: false,
        error: overviewResult.ok ? null : overviewResult.error,
      });
      setIncidents({
        data: incidentsResult.ok ? incidentsResult.data : null,
        loading: false,
        error: incidentsResult.ok ? null : incidentsResult.error,
      });
      setPlaybooks({
        data: playbooksResult.ok ? playbooksResult.data : null,
        loading: false,
        error: playbooksResult.ok ? null : playbooksResult.error,
      });
      setAutomation({
        data: automationResult.ok ? automationResult.data : null,
        loading: false,
        error: automationResult.ok ? null : automationResult.error,
      });
      setAnalysts({
        data: analystsResult.ok ? analystsResult.data : null,
        loading: false,
        error: analystsResult.ok ? null : analystsResult.error,
      });
      setConnectors({
        data: connectorsResult.ok ? connectorsResult.data : null,
        loading: false,
        error: connectorsResult.ok ? null : connectorsResult.error,
      });
    };

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const showEmptyPlatform =
    overview.data &&
    Number(overview.data.recent_alerts_24h ?? 0) === 0 &&
    Number(overview.data.open_incidents ?? 0) === 0 &&
    Number(overview.data.connected_integrations ?? 0) === 0;

  return (
    <div className="space-y-6">
      {showEmptyPlatform && <SoarEmptyPlatformBanner />}
      <div>
        {overview.loading && <KpiSkeleton />}
        {overview.error && (
          <WidgetErrorBanner title="Overview unavailable" message={overview.error} />
        )}
        {!overview.loading && overview.data && <OverviewKpiCards overview={overview.data} />}
      </div>

      <div>
        {incidents.error && !incidents.loading && (
          <WidgetErrorBanner title="Incidents unavailable" message={incidents.error} />
        )}
        {(incidents.loading || incidents.data) && (
          <IncidentsTable
            incidents={incidents.data?.items ?? []}
            pagination={
              incidents.data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 }
            }
            loading={incidents.loading}
            onPageChange={loadIncidentsPage}
          />
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div>
          {playbooks.loading && <PanelSkeleton />}
          {playbooks.error && !playbooks.loading && (
            <WidgetErrorBanner title="Playbooks unavailable" message={playbooks.error} />
          )}
          {!playbooks.loading && playbooks.data && <PlaybooksPanel playbooks={playbooks.data} />}
        </div>

        <div>
          {automation.loading && <PanelSkeleton />}
          {automation.error && !automation.loading && (
            <WidgetErrorBanner title="Automation stats unavailable" message={automation.error} />
          )}
          {!automation.loading && automation.data && (
            <AutomationPanel automation={automation.data} />
          )}
        </div>

        <div>
          {analysts.loading && <PanelSkeleton />}
          {analysts.error && !analysts.loading && (
            <WidgetErrorBanner title="Analyst workload unavailable" message={analysts.error} />
          )}
          {!analysts.loading && analysts.data && <AnalystsPanel analysts={analysts.data} />}
        </div>
      </div>

      <div>
        {connectors.error && !connectors.loading && (
          <WidgetErrorBanner title="Connectors unavailable" message={connectors.error} />
        )}
        {(connectors.loading || connectors.data) && (
          <ConnectorsPanel
            connectors={connectors.data?.items ?? []}
            pagination={
              connectors.data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 }
            }
            loading={connectors.loading}
          />
        )}
      </div>
    </div>
  );
}
