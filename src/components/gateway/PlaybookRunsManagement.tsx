'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { formatIncidentDate } from '@/lib/lumisec-api/browser/incidentUi';
import { runStatusBadgeClass } from '@/lib/lumisec-api/browser/playbookRunUi';
import { fetchPlaybookRuns, type PlaybookRun } from '@/lib/lumisec-api/browser/soarPlaybooks';
import type { PaginationMeta } from '@/lib/lumisec-api/browser/soarDashboard';
import type { SoarNavigate } from '@/lib/soar/mode';

function RunStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const isRunning = normalized === 'running' || normalized === 'in_progress';

  return (
    <Badge variant="outline" className={runStatusBadgeClass(status)}>
      {isRunning && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
      )}
      {status}
    </Badge>
  );
}

interface PlaybookRunsManagementProps {
  playbookId?: string;
  onNavigate?: SoarNavigate;
  onBack?: () => void;
}

export function PlaybookRunsManagement({
  playbookId,
  onNavigate,
  onBack,
}: PlaybookRunsManagementProps) {
  const [runs, setRuns] = useState<PlaybookRun[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(
    async (page: number) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchPlaybookRuns({
          playbook_id: playbookId,
          page,
          limit: 20,
        });
        setRuns(result.items);
        setPagination(result.pagination);
      } catch (err) {
        setError(getApiErrorMessage(err));
        setRuns([]);
      } finally {
        setLoading(false);
      }
    },
    [playbookId],
  );

  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [playbookId]);

  useEffect(() => {
    loadRuns(pagination.page);
  }, [loadRuns, pagination.page]);

  const openRun = (runId: string) => {
    if (onNavigate) {
      onNavigate({ page: 'playbook-run-detail', runId });
      return;
    }
  };

  const totalPages = pagination.totalPages ?? 1;
  const canGoBack = pagination.page > 1;
  const canGoForward = pagination.page < totalPages;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Playbooks
          </Button>
          <div>
            <h2 className="text-lg font-semibold">Playbook Runs</h2>
            {playbookId && (
              <p className="text-xs text-muted-foreground font-mono">
                Filtered by playbook: {playbookId}
              </p>
            )}
          </div>
        </div>
        {playbookId && onNavigate && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate({ page: 'playbook-runs' })}
          >
            Clear filter
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Playbook</TableHead>
                    <TableHead>Triggered By</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                        No playbook runs found
                      </TableCell>
                    </TableRow>
                  ) : (
                    runs.map((run) => (
                      <TableRow
                        key={run.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openRun(run.id)}
                      >
                        <TableCell className="font-mono text-xs">{run.id}</TableCell>
                        <TableCell className="text-sm">
                          {run.playbook_name ?? run.playbook_id}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {run.triggered_by ?? 'System'}
                        </TableCell>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatIncidentDate(run.started_at)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {run.duration ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

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
        </CardContent>
      </Card>
    </div>
  );
}
