'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Filter, Loader2, Plus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import {
  createIncident,
  fetchIncidents,
  bulkIncidentsAction,
  type IncidentFilters,
  type SoarIncident,
} from '@/lib/lumisec-api/browser/soarIncidents';
import type { PaginationMeta } from '@/lib/lumisec-api/browser/soarDashboard';
import {
  formatIncidentDate,
  severityBadgeClass,
  statusBadgeClass,
} from '@/lib/lumisec-api/browser/incidentUi';
import { useAuth } from '@/components/auth/AuthProvider';

const ALL_FILTER = '__all__';

const EMPTY_FILTERS: IncidentFilters = {
  status: '',
  severity: '',
  assigned_to: '',
  date_from: '',
  date_to: '',
};

function TableSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

interface CreateIncidentFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

function CreateIncidentForm({ onSuccess, onCancel }: CreateIncidentFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [assignedTo, setAssignedTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await createIncident({
        title: title.trim(),
        description: description.trim() || undefined,
        severity,
        assigned_to: assignedTo.trim() || null,
      });
      onSuccess();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="incident-title">Title</Label>
        <Input
          id="incident-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Incident title"
          required
          disabled={submitting}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="incident-description">Description</Label>
        <Textarea
          id="incident-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe the incident"
          disabled={submitting}
        />
      </div>
      <div className="space-y-2">
        <Label>Severity</Label>
        <Select value={severity} onValueChange={setSeverity} disabled={submitting}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="incident-assigned">Assigned To</Label>
        <Input
          id="incident-assigned"
          value={assignedTo}
          onChange={(event) => setAssignedTo(event.target.value)}
          placeholder="Analyst name or email"
          disabled={submitting}
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !title.trim()}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Incident'
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function IncidentsList({ onSelectIncident }: { onSelectIncident?: (id: string) => void }) {
  const router = useRouter();
  const openIncident = (id: string) => (onSelectIncident ? onSelectIncident(id) : router.push(`/incidents/${id}`));
  const { user } = useAuth();

  const [incidents, setIncidents] = useState<SoarIncident[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draftFilters, setDraftFilters] = useState<IncidentFilters>({ ...EMPTY_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState<IncidentFilters>({ ...EMPTY_FILTERS });

  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const loadIncidents = useCallback(
    async (page: number, filters: IncidentFilters) => {
      setLoading(true);
      setError(null);

      const activeFilters: IncidentFilters = {};
      if (filters.status) activeFilters.status = filters.status;
      if (filters.severity) activeFilters.severity = filters.severity;
      if (filters.assigned_to) activeFilters.assigned_to = filters.assigned_to;
      if (filters.date_from) activeFilters.date_from = filters.date_from;
      if (filters.date_to) activeFilters.date_to = filters.date_to;

      try {
        const result = await fetchIncidents(page, 20, activeFilters);
        setIncidents(result.items);
        setPagination(result.pagination);
      } catch (err) {
        setError(getApiErrorMessage(err));
        setIncidents([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!user) return;
    loadIncidents(pagination.page, appliedFilters);
  }, [user, pagination.page, appliedFilters, loadIncidents]);

  const applyFilters = () => {
    setAppliedFilters({ ...draftFilters });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setDraftFilters({ ...EMPTY_FILTERS });
    setAppliedFilters({ ...EMPTY_FILTERS });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setPagination((prev) => ({ ...prev, page }));
  };

  const handleCreateSuccess = () => {
    setShowCreate(false);
    setPagination((prev) => ({ ...prev, page: 1 }));
    loadIncidents(1, appliedFilters);
  };

  const runBulkClose = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkLoading(true);
    try {
      const result = await bulkIncidentsAction({ ids, action: 'close' });
      toast({
        title: `Closed ${result.processed} incident(s)`,
        description: result.errors.length ? result.errors.slice(0, 3).join('; ') : undefined,
        variant: result.errors.length ? 'destructive' : 'default',
      });
      setSelected(new Set());
      loadIncidents(pagination.page, appliedFilters);
    } catch (err) {
      toast({ title: 'Bulk close failed', description: getApiErrorMessage(err), variant: 'destructive' });
    } finally {
      setBulkLoading(false);
    }
  };

  const totalPages = pagination.totalPages ?? pagination.pages ?? 1;
  const canGoBack = pagination.page > 1;
  const canGoForward = pagination.page < totalPages;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Incidents</h3>
          <p className="text-sm text-muted-foreground">
            Manage and investigate security incidents
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Create Incident
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" disabled={bulkLoading} onClick={runBulkClose}>
            Close incidents
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="h-4 w-4" />
          Filters
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select
              value={draftFilters.status || ALL_FILTER}
              onValueChange={(value) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  status: value === ALL_FILTER ? '' : value,
                }))
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER}>All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="contained">Contained</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Severity</Label>
            <Select
              value={draftFilters.severity || ALL_FILTER}
              onValueChange={(value) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  severity: value === ALL_FILTER ? '' : value,
                }))
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All severities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER}>All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assigned To</Label>
            <Input
              className="h-9"
              value={draftFilters.assigned_to ?? ''}
              onChange={(event) =>
                setDraftFilters((prev) => ({ ...prev, assigned_to: event.target.value }))
              }
              placeholder="Analyst name"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Date From</Label>
            <Input
              className="h-9"
              type="date"
              value={draftFilters.date_from ?? ''}
              onChange={(event) =>
                setDraftFilters((prev) => ({ ...prev, date_from: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Date To</Label>
            <Input
              className="h-9"
              type="date"
              value={draftFilters.date_to ?? ''}
              onChange={(event) =>
                setDraftFilters((prev) => ({ ...prev, date_to: event.target.value }))
              }
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={applyFilters}>
            Apply Filters
          </Button>
          <Button size="sm" variant="outline" onClick={clearFilters}>
            Clear
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="p-4">
            <TableSkeleton />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={incidents.length > 0 && selected.size === incidents.length}
                      onCheckedChange={(v) => {
                        if (v) setSelected(new Set(incidents.map((i) => i.id)));
                        else setSelected(new Set());
                      }}
                    />
                  </TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Updated At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                      No incidents found
                    </TableCell>
                  </TableRow>
                ) : (
                  incidents.map((incident) => (
                    <TableRow
                      key={incident.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openIncident(incident.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(incident.id)}
                          onCheckedChange={(v) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(incident.id);
                              else next.delete(incident.id);
                              return next;
                            });
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{incident.id}</TableCell>
                      <TableCell className="font-medium max-w-[240px] truncate">
                        {incident.title}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={severityBadgeClass(incident.severity)}>
                          {incident.severity}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadgeClass(incident.status)}>
                          {incident.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{incident.assigned_to ?? 'Unassigned'}</TableCell>
                      <TableCell>{incident.source ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {formatIncidentDate(incident.created_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {formatIncidentDate(incident.updated_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">
                {pagination.total > 0
                  ? `Showing page ${pagination.page} of ${totalPages} (${pagination.total} total)`
                  : 'No results'}
              </p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        if (canGoBack && !loading) handlePageChange(pagination.page - 1);
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
                        if (canGoForward && !loading) handlePageChange(pagination.page + 1);
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

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Incident</DialogTitle>
          </DialogHeader>
          <CreateIncidentForm
            onSuccess={handleCreateSuccess}
            onCancel={() => setShowCreate(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
