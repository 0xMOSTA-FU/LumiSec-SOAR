'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import {
  approveRequest,
  fetchApprovals,
  rejectRequest,
  type SoarApproval,
} from '@/lib/lumisec-api/browser/soarApprovals';
import { formatIncidentDate } from '@/lib/lumisec-api/browser/incidentUi';

function riskBadge(risk: string) {
  const r = risk.toLowerCase();
  if (r === 'critical') return 'bg-red-500/10 text-red-600 border-red-500/20';
  if (r === 'high') return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
  return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
}

export function ApprovalsManagement() {
  const [approvals, setApprovals] = useState<SoarApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setApprovals(await fetchApprovals('pending'));
    } catch (e) {
      toast({ title: 'Failed to load approvals', description: getApiErrorMessage(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: 'approve' | 'reject') {
    setActingId(id);
    try {
      if (action === 'approve') await approveRequest(id, comments[id]);
      else await rejectRequest(id, comments[id]);
      toast({ title: action === 'approve' ? 'Approved' : 'Rejected' });
      await load();
    } catch (e) {
      toast({ title: 'Action failed', description: getApiErrorMessage(e), variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-amber-500" />
            Approvals Inbox
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Destructive containment actions require human approval before execution.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending ({approvals.length})</CardTitle>
          <CardDescription>Block IP, isolate host, disable user, and workflow gates</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : approvals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No pending approvals.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Comment</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvals.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.action}</TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">{a.targetType}</span>
                      <div className="font-mono text-sm truncate max-w-[200px]">{a.targetValue}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={riskBadge(a.riskLevel)}>
                        {a.riskLevel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.createdAt ? formatIncidentDate(a.createdAt) : '—'}
                    </TableCell>
                    <TableCell>
                      <Textarea
                        className="min-h-[60px] text-xs"
                        placeholder="Optional comment"
                        value={comments[a.id] || ''}
                        onChange={(e) => setComments((c) => ({ ...c, [a.id]: e.target.value }))}
                      />
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="default"
                        disabled={actingId === a.id}
                        onClick={() => act(a.id, 'approve')}
                      >
                        {actingId === a.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                        )}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actingId === a.id}
                        onClick={() => act(a.id, 'reject')}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
