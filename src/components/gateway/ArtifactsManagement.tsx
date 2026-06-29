'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Fingerprint,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import {
  artifactTypeIcon,
  artifactTypeLabel,
  tlpBadgeClass,
} from '@/lib/lumisec-api/browser/artifactUi';
import { formatIncidentDate } from '@/lib/lumisec-api/browser/incidentUi';
import type { PaginationMeta } from '@/lib/lumisec-api/browser/soarDashboard';
import {
  bulkEnrichArtifacts,
  deleteArtifact,
  enrichArtifact,
  EnrichmentUnavailableError,
  fetchArtifactById,
  fetchArtifacts,
  updateArtifact,
  type SoarArtifact,
} from '@/lib/lumisec-api/browser/soarArtifacts';

const TLP_OPTIONS = ['WHITE', 'GREEN', 'AMBER', 'RED'];
const TYPE_OPTIONS = ['ip', 'domain', 'hash', 'url', 'email', 'file'];

function TableSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function formatFieldLabel(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

interface ArtifactDetailDrawerProps {
  artifactId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (artifact: SoarArtifact) => void;
  onDeleted: (artifactId: string) => void;
}

function ArtifactDetailDrawer({
  artifactId,
  open,
  onOpenChange,
  onUpdated,
  onDeleted,
}: ArtifactDetailDrawerProps) {
  const [artifact, setArtifact] = useState<SoarArtifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [form, setForm] = useState({
    type: 'ip',
    value: '',
    tlp: 'WHITE',
    description: '',
  });

  const loadDetail = useCallback(async () => {
    if (!artifactId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchArtifactById(artifactId);
      setArtifact(data);
      setForm({
        type: data.type || 'ip',
        value: data.value,
        tlp: data.tlp || 'WHITE',
        description: data.description ?? '',
      });
    } catch (err) {
      setError(getApiErrorMessage(err));
      setArtifact(null);
    } finally {
      setLoading(false);
    }
  }, [artifactId]);

  useEffect(() => {
    if (open && artifactId) {
      setEditing(false);
      loadDetail();
    }
  }, [open, artifactId, loadDetail]);

  const handleSave = async () => {
    if (!artifactId) return;
    setSaving(true);
    try {
      const updated = await updateArtifact(artifactId, {
        type: form.type,
        value: form.value.trim(),
        tlp: form.tlp,
        description: form.description.trim() || undefined,
      });
      setArtifact(updated);
      setEditing(false);
      onUpdated(updated);
      toast({ title: 'Artifact updated' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: getApiErrorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!artifactId) return;
    setDeleting(true);
    try {
      await deleteArtifact(artifactId);
      onDeleted(artifactId);
      onOpenChange(false);
      toast({ title: 'Artifact deleted' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: getApiErrorMessage(err),
      });
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleEnrich = async () => {
    if (!artifactId) return;
    setEnriching(true);
    try {
      const enriched = await enrichArtifact(artifactId);
      setArtifact(enriched);
      onUpdated(enriched);
      toast({ title: 'Artifact enriched' });
    } catch (err) {
      if (err instanceof EnrichmentUnavailableError) {
        toast({
          title: 'Enrichment unavailable',
          description: err.message,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Enrichment failed',
          description: getApiErrorMessage(err),
        });
      }
    } finally {
      setEnriching(false);
    }
  };

  const detailFields = useMemo(() => {
    if (!artifact) return [];
    const skip = new Set(['raw', 'enrichment', '_id', '__v']);
    return Object.entries(artifact.raw)
      .filter(([key]) => !skip.has(key))
      .map(([key, value]) => ({ key, value }));
  }, [artifact]);

  const TypeIcon = artifact ? artifactTypeIcon(artifact.type) : Fingerprint;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TypeIcon className="h-5 w-5" />
              Artifact Detail
            </SheetTitle>
          </SheetHeader>

          {loading && (
            <div className="space-y-3 mt-6">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}

          {error && !loading && (
            <Alert variant="destructive" className="mt-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {artifact && !loading && (
            <div className="mt-6 space-y-5">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={tlpBadgeClass(artifact.tlp)}>
                  TLP:{artifact.tlp}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {artifactTypeLabel(artifact.type)}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    artifact.enriched
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      : 'bg-gray-500/10 text-gray-600 border-gray-500/20'
                  }
                >
                  {artifact.enriched ? 'Enriched' : 'Not enriched'}
                </Badge>
              </div>

              {editing ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TYPE_OPTIONS.map((type) => (
                          <SelectItem key={type} value={type}>
                            {artifactTypeLabel(type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Value</Label>
                    <Input
                      value={form.value}
                      onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>TLP</Label>
                    <Select value={form.tlp} onValueChange={(v) => setForm((f) => ({ ...f, tlp: v }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TLP_OPTIONS.map((tlp) => (
                          <SelectItem key={tlp} value={tlp}>
                            {tlp}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      rows={3}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleSave} disabled={saving || !form.value.trim()}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                    </Button>
                    <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Value</p>
                    <p className="font-mono text-sm break-all">{artifact.value}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Created</p>
                      <p>{formatIncidentDate(artifact.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Source Incident</p>
                      {artifact.source_incident ? (
                        <Link
                          href={`/incidents/${artifact.source_incident}`}
                          className="text-primary hover:underline text-sm"
                        >
                          {artifact.source_incident_title ?? artifact.source_incident}
                        </Link>
                      ) : (
                        <p>—</p>
                      )}
                    </div>
                  </div>

                  {artifact.description && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Description</p>
                      <p className="text-sm">{artifact.description}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={artifact.enriched || enriching}
                      onClick={handleEnrich}
                    >
                      {enriching ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                      )}
                      Enrich
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={deleting}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete
                    </Button>
                  </div>
                </>
              )}

              <Separator />

              <div>
                <h4 className="text-sm font-medium mb-2">All Fields</h4>
                <div className="space-y-2">
                  {detailFields.map(({ key, value }) => (
                    <div key={key} className="text-xs">
                      <span className="text-muted-foreground">{formatFieldLabel(key)}</span>
                      <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono bg-muted/40 rounded p-2">
                        {formatFieldValue(value)}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>

              {artifact.enriched && artifact.enrichment && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-medium mb-2">Enrichment Data</h4>
                    <pre className="text-xs whitespace-pre-wrap break-all font-mono bg-muted/40 rounded p-3 max-h-64 overflow-y-auto">
                      {JSON.stringify(artifact.enrichment, null, 2)}
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete artifact?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The artifact will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ArtifactsManagement() {
  const [artifacts, setArtifacts] = useState<SoarArtifact[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [bulkEnriching, setBulkEnriching] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadArtifacts = useCallback(async (page: number, search: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchArtifacts({ page, limit: 20, search: search || undefined });
      setArtifacts(result.items);
      setPagination(result.pagination);
      setSelectedIds(new Set());
    } catch (err) {
      setError(getApiErrorMessage(err));
      setArtifacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [searchQuery]);

  useEffect(() => {
    loadArtifacts(pagination.page, searchQuery);
  }, [loadArtifacts, pagination.page, searchQuery]);

  const filteredArtifacts = useMemo(() => {
    if (!searchQuery) return artifacts;
    const query = searchQuery.toLowerCase();
    return artifacts.filter(
      (artifact) =>
        artifact.value.toLowerCase().includes(query) ||
        artifact.type.toLowerCase().includes(query) ||
        (artifact.source_incident ?? '').toLowerCase().includes(query) ||
        (artifact.source_incident_title ?? '').toLowerCase().includes(query),
    );
  }, [artifacts, searchQuery]);

  const visibleIds = filteredArtifacts.map((artifact) => artifact.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRowEnrich = async (artifactId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setEnrichingId(artifactId);
    try {
      const enriched = await enrichArtifact(artifactId);
      setArtifacts((prev) =>
        prev.map((item) => (item.id === artifactId ? { ...item, ...enriched } : item)),
      );
      toast({ title: 'Artifact enriched' });
    } catch (err) {
      if (err instanceof EnrichmentUnavailableError) {
        toast({
          title: 'Enrichment unavailable',
          description: err.message,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Enrichment failed',
          description: getApiErrorMessage(err),
        });
      }
    } finally {
      setEnrichingId(null);
    }
  };

  const handleBulkEnrich = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setBulkEnriching(true);
    try {
      await bulkEnrichArtifacts(ids);
      toast({ title: 'Bulk enrichment complete', description: `${ids.length} artifact(s) queued` });
      await loadArtifacts(pagination.page, searchQuery);
    } catch (err) {
      if (err instanceof EnrichmentUnavailableError) {
        toast({
          title: 'Enrichment unavailable',
          description: err.message,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Bulk enrichment failed',
          description: getApiErrorMessage(err),
        });
      }
    } finally {
      setBulkEnriching(false);
    }
  };

  const handleArtifactUpdated = (updated: SoarArtifact) => {
    setArtifacts((prev) =>
      prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
    );
  };

  const handleArtifactDeleted = (artifactId: string) => {
    setArtifacts((prev) => prev.filter((item) => item.id !== artifactId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(artifactId);
      return next;
    });
  };

  const openDetail = (artifactId: string) => {
    setDetailId(artifactId);
    setDetailOpen(true);
  };

  const totalPages = pagination.totalPages ?? 1;
  const canGoBack = pagination.page > 1;
  const canGoForward = pagination.page < totalPages;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Fingerprint className="h-5 w-5" />
            Artifacts
          </h3>
          <p className="text-sm text-muted-foreground">
            Manage and enrich threat intelligence artifacts
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button size="sm" onClick={handleBulkEnrich} disabled={bulkEnriching}>
              {bulkEnriching ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1.5" />
              )}
              Bulk Enrich ({selectedIds.size})
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadArtifacts(pagination.page, searchQuery)}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {bulkEnriching && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Enriching {selectedIds.size} artifact(s)…</span>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
          <Progress value={undefined} className="h-1.5 animate-pulse" />
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by value, type, or incident…"
          className="pl-9"
        />
      </div>

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all artifacts"
                    />
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>TLP</TableHead>
                  <TableHead>Enriched</TableHead>
                  <TableHead>Source Incident</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredArtifacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                      No artifacts found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredArtifacts.map((artifact) => {
                    const TypeIcon = artifactTypeIcon(artifact.type);
                    return (
                      <TableRow
                        key={artifact.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openDetail(artifact.id)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(artifact.id)}
                            onCheckedChange={() => toggleSelect(artifact.id)}
                            aria-label={`Select artifact ${artifact.value}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <TypeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-xs font-medium">
                              {artifactTypeLabel(artifact.type)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[220px] truncate">
                          {artifact.value}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={tlpBadgeClass(artifact.tlp)}>
                            {artifact.tlp}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              artifact.enriched
                                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                                : 'bg-gray-500/10 text-gray-600 border-gray-500/20'
                            }
                          >
                            {artifact.enriched ? 'Yes' : 'No'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {artifact.source_incident ? (
                            <Link
                              href={`/incidents/${artifact.source_incident}`}
                              className="text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {artifact.source_incident_title ?? artifact.source_incident}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatIncidentDate(artifact.created_at)}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            disabled={artifact.enriched || enrichingId === artifact.id}
                            onClick={(e) => handleRowEnrich(artifact.id, e)}
                          >
                            {enrichingId === artifact.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
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
      </div>

      <ArtifactDetailDrawer
        artifactId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdated={handleArtifactUpdated}
        onDeleted={handleArtifactDeleted}
      />
    </div>
  );
}
