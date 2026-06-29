'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import {
  exportAnalyticsReport,
  fetchAnalyticsKpis,
  fetchAnalyticsReport,
  fetchAnalyticsSnapshots,
  type AnalyticsDays,
  type AnalyticsKpi,
  type AnalyticsReport,
  type AnalyticsSnapshots,
  type ExportFormat,
  type SnapshotSeries,
} from '@/lib/lumisec-api/browser/soarAnalytics';

const DAY_OPTIONS: AnalyticsDays[] = [7, 14, 30, 90];

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
];

function kpiIcon(key: string): React.ReactNode {
  const normalized = key.toLowerCase();
  if (normalized.includes('mttr') || normalized.includes('mttd') || normalized.includes('time')) {
    return <Clock className="h-5 w-5" />;
  }
  if (normalized.includes('resolved') || normalized.includes('closed')) {
    return <CheckCircle2 className="h-5 w-5" />;
  }
  if (normalized.includes('false') || normalized.includes('accuracy')) {
    return <AlertTriangle className="h-5 w-5" />;
  }
  if (normalized.includes('automation') || normalized.includes('roi') || normalized.includes('playbook')) {
    return <Bot className="h-5 w-5" />;
  }
  return <BarChart3 className="h-5 w-5" />;
}

function kpiStyle(index: number): { bg: string; color: string } {
  const styles = [
    { bg: 'bg-blue-500/10', color: 'text-blue-500' },
    { bg: 'bg-purple-500/10', color: 'text-purple-500' },
    { bg: 'bg-emerald-500/10', color: 'text-emerald-500' },
    { bg: 'bg-orange-500/10', color: 'text-orange-500' },
    { bg: 'bg-pink-500/10', color: 'text-pink-500' },
  ];
  return styles[index % styles.length];
}

function formatColumnLabel(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatCellValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}

function KpiCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}

interface SnapshotChartProps {
  title: string;
  series: SnapshotSeries[];
  combined: Record<string, string | number>[];
  variant: 'line' | 'bar';
}

function SnapshotChart({ title, series, combined, variant }: SnapshotChartProps) {
  const chartConfig = useMemo(() => {
    const config: Record<string, { label: string; color: string }> = {};
    series.forEach((item, index) => {
      config[item.key] = {
        label: item.label,
        color: CHART_COLORS[index % CHART_COLORS.length],
      };
    });
    return config;
  }, [series]);

  const xKey = useMemo(() => {
    for (const key of ['date', 'timestamp', 'time', 'period', 'week', 'label']) {
      if (combined.some((row) => row[key] !== undefined)) return key;
    }
    return 'date';
  }, [combined]);

  if (combined.length === 0 || series.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-16">No chart data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-64 w-full">
          {variant === 'line' ? (
            <LineChart data={combined} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey={xKey}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {series.map((item) => (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  stroke={`var(--color-${item.key})`}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={combined} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey={xKey}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {series.map((item) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  fill={`var(--color-${item.key})`}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          )}
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function groupSnapshotCharts(snapshots: AnalyticsSnapshots): Array<{
  title: string;
  series: SnapshotSeries[];
  combined: Record<string, string | number>[];
  variant: 'line' | 'bar';
}> {
  if (snapshots.series.length === 0) return [];

  const countLike = snapshots.series.filter((series) =>
    /incident|opened|closed|count|total|triggered|executed/i.test(series.key),
  );
  const durationLike = snapshots.series.filter((series) =>
    /mttr|mttd|duration|time|latency|response|resolve/i.test(series.key),
  );

  const used = new Set<string>();
  const groups: Array<{
    title: string;
    series: SnapshotSeries[];
    combined: Record<string, string | number>[];
    variant: 'line' | 'bar';
  }> = [];

  const addGroup = (
    title: string,
    series: SnapshotSeries[],
    variant: 'line' | 'bar',
  ) => {
    if (series.length === 0) return;
    series.forEach((item) => used.add(item.key));
    groups.push({
      title,
      series,
      combined: snapshots.combined,
      variant,
    });
  };

  addGroup('Incident Volume', countLike, 'line');
  addGroup('Response Metrics', durationLike, 'bar');

  const remaining = snapshots.series.filter((series) => !used.has(series.key));
  if (remaining.length > 0) {
    addGroup(
      remaining.length === 1 ? remaining[0].label : 'Metrics Over Time',
      remaining,
      'line',
    );
  }

  if (groups.length === 0 && snapshots.combined.length > 0) {
    groups.push({
      title: 'Analytics Snapshots',
      series: snapshots.series,
      combined: snapshots.combined,
      variant: 'line',
    });
  }

  return groups;
}

function ReportSection({ report }: { report: AnalyticsReport }) {
  if (!report.summary && report.sections.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No report data available
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {report.summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {report.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {report.sections.map((section, index) => (
        <Card key={`${section.title}-${index}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{section.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {section.type === 'text' && section.text ? (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {section.text}
              </p>
            ) : section.rows && section.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {(section.columns ?? []).map((column) => (
                        <TableHead key={column}>{formatColumnLabel(column)}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section.rows.map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        {(section.columns ?? []).map((column) => (
                          <TableCell key={column}>{formatCellValue(row[column])}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No data in this section</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [kpis, setKpis] = useState<AnalyticsKpi[]>([]);
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshots>({ series: [], combined: [] });
  const [report, setReport] = useState<AnalyticsReport>({ summary: null, sections: [] });
  const [loading, setLoading] = useState(true);
  const [kpisLoading, setKpisLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const loadInitial = useCallback(async (selectedDays: AnalyticsDays) => {
    setLoading(true);
    setError(null);
    try {
      const [snapshotsData, reportData, kpisData] = await Promise.all([
        fetchAnalyticsSnapshots(selectedDays),
        fetchAnalyticsReport(selectedDays),
        fetchAnalyticsKpis(selectedDays),
      ]);
      setSnapshots(snapshotsData);
      setReport(reportData);
      setKpis(kpisData);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKpis = useCallback(async (selectedDays: AnalyticsDays) => {
    setKpisLoading(true);
    try {
      const data = await fetchAnalyticsKpis(selectedDays);
      setKpis(data);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to refresh KPIs',
        description: getApiErrorMessage(err),
      });
    } finally {
      setKpisLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitial(days);
  }, [loadInitial]);

  const handleDaysChange = (value: string) => {
    const nextDays = Number(value) as AnalyticsDays;
    setDays(nextDays);
    loadInitial(nextDays);
  };

  const handleExport = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await exportAnalyticsReport(format, days);
      toast({ title: 'Export started', description: `Downloading ${format.toUpperCase()} report…` });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Export failed',
        description: getApiErrorMessage(err),
      });
    } finally {
      setExporting(null);
    }
  };

  const chartGroups = useMemo(() => groupSnapshotCharts(snapshots), [snapshots]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-primary flex items-center gap-2">
            <BarChart3 className="h-6 w-6" /> Analytics & Reporting
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Incident analysis and performance metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={handleDaysChange}>
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue placeholder="Days" />
            </SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  Last {option} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={exporting !== null}>
                {exporting ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1.5" />
                )}
                Export Report
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={exporting !== null} onClick={() => handleExport('pdf')}>
                Export as PDF
              </DropdownMenuItem>
              <DropdownMenuItem disabled={exporting !== null} onClick={() => handleExport('csv')}>
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {loading || kpisLoading
          ? Array.from({ length: 5 }).map((_, index) => <KpiCardSkeleton key={index} />)
          : kpis.length === 0
            ? (
              <Card className="col-span-full">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No KPI data available for the selected period
                </CardContent>
              </Card>
            )
            : kpis.map((kpi, index) => {
              const style = kpiStyle(index);
              const hasDelta = kpi.delta !== null && kpi.delta !== undefined;
              const positive = (kpi.delta ?? 0) > 0;
              const isGoodTrend = kpi.lowerIsBetter ? !positive : positive;
              const trendColor = isGoodTrend ? 'text-emerald-500' : 'text-red-500';

              return (
                <motion.div
                  key={kpi.key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className={`p-2 rounded-lg ${style.bg} ${style.color}`}>
                          {kpiIcon(kpi.key)}
                        </div>
                        {hasDelta && (
                          <span className={`text-xs flex items-center gap-0.5 font-medium ${trendColor}`}>
                            {positive ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {Math.abs(kpi.delta ?? 0)}%
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="text-2xl font-bold tracking-tight">{kpi.value}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{kpi.label}</p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loading
          ? Array.from({ length: 2 }).map((_, index) => <ChartSkeleton key={index} />)
          : chartGroups.length > 0
            ? chartGroups.map((group) => (
              <SnapshotChart
                key={group.title}
                title={group.title}
                series={group.series}
                combined={group.combined}
                variant={group.variant}
              />
            ))
            : (
              <Card className="lg:col-span-2">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No snapshot chart data available
                </CardContent>
              </Card>
            )}
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Detailed Report</h3>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <ReportSection report={report} />
        )}
      </div>
    </div>
  );
}
