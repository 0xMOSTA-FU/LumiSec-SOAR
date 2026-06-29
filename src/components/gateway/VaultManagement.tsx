'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
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
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import { formatIncidentDate } from '@/lib/lumisec-api/browser/incidentUi';
import {
  createVaultEntry,
  deleteVaultEntry,
  fetchVaultEntries,
  fetchVaultEntryById,
  fetchVaultSecretForCopy,
  updateVaultEntry,
  type SoarVaultEntry,
} from '@/lib/lumisec-api/browser/soarVault';
import { MASKED_SECRET, VAULT_TYPES, vaultTypeLabel } from '@/lib/lumisec-api/browser/vaultUi';

function TableSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

interface AddSecretDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (entry: SoarVaultEntry) => void;
}

function AddSecretDialog({ open, onOpenChange, onSuccess }: AddSecretDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('api_key');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setType('api_key');
    setValue('');
    setDescription('');
    setError(null);
  }, [open]);

  const handleSubmit = async () => {
    if (!name.trim() || !value.trim()) return;
    setSubmitting(true);
    setError(null);

    const payload = {
      name: name.trim(),
      type,
      value: value.trim(),
      description: description.trim() || undefined,
    };

    try {
      const entry = await createVaultEntry(payload);
      setValue('');
      onSuccess(entry);
      onOpenChange(false);
      toast({ title: 'Secret stored securely' });
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Secret</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vault-name">Name</Label>
            <Input
              id="vault-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="FortiGate API Token"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VAULT_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vault-value">Value</Label>
            <Input
              id="vault-value"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter secret value"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vault-description">Description</Label>
            <Textarea
              id="vault-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional description"
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !value.trim()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Secret'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EditSecretDialogProps {
  entry: SoarVaultEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (entry: SoarVaultEntry) => void;
}

function EditSecretDialog({ entry, open, onOpenChange, onSuccess }: EditSecretDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('api_key');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateValue, setRotateValue] = useState('');
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    if (!open || !entry) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setRotateOpen(false);
    setRotateValue('');

    fetchVaultEntryById(entry.id)
      .then((detail) => {
        if (cancelled) return;
        setName(detail.name);
        setType(detail.type);
        setDescription(detail.description ?? '');
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
  }, [open, entry]);

  const handleSave = async () => {
    if (!entry || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateVaultEntry(entry.id, {
        name: name.trim(),
        type,
        description: description.trim(),
      });
      onSuccess(updated);
      onOpenChange(false);
      toast({ title: 'Secret updated' });
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRotate = async () => {
    if (!entry || !rotateValue.trim()) return;
    setRotating(true);
    setError(null);
    try {
      const updated = await updateVaultEntry(entry.id, { value: rotateValue.trim() });
      setRotateValue('');
      setRotateOpen(false);
      onSuccess(updated);
      toast({ title: 'Secret rotated' });
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setRotating(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Secret</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-vault-name">Name</Label>
                <Input
                  id="edit-vault-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAULT_TYPES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Stored Value</Label>
                <Input
                  type="password"
                  value={MASKED_SECRET}
                  readOnly
                  disabled
                  className="font-mono tracking-widest"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-vault-description">Description</Label>
                <Textarea
                  id="edit-vault-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setRotateValue('');
                  setRotateOpen(true);
                }}
              >
                <RotateCw className="h-3.5 w-3.5 mr-1.5" />
                Rotate Secret
              </Button>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={submitting || loading || !name.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rotate Secret</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rotate-value">New Value</Label>
            <Input
              id="rotate-value"
              type="password"
              value={rotateValue}
              onChange={(e) => setRotateValue(e.target.value)}
              placeholder="Enter new secret value"
              autoComplete="new-password"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateOpen(false)} disabled={rotating}>
              Cancel
            </Button>
            <Button onClick={handleRotate} disabled={rotating || !rotateValue.trim()}>
              {rotating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Rotate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VaultManagement() {
  const [entries, setEntries] = useState<SoarVaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<SoarVaultEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SoarVaultEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchVaultEntries(1, 100);
      setEntries(result.items);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleCopy = async (entry: SoarVaultEntry) => {
    setCopyingId(entry.id);
    try {
      const secret = await fetchVaultSecretForCopy(entry.id);
      if (!secret) {
        toast({
          variant: 'destructive',
          title: 'Copy unavailable',
          description: 'The API did not return a secret value for this entry.',
        });
        return;
      }
      await navigator.clipboard.writeText(secret);
      toast({ title: 'Copied to clipboard', description: entry.name });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: getApiErrorMessage(err),
      });
    } finally {
      setCopyingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteVaultEntry(deleteTarget.id);
      setEntries((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      toast({ title: 'Secret deleted' });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: getApiErrorMessage(err),
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleEntryUpdated = (updated: SoarVaultEntry) => {
    setEntries((prev) =>
      prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
    );
  };

  const handleEntryCreated = (created: SoarVaultEntry) => {
    setEntries((prev) => [created, ...prev]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Vault
          </h3>
          <p className="text-sm text-muted-foreground">
            Encrypted storage for credentials and secrets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={loadEntries} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Secret
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
          <TableSkeleton />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    No secrets stored yet
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium text-sm">{entry.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{vaultTypeLabel(entry.type)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[220px] truncate">
                      {entry.description ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatIncidentDate(entry.created_at)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {entry.last_used_at ? formatIncidentDate(entry.last_used_at) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2"
                          disabled={copyingId === entry.id}
                          onClick={() => handleCopy(entry)}
                          title="Copy secret to clipboard"
                        >
                          {copyingId === entry.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2"
                          onClick={() => setEditEntry(entry)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(entry)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <AddSecretDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={handleEntryCreated}
      />

      <EditSecretDialog
        entry={editEntry}
        open={Boolean(editEntry)}
        onOpenChange={(open) => !open && setEditEntry(null)}
        onSuccess={handleEntryUpdated}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete secret?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `You are about to delete "${deleteTarget.name}". This action cannot be undone and any connectors or playbooks referencing this secret may fail.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Secret'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
