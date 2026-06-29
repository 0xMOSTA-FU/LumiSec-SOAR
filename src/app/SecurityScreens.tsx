'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/components/auth/AuthProvider';
import { computeExposureRiskScore } from '@/lib/platform/enterprise-mode';
import {
  BarChart3, TrendingUp, TrendingDown, Download,
  Clock, CheckCircle2, AlertTriangle, Bot, Shield, List,
  Globe, User as UserIcon, ChevronDown, MoreVertical,
  Filter, AlertCircle, Activity, Zap, FileText, Crosshair,
  Bug, Lock, Server, Hash, Link2, KeyRound,
  MessageSquare, Bell, Calendar, ChevronRight,
  Skull, Radio, ArrowUpRight, ArrowDownRight, Plus,
  UserX, Search, Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { soarFetch, asArray } from '@/lib/soar/fetch-json';

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return value.trim() ? [value] : [];
    }
  }
  return [];
}

// ============================================================================
// ANALYTICS & REPORTING VIEW (Image 2)
// ============================================================================
export interface AnalyticsData {
  mttr: string;
  mttrChange: number;
  mttrResolve: string;
  mttrResolveChange: number;
  totalResolved: number;
  totalResolvedChange: number;
  falsePositiveRate: number;
  falsePositiveChange: number;
  automationRoi: number;
  automationRoiChange: number;
  incidentsOverTime: { week: string; critical: number; high: number; medium: number }[];
  incidentTypes: { label: string; value: number; color: string }[];
  analystPerformance: { name: string; resolved: number; avgResponse: string }[];
  topPlaybooks: { name: string; executed: number; timeSaved: string; iconColor: string }[];
}

const emptyAnalytics: AnalyticsData = {
  mttr: '0m',
  mttrChange: 0,
  mttrResolve: '0m',
  mttrResolveChange: 0,
  totalResolved: 0,
  totalResolvedChange: 0,
  falsePositiveRate: 0,
  falsePositiveChange: 0,
  automationRoi: 0,
  automationRoiChange: 0,
  incidentsOverTime: [],
  incidentTypes: [],
  analystPerformance: [],
  topPlaybooks: [],
};

const defaultAnalytics: AnalyticsData = emptyAnalytics;

interface AnalyticsViewProps {
  data?: AnalyticsData;
}

export function AnalyticsView({ data }: AnalyticsViewProps) {
  const [timeFilter, setTimeFilter] = useState('Last 30 Days');
  const [realData, setRealData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const daysFromFilter = (filter: string): number => {
    if (filter.includes('24')) return 1;
    if (filter.includes('7')) return 7;
    if (filter.includes('90')) return 90;
    if (filter.includes('Year')) return 365;
    return 30;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const days = daysFromFilter(timeFilter);
        const res = await soarFetch<AnalyticsData>(`/api/analytics?days=${days}`);
        if (!cancelled && res.ok && res.data) {
          setRealData(res.data);
        }
      } catch (e) {
        console.error('Analytics fetch error', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [timeFilter]);

  const d = data || realData || defaultAnalytics;
  const maxIncident = Math.max(...d.incidentsOverTime.map(w => w.critical + w.high + w.medium), 1);

  // Precompute donut chart segments with cumulative offsets (using reduce to avoid mutation)
  const donutSegments = useMemo(() => {
    const total = d.incidentTypes.reduce((sum, t) => sum + t.value, 0);
    if (total <= 0) return [];
    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    const { segments } = d.incidentTypes.reduce(
      (acc, t) => {
        const fraction = t.value / total;
        const dash = fraction * circumference;
        const offset = (acc.cumulative / total) * circumference;
        acc.segments.push({ ...t, dash, offset, circumference });
        return { segments: acc.segments, cumulative: acc.cumulative + t.value };
      },
      { segments: [] as Array<typeof d.incidentTypes[number] & { dash: number; offset: number; circumference: number }>, cumulative: 0 }
    );
    return segments;
  }, [d.incidentTypes]);

  const metricCards = [
    { icon: <Clock className="h-5 w-5" />, label: 'Mean Time To Respond', value: d.mttr, change: d.mttrChange, subtitle: 'Average response time', bg: 'bg-blue-500/10', color: 'text-blue-500' },
    { icon: <Clock className="h-5 w-5" />, label: 'Mean Time To Resolve', value: d.mttrResolve, change: d.mttrResolveChange, subtitle: 'Average resolution time', bg: 'bg-blue-500/10', color: 'text-blue-500' },
    { icon: <CheckCircle2 className="h-5 w-5" />, label: 'Total Incidents Resolved', value: d.totalResolved.toLocaleString(), change: d.totalResolvedChange, subtitle: 'Successfully closed', bg: 'bg-emerald-500/10', color: 'text-emerald-500' },
    { icon: <AlertTriangle className="h-5 w-5" />, label: 'False Positive Rate', value: `${d.falsePositiveRate}%`, change: d.falsePositiveChange, subtitle: 'Accuracy improvement', bg: 'bg-amber-500/10', color: 'text-amber-500' },
    { icon: <Bot className="h-5 w-5" />, label: 'Automation ROI', value: `${d.automationRoi}h`, change: d.automationRoiChange, subtitle: 'Hours saved by automation', bg: 'bg-purple-500/10', color: 'text-purple-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-primary flex items-center gap-2">
            <BarChart3 className="h-6 w-6" /> Analytics & Reporting
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Incident analysis and performance metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Calendar className="h-4 w-4 mr-1.5" /> {timeFilter}
                <ChevronDown className="h-3 w-3 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {['Last 24 Hours', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'Last Year'].map(t => (
                <DropdownMenuItem key={t} onClick={() => setTimeFilter(t)}>{t}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" data-ui-button>
            <Download className="h-4 w-4 mr-1.5" /> Export Report
          </Button>
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">SO</AvatarFallback>
          </Avatar>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {metricCards.map((m, i) => {
          const positive = m.change > 0;
          const isGoodTrend = (m.label.includes('Resolved') || m.label.includes('ROI')) ? positive : !positive;
          const trendColor = isGoodTrend ? 'text-emerald-500' : 'text-red-500';
          const TrendIcon = positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />;
          return (
            <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2 rounded-lg ${m.bg} ${m.color}`}>{m.icon}</div>
                    <span className={`text-xs flex items-center gap-0.5 font-medium ${trendColor}`}>
                      {TrendIcon}
                      {Math.abs(m.change)}%
                    </span>
                  </div>
                  <div>
                    <p className="text-2xl font-bold tracking-tight">{m.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.label}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">{m.subtitle}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Incidents Over Time - Stacked Bar Chart */}
        <Card data-interactive-card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Incidents Over Time</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">Weekly breakdown by severity</p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="More options"><MoreVertical className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 h-64">
              {/* Y-axis labels */}
              <div className="flex flex-col justify-between text-[10px] text-muted-foreground font-medium pr-1 border-r">
                <span>{maxIncident}</span>
                <span>{Math.round(maxIncident * 0.75)}</span>
                <span>{Math.round(maxIncident * 0.5)}</span>
                <span>{Math.round(maxIncident * 0.25)}</span>
                <span>0</span>
              </div>
              {/* Bars */}
              <div className="flex-1 flex items-end gap-4">
                {d.incidentsOverTime.map((w, i) => {
                  const total = w.critical + w.high + w.medium;
                  const totalH = (total / maxIncident) * 100;
                  const critH = (w.critical / total) * totalH;
                  const highH = (w.high / total) * totalH;
                  const medH = (w.medium / total) * totalH;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group">
                      <div className="text-[10px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">{total}</div>
                      <div className="w-full h-full flex flex-col-reverse rounded-md overflow-hidden bg-muted/30 border border-border group-hover:border-primary/30 transition-colors">
                        {w.medium > 0 && (
                          <motion.div
                            initial={{ height: 0 }} animate={{ height: `${medH}%` }} transition={{ delay: i * 0.1, duration: 0.5 }}
                            className="w-full bg-emerald-500/80 hover:bg-emerald-500 transition-colors"
                            title={`Medium: ${w.medium}`}
                          />
                        )}
                        {w.high > 0 && (
                          <motion.div
                            initial={{ height: 0 }} animate={{ height: `${highH}%` }} transition={{ delay: i * 0.1 + 0.1, duration: 0.5 }}
                            className="w-full bg-orange-500/80 hover:bg-orange-500 transition-colors"
                            title={`High: ${w.high}`}
                          />
                        )}
                        {w.critical > 0 && (
                          <motion.div
                            initial={{ height: 0 }} animate={{ height: `${critH}%` }} transition={{ delay: i * 0.1 + 0.2, duration: 0.5 }}
                            className="w-full bg-red-500/90 hover:bg-red-500 transition-colors"
                            title={`Critical: ${w.critical}`}
                          />
                        )}
                        {total === 0 && (
                          <div className="w-full flex items-center justify-center text-[10px] text-muted-foreground/50">No data</div>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-medium">{w.week}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <Separator className="my-3" />
            {/* Legend with text labels */}
            <div className="flex items-center justify-center gap-4 text-[11px]">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> <span className="font-medium">Critical</span></span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-orange-500" /> <span className="font-medium">High</span></span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> <span className="font-medium">Medium</span></span>
            </div>
          </CardContent>
        </Card>

        {/* Top Incident Types - Donut Chart */}
        <Card data-interactive-card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Top Incident Types</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">Distribution by category</p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="More options"><MoreVertical className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              {/* Donut SVG */}
              <div className="relative shrink-0">
                <svg width="180" height="180" viewBox="0 0 180 180" className="-rotate-90">
                  {donutSegments.map((seg, i) => (
                    <motion.circle
                      key={i}
                      cx="90" cy="90" r={70}
                      fill="none" stroke={seg.color} strokeWidth="22"
                      strokeDasharray={`${seg.dash} ${seg.circumference - seg.dash}`}
                      strokeDashoffset={-seg.offset}
                      initial={{ opacity: 0, strokeDasharray: `0 ${seg.circumference}` }}
                      animate={{ opacity: 1, strokeDasharray: `${seg.dash} ${seg.circumference - seg.dash}` }}
                      transition={{ delay: i * 0.15, duration: 0.6 }}
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xs text-muted-foreground">Total</span>
                  <span className="text-lg font-bold">100%</span>
                </div>
              </div>
              {/* Legend */}
              <div className="flex-1 space-y-2">
                {d.incidentTypes.map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-muted/40 transition-colors">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: t.color }} />
                      <span className="font-medium truncate">{t.label}</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums shrink-0 ml-2">{t.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Analyst Performance */}
        <Card data-interactive-card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Analyst Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-[10px] text-muted-foreground uppercase tracking-wide font-semibold pb-2 border-b">
                <span>Analyst Name</span>
                <span className="text-right w-24">Incidents Resolved</span>
                <span className="text-right w-24">Avg. Response Time</span>
              </div>
              {d.analystPerformance.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  No analyst performance data available
                </div>
              ) : d.analystPerformance.map((a, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  data-table-row
                  className="grid grid-cols-[1fr_auto_auto] gap-3 items-center py-2 rounded-md px-1 cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                        {a.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs font-medium truncate">{a.name}</span>
                  </div>
                  <span className="text-xs font-semibold text-right w-24 tabular-nums">{a.resolved}</span>
                  <span className="text-xs text-muted-foreground text-right w-24 tabular-nums">{a.avgResponse}</span>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Top Automated Playbooks */}
        <Card data-interactive-card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Top Automated Playbooks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-[10px] text-muted-foreground uppercase tracking-wide font-semibold pb-2 border-b">
                <span>Playbook Name</span>
                <span className="text-right w-24">Times Executed</span>
                <span className="text-right w-24">Time Saved</span>
              </div>
              {d.topPlaybooks.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  No playbook execution data available
                </div>
              ) : d.topPlaybooks.map((p, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  data-table-row
                  className="grid grid-cols-[1fr_auto_auto] gap-3 items-center py-2 rounded-md px-1 cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`p-1.5 rounded shrink-0 ${p.iconColor}`}>
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-medium truncate">{p.name}</span>
                  </div>
                  <span className="text-xs font-semibold text-right w-24 tabular-nums">{p.executed}</span>
                  <span className="text-xs text-emerald-500 font-semibold text-right w-24 tabular-nums">{p.timeSaved}</span>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// THREAT OPERATIONS DASHBOARD VIEW (Image 3)
// ============================================================================
export interface IncidentQueueItem {
  id: string;
  kind?: 'alert' | 'incident';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  context: string;
  soarStatus: string;
  soarStatusColor: 'green' | 'yellow' | 'red' | 'blue' | 'gray';
  mitre?: string;
  action: 'Investigate' | 'Review' | 'Triage';
  sortTime?: number;
}

export interface LivePlaybook {
  name: string;
  progress: number;
  color: string;
  status: string;
}

export interface ThreatIntelItem {
  text: string;
  type: 'critical' | 'info';
  source: string;
}

export interface ThreatOpsProps {
  incidents?: IncidentQueueItem[];
  livePlaybooks?: LivePlaybook[];
  threatIntel?: ThreatIntelItem[];
  assetRiskScore?: number;
  onInvestigate?: (id: string, kind?: 'alert' | 'incident') => void;
  /** Industry SOAR mode: unified queue from `/api/soar/*` (Incidents + Alerts) */
  gatewayMode?: boolean;
}

export function ThreatOpsView({
  incidents,
  livePlaybooks,
  threatIntel,
  assetRiskScore: assetRiskScoreProp,
  onInvestigate,
  gatewayMode = false,
}: ThreatOpsProps) {
  const { user } = useAuth();
  const [realAlerts, setRealAlerts] = useState<any[]>([]);
  const [realCases, setRealCases] = useState<any[]>([]);
  const [realMetrics, setRealMetrics] = useState<any>(null);
  const [realPlaybookRuns, setRealPlaybookRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (gatewayMode) {
          const { fetchIncidents } = await import('@/lib/lumisec-api/browser/soarIncidents');
          const { fetchAlerts } = await import('@/lib/lumisec-api/browser/soarAlerts');
          const { fetchPlaybookRuns } = await import('@/lib/lumisec-api/browser/soarPlaybooks');
          const { apiClient } = await import('@/lib/lumisec-api/browser/api-client');
          const [incRes, alertRes, dashRes, runsRes] = await Promise.all([
            fetchIncidents(1, 50).catch(() => ({ items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } })),
            fetchAlerts({ page: 1, limit: 50 }).catch(() => ({ items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } })),
            apiClient.get<{ data?: Record<string, unknown> }>('/api/soar/dashboard/overview').catch(() => ({ data: {} })),
            fetchPlaybookRuns({ page: 1, limit: 8 }).catch(() => ({ items: [], pagination: { page: 1, limit: 8, total: 0, totalPages: 1 } })),
          ]);
          if (cancelled) return;
          setRealCases(incRes.items.map((i) => ({
            id: i.id,
            title: i.title,
            severity: i.severity,
            status: i.status,
            tags: [],
            updatedAt: i.updated_at,
            createdAt: i.created_at,
          })));
          setRealAlerts(alertRes.items.map((a) => ({
            id: a.id,
            title: a.title,
            severity: a.severity,
            status: a.status,
            source: a.source,
            createdAt: a.created_at,
          })));
          const dash = ((dashRes as { data?: Record<string, unknown> }).data || dashRes) as Record<string, unknown>;
          setRealMetrics({
            metrics: {
              openCases: dash.open_incidents ?? incRes.pagination.total,
              newAlerts: alertRes.pagination.total,
              criticalCases: dash.critical_count ?? 0,
              activeWorkflows: dash.running_executions ?? 0,
              runningExecutions: dash.running_executions ?? 0,
            },
          });
          setRealPlaybookRuns(runsRes.items);
        } else {
          const [aRes, cRes, dRes] = await Promise.all([
            soarFetch<unknown[]>('/api/alerts'),
            soarFetch<unknown[]>('/api/cases'),
            soarFetch<{ metrics?: unknown }>('/api/dashboard'),
          ]);
          if (cancelled) return;
          setRealAlerts(aRes.ok ? asArray(aRes.data) : []);
          setRealCases(cRes.ok ? asArray(cRes.data) : []);
          setRealMetrics(dRes.ok ? dRes.data : null);
        }
      } catch (e) {
        console.error('ThreatOps fetch error', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gatewayMode]);

  const sevWeight = (s: string) => ({ critical: 4, high: 3, medium: 2, low: 1 }[s] || 0);

  const alertRows: IncidentQueueItem[] = realAlerts.map(a => ({
    id: a.id,
    kind: 'alert' as const,
    severity: a.severity || 'medium',
    title: a.title || 'Untitled alert',
    context: `Alert · ${a.source || 'unknown'} · ${new Date(a.createdAt).toLocaleString()}`,
    soarStatus: a.status || 'new',
    soarStatusColor: a.status === 'resolved' || a.status === 'closed' ? 'green' :
                     a.status === 'investigating' ? 'yellow' : 'red',
    mitre: '',
    action: 'Investigate',
    sortTime: new Date(a.createdAt).getTime(),
  }));

  const caseRows: IncidentQueueItem[] = realCases.map(c => ({
    id: c.id,
    kind: 'incident' as const,
    severity: c.severity || 'medium',
    title: c.title || 'Untitled incident',
    context: gatewayMode
      ? `Incident · ${new Date(c.updatedAt || c.createdAt).toLocaleString()}`
      : `Case · ${parseStringArray(c.tags).slice(0, 2).join(', ') || 'investigation'} · ${new Date(c.updatedAt || c.createdAt).toLocaleString()}`,
    soarStatus: c.status || 'open',
    soarStatusColor: c.status === 'closed' || c.status === 'resolved' ? 'green' :
                     c.status === 'investigating' ? 'yellow' :
                     c.status === 'contained' ? 'blue' : 'red',
    mitre: '',
    action: 'Investigate',
    sortTime: new Date(c.updatedAt || c.createdAt).getTime(),
  }));

  const realIncidents: IncidentQueueItem[] = [...alertRows, ...caseRows]
    .filter(row => !severityFilter || row.severity === severityFilter)
    .sort((a, b) => sevWeight(b.severity) - sevWeight(a.severity) || (b.sortTime || 0) - (a.sortTime || 0))
    .slice(0, 20);

  const runProgress = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'completed' || s === 'success') return 100;
    if (s === 'running') return 55;
    if (s === 'paused') return 40;
    if (s === 'failed' || s === 'error') return 100;
    if (s === 'cancelled') return 100;
    return 15;
  };

  const realLivePlaybooks: LivePlaybook[] = realPlaybookRuns.length > 0
    ? realPlaybookRuns.slice(0, 5).map(r => ({
        name: r.playbook_name || `Run ${r.id.slice(0, 8)}`,
        progress: runProgress(r.status),
        color: r.status === 'failed' || r.status === 'error' ? 'text-red-400'
          : r.status === 'running' ? 'text-blue-400' : 'text-emerald-400',
        status: r.status,
      }))
    : [];

  const incs = incidents || (realIncidents.length > 0 ? realIncidents : []);
  const lps = livePlaybooks || realLivePlaybooks;
  const ti: ThreatIntelItem[] = threatIntel || realAlerts
    .filter(a => a.severity === 'critical' || a.severity === 'high')
    .slice(0, 5)
    .map(a => ({
      text: a.title || 'Untitled alert',
      type: a.severity === 'critical' ? 'critical' as const : 'info' as const,
      source: a.source || 'alerts',
    }));

  const computedRisk = computeExposureRiskScore(realAlerts);
  const assetRiskScore = assetRiskScoreProp ?? computedRisk;
  const topAlertSource = realAlerts.find(a => a.source)?.source || 'Tenant exposure';
  const analystName = user?.fullName || user?.email?.split('@')[0] || 'SOC Analyst';
  const analystInitials = analystName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p: string) => p[0]?.toUpperCase() ?? '')
    .join('') || 'SA';

  // Compute metrics from real data
  const metrics = [
    { icon: <Shield className="h-5 w-5" />, label: 'Active Threats', value: String(realMetrics?.metrics?.newAlerts ?? realAlerts.filter(a => a.status === 'new').length ?? 0), subtitle: realMetrics ? `${realAlerts.length} total alerts` : 'Loading...', color: 'text-red-500 dark:text-red-400', trend: 'up' },
    { icon: <List className="h-5 w-5" />, label: gatewayMode ? 'Open Incidents' : 'Open Cases', value: String(realMetrics?.metrics?.openCases ?? realCases.filter(c => c.status !== 'closed').length ?? 0), subtitle: realMetrics ? `${realCases.length} total ${gatewayMode ? 'incidents' : 'cases'}` : 'Loading...', color: 'text-orange-500 dark:text-orange-400', trend: 'neutral' },
    { icon: <Clock className="h-5 w-5" />, label: 'Critical Cases', value: String(realMetrics?.metrics?.criticalCases ?? realCases.filter(c => c.severity === 'critical').length ?? 0), subtitle: 'High severity open', color: 'text-red-500 dark:text-red-400', trend: 'neutral' },
    { icon: <Activity className="h-5 w-5" />, label: 'Active Workflows', value: String(realMetrics?.metrics?.activeWorkflows ?? 0), subtitle: realMetrics?.metrics ? `${realMetrics.metrics.runningExecutions ?? 0} running` : 'Loading...', color: 'text-emerald-500 dark:text-emerald-400', trend: 'up' },
  ];

  const sevBadge = (sev: string) => {
    const map: Record<string, string> = {
      critical: 'bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/30',
      high: 'bg-orange-500/15 text-orange-500 dark:text-orange-400 border-orange-500/30',
      medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
      low: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    };
    return map[sev] || 'bg-muted text-muted-foreground border-border';
  };

  const statusBadge = (color: string) => {
    const map: Record<string, string> = {
      green: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
      yellow: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
      red: 'bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/30',
      blue: 'bg-blue-500/15 text-blue-500 dark:text-blue-400 border-blue-500/30',
      gray: 'bg-muted text-muted-foreground border-border',
    };
    return map[color] || map.gray;
  };

  // Top critical alert banner — pulled from real data, no hardcoded incident
  const topCritical = realAlerts.find(a => a.severity === 'critical' && a.status !== 'resolved' && a.status !== 'closed');
  const topHighAlert = topCritical || realAlerts.find(a => a.severity === 'high' && a.status !== 'resolved');

  return (
    <div className="space-y-4">
      {/* Header with alert banner */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {topHighAlert ? (
            <Badge variant="outline" className="bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/30 px-3 py-1 text-xs font-semibold truncate max-w-full">
              <AlertCircle className="h-3 w-3 mr-1 shrink-0" />
              <span className="truncate">[{topHighAlert.severity.toUpperCase()}] {topHighAlert.title}</span>
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 px-3 py-1 text-xs font-semibold">
              <CheckCircle2 className="h-3 w-3 mr-1" /> No active critical threats
            </Badge>
          )}
          <span className="text-xs text-muted-foreground hidden sm:inline shrink-0">Real-time Threat Operations Center</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium">{analystName}</p>
              <p className="text-[10px] text-muted-foreground">Security Operations</p>
            </div>
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">{analystInitials}</AvatarFallback>
            </Avatar>
          </div>
          <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 pulse-dot" /> Online
          </Badge>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="bg-card/80 backdrop-blur-sm" data-interactive-card>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className={`p-2 rounded-lg bg-muted/40 ${m.color}`} aria-hidden>{m.icon}</div>
                  {m.trend === 'up' && <ArrowUpRight className="h-3 w-3 text-red-500" aria-label="Trend up" />}
                  {m.trend === 'down' && <ArrowDownRight className="h-3 w-3 text-emerald-500" aria-label="Trend down" />}
                </div>
                <p className="text-2xl font-bold tabular-nums">{m.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5 font-medium">{m.label}</p>
                <p className={`text-[10px] mt-1 ${m.color}`}>{m.subtitle}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Main grid: incidents table + right sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        {/* Unified Incident Management Queue */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <List className="h-4 w-4" /> Unified Incident Management Queue
              {incs.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{incs.length}</Badge>}
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs" data-ui-button
                  onClick={() => setSeverityFilter(severityFilter === 'critical' ? '' : 'critical')}
                  aria-label="Toggle critical-severity filter"
                >
                  <Filter className="h-3 w-3 mr-1" /> {severityFilter ? `Filtering: ${severityFilter}` : 'Filter by Severity'}
                </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left bg-muted/30">
                    <th className="px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px] w-24">Severity</th>
                    <th className="px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Incident & Entity Context</th>
                    <th className="px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px] w-56">SOAR Status / MITRE</th>
                    <th className="px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wide text-[10px] w-28 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {incs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-12 text-xs text-muted-foreground">
                        <div className="mx-auto w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-2">
                          <List className="h-5 w-5 text-muted-foreground/40" />
                        </div>
                        No active incidents
                      </td>
                    </tr>
                  ) : incs.map((inc, i) => (
                    <motion.tr
                      key={inc.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      data-table-row
                      className="border-b cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={`${sevBadge(inc.severity)} font-semibold uppercase text-[10px]`}>
                          {inc.severity}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-sm">{inc.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{inc.context}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className={`${statusBadge(inc.soarStatusColor)} text-[10px] font-medium`}>
                            {inc.soarStatus}
                          </Badge>
                          {inc.mitre && (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-500 dark:text-blue-400 border-blue-500/20 text-[10px] font-mono">
                              TTP: {inc.mitre}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant={inc.action === 'Investigate' ? 'default' : inc.action === 'Triage' ? 'destructive' : 'outline'}
                          className="h-7 text-xs"
                          onClick={() => onInvestigate?.(inc.id, inc.kind ?? 'incident')}
                          data-ui-button
                        >
                          {inc.action}
                        </Button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Right Sidebar */}
        <div className="space-y-4">
          {/* Live Playbook Stream */}
          <Card data-interactive-card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Live Playbook Stream
                {lps.length > 0 && <Badge variant="secondary" className="text-[9px]">{lps.length}</Badge>}
              </CardTitle>
              <span className="text-[10px] text-muted-foreground font-medium hidden sm:inline">Auto-refresh</span>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {lps.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  No active playbooks
                </div>
              ) : lps.map((lp, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-medium ${lp.color} truncate`} title={lp.name}>{lp.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 uppercase tracking-wide">{lp.status}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden flex-1">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${lp.progress}%` }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className={`h-full rounded-full ${lp.progress === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-8 text-right">{lp.progress}%</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Global Threat Intel Feed */}
          <Card data-interactive-card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Global Threat Intel Feed
                {ti.length > 0 && <Badge variant="secondary" className="text-[9px]">{ti.length}</Badge>}
              </CardTitle>
              <Radio className="h-3.5 w-3.5 text-red-500 animate-pulse" aria-label="Live feed" />
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {ti.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  No critical threat intel at this time
                </div>
              ) : ti.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className={`text-xs p-2 rounded-md border ${
                    item.type === 'critical'
                      ? 'bg-red-500/10 border-red-500/20 text-red-500 dark:text-red-400'
                      : 'bg-muted/30 border-border'
                  }`}
                >
                  <p className="leading-relaxed">{item.text}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{item.source}</p>
                </motion.div>
              ))}
            </CardContent>
          </Card>

          {/* Asset Risk Context */}
          <Card data-interactive-card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-1.5">
                <Crosshair className="h-3.5 w-3.5" /> Asset Risk Context
              </CardTitle>
              <span className="text-[10px] text-muted-foreground font-medium truncate max-w-[120px]">{topAlertSource}</span>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-center py-2">
                <div className="relative inline-flex items-center justify-center">
                  <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="var(--muted)" strokeWidth="8" />
                    <motion.circle
                      cx="60" cy="60" r="50" fill="none"
                      stroke={assetRiskScore > 70 ? 'var(--destructive)' : 'var(--primary)'}
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${(assetRiskScore / 100) * 314.16} 314.16`}
                      initial={{ strokeDasharray: '0 314.16' }}
                      animate={{ strokeDasharray: `${(assetRiskScore / 100) * 314.16} 314.16` }}
                      transition={{ duration: 1, delay: 0.3 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold tabular-nums">{assetRiskScore}%</span>
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Risk Score</span>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2 px-2">
                  {assetRiskScore > 70 ? 'High risk due to critical alerts and active malware' : assetRiskScore > 40 ? 'Moderate risk - monitor for escalation' : 'Low risk - within normal parameters'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// INCIDENT DETAIL VIEW (Image 4)
// ============================================================================
export interface IncidentArtifact {
  type: 'ip' | 'hash' | 'domain' | 'file';
  value: string;
  malicious?: boolean;
}

export interface TimelineEntry {
  time: string;
  actor: string;
  actorType: 'system' | 'automation' | 'analyst';
  message: string;
  detail?: string;
  detailColor?: string;
}

export interface LinkedAlert {
  title: string;
  source: string;
  time: string;
  severity: 'critical' | 'high' | 'medium';
}

export interface RelatedIncident {
  title: string;
  date: string;
}

export interface RecommendedResponseAction {
  id: string;
  label: string;
  description: string;
  category: 'contain' | 'investigate' | 'notify' | 'remediate' | 'status';
  destructive: boolean;
  available: boolean;
  unavailableReason?: string;
  score: number;
}

export interface IncidentDetailProps {
  incidentId?: string;
  title?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  status?: string;
  created?: string;
  time?: string;
  source?: string;
  artifacts?: IncidentArtifact[];
  timeline?: TimelineEntry[];
  linkedAlerts?: LinkedAlert[];
  relatedIncidents?: RelatedIncident[];
  onBack?: () => void;
  onClose?: () => void;
  onAddNote?: (note: string) => void;
}

function actionIcon(id: string) {
  switch (id) {
    case 'block_ip': return <Shield className="h-4 w-4" />;
    case 'isolate_host': return <Lock className="h-4 w-4" />;
    case 'enrich_ip': return <Search className="h-4 w-4" />;
    case 'scan_hash': return <Bug className="h-4 w-4" />;
    case 'disable_user': return <UserX className="h-4 w-4" />;
    case 'notify_soc_slack': return <Bell className="h-4 w-4" />;
    case 'run_enrichment_playbook': return <Workflow className="h-4 w-4" />;
    case 'mark_investigating': return <Activity className="h-4 w-4" />;
    case 'mark_contained': return <CheckCircle2 className="h-4 w-4" />;
    default: return <Zap className="h-4 w-4" />;
  }
}

function actionColor(category: string, destructive: boolean): string {
  if (category === 'contain' || destructive) {
    return 'bg-red-500/15 text-red-500 dark:text-red-400 hover:bg-red-500/25 border-red-500/30';
  }
  if (category === 'investigate') {
    return 'bg-blue-500/15 text-blue-500 dark:text-blue-400 hover:bg-blue-500/25 border-blue-500/30';
  }
  if (category === 'notify') {
    return 'bg-purple-500/15 text-purple-500 dark:text-purple-400 hover:bg-purple-500/25 border-purple-500/30';
  }
  if (category === 'remediate') {
    return 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/25 border-yellow-500/30';
  }
  return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 border-emerald-500/30';
}

export function IncidentDetailView({
  incidentId,
  title: titleProp,
  severity: severityProp,
  status: statusProp,
  created: createdProp,
  time: timeProp,
  source: sourceProp,
  artifacts: artifactsProp,
  timeline: timelineProp,
  linkedAlerts: linkedAlertsProp,
  relatedIncidents: relatedIncidentsProp,
  onBack, onClose, onAddNote,
}: IncidentDetailProps) {
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<{ text: string; time: string; author: string }[]>([]);
  const [assignTo, setAssignTo] = useState('Unassigned');
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [currentStatus, setCurrentStatus] = useState(statusProp || 'New');
  const [scanningHash, setScanningHash] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<Record<string, string>>({});
  const [loadingIncident, setLoadingIncident] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [recommendedActions, setRecommendedActions] = useState<RecommendedResponseAction[]>([]);
  const [loadedIncident, setLoadedIncident] = useState<null | {
    title: string; severity: string; status: string; source: string;
    created: string; description?: string;
  }>(null);
  const [loadedArtifacts, setLoadedArtifacts] = useState<IncidentArtifact[]>([]);
  const [loadedTimeline, setLoadedTimeline] = useState<TimelineEntry[]>([]);
  const [loadedLinkedAlerts, setLoadedLinkedAlerts] = useState<LinkedAlert[]>([]);
  const [loadedRelated, setLoadedRelated] = useState<RelatedIncident[]>([]);
  const [incidentKind, setIncidentKind] = useState<'case' | 'alert'>('case');

  const reloadIncident = async () => {
    if (!incidentId) return;
    setLoadingIncident(true);
    try {
      const r = await soarFetch<{
        incident?: Record<string, unknown>;
        artifacts?: IncidentArtifact[];
        timeline?: TimelineEntry[];
        linkedAlerts?: LinkedAlert[];
        relatedIncidents?: RelatedIncident[];
        recommendations?: RecommendedResponseAction[];
      }>(`/api/incidents/${encodeURIComponent(incidentId)}`);
      if (!r.ok || !r.data) throw new Error(r.error || 'Failed to load incident');
      const data = r.data;
      const inc = data.incident || {};
      setIncidentKind((inc.kind as 'case' | 'alert') || 'case');
      setLoadedIncident({
        title: String(inc.title || 'Untitled incident'),
        severity: String(inc.severity || 'medium'),
        status: String(inc.status || 'open'),
        source: String(inc.source || 'unknown'),
        created: inc.createdAt ? new Date(String(inc.createdAt)).toLocaleString() : '',
        description: inc.description ? String(inc.description) : undefined,
      });
      setCurrentStatus(String(inc.status || 'open'));
      setLoadedArtifacts(data.artifacts || []);
      setLoadedTimeline(data.timeline || []);
      setLoadedLinkedAlerts((data.linkedAlerts || []).map((a) => ({
        title: a.title,
        source: a.source,
        time: a.time,
        severity: a.severity,
      })));
      setLoadedRelated((data.relatedIncidents || []).map((row) => ({
        title: row.title,
        date: row.date,
      })));
      setRecommendedActions(data.recommendations || []);
    } catch (e) {
      console.error('Incident detail load error', e);
      setActionFeedback({ ok: false, message: e instanceof Error ? e.message : 'Load failed' });
    } finally {
      setLoadingIncident(false);
    }
  };

  useEffect(() => {
    if (!incidentId) return;
    reloadIncident();
  }, [incidentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchDashboardAnalysts } = await import('@/lib/lumisec-api/browser/soarDashboard');
        const analysts = await fetchDashboardAnalysts();
        if (cancelled) return;
        const names = analysts
          .map((a) => String(a.fullName ?? (a as { name?: string }).name ?? '').trim())
          .filter(Boolean);
        if (names.length > 0) setTeamMembers(names);
      } catch {
        /* analysts optional */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (statusProp) setCurrentStatus(statusProp); }, [statusProp]);

  const title = loadedIncident?.title || titleProp || `Incident ${incidentId || ''}`;
  const severity = loadedIncident?.severity || severityProp || 'medium';
  const created = loadedIncident?.created || createdProp || '';
  const source = loadedIncident?.source || sourceProp || 'unknown';
  const time = timeProp || '';
  const artifacts = loadedArtifacts.length ? loadedArtifacts : (artifactsProp || []);
  const timeline = loadedTimeline.length ? loadedTimeline : (timelineProp || []);
  const linkedAlerts = loadedLinkedAlerts.length ? loadedLinkedAlerts : (linkedAlertsProp || []);
  const relatedIncidents = loadedRelated.length ? loadedRelated : (relatedIncidentsProp || []);

  const handleAddNote = async () => {
    if (!note.trim() || !incidentId) return;
    const text = note.trim();
    const newNote = { text, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), author: 'You' };
    setNotes([...notes, newNote]);
    onAddNote?.(text);
    setNote('');

    if (incidentKind === 'case') {
      const existing = await soarFetch<Record<string, unknown>>(`/api/cases`);
      const row = asArray<Record<string, unknown>>(existing.data).find(c => c.id === incidentId);
      if (row) {
        const timeline = typeof row.timeline === 'string' ? JSON.parse(row.timeline as string) : (row.timeline || []);
        timeline.push({ time: new Date().toISOString(), event: `Analyst note: ${text}` });
        await soarFetch('/api/cases', {
          method: 'PUT',
          body: JSON.stringify({ id: incidentId, timeline }),
        });
        await reloadIncident();
      }
    }
  };

  const persistStatus = async (status: string) => {
    if (!incidentId) return;
    setCurrentStatus(status);

    if (status === 'investigating' || status === 'contained') {
      const actionId = status === 'investigating' ? 'mark_investigating' : 'mark_contained';
      const r = await soarFetch(`/api/incidents/${encodeURIComponent(incidentId)}/respond`, {
        method: 'POST',
        body: JSON.stringify({ actionId }),
      });
      if (!r.ok) {
        setActionFeedback({ ok: false, message: r.error || 'Status update failed' });
        return;
      }
      await reloadIncident();
      return;
    }

    const path = incidentKind === 'alert' ? '/api/alerts' : '/api/cases';
    const r = await soarFetch(path, {
      method: 'PUT',
      body: JSON.stringify({ id: incidentId, status }),
    });
    if (!r.ok) {
      setActionFeedback({ ok: false, message: r.error || 'Status update failed' });
      return;
    }
    await reloadIncident();
  };

  const handleCloseIncident = async () => {
    await persistStatus('closed');
    onClose?.();
  };

  const handleExecuteAction = async (action: RecommendedResponseAction) => {
    if (!incidentId || !action.available || runningAction) return;
    setRunningAction(action.id);
    setActionFeedback(null);
    try {
      const r = await soarFetch<{ ok?: boolean; message?: string; error?: string; statusUpdated?: string }>(
        `/api/incidents/${encodeURIComponent(incidentId)}/respond`,
        { method: 'POST', body: JSON.stringify({ actionId: action.id }) },
      );
      const data = r.data || {};
      const ok = r.ok && !!data.ok;
      setActionFeedback({ ok, message: data.message || data.error || r.error || (ok ? 'Done' : 'Action failed') });
      if (data.statusUpdated) setCurrentStatus(data.statusUpdated);
      if (ok) await reloadIncident();
    } catch (e) {
      setActionFeedback({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunningAction(null);
    }
  };

  const handleScanHash = async (hashValue: string) => {
    if (!incidentId) return;
    setScanningHash(hashValue);
    try {
      const r = await soarFetch<{ ok?: boolean; message?: string; error?: string }>(
        `/api/incidents/${encodeURIComponent(incidentId)}/respond`,
        { method: 'POST', body: JSON.stringify({ actionId: 'scan_hash', params: { hash: hashValue } }) },
      );
      const data = r.data || {};
      setScanResults(prev => ({
        ...prev,
        [hashValue]: data.ok ? (data.message || 'Scan complete') : (data.message || data.error || r.error || 'Scan failed'),
      }));
      if (data.ok) await reloadIncident();
    } catch (e) {
      setScanResults(prev => ({ ...prev, [hashValue]: `Error: ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setScanningHash(null);
    }
  };

  const artifactIcon = (type: string) => {
    switch (type) {
      case 'ip': return <Server className="h-3 w-3" />;
      case 'hash': return <Hash className="h-3 w-3" />;
      case 'domain': return <Globe className="h-3 w-3" />;
      case 'file': return <FileText className="h-3 w-3" />;
      default: return <FileText className="h-3 w-3" />;
    }
  };

  const actorColor = (t: string) => {
    switch (t) {
      case 'system': return 'bg-blue-500';
      case 'automation': return 'bg-purple-500';
      case 'analyst': return 'bg-emerald-500';
      default: return 'bg-muted-foreground';
    }
  };

  const sevColor = (sev: string) => {
    const map: Record<string, string> = {
      critical: 'bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/30',
      high: 'bg-orange-500/15 text-orange-500 dark:text-orange-400 border-orange-500/30',
      medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
      low: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    };
    return map[sev] || 'bg-muted text-muted-foreground border-border';
  };

  // Format timestamp consistently with timezone indicator
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const tzShort = tz.split('/').pop()?.replace('_', ' ') || 'Local';
  const formatTime = (t: string) => {
    // If it already looks like "10:15 AM", append timezone; otherwise format as time
    if (/^\d{1,2}:\d{2}\s*[AP]M$/i.test(t)) return `${t} ${tzShort}`;
    return t;
  };

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-xs text-muted-foreground hidden sm:flex items-center">
            <span>Incident Management</span>
            <ChevronRight className="inline h-3 w-3 mx-1" />
            <span>Incident</span>
          </div>
          <Separator orientation="vertical" className="hidden sm:block h-6" />
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="outline" className="bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/30 uppercase text-[10px] font-semibold">
              <Skull className="h-3 w-3 mr-1" /> {severity}
            </Badge>
            <h2 className="text-lg font-semibold truncate">{loadingIncident ? 'Loading incident…' : title}</h2>
            <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs font-mono shrink-0">
              #{incidentId}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button variant="outline" size="sm" onClick={onBack} data-ui-button>
            <List className="h-3.5 w-3.5 mr-1" /> <span className="hidden sm:inline">Incidents Queue</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-ui-button>
                <Activity className="h-3.5 w-3.5 mr-1" /> {currentStatus}
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {['open', 'investigating', 'contained', 'resolved', 'closed'].map(s => (
                <DropdownMenuItem key={s} onClick={() => persistStatus(s)} className={s === currentStatus ? 'font-semibold capitalize' : 'capitalize'}>
                  {s}{s === currentStatus ? ' (current)' : ''}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-ui-button>
                <UserIcon className="h-3.5 w-3.5 mr-1" /> {assignTo || 'Assign to...'}
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(teamMembers.length > 0 ? teamMembers : ['Unassigned']).map(a => (
                <DropdownMenuItem key={a} onClick={() => setAssignTo(a)}>{a}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Primary action CTA - prominent */}
          <Button size="sm" onClick={handleCloseIncident} data-ui-button className="gap-1.5 shadow-sm">
            <CheckCircle2 className="h-3.5 w-3.5" /> Close Incident
          </Button>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_280px] gap-4">
        {/* LEFT: Summary + Artifacts */}
        <div className="space-y-4">
          {/* Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <div className="p-1 rounded bg-primary/15 text-primary"><FileText className="h-3 w-3" /></div>
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs pt-0">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Severity</span>
                <span className="font-medium capitalize text-red-500 dark:text-red-400">{severity}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium text-amber-600 dark:text-amber-400">{currentStatus}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="font-medium">{created}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time</span>
                <span className="font-medium tabular-nums">{formatTime(time)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Source</span>
                <span className="font-medium">{source}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Assigned to</span>
                <span className="font-medium">{assignTo}</span>
              </div>
            </CardContent>
          </Card>

          {/* Artifacts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <div className="p-1 rounded bg-primary/15 text-primary"><Bug className="h-3 w-3" /></div>
                Artifacts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {/* IPs */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1 font-semibold"><Server className="h-3 w-3" /> IP Addresses</p>
                {artifacts.filter(a => a.type === 'ip').map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 px-1.5 rounded hover:bg-muted/40 transition-colors" title={a.value}>
                    <span className="artifact-mono truncate">{a.value}</span>
                    {a.malicious && <Badge variant="outline" className="bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/30 text-[9px] px-1.5 shrink-0">Malicious</Badge>}
                  </div>
                ))}
              </div>
              {/* Hashes */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1 font-semibold"><Hash className="h-3 w-3" /> File Hashes</p>
                {artifacts.filter(a => a.type === 'hash').map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 px-1.5 rounded hover:bg-muted/40 transition-colors" title={a.value}>
                    <span className="artifact-mono truncate flex-1">{a.value}</span>
                    <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 shrink-0" data-ui-button
                      onClick={() => handleScanHash(a.value)}
                      disabled={scanningHash === a.value}
                    >
                      {scanningHash === a.value ? <Activity className="h-3 w-3 mr-1 animate-pulse" /> : null}
                      {scanningHash === a.value ? 'Scanning' : 'Scan'}
                    </Button>
                  </div>
                ))}
                {artifacts.filter(a => a.type === 'hash').map((a, i) => scanResults[a.value] && (
                  <div key={`r-${i}`} className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/30">{scanResults[a.value]}</div>
                ))}
              </div>
              {/* Domains */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1 font-semibold"><Globe className="h-3 w-3" /> Domains</p>
                {artifacts.filter(a => a.type === 'domain').map((a, i) => (
                  <div key={i} className="text-xs py-1 px-1.5 rounded hover:bg-muted/40 transition-colors artifact-mono truncate" title={a.value}>{a.value}</div>
                ))}
              </div>
              {/* Files */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1 font-semibold"><FileText className="h-3 w-3" /> Files</p>
                {artifacts.filter(a => a.type === 'file').map((a, i) => (
                  <div key={i} className="text-xs py-1 px-1.5 rounded hover:bg-muted/40 transition-colors artifact-mono truncate" title={a.value}>{a.value}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* CENTER: Investigation Timeline + Notes */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Investigation Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {timeline.map((entry, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                    className="flex gap-3"
                  >
                    {/* Timeline column */}
                    <div className="flex flex-col items-center">
                      <div className={`h-2.5 w-2.5 rounded-full ${actorColor(entry.actorType)} shrink-0 ring-4 ring-card`} />
                      {i < timeline.length - 1 && <div className="w-px flex-1 bg-border min-h-[40px] my-1" />}
                    </div>
                    {/* Content */}
                    <div className="flex-1 pb-4 -mt-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium">{entry.actor}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums" title={tz}>{formatTime(entry.time)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{entry.message}</p>
                      {entry.detail && (
                        <p className={`text-xs mt-1 font-medium ${entry.detailColor || 'text-muted-foreground'}`}>{entry.detail}</p>
                      )}
                    </div>
                  </motion.div>
                ))}
                {/* Analyst notes appear in timeline too */}
                {notes.map((n, i) => (
                  <motion.div
                    key={`note-${i}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex gap-3"
                  >
                    <div className="flex flex-col items-center">
                      <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0 ring-4 ring-card" />
                    </div>
                    <div className="flex-1 pb-4 -mt-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium">{n.author}</span>
                        <span className="text-[10px] text-muted-foreground">{n.time}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed italic">"{n.text}"</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Investigation Notes */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" /> Investigation Notes
                {notes.length > 0 && <Badge variant="secondary" className="text-[10px]">{notes.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Add investigation note... (Ctrl+Enter to submit)"
                  className="min-h-[80px] text-xs pr-24"
                  onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && note.trim()) {
                      e.preventDefault();
                      handleAddNote();
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleAddNote}
                  disabled={!note.trim()}
                  className="absolute right-2 bottom-2 h-7 text-xs"
                  data-ui-button
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Note
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to quickly submit. Notes appear in the timeline above.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Recommended Actions + Related + Linked Alerts */}
        <div className="space-y-4">
          {/* Recommended Actions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <div className="p-1 rounded bg-primary/15 text-primary"><Zap className="h-3 w-3" /></div>
                Recommended Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {actionFeedback && (
                <div className={`text-[11px] rounded-md px-2 py-1.5 border ${actionFeedback.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'}`}>
                  {actionFeedback.message}
                </div>
              )}
              {loadingIncident && recommendedActions.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">Analyzing incident context…</p>
              )}
              {!loadingIncident && recommendedActions.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">No automated actions match this incident. Add IOCs or link alerts for suggestions.</p>
              )}
              {recommendedActions.map((a) => (
                <div key={a.id} className="space-y-0.5">
                  <Button
                    variant="outline"
                    className={`w-full justify-start h-auto min-h-9 text-xs border py-2 ${actionColor(a.category, a.destructive)} transition-all ${a.available ? 'hover:translate-x-0.5' : 'opacity-50 cursor-not-allowed'}`}
                    onClick={() => handleExecuteAction(a)}
                    disabled={!a.available || runningAction === a.id}
                    data-ui-button
                    title={a.unavailableReason || a.description}
                  >
                    {runningAction === a.id ? <Activity className="h-4 w-4 animate-pulse" /> : actionIcon(a.id)}
                    <span className="ml-2 text-left flex-1">
                      <span className="block font-medium">{a.label}</span>
                      <span className="block text-[10px] opacity-80 font-normal truncate">{a.description}</span>
                    </span>
                  </Button>
                  {!a.available && a.unavailableReason && (
                    <p className="text-[10px] text-muted-foreground px-1">{a.unavailableReason}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Related Incidents */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <div className="p-1 rounded bg-primary/15 text-primary"><Link2 className="h-3 w-3" /></div>
                Related Incidents
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {relatedIncidents.map((r, i) => (
                <div key={i} className="text-xs p-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors border border-transparent hover:border-border" title={r.title}>
                  <p className="font-medium truncate">{r.title}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{r.date}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Linked Alerts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <div className="p-1 rounded bg-primary/15 text-primary"><Bell className="h-3 w-3" /></div>
                Linked Alerts
                {linkedAlerts.length > 0 && <Badge variant="secondary" className="text-[10px] ml-auto">{linkedAlerts.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {linkedAlerts.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-md hover:bg-muted/40 transition-colors border border-transparent hover:border-border">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{a.title}</p>
                    <p className="text-[10px] text-muted-foreground">{a.source} • {a.time}</p>
                  </div>
                  <Badge variant="outline" className={`${sevColor(a.severity)} text-[9px] capitalize shrink-0`}>
                    {a.severity}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Helper icon for password reset action — re-exported from lucide-react so consumers
// get a single canonical icon. Kept here only to avoid breaking imports in case the
// default `recommendedActions` array below is consumed externally.
// (No longer a custom SVG — uses lucide-react's KeyRound directly.)
