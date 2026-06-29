'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  Hash,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Shield,
  Trash2,
  User,
  X,
  Zap,
  Lightbulb,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  formatIncidentDate,
  severityBadgeClass,
  statusBadgeClass,
} from '@/lib/lumisec-api/browser/incidentUi';
import { EnrichmentUnavailableError } from '@/lib/lumisec-api/browser/soarArtifacts';
import {
  addIncidentArtifact,
  addIncidentNote,
  closeIncident,
  deleteIncident,
  enrichIncidentArtifact,
  fetchIncidentArtifacts,
  fetchIncidentById,
  fetchIncidentNotes,
  fetchIncidentTimeline,
  fetchRelatedIncidents,
  fetchRecommendations,
  linkRelatedIncident,
  respondToIncident,
  updateIncident,
  type IncidentArtifact,
  type IncidentNote,
  type RecommendedResponseAction,
  type RelatedIncident,
  type SoarIncident,
  type TimelineEvent,
} from '@/lib/lumisec-api/browser/soarIncidents';
import { fetchPlaybooks, runPlaybookOnIncident, type SoarPlaybook } from '@/lib/lumisec-api/browser/soarPlaybooks';

interface IncidentDetailPageProps {
  incidentId: string;
  onBack?: () => void;
  onNavigateIncident?: (id: string) => void;
  onNavigate?: import('@/lib/soar/mode').SoarNavigate;
}

type WidgetState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
};

function emptyWidget<T>(empty: T): WidgetState<T> {
  return { data: empty, loading: true, error: null };
}

function WidgetError({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="my-2">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function TabSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

function timelineIcon(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes('note')) return <MessageSquare className="h-4 w-4" />;
  if (normalized.includes('playbook') || normalized.includes('automation')) {
    return <Bot className="h-4 w-4" />;
  }
  if (normalized.includes('artifact')) return <Hash className="h-4 w-4" />;
  if (normalized.includes('status')) return <Activity className="h-4 w-4" />;
  if (normalized.includes('alert')) return <AlertTriangle className="h-4 w-4" />;
  return <Zap className="h-4 w-4" />;
}

export function IncidentDetailPage({ incidentId, onBack, onNavigateIncident, onNavigate }: IncidentDetailPageProps) {
  const router = useRouter();
  const goIncidents = () => (onBack ? onBack() : router.push('/incidents'));
  const goIncident = (id: string) => (onNavigateIncident ? onNavigateIncident(id) : router.push(`/incidents/${id}`));

  const [incident, setIncident] = useState<SoarIncident | null>(null);
  const [incidentLoading, setIncidentLoading] = useState(true);
  const [incidentError, setIncidentError] = useState<string | null>(null);

  const [timeline, setTimeline] = useState<WidgetState<TimelineEvent[]>>(emptyWidget([]));
  const [notes, setNotes] = useState<WidgetState<IncidentNote[]>>(emptyWidget([]));
  const [artifacts, setArtifacts] = useState<WidgetState<IncidentArtifact[]>>(emptyWidget([]));
  const [related, setRelated] = useState<WidgetState<RelatedIncident[]>>(emptyWidget([]));

  const [playbooks, setPlaybooks] = useState<SoarPlaybook[]>([]);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState('');
  const [runningPlaybook, setRunningPlaybook] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    status: '',
    severity: '',
    assigned_to: '',
    title: '',
    description: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [noteContent, setNoteContent] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [showAddArtifact, setShowAddArtifact] = useState(false);
  const [artifactForm, setArtifactForm] = useState({ type: 'ip', value: '', description: '' });
  const [addingArtifact, setAddingArtifact] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  const [linkIncidentId, setLinkIncidentId] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [recommendations, setRecommendations] = useState<RecommendedResponseAction[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const isClosed = incident?.status?.toLowerCase() === 'closed';

  useEffect(() => {
    let cancelled = false;

    const loadAll = async () => {
      setTimeline(emptyWidget([]));
      setNotes(emptyWidget([]));
      setArtifacts(emptyWidget([]));
      setRelated(emptyWidget([]));
      setRecommendationsLoading(true);
      setRecommendations([]);
      setActionFeedback(null);
      setIncidentLoading(true);
      setIncidentError(null);

      const [
        incidentResult,
        timelineResult,
        notesResult,
        artifactsResult,
        relatedResult,
        playbooksResult,
        recommendationsResult,
      ] = await Promise.all([
        fetchIncidentById(incidentId)
          .then((data) => ({ ok: true as const, data }))
          .catch((err) => ({ ok: false as const, error: getApiErrorMessage(err) })),
        fetchIncidentTimeline(incidentId)
          .then((data) => ({ ok: true as const, data }))
          .catch((err) => ({ ok: false as const, error: getApiErrorMessage(err) })),
        fetchIncidentNotes(incidentId)
          .then((data) => ({ ok: true as const, data }))
          .catch((err) => ({ ok: false as const, error: getApiErrorMessage(err) })),
        fetchIncidentArtifacts(incidentId)
          .then((data) => ({ ok: true as const, data }))
          .catch((err) => ({ ok: false as const, error: getApiErrorMessage(err) })),
        fetchRelatedIncidents(incidentId)
          .then((data) => ({ ok: true as const, data }))
          .catch((err) => ({ ok: false as const, error: getApiErrorMessage(err) })),
        fetchPlaybooks()
          .then((data) => ({ ok: true as const, data }))
          .catch(() => ({ ok: false as const, data: [] as SoarPlaybook[] })),
        fetchRecommendations(incidentId)
          .then((data) => ({ ok: true as const, data }))
          .catch(() => ({ ok: false as const, data: { recommendations: [] as RecommendedResponseAction[] } })),
      ]);

      if (cancelled) return;

      if (incidentResult.ok) {
        setIncident(incidentResult.data);
        setEditForm({
          status: incidentResult.data.status,
          severity: incidentResult.data.severity,
          assigned_to: incidentResult.data.assigned_to ?? '',
          title: incidentResult.data.title,
          description: incidentResult.data.description ?? '',
        });
        setIncidentError(null);
      } else {
        setIncident(null);
        setIncidentError(incidentResult.error);
      }
      setIncidentLoading(false);

      setTimeline({
        data: timelineResult.ok ? timelineResult.data : [],
        loading: false,
        error: timelineResult.ok ? null : timelineResult.error,
      });
      setNotes({
        data: notesResult.ok ? notesResult.data : [],
        loading: false,
        error: notesResult.ok ? null : notesResult.error,
      });
      setArtifacts({
        data: artifactsResult.ok ? artifactsResult.data : [],
        loading: false,
        error: artifactsResult.ok ? null : artifactsResult.error,
      });
      setRelated({
        data: relatedResult.ok ? relatedResult.data : [],
        loading: false,
        error: relatedResult.ok ? null : relatedResult.error,
      });

      if (playbooksResult.ok) {
        setPlaybooks(playbooksResult.data);
        if (playbooksResult.data[0]) {
          setSelectedPlaybookId(playbooksResult.data[0].id);
        }
      }

      setRecommendations(
        recommendationsResult.ok ? recommendationsResult.data.recommendations : [],
      );
      setRecommendationsLoading(false);
    };

    loadAll();

    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  const handleSaveEdit = async () => {
    if (!incident) return;
    setSavingEdit(true);
    setEditError(null);

    const changes: Record<string, string | null> = {};
    if (editForm.status !== incident.status) changes.status = editForm.status;
    if (editForm.severity !== incident.severity) changes.severity = editForm.severity;
    if ((editForm.assigned_to || null) !== incident.assigned_to) {
      changes.assigned_to = editForm.assigned_to || null;
    }
    if (editForm.title !== incident.title) changes.title = editForm.title;
    if ((editForm.description || '') !== (incident.description || '')) {
      changes.description = editForm.description;
    }

    if (Object.keys(changes).length === 0) {
      setEditing(false);
      setSavingEdit(false);
      return;
    }

    try {
      const updated = await updateIncident(incident.id, changes);
      setIncident(updated);
      setEditing(false);
      toast({ title: 'Incident updated' });
    } catch (err) {
      setEditError(getApiErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleClose = async () => {
    if (!incident) return;
    setClosing(true);
    try {
      const updated = await closeIncident(incident.id);
      setIncident(updated.status ? updated : { ...incident, status: 'closed' });
      toast({ title: 'Incident closed' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to close incident',
        description: getApiErrorMessage(err),
      });
    } finally {
      setClosing(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteIncident(incidentId);
      toast({ title: 'Incident deleted' });
      goIncidents();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to delete incident',
        description: getApiErrorMessage(err),
      });
      setDeleting(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteContent.trim()) return;
    setAddingNote(true);
    setNoteError(null);
    try {
      const note = await addIncidentNote(incidentId, noteContent.trim());
      setNotes((prev) => ({ ...prev, data: [...prev.data, note] }));
      setNoteContent('');
    } catch (err) {
      setNoteError(getApiErrorMessage(err));
    } finally {
      setAddingNote(false);
    }
  };

  const handleAddArtifact = async () => {
    if (!artifactForm.value.trim()) return;
    setAddingArtifact(true);
    setArtifactError(null);
    try {
      const artifact = await addIncidentArtifact(incidentId, {
        type: artifactForm.type,
        value: artifactForm.value.trim(),
        description: artifactForm.description.trim() || undefined,
      });
      setArtifacts((prev) => ({ ...prev, data: [...prev.data, artifact] }));
      setShowAddArtifact(false);
      setArtifactForm({ type: 'ip', value: '', description: '' });
    } catch (err) {
      setArtifactError(getApiErrorMessage(err));
    } finally {
      setAddingArtifact(false);
    }
  };

  const handleEnrich = async (artifactId: string) => {
    setEnrichingId(artifactId);
    try {
      const enriched = await enrichIncidentArtifact(artifactId);
      setArtifacts((prev) => ({
        ...prev,
        data: prev.data.map((item) =>
          item.id === artifactId ? { ...item, ...enriched, enriched: true } : item,
        ),
      }));
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

  const handleLinkIncident = async () => {
    if (!linkIncidentId.trim()) return;
    setLinking(true);
    setLinkError(null);
    try {
      const linked = await linkRelatedIncident(incidentId, linkIncidentId.trim());
      setRelated((prev) => ({ ...prev, data: [...prev.data, linked] }));
      setLinkIncidentId('');
    } catch (err) {
      setLinkError(getApiErrorMessage(err));
    } finally {
      setLinking(false);
    }
  };

  const handleExecuteAction = async (action: RecommendedResponseAction) => {
    if (!action.available || runningAction) return;
    setRunningAction(action.id);
    setActionFeedback(null);
    try {
      const result = await respondToIncident(incidentId, action.id);
      setActionFeedback({ ok: result.ok, message: result.message });
      if (result.statusUpdated && incident) {
        setIncident({ ...incident, status: result.statusUpdated });
      }
      if (result.ok) {
        const [timelineData, recs] = await Promise.all([
          fetchIncidentTimeline(incidentId).catch(() => []),
          fetchRecommendations(incidentId).catch(() => ({ recommendations: [] })),
        ]);
        setTimeline((prev) => ({ ...prev, data: timelineData }));
        setRecommendations(recs.recommendations);
        toast({ title: result.message || 'Action completed' });
      } else {
        toast({
          variant: 'destructive',
          title: 'Action failed',
          description: result.message,
        });
      }
    } catch (err) {
      const message = getApiErrorMessage(err);
      setActionFeedback({ ok: false, message });
      toast({ variant: 'destructive', title: 'Action failed', description: message });
    } finally {
      setRunningAction(null);
    }
  };

  const handleRunPlaybook = async () => {
    if (!selectedPlaybookId) return;
    setRunningPlaybook(true);
    try {
      const result = await runPlaybookOnIncident(incidentId, selectedPlaybookId);
      const runId = result.runId || 'unknown';
      toast({
        title: 'Playbook started',
        description: (
          <span>
            Run ID: {runId}.{' '}
            {runId !== 'unknown' && onNavigate && (
              <button
                type="button"
                className="underline font-medium"
                onClick={() => onNavigate({ page: 'playbook-run-detail', runId })}
              >
                View run details
              </button>
            )}
          </span>
        ),
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to run playbook',
        description: getApiErrorMessage(err),
      });
    } finally {
      setRunningPlaybook(false);
    }
  };

  if (incidentLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (incidentError || !incident) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unable to load incident</AlertTitle>
        <AlertDescription>{incidentError ?? 'Incident not found'}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={goIncidents}>
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
                <span className="text-xs text-muted-foreground font-mono">{incident.id}</span>
              </div>

              {!editing ? (
                <>
                  <h2 className="text-xl font-semibold">{incident.title}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={severityBadgeClass(incident.severity)}>
                      {incident.severity}
                    </Badge>
                    <Badge variant="outline" className={statusBadgeClass(incident.status)}>
                      {incident.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5" />
                      {incident.assigned_to ?? 'Unassigned'}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {formatIncidentDate(incident.created_at)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5" />
                      {incident.source ?? 'Unknown'}
                    </span>
                  </div>
                </>
              ) : (
                <div className="space-y-3 max-w-xl">
                  <div className="space-y-1.5">
                    <Label>Title</Label>
                    <Input
                      value={editForm.title}
                      onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Textarea
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, description: e.target.value }))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select
                        value={editForm.status}
                        onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="investigating">Investigating</SelectItem>
                          <SelectItem value="contained">Contained</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Severity</Label>
                      <Select
                        value={editForm.severity}
                        onValueChange={(v) => setEditForm((f) => ({ ...f, severity: v }))}
                      >
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
                    <div className="space-y-1.5">
                      <Label>Assigned To</Label>
                      <Input
                        value={editForm.assigned_to}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, assigned_to: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                  {editError && (
                    <Alert variant="destructive">
                      <AlertDescription>{editError}</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 shrink-0">
              {!editing ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit}>
                    {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleClose}
                disabled={closing || isClosed}
              >
                {closing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                )}
                Close Incident
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" disabled={deleting}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete incident?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. The incident will be permanently removed.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">
        {/* Tabs */}
        <Card>
          <CardContent className="p-4">
            <Tabs defaultValue="timeline">
              <TabsList>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
                <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
                <TabsTrigger value="related">Related</TabsTrigger>
              </TabsList>

              <TabsContent value="timeline" className="mt-4">
                {timeline.loading && <TabSkeleton />}
                {timeline.error && <WidgetError message={timeline.error} />}
                {!timeline.loading && !timeline.error && timeline.data.length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">No timeline events</p>
                )}
                {!timeline.loading && timeline.data.length > 0 && (
                  <div className="space-y-0">
                    {timeline.data.map((event, index) => (
                      <div key={event.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="p-1.5 rounded-full bg-primary/10 text-primary">
                            {timelineIcon(event.type)}
                          </div>
                          {index < timeline.data.length - 1 && (
                            <div className="w-px flex-1 bg-border min-h-[32px] my-1" />
                          )}
                        </div>
                        <div className="flex-1 pb-4">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-medium capitalize">{event.type}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {formatIncidentDate(event.timestamp)}
                            </span>
                          </div>
                          <p className="text-sm mt-0.5">{event.description}</p>
                          <p className="text-xs text-muted-foreground mt-1">{event.actor}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="notes" className="mt-4 space-y-4">
                {notes.loading && <TabSkeleton />}
                {notes.error && <WidgetError message={notes.error} />}
                {!notes.loading && notes.data.length === 0 && !notes.error && (
                  <p className="text-sm text-muted-foreground py-4 text-center">No notes yet</p>
                )}
                {!notes.loading && notes.data.length > 0 && (
                  <div className="space-y-3">
                    {notes.data.map((note) => (
                      <div key={note.id} className="rounded-lg border p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{note.author}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatIncidentDate(note.created_at)}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="border-t pt-4 space-y-2">
                  <Label>Add Note</Label>
                  <Textarea
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Write a note..."
                    disabled={addingNote}
                  />
                  {noteError && (
                    <Alert variant="destructive">
                      <AlertDescription>{noteError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={handleAddNote}
                      disabled={addingNote || !noteContent.trim()}
                    >
                      {addingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Note'}
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="artifacts" className="mt-4 space-y-4">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setShowAddArtifact(true)}>
                    Add Artifact
                  </Button>
                </div>
                {artifacts.loading && <TabSkeleton />}
                {artifacts.error && <WidgetError message={artifacts.error} />}
                {!artifacts.loading && !artifacts.error && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>TLP</TableHead>
                        <TableHead>Enriched</TableHead>
                        <TableHead>Created At</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {artifacts.data.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No artifacts
                          </TableCell>
                        </TableRow>
                      ) : (
                        artifacts.data.map((artifact) => (
                          <TableRow key={artifact.id}>
                            <TableCell className="capitalize">{artifact.type}</TableCell>
                            <TableCell className="font-mono text-xs max-w-[200px] truncate">
                              {artifact.value}
                            </TableCell>
                            <TableCell className="uppercase text-xs">{artifact.tlp}</TableCell>
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
                            <TableCell className="text-xs text-muted-foreground">
                              {formatIncidentDate(artifact.created_at)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={artifact.enriched || enrichingId === artifact.id}
                                onClick={() => handleEnrich(artifact.id)}
                              >
                                {enrichingId === artifact.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  'Enrich'
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              <TabsContent value="related" className="mt-4 space-y-4">
                {related.loading && <TabSkeleton />}
                {related.error && <WidgetError message={related.error} />}
                {!related.loading && related.data.length === 0 && !related.error && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No related incidents
                  </p>
                )}
                {!related.loading && related.data.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {related.data.map((item) => (
                      <Card
                        key={item.id}
                        className="cursor-pointer hover:bg-muted/40 transition-colors"
                        onClick={() => goIncident(item.id)}
                      >
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono text-muted-foreground">{item.id}</span>
                            <div className="flex gap-1">
                              <Badge variant="outline" className={severityBadgeClass(item.severity)}>
                                {item.severity}
                              </Badge>
                              <Badge variant="outline" className={statusBadgeClass(item.status)}>
                                {item.status}
                              </Badge>
                            </div>
                          </div>
                          <p className="text-sm font-medium">{item.title}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
                <div className="border-t pt-4 space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" />
                    Link Incident
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={linkIncidentId}
                      onChange={(e) => setLinkIncidentId(e.target.value)}
                      placeholder="Related incident ID"
                      disabled={linking}
                    />
                    <Button onClick={handleLinkIncident} disabled={linking || !linkIncidentId.trim()}>
                      {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link'}
                    </Button>
                  </div>
                  {linkError && (
                    <Alert variant="destructive">
                      <AlertDescription>{linkError}</AlertDescription>
                    </Alert>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Response Actions + Run Playbook */}
        <div className="space-y-4">
          <Card className="h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Lightbulb className="h-4 w-4" />
                Response Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recommendationsLoading && (
                <p className="text-xs text-muted-foreground py-2">Analyzing incident context…</p>
              )}
              {!recommendationsLoading && recommendations.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">
                  No automated actions match this incident. Add artifacts or link alerts for suggestions.
                </p>
              )}
              {recommendations.map((action) => (
                <div key={action.id} className="space-y-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start h-auto py-2 px-3 text-left"
                    disabled={!action.available || !!runningAction || isClosed}
                    onClick={() => handleExecuteAction(action)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {runningAction === action.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                        ) : (
                          <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
                        )}
                        <span className="text-xs font-medium truncate">{action.label}</span>
                        {action.destructive && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 border-red-500/30 text-red-500">
                            Destructive
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                        {action.description}
                      </p>
                      {!action.available && action.unavailableReason && (
                        <p className="text-[10px] text-amber-600 mt-0.5">{action.unavailableReason}</p>
                      )}
                    </div>
                  </Button>
                </div>
              ))}
              {actionFeedback && (
                <Alert variant={actionFeedback.ok ? 'default' : 'destructive'} className="mt-2">
                  <AlertDescription className="text-xs">{actionFeedback.message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Play className="h-4 w-4" />
              Run Playbook
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {playbooks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No playbooks available</p>
            ) : (
              <>
                <Select value={selectedPlaybookId} onValueChange={setSelectedPlaybookId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select playbook" />
                  </SelectTrigger>
                  <SelectContent>
                    {playbooks.map((pb) => (
                      <SelectItem key={pb.id} value={pb.id}>
                        {pb.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full"
                  onClick={handleRunPlaybook}
                  disabled={runningPlaybook || !selectedPlaybookId}
                >
                  {runningPlaybook ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Bot className="h-4 w-4 mr-1" />
                  )}
                  Run
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        </div>
      </div>

      {/* Add Artifact Dialog */}
      <Dialog open={showAddArtifact} onOpenChange={setShowAddArtifact}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Artifact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={artifactForm.type}
                onValueChange={(v) => setArtifactForm((f) => ({ ...f, type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ip">IP</SelectItem>
                  <SelectItem value="domain">Domain</SelectItem>
                  <SelectItem value="hash">Hash</SelectItem>
                  <SelectItem value="file">File</SelectItem>
                  <SelectItem value="url">URL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Value</Label>
              <Input
                value={artifactForm.value}
                onChange={(e) => setArtifactForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="Artifact value"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={artifactForm.description}
                onChange={(e) => setArtifactForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
              />
            </div>
            {artifactError && (
              <Alert variant="destructive">
                <AlertDescription>{artifactError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddArtifact(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddArtifact}
              disabled={addingArtifact || !artifactForm.value.trim()}
            >
              {addingArtifact ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
