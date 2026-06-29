'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Plus, RefreshCw, Webhook } from 'lucide-react';
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
  createWebhookSource,
  fetchWebhookSources,
  type SoarWebhookSource,
} from '@/lib/lumisec-api/browser/soarWebhookSources';
import {
  INBOUND_WEBHOOK_ENDPOINTS,
  WEBHOOK_SOURCE_TYPES,
  inboundWebhookUrl,
  webhookSourceTypeLabel,
  webhookStatusBadgeClass,
} from '@/lib/lumisec-api/browser/webhookUi';

function TableSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

function CopyableUrlField({ url }: { url: string }) {
  const [copying, setCopying] = useState(false);

  const handleCopy = async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'URL copied' });
    } catch {
      toast({ variant: 'destructive', title: 'Failed to copy URL' });
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Input
        readOnly
        value={url}
        className="font-mono text-xs h-8"
        onFocus={(e) => e.target.select()}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0 h-8 px-2"
        disabled={copying}
        onClick={handleCopy}
      >
        {copying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

interface CreateWebhookSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (source: SoarWebhookSource) => void;
}

function CreateWebhookSourceDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateWebhookSourceDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('crowdstrike');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [createdSource, setCreatedSource] = useState<SoarWebhookSource | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setType('crowdstrike');
    setDescription('');
    setError(null);
    setCreatedUrl(null);
    setCreatedSource(null);
  }, [open]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await createWebhookSource({
        name: name.trim(),
        type,
        description: description.trim() || undefined,
      });
      setCreatedUrl(result.generatedUrl ?? result.source.webhook_url);
      setCreatedSource(result.source);
      onSuccess(result.source);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const showSuccess = Boolean(createdUrl && createdSource);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {showSuccess ? 'Webhook Source Created' : 'Create Webhook Source'}
          </DialogTitle>
        </DialogHeader>

        {showSuccess ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                Save this webhook URL now. It may not be shown again in full after you close this
                dialog.
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label>Generated Webhook URL</Label>
              <CopyableUrlField url={createdUrl!} />
            </div>
            <p className="text-sm text-muted-foreground">
              Source <span className="font-medium text-foreground">{createdSource!.name}</span>{' '}
              ({webhookSourceTypeLabel(createdSource!.type)}) is ready to receive events.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-name">Name</Label>
              <Input
                id="webhook-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production CrowdStrike"
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEBHOOK_SOURCE_TYPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook-description">Description</Label>
              <Textarea
                id="webhook-description"
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
        )}

        <DialogFooter>
          {showSuccess ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WebhookSourcesManagement() {
  const [sources, setSources] = useState<SoarWebhookSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchWebhookSources(1, 100);
      setSources(result.items);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const handleCreated = (source: SoarWebhookSource) => {
    setSources((prev) => {
      const exists = prev.some((item) => item.id === source.id);
      if (exists) {
        return prev.map((item) => (item.id === source.id ? source : item));
      }
      return [source, ...prev];
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Webhook Sources
          </h3>
          <p className="text-sm text-muted-foreground">
            Register and manage inbound webhook integrations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={loadSources} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create Webhook Source
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
                <TableHead>Webhook URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    No webhook sources configured yet
                  </TableCell>
                </TableRow>
              ) : (
                sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="font-medium text-sm">{source.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{webhookSourceTypeLabel(source.type)}</Badge>
                    </TableCell>
                    <TableCell className="min-w-[280px] max-w-[360px]">
                      <CopyableUrlField url={source.webhook_url} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={webhookStatusBadgeClass(source.status)}>
                        {source.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatIncidentDate(source.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inbound Webhook URLs</CardTitle>
          <CardDescription>
            Configure these POST endpoints in external security tools. Authentication uses Bearer JWT
            plus an optional webhook signature header.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {INBOUND_WEBHOOK_ENDPOINTS.map((endpoint) => (
            <div key={endpoint.slug} className="rounded-lg border p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{endpoint.label}</p>
                <Badge variant="outline" className="text-[10px] uppercase">
                  POST
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{endpoint.description}</p>
              {endpoint.externalNote && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{endpoint.externalNote}</p>
              )}
              <CopyableUrlField url={inboundWebhookUrl(endpoint.slug)} />
            </div>
          ))}
        </CardContent>
      </Card>

      <CreateWebhookSourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={handleCreated}
      />
    </div>
  );
}
