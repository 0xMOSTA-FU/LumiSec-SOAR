'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Pause, Play, Square, User } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import { formatIncidentDate } from '@/lib/lumisec-api/browser/incidentUi';
import {
  isActiveRunStatus,
  runStatusBadgeClass,
  stepStatusBadgeClass,
} from '@/lib/lumisec-api/browser/playbookRunUi';
import {
  cancelPlaybookRun,
  fetchPlaybookRun,
  pausePlaybookRun,
  resumePlaybookRun,
  type PlaybookRunDetail,
} from '@/lib/lumisec-api/browser/soarPlaybooks';
import { EnrichmentResultsCards } from '@/components/gateway/EnrichmentResultsCards';
import type { SoarNavigate } from '@/lib/soar/mode';

interface PlaybookRunDetailViewProps {
  runId: string;
  onNavigate?: SoarNavigate;
  onBack?: () => void;
}

function StepSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function PlaybookRunDetailView({ runId, onNavigate, onBack }: PlaybookRunDetailViewProps) {
  const [run, setRun] = useState<PlaybookRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<'pause' | 'resume' | 'cancel' | null>(null);

  const loadRun = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const data = await fetchPlaybookRun(runId);
        setRun(data);
      } catch (err) {
        if (!silent) setRun(null);
        setError(getApiErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [runId],
  );

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  useEffect(() => {
    if (!run || !isActiveRunStatus(run.status)) return;
    const interval = setInterval(() => loadRun(true), 5000);
    return () => clearInterval(interval);
  }, [run?.status, loadRun]);

  const handleAction = async (action: 'pause' | 'resume' | 'cancel') => {
    setActionLoading(action);
    try {
      const updated =
        action === 'pause'
          ? await pausePlaybookRun(runId)
          : action === 'resume'
            ? await resumePlaybookRun(runId)
            : await cancelPlaybookRun(runId);
      setRun(updated);
      toast({
        title:
          action === 'pause' ? 'Run paused' : action === 'resume' ? 'Run resumed' : 'Run cancelled',
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Action failed',
        description: getApiErrorMessage(err),
      });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <StepSkeleton />
      </div>
    );
  }

  if (error || !run) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? 'Run not found'}</AlertDescription>
      </Alert>
    );
  }

  const status = run.status.toLowerCase();
  const isRunning = status === 'running' || status === 'in_progress';
  const isPaused = status === 'paused';

  return (
    <div className="space-y-4">
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to runs
        </Button>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-lg">{run.playbook_name ?? run.playbook_id}</CardTitle>
              <p className="text-xs font-mono text-muted-foreground">{run.id}</p>
            </div>
            <div className="flex items-center gap-2">
              {refreshing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Badge variant="outline" className={runStatusBadgeClass(run.status)}>
                {isRunning && (
                  <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
                )}
                {run.status}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <span className="text-muted-foreground">Started</span>
              <p>{formatIncidentDate(run.started_at)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Completed</span>
              <p>{run.completed_at ? formatIncidentDate(run.completed_at) : '—'}</p>
            </div>
            <div className="flex items-start gap-1.5">
              <User className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
              <div>
                <span className="text-muted-foreground">Triggered by</span>
                <p>{run.triggered_by ?? 'System'}</p>
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Duration</span>
              <p>{run.duration ?? '—'}</p>
            </div>
          </div>

          {(isRunning || isPaused) && (
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              {isRunning && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionLoading !== null}
                  onClick={() => handleAction('pause')}
                >
                  {actionLoading === 'pause' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Pause className="h-3.5 w-3.5 mr-1" />
                  )}
                  Pause
                </Button>
              )}
              {isPaused && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionLoading !== null}
                  onClick={() => handleAction('resume')}
                >
                  {actionLoading === 'resume' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Play className="h-3.5 w-3.5 mr-1" />
                  )}
                  Resume
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                disabled={actionLoading !== null}
                onClick={() => handleAction('cancel')}
              >
                {actionLoading === 'cancel' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <Square className="h-3.5 w-3.5 mr-1" />
                )}
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {run.enrichment && (run.enrichment.virustotal || run.enrichment.ipinfo || run.enrichment.abuseipdb) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Threat Intelligence Results</CardTitle>
          </CardHeader>
          <CardContent>
            {run.partial_success && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                Run completed with partial success — enrichment data is available below.
              </p>
            )}
            <EnrichmentResultsCards
              ip={run.display_ip || run.enrichment.virustotal?.ioc || '—'}
              enrichment={run.enrichment}
              durationMs={run.duration_ms ?? undefined}
              executionId={run.id}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Execution Steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {run.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No step data available</p>
          ) : (
            run.steps.map((step, index) => (
              <div key={step.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground font-mono w-6">{index + 1}</span>
                    <span className="text-sm font-medium truncate">{step.name}</span>
                  </div>
                  <Badge variant="outline" className={stepStatusBadgeClass(step.status)}>
                    {step.status}
                  </Badge>
                </div>
                {step.output && (
                  <div className="text-xs bg-muted/50 rounded p-2 font-mono whitespace-pre-wrap">
                    {step.output}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {run.incident_id && onNavigate && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onNavigate({ page: 'gateway-incident-detail', incidentId: run.incident_id! })
          }
        >
          View related incident
        </Button>
      )}
    </div>
  );
}
