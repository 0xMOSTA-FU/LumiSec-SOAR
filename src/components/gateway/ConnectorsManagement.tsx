'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock,
  ListTree,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wrench,
  Zap,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import {
  CONNECTOR_TYPES,
  connectorConfigFields,
  connectorStatusBadgeClass,
  connectorStatusDotClass,
  connectorTypeLabel,
} from '@/lib/lumisec-api/browser/connectorUi';
import { pollElasticAlerts } from '@/lib/lumisec-api/browser/soarElastic';
import {
  PRIORITY_CONNECTOR_META,
  PRIORITY_CONNECTOR_TYPES,
} from '@/lib/integrations/catalog';
import { formatIncidentDate } from '@/lib/lumisec-api/browser/incidentUi';
import {
  createConnector,
  deleteConnector,
  fetchConnectorActions,
  fetchConnectorById,
  fetchConnectors,
  testConnector,
  updateConnector,
  type ConnectorAction,
  type SoarConnector,
} from '@/lib/lumisec-api/browser/soarConnectors';
import {
  runPlatformQuickFix,
  type QuickFixAction,
} from '@/lib/lumisec-api/browser/platformQuickFix';

function emptyConfig(type: string): Record<string, string> {
  return Object.fromEntries(
    connectorConfigFields(type).map((field) => [field.key, '']),
  );
}

function CardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/3 mt-2" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </Card>
  );
}

interface ConnectorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectorId?: string;
  initialType?: string;
  onSuccess: (connector: SoarConnector) => void;
}

function ConnectorFormDialog({
  open,
  onOpenChange,
  connectorId,
  initialType,
  onSuccess,
}: ConnectorFormDialogProps) {
  const isEdit = Boolean(connectorId);
  const [name, setName] = useState('');
  const [type, setType] = useState('siem');
  const [description, setDescription] = useState('');
  const [config, setConfig] = useState<Record<string, string>>(emptyConfig('siem'));
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configFields = useMemo(() => connectorConfigFields(type), [type]);

  const resetForm = useCallback((nextType = 'siem') => {
    setName('');
    setType(nextType);
    setDescription('');
    setConfig(emptyConfig(nextType));
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) return;

    if (!connectorId) {
      resetForm(initialType || 'elastic');
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    setError(null);

    fetchConnectorById(connectorId)
      .then((connector) => {
        if (cancelled) return;
        setName(connector.name);
        setType(connector.type || 'other');
        setDescription(connector.description ?? '');
        const rawCfg = connector.config ?? connector.raw?.config;
        if (rawCfg && typeof rawCfg === 'object' && !Array.isArray(rawCfg)) {
          const next = emptyConfig(connector.type || 'other');
          for (const [k, v] of Object.entries(rawCfg as Record<string, unknown>)) {
            if (v !== null && v !== undefined) next[k] = String(v);
          }
          setConfig(next);
        } else {
          setConfig(emptyConfig(connector.type || 'other'));
        }
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
  }, [open, connectorId, initialType, resetForm]);

  const handleTypeChange = (nextType: string) => {
    setType(nextType);
    setConfig(emptyConfig(nextType));
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);

    const configPayload = Object.fromEntries(
      Object.entries(config).filter(([, value]) => value.trim() !== ''),
    );

    try {
      const connector = isEdit && connectorId
        ? await updateConnector(connectorId, {
            name: name.trim(),
            type,
            description: description.trim() || undefined,
            config: Object.keys(configPayload).length > 0 ? configPayload : undefined,
          })
        : await createConnector({
            name: name.trim(),
            type,
            description: description.trim() || undefined,
            config: configPayload,
          });

      const hasConfig = Object.keys(configPayload).length > 0;
      toast({
        title:
          hasConfig && connector.status === 'active'
            ? isEdit
              ? 'Connector updated & connected'
              : 'Connector created & connected'
            : isEdit
              ? 'Connector updated'
              : 'Connector created',
        description:
          hasConfig && connector.status === 'error'
            ? connector.last_error || 'Check credentials before running workflows.'
            : hasConfig && connector.status === 'active'
              ? `${connector.name} is ready for workflows.`
              : undefined,
        variant: hasConfig && connector.status === 'error' ? 'destructive' : 'default',
      });

      setConfig(emptyConfig(type));
      onSuccess(connector);
      onOpenChange(false);
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
          <DialogTitle>{isEdit ? 'Edit Connector' : 'Create Connector'}</DialogTitle>
        </DialogHeader>

        {loadingDetail ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="connector-name">Name</Label>
              <Input
                id="connector-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="FortiGate Edge"
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTOR_TYPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="connector-description">Description</Label>
              <Textarea
                id="connector-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional description"
              />
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Configuration</p>
              {configFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`config-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`config-${field.key}`}
                    type={field.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={config[field.key] ?? ''}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    placeholder={
                      isEdit && field.secret
                        ? 'Leave blank to keep unchanged'
                        : field.placeholder
                    }
                  />
                </div>
              ))}
            </div>

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
          <Button onClick={handleSubmit} disabled={submitting || loadingDetail || !name.trim()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ActionsPanelProps {
  connector: SoarConnector | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ActionsPanel({ connector, open, onOpenChange }: ActionsPanelProps) {
  const [actions, setActions] = useState<ConnectorAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !connector) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setActions([]);

    fetchConnectorActions(connector.id)
      .then((data) => {
        if (cancelled) return;
        setActions(data);
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
  }, [open, connector]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ListTree className="h-5 w-5" />
            Available Actions
          </SheetTitle>
          {connector && (
            <p className="text-sm text-muted-foreground">{connector.name}</p>
          )}
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && actions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No actions available for this connector
            </p>
          )}

          {!loading &&
            actions.map((action) => (
              <div key={action.id} className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{action.name}</p>
                  {action.type && (
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {action.type}
                    </Badge>
                  )}
                </div>
                {action.description && (
                  <p className="text-xs text-muted-foreground">{action.description}</p>
                )}
              </div>
            ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ConnectorsManagement() {
  const [connectors, setConnectors] = useState<SoarConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<SoarConnector | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionsConnector, setActionsConnector] = useState<SoarConnector | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [quickFixAction, setQuickFixAction] = useState<QuickFixAction | null>(null);
  const [pollingElastic, setPollingElastic] = useState(false);
  const [createTypePreset, setCreateTypePreset] = useState<string | undefined>(undefined);

  const elasticConnected = useMemo(
    () => connectors.some((c) => ['elastic', 'elasticsearch', 'es'].includes(c.type.toLowerCase()) && ['connected', 'active'].includes(c.status.toLowerCase())),
    [connectors],
  );

  const runQuickFix = async (action: QuickFixAction) => {
    setQuickFixAction(action);
    try {
      const result = await runPlatformQuickFix(action);
      await loadConnectors();

      const summary = result.steps.map(s => s.message).join('\n');
      if (result.ok) {
        toast({ title: 'Platform fix completed', description: summary });
      } else {
        toast({
          variant: 'destructive',
          title: 'Completed with issues',
          description: summary,
        });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Quick fix failed',
        description: getApiErrorMessage(err),
      });
    } finally {
      setQuickFixAction(null);
    }
  };

  const isQuickFixRunning = quickFixAction !== null;

  const loadConnectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchConnectors(1, 100);
      setConnectors(result.items);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setConnectors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnectors();
  }, [loadConnectors]);

  const handleTest = async (connector: SoarConnector) => {
    setTestingId(connector.id);
    try {
      const result = await testConnector(connector.id);
      setConnectors((prev) =>
        prev.map((item) =>
          item.id === connector.id
            ? {
                ...item,
                status: result.status,
                last_tested_at: result.last_tested_at,
                last_error: result.success ? null : result.message,
              }
            : item,
        ),
      );

      if (result.success) {
        toast({ title: 'Connection test passed', description: connector.name });
      } else {
        toast({
          variant: 'destructive',
          title: 'Connection test failed',
          description: result.message ?? 'Unable to connect',
        });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Test failed',
        description: getApiErrorMessage(err),
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteConnector(deleteTarget.id);
      setConnectors((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      toast({ title: 'Connector deleted' });
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

  const handleFormSuccess = (connector: SoarConnector) => {
    setConnectors((prev) => {
      const exists = prev.some((item) => item.id === connector.id);
      if (exists) {
        return prev.map((item) => (item.id === connector.id ? { ...item, ...connector } : item));
      }
      return [connector, ...prev];
    });
    setEditId(undefined);
  };

  const openCreate = (type?: string) => {
    setEditId(undefined);
    setCreateTypePreset(type);
    setFormOpen(true);
  };

  const handlePollElastic = async () => {
    setPollingElastic(true);
    try {
      const result = await pollElasticAlerts({ minutes: 60, limit: 100 });
      await loadConnectors();
      toast({
        title: 'Elastic poll complete',
        description: `${result.ingested} new alert(s), ${result.deduplicated} deduplicated`,
      });
      if (result.errors?.length) {
        toast({ variant: 'destructive', title: 'Elastic poll warnings', description: result.errors.join('; ') });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Elastic poll failed', description: getApiErrorMessage(err) });
    } finally {
      setPollingElastic(false);
    }
  };

  const openEdit = (connector: SoarConnector) => {
    setEditId(connector.id);
    setFormOpen(true);
  };

  const openActions = (connector: SoarConnector) => {
    setActionsConnector(connector);
    setActionsOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Plug className="h-5 w-5" />
            Connectors
          </h3>
          <p className="text-sm text-muted-foreground">
            Inbound sources — SIEM, EDR, and webhook ingest (credentials stored in Vault)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={loading || isQuickFixRunning}
            onClick={() => runQuickFix('fix_all')}
          >
            {quickFixAction === 'fix_all' ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Wrench className="h-4 w-4 mr-1.5" />
            )}
            Fix Platform
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || isQuickFixRunning}
            onClick={() => runQuickFix('test_all_connectors')}
          >
            {quickFixAction === 'test_all_connectors' ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-1.5" />
            )}
            Test All Configured
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || isQuickFixRunning}
            onClick={() => runQuickFix('connect_free_tier')}
          >
            {quickFixAction === 'connect_free_tier' ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1.5" />
            )}
            Connect Free APIs
          </Button>
          <Button size="sm" variant="outline" onClick={loadConnectors} disabled={loading || isQuickFixRunning}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => openCreate()} disabled={isQuickFixRunning}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create Connector
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">SOC priority stack</CardTitle>
          <CardDescription>
            Configure in order: Elasticsearch (SIEM) → Firewall → VirusTotal → Email → Telegram
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {PRIORITY_CONNECTOR_TYPES.map((type) => {
            const meta = PRIORITY_CONNECTOR_META[type];
            const configured = connectors.some(
              (c) => c.type === type || c.type.toLowerCase() === type,
            );
            return (
              <Button
                key={type}
                size="sm"
                variant={configured ? 'secondary' : 'outline'}
                title={meta.hint}
                onClick={() => openCreate(type)}
                disabled={isQuickFixRunning}
              >
                {connectorTypeLabel(type)}
                {!configured && <Plus className="h-3 w-3 ml-1" />}
              </Button>
            );
          })}
          {elasticConnected && (
            <Button
              size="sm"
              variant="default"
              onClick={handlePollElastic}
              disabled={pollingElastic || isQuickFixRunning}
            >
              {pollingElastic ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1.5" />
              )}
              Poll Elastic alerts
            </Button>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      ) : connectors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No connectors configured yet
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {connectors.map((connector) => {
            const isTesting = testingId === connector.id;
            return (
              <Card key={connector.id} className={`min-w-0 overflow-hidden ${isTesting ? 'opacity-80' : ''}`}>
                <CardHeader className="pb-2 min-w-0">
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <CardTitle className="text-base flex items-center gap-2 min-w-0">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${connectorStatusDotClass(connector.status)}`}
                        />
                        <span className="truncate">{connector.name}</span>
                      </CardTitle>
                      <CardDescription className="mt-1 truncate">
                        {connectorTypeLabel(connector.type)}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className={`shrink-0 ${connectorStatusBadgeClass(connector.status)}`}>
                      {connector.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {connector.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 break-words">
                      {connector.description}
                    </p>
                  )}

                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>
                      Last tested:{' '}
                      {connector.last_tested_at
                        ? formatIncidentDate(connector.last_tested_at)
                        : 'Never'}
                    </span>
                  </div>

                  {connector.status === 'error' && connector.last_error && (
                    <Alert variant="destructive" className="py-2">
                      <AlertDescription className="text-xs break-words">{connector.last_error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isTesting}
                      onClick={() => handleTest(connector)}
                    >
                      {isTesting ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Zap className="h-3.5 w-3.5 mr-1" />
                      )}
                      Test
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openActions(connector)}>
                      <ListTree className="h-3.5 w-3.5 mr-1" />
                      Actions
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(connector)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(connector)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConnectorFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        connectorId={editId}
        initialType={createTypePreset}
        onSuccess={handleFormSuccess}
      />

      <ActionsPanel
        connector={actionsConnector}
        open={actionsOpen}
        onOpenChange={setActionsOpen}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete connector?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${deleteTarget.name}" will be permanently removed. This cannot be undone.`
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
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
