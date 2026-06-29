'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SoarNavigate } from '@/lib/soar/mode';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  BookOpen,
  Clock,
  GitBranch,
  History,
  Link2,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Zap,
  AlertTriangle,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import { formatIncidentDate } from '@/lib/lumisec-api/browser/incidentUi';
import {
  createPlaybook,
  deletePlaybook,
  executePlaybook,
  fetchPlaybookById,
  fetchPlaybooks,
  setPlaybookStatus,
  updatePlaybook,
  type PlaybookFormInput,
  type SoarPlaybook,
} from '@/lib/lumisec-api/browser/soarPlaybooks';
import { LinkWorkflowDialog } from '@/components/soar/modals/LinkWorkflowDialog';
import type { Workflow } from '@/app/soar/types';
import { soarFetch, asArray } from '@/lib/soar/fetch-json';

const DEFAULT_STEPS_JSON = `[
  {
    "type": "block_ip",
    "order": 0,
    "params": { "ip": "{{blockedIp}}" }
  }
]`;

function statusBadgeClass(status: string): string {
  return status.toLowerCase() === 'active'
    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    : 'bg-gray-500/10 text-gray-600 border-gray-500/20';
}

interface PlaybookFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbookId?: string;
  workflows: Workflow[];
  onSuccess: (playbook: SoarPlaybook) => void;
}

function PlaybookFormDialog({
  open,
  onOpenChange,
  playbookId,
  workflows,
  onSuccess,
}: PlaybookFormDialogProps) {
  const isEdit = Boolean(playbookId);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState('manual');
  const [stepsJson, setStepsJson] = useState(DEFAULT_STEPS_JSON);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    if (!playbookId) {
      setName('');
      setDescription('');
      setTrigger('manual');
      setStepsJson(DEFAULT_STEPS_JSON);
      setWorkflowId(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    setError(null);

    fetchPlaybookById(playbookId)
      .then((pb) => {
        if (cancelled) return;
        setName(pb.name);
        setDescription(pb.description ?? '');
        setTrigger(pb.trigger_type);
        setStepsJson(
          pb.steps.length > 0 ? JSON.stringify(pb.steps, null, 2) : '[]',
        );
        setWorkflowId(pb.workflow_id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, playbookId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    let steps: unknown[];
    try {
      const parsed = JSON.parse(stepsJson);
      if (!Array.isArray(parsed)) {
        setError('Steps must be a JSON array');
        return;
      }
      steps = parsed;
    } catch {
      setError('Steps must be valid JSON');
      return;
    }

    const input: PlaybookFormInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      trigger,
      steps,
      workflow_id: workflowId,
    };

    setSubmitting(true);
    try {
      const result = isEdit && playbookId
        ? await updatePlaybook(playbookId, input)
        : await createPlaybook(input);
      onSuccess(result);
      onOpenChange(false);
      toast({ title: isEdit ? 'Playbook updated' : 'Playbook created' });
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Playbook' : 'Create Playbook'}</DialogTitle>
        </DialogHeader>

        {loadingDetail ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pb-name">Name</Label>
              <Input
                id="pb-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Playbook name"
                required
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pb-description">Description</Label>
              <Textarea
                id="pb-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this playbook do?"
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label>Trigger</Label>
              <Select value={trigger} onValueChange={setTrigger} disabled={submitting}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="schedule">Schedule</SelectItem>
                  <SelectItem value="alert">Alert</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Linked Workflow</Label>
              <Select
                value={workflowId ?? '__none__'}
                onValueChange={(value) => setWorkflowId(value === '__none__' ? null : value)}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select workflow to execute" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No workflow (documentation only)</SelectItem>
                  {workflows.map((wf) => (
                    <SelectItem key={wf.id} value={wf.id}>
                      {wf.name} ({wf.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Playbooks run the linked workflow when executed from an incident or the Run button.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pb-steps">Steps (JSON)</Label>
              <Textarea
                id="pb-steps"
                value={stepsJson}
                onChange={(e) => setStepsJson(e.target.value)}
                className="font-mono text-xs min-h-[180px]"
                disabled={submitting}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isEdit ? (
                  'Save Changes'
                ) : (
                  'Create Playbook'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </Card>
  );
}

export function PlaybooksManagement({
  onNavigate,
}: {
  onNavigate?: SoarNavigate;
}) {
  const router = useRouter();
  const { user } = useAuth();

  const [playbooks, setPlaybooks] = useState<SoarPlaybook[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [linkingPlaybookId, setLinkingPlaybookId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();

  const loadWorkflows = useCallback(async () => {
    const res = await soarFetch<Record<string, unknown>[]>('/api/workflows');
    if (!res.ok) {
      setWorkflows([]);
      return;
    }
    setWorkflows(
      asArray<Record<string, unknown>>(res.data).map((w) => ({
        id: String(w.id),
        name: String(w.name ?? 'Workflow'),
        description: w.description ? String(w.description) : undefined,
        status: String(w.status ?? 'draft'),
        nodes: Array.isArray(w.nodes) ? (w.nodes as Workflow['nodes']) : [],
        edges: Array.isArray(w.edges) ? (w.edges as Workflow['edges']) : [],
        trigger:
          w.trigger && typeof w.trigger === 'object'
            ? (w.trigger as Record<string, unknown>)
            : {},
        tags: Array.isArray(w.tags) ? (w.tags as string[]) : [],
        createdAt: String(w.createdAt ?? ''),
        updatedAt: String(w.updatedAt ?? ''),
      })),
    );
  }, []);

  const loadPlaybooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPlaybooks();
      setPlaybooks(data);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setPlaybooks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadPlaybooks();
    loadWorkflows();
  }, [user, loadPlaybooks, loadWorkflows]);

  const handleRun = async (playbook: SoarPlaybook) => {
    if (!playbook.workflow_id) {
      toast({
        variant: 'destructive',
        title: 'No linked workflow',
        description: 'Link a workflow before running this playbook.',
      });
      return;
    }
    setRunningId(playbook.id);
    try {
      const result = await executePlaybook(playbook.id, {});
      toast({ title: 'Playbook execution started' });
      if (result.runId && onNavigate) {
        onNavigate({ page: 'playbook-run-detail', runId: result.runId });
      } else if (onNavigate) {
        onNavigate({ page: 'playbook-runs', playbookId: playbook.id });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Execution failed',
        description: getApiErrorMessage(err),
      });
    } finally {
      setRunningId(null);
    }
  };

  const handleLinkWorkflow = async (playbookId: string, workflowId: string | null) => {
    try {
      const updated = await updatePlaybook(playbookId, { workflow_id: workflowId });
      setPlaybooks((prev) =>
        prev.map((item) => (item.id === playbookId ? { ...item, ...updated } : item)),
      );
      toast({
        title: workflowId ? 'Workflow linked' : 'Workflow unlinked',
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to update link',
        description: getApiErrorMessage(err),
      });
    }
  };

  const handleToggle = async (playbook: SoarPlaybook, active: boolean) => {
    setTogglingId(playbook.id);
    try {
      const updated = await setPlaybookStatus(playbook.id, active);
      setPlaybooks((prev) =>
        prev.map((item) => (item.id === playbook.id ? { ...item, ...updated } : item)),
      );
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to update status',
        description: getApiErrorMessage(err),
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deletePlaybook(id);
      setPlaybooks((prev) => prev.filter((item) => item.id !== id));
      toast({ title: 'Playbook deleted' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to delete playbook',
        description: getApiErrorMessage(err),
      });
    } finally {
      setDeletingId(null);
    }
  };

  const openCreate = () => {
    setEditingId(undefined);
    setFormOpen(true);
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setFormOpen(true);
  };

  const handleFormSuccess = (playbook: SoarPlaybook) => {
    setPlaybooks((prev) => {
      const exists = prev.some((item) => item.id === playbook.id);
      if (exists) {
        return prev.map((item) => (item.id === playbook.id ? { ...item, ...playbook } : item));
      }
      return [playbook, ...prev];
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Playbooks
          </h3>
          <p className="text-sm text-muted-foreground">
            Automated response procedures and orchestration workflows
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Create Playbook
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      ) : playbooks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No playbooks found. Create your first playbook to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {playbooks.map((playbook) => {
            const isActive = playbook.status.toLowerCase() === 'active';
            const linkedWf = workflows.find((w) => w.id === playbook.workflow_id);
            return (
              <Card key={playbook.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{playbook.name}</CardTitle>
                    <Badge variant="outline" className={statusBadgeClass(playbook.status)}>
                      {playbook.status}
                    </Badge>
                  </div>
                  {playbook.description && (
                    <CardDescription className="line-clamp-2">
                      {playbook.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-4">
                  <div
                    className={`p-2 rounded-md border text-xs flex items-center gap-2 ${
                      playbook.workflow_id
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {playbook.workflow_id ? (
                      <>
                        <GitBranch className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          Workflow: <span className="font-medium">{linkedWf?.name ?? playbook.workflow_id}</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>Link a workflow to enable execution</span>
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      <span className="capitalize">{playbook.trigger_type}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Play className="h-3.5 w-3.5" />
                      {playbook.step_count} steps
                    </div>
                    <div className="col-span-2 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Last run:{' '}
                      {playbook.last_run_at
                        ? formatIncidentDate(playbook.last_run_at)
                        : 'Never'}
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t pt-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={isActive}
                        disabled={togglingId === playbook.id}
                        onCheckedChange={(checked) => handleToggle(playbook, checked)}
                      />
                      <span className="text-xs text-muted-foreground">Active</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-auto">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={!playbook.workflow_id || runningId === playbook.id}
                      onClick={() => handleRun(playbook)}
                    >
                      {runningId === playbook.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5 mr-1" />
                          Run
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setLinkingPlaybookId(playbook.id)}
                    >
                      <Link2 className="h-3.5 w-3.5 mr-1" />
                      Link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onNavigate
                          ? onNavigate({ page: 'playbook-runs', playbookId: playbook.id })
                          : router.push(`/playbook-runs?playbook_id=${playbook.id}`)
                      }
                    >
                      <History className="h-3.5 w-3.5 mr-1" />
                      View Runs
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(playbook.id)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deletingId === playbook.id}
                        >
                          {deletingId === playbook.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete playbook?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete &quot;{playbook.name}&quot;. This action
                            cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground"
                            onClick={() => handleDelete(playbook.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <PlaybookFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        playbookId={editingId}
        workflows={workflows}
        onSuccess={handleFormSuccess}
      />

      <LinkWorkflowDialog
        playbookId={linkingPlaybookId}
        workflows={workflows}
        currentWorkflowId={
          linkingPlaybookId
            ? playbooks.find((p) => p.id === linkingPlaybookId)?.workflow_id ?? null
            : null
        }
        onClose={() => setLinkingPlaybookId(null)}
        onLink={async (workflowId) => {
          if (linkingPlaybookId) {
            await handleLinkWorkflow(linkingPlaybookId, workflowId);
          }
          setLinkingPlaybookId(null);
        }}
      />
    </div>
  );
}
