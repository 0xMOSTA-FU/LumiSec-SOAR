'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import { alertSeverityBadgeClass, alertStatusBadgeClass } from '@/lib/lumisec-api/browser/alertUi';
import { formatIncidentDate } from '@/lib/lumisec-api/browser/incidentUi';
import { createIncident } from '@/lib/lumisec-api/browser/soarIncidents';
import type { PaginationMeta } from '@/lib/lumisec-api/browser/soarDashboard';
import {
  fetchAlertById,
  fetchAlerts,
  getAlertIds,
  hasNewAlerts,
  bulkAlertsAction,
  type SoarAlert,
  type SoarAlertDetail,
} from '@/lib/lumisec-api/browser/soarAlerts';

const POLL_INTERVAL_MS = 30_000;

function TableSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

function formatRawEvent(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

interface AlertDetailDrawerProps {
  alertId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: import('@/lib/soar/mode').SoarNavigate;
}

function AlertDetailDrawer({ alertId, open, onOpenChange, onNavigate }: AlertDetailDrawerProps) {
  const router = useRouter();
  const [alert, setAlert] = useState<SoarAlertDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingIncident, setCreatingIncident] = useState(false);

  useEffect(() => {
    if (!open || !alertId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setAlert(null);

    fetchAlertById(alertId)
      .then((data) => {
        if (!cancelled) setAlert(data);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, alertId]);

  const handleCreateIncident = async () => {
    if (!alert) return;
    setCreatingIncident(true);
    try {
      const incident = await createIncident({
        title: alert.title,
        severity: alert.severity,
        description: alert.description ?? undefined,
        source: alert.source ?? undefined,
        source_alert_id: alert.id,
      });
      toast({ title: 'Incident created from alert' });
      onOpenChange(false);
      if (onNavigate) {
        onNavigate({ page: 'gateway-incident-detail', incidentId: incident.id });
      } else {
        router.push(`/incidents/${incident.id}`);
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to create incident',
        description: getApiErrorMessage(err),
      });
    } finally {
      setCreatingIncident(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="pr-8">{alert?.title ?? 'Alert Detail'}</SheetTitle>
          {alert && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="outline" className={alertSeverityBadgeClass(alert.severity)}>
                {alert.severity}
              </Badge>
              <Badge variant="outline" className={alertStatusBadgeClass(alert.status)}>
                {alert.status}
              </Badge>
            </div>
          )}
        </SheetHeader>

        {loading && (
          <div className="space-y-3 mt-6">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {error && !loading && (
          <Alert variant="destructive" className="mt-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {alert && !loading && (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Alert ID</p>
                <p className="font-mono text-xs break-all">{alert.id}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Source</p>
                <p>{alert.source ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p>{formatIncidentDate(alert.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Matched At</p>
                <p>{alert.matched_at ? formatIncidentDate(alert.matched_at) : '—'}</p>
              </div>
            </div>

            {alert.rule_name && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Rule Name</p>
                <p className="text-sm font-medium">{alert.rule_name}</p>
              </div>
            )}

            {alert.description && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Description</p>
                <p className="text-sm whitespace-pre-wrap">{alert.description}</p>
              </div>
            )}

            {alert.raw_event !== null && alert.raw_event !== undefined && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Raw Event</p>
                <pre className="text-xs font-mono bg-muted/40 rounded p-3 overflow-x-auto max-h-48 whitespace-pre-wrap">
                  {formatRawEvent(alert.raw_event)}
                </pre>
              </div>
            )}

            {alert.related_incidents.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Related Incidents</p>
                <div className="space-y-2">
                  {alert.related_incidents.map((incident) => (
                    <Link
                      key={incident.id}
                      href={`/incidents/${incident.id}`}
                      className="block rounded-md border p-2 hover:bg-muted/50 transition-colors"
                    >
                      <p className="text-sm font-medium">{incident.title}</p>
                      {(incident.severity || incident.status) && (
                        <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                          {[incident.severity, incident.status].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            <Button
              className="w-full"
              onClick={handleCreateIncident}
              disabled={creatingIncident}
            >
              {creatingIncident ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Create Incident from Alert
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function AlertsManagement({
  onNavigate,
  initialAlertId,
  onInitialAlertConsumed,
}: {
  onNavigate?: import('@/lib/soar/mode').SoarNavigate;
  initialAlertId?: string | null;
  onInitialAlertConsumed?: () => void;
}) {
  const [alerts, setAlerts] = useState<SoarAlert[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newAlertsAvailable, setNewAlertsAvailable] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const knownIdsRef = useRef<Set<string>>(new Set());
  const lastKnownTotalRef = useRef(0);

  useEffect(() => {
    if (!initialAlertId) return;
    setDetailId(initialAlertId);
    setDetailOpen(true);
    onInitialAlertConsumed?.();
  }, [initialAlertId, onInitialAlertConsumed]);

  const loadAlerts = useCallback(async (page: number, limit: number, silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await fetchAlerts({ page, limit });
      setAlerts(result.items);
      setPagination(result.pagination);
      lastKnownTotalRef.current = result.pagination.total;
      if (page === 1) {
        knownIdsRef.current = getAlertIds(result.items);
      }
      setNewAlertsAvailable(false);
    } catch (err) {
      if (!silent) {
        setError(getApiErrorMessage(err));
        setAlerts([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlerts(pagination.page, pagination.limit);
  }, [loadAlerts, pagination.page, pagination.limit]);

  useEffect(() => {
    const poll = async () => {
      try {
        const result = await fetchAlerts({ page: 1, limit: pagination.limit });
        const totalIncreased = result.pagination.total > lastKnownTotalRef.current;
        const newIdsOnFirstPage = hasNewAlerts(knownIdsRef.current, result.items);
        if (totalIncreased || newIdsOnFirstPage) {
          setNewAlertsAvailable(true);
        }
      } catch {
        // Ignore polling errors
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pagination.limit]);

  const handleRefresh = () => {
    loadAlerts(pagination.page, pagination.limit);
  };

  const openDetail = (alertId: string) => {
    setDetailId(alertId);
    setDetailOpen(true);
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const runBulk = async (action: 'escalate' | 'dismiss') => {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkLoading(true);
    try {
      const result = await bulkAlertsAction({ ids, action });
      toast({
        title: `${result.processed} alert(s) ${action === 'escalate' ? 'escalated' : 'dismissed'}`,
        description: result.errors.length ? result.errors.slice(0, 3).join('; ') : undefined,
        variant: result.errors.length ? 'destructive' : 'default',
      });
      setSelected(new Set());
      handleRefresh();
    } catch (e) {
      toast({ title: 'Bulk action failed', description: getApiErrorMessage(e), variant: 'destructive' });
    } finally {
      setBulkLoading(false);
    }
  };

  const totalPages = pagination.totalPages ?? 1;
  const canGoBack = pagination.page > 1;
  const canGoForward = pagination.page < totalPages;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Alerts
          </h3>
          <p className="text-sm text-muted-foreground">
            Security alerts from integrated sources
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" disabled={bulkLoading} onClick={() => runBulk('escalate')}>
            Escalate to incidents
          </Button>
          <Button size="sm" variant="outline" disabled={bulkLoading} onClick={() => runBulk('dismiss')}>
            Dismiss
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {newAlertsAvailable && (
        <Alert className="cursor-pointer border-primary/30 bg-primary/5" onClick={handleRefresh}>
          <Bell className="h-4 w-4" />
          <AlertTitle>New alerts available</AlertTitle>
          <AlertDescription>Click to refresh and load the latest alerts.</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border bg-card">
        {loading ? (
          <TableSkeleton />
        ) : (
          <>
            <div className="overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={alerts.length > 0 && selected.size === alerts.length}
                      onCheckedChange={(v) => {
                        if (v) setSelected(new Set(alerts.map((a) => a.id)));
                        else setSelected(new Set());
                      }}
                    />
                  </TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12 max-w-lg mx-auto">
                      <p className="font-medium text-foreground mb-1">No alerts ingested yet</p>
                      <p className="text-sm">
                        Alerts appear when SIEM, webhooks, or connected tools send events to SOAR — not from demo data.
                        Configure Connectors or Webhooks to start ingest.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  alerts.map((alert) => (
                    <TableRow
                      key={alert.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openDetail(alert.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(alert.id)}
                          onCheckedChange={(v) => toggleSelect(alert.id, v === true)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[120px] truncate">
                        {alert.id}
                      </TableCell>
                      <TableCell className="text-sm font-medium max-w-[240px] truncate">
                        {alert.title}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={alertSeverityBadgeClass(alert.severity)}>
                          {alert.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {alert.source ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={alertStatusBadgeClass(alert.status)}>
                          {alert.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatIncidentDate(alert.created_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">
                Page {pagination.page} of {totalPages}
                {pagination.total > 0 ? ` (${pagination.total} total)` : ''}
              </p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        if (canGoBack && !loading) {
                          setPagination((prev) => ({ ...prev, page: prev.page - 1 }));
                        }
                      }}
                      className={!canGoBack || loading ? 'pointer-events-none opacity-50' : ''}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        if (canGoForward && !loading) {
                          setPagination((prev) => ({ ...prev, page: prev.page + 1 }));
                        }
                      }}
                      className={!canGoForward || loading ? 'pointer-events-none opacity-50' : ''}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </>
        )}
      </div>

      <AlertDetailDrawer
        alertId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onNavigate={onNavigate}
      />
    </div>
  );
}
