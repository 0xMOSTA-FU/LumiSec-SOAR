'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Sun, Moon, Wrench, Zap, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import type { DashboardMetrics } from '@/app/soar/types';
import { soarFetch } from '@/lib/soar/fetch-json';
import {
  runPlatformQuickFix,
  type QuickFixAction,
} from '@/lib/lumisec-api/browser/platformQuickFix';

interface SystemServiceStatus {
  ok: boolean;
  configured: boolean;
  latencyMs?: number;
  detail?: unknown;
}
interface SystemStatus {
  ok: boolean;
  uptime_sec: number;
  services: Record<string, SystemServiceStatus>;
  latency_ms?: number;
}

export function SettingsView({ darkMode, setDarkMode, metrics }: {
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
  metrics: DashboardMetrics | null;
}) {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [quickFixAction, setQuickFixAction] = useState<QuickFixAction | null>(null);

  // Fetch on mount. The async call writes state through setters inside a microtask
  // (after the first await), so React 19's set-state-in-effect rule is satisfied:
  // the synchronous body of the effect does NOT call setState.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setChecking(true);
      try {
        const res = await soarFetch<SystemStatus>('/api/system/status');
        if (cancelled) return;
        if (res.ok && res.data) setSystemStatus(res.data);
      } catch (e) { console.error('System status fetch error', e); }
      if (!cancelled) setChecking(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Expose an imperative refetch for the Refresh button. Re-implements the same
  // logic so the button works without re-running the mount effect.
  const refreshStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await soarFetch<SystemStatus>('/api/system/status');
      if (res.ok && res.data) setSystemStatus(res.data);
    } catch (e) { console.error('System status fetch error', e); }
    setChecking(false);
  }, []);

  const handleQuickFix = useCallback(async (action: QuickFixAction) => {
    setQuickFixAction(action);
    try {
      const result = await runPlatformQuickFix(action);
      await refreshStatus();
      const description = result.steps.map(s => s.message).join(' · ');
      toast({
        variant: result.ok ? 'default' : 'destructive',
        title: result.ok ? 'Done' : 'Completed with issues',
        description,
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Quick fix failed',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setQuickFixAction(null);
    }
  }, [refreshStatus]);

  const serviceLabel = (key: string) => {
    const map: Record<string, string> = {
      database: 'Prisma Database',
      mongodb: 'MongoDB',
      external_backend: 'External Backend',
    };
    return map[key] || key;
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h3 className="text-lg font-semibold">Settings</h3>
        <p className="text-sm text-muted-foreground">Configure your SOAR platform and monitor connected services</p>
      </div>


      {/* Service Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-sm">Service Status</CardTitle>
            <CardDescription className="text-xs">Real-time connectivity to backing services</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refreshStatus} disabled={checking}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${checking ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!systemStatus ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <>
              {Object.entries(systemStatus.services).map(([key, svc]) => (
                <div key={key} className="flex items-center justify-between p-3 rounded-md border bg-card">
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${svc.ok ? 'bg-green-500 pulse-dot' : svc.configured ? 'bg-red-500' : 'bg-muted-foreground/40'}`} />
                    <div>
                      <p className="text-sm font-medium">{serviceLabel(key)}</p>
                      <p className="text-xs text-muted-foreground">
                        {svc.ok ? `Connected${svc.latencyMs ? ` · ${svc.latencyMs}ms` : ''}` :
                         svc.configured ? 'Configured but not reachable' :
                         'Not configured (optional)'}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className={
                    svc.ok ? 'bg-green-500/10 text-green-600 border-green-500/20' :
                    svc.configured ? 'bg-red-500/10 text-red-600 border-red-500/20' :
                    'bg-muted text-muted-foreground'
                  }>
                    {svc.ok ? 'OK' : svc.configured ? 'DOWN' : 'OFF'}
                  </Badge>
                </div>
              ))}
              <div className="text-xs text-muted-foreground pt-1 border-t">
                Platform uptime: {Math.floor(systemStatus.uptime_sec / 60)}m {systemStatus.uptime_sec % 60}s ·
                Check latency: {systemStatus.latency_ms}ms
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Quick Fix (MVP)</CardTitle>
          <CardDescription className="text-xs">
            One-click maintenance — test connectors, connect free APIs, sync artifacts
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={quickFixAction !== null}
            onClick={() => handleQuickFix('fix_all')}
          >
            {quickFixAction === 'fix_all' ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Wrench className="h-4 w-4 mr-1" />
            )}
            Fix Platform
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={quickFixAction !== null}
            onClick={() => handleQuickFix('test_all_connectors')}
          >
            {quickFixAction === 'test_all_connectors' ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-1" />
            )}
            Test Connectors
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={quickFixAction !== null}
            onClick={() => handleQuickFix('connect_free_tier')}
          >
            {quickFixAction === 'connect_free_tier' ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1" />
            )}
            Free APIs
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={quickFixAction !== null}
            onClick={() => handleQuickFix('sync_artifacts')}
          >
            {quickFixAction === 'sync_artifacts' ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Sync Artifacts
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Appearance</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Dark Mode</p>
              <p className="text-xs text-muted-foreground">Toggle between light and dark themes (persisted)</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setDarkMode(!darkMode)}>
              {darkMode ? <Sun className="h-4 w-4 mr-1" /> : <Moon className="h-4 w-4 mr-1" />}
              {darkMode ? 'Light' : 'Dark'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Platform Info</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Version</span><span>1.0.0</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Workflows</span><span>{metrics?.totalWorkflows || 0}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Cases</span><span>{metrics?.totalCases || 0}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Alerts</span><span>{metrics?.totalAlerts || 0}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Integrations</span><span>{metrics?.connectedIntegrations || 0} connected</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Playbooks</span><span>{metrics?.totalPlaybooks || 0}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Primary DB</span><span>SQLite (Prisma)</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Secondary DB</span><span>MongoDB (optional)</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">External Backend</span><span>Node.js + Express (optional)</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Architecture</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p><span className="font-medium text-foreground">Next.js (this app)</span> — primary web UI + API + workflow engine. Prisma/SQLite holds authoritative relational state (workflows, cases, integrations, alerts, audit).</p>
          <p><span className="font-medium text-foreground">MongoDB</span> — optional high-volume document store. Used for execution traces, raw alert payloads, connector call samples, and external sync mirror. Enabled when MONGODB_URI is set.</p>
          <p><span className="font-medium text-foreground">External Backend</span> — separate Node.js + Express service (mini-services/soar-backend) that exposes incidents / assets / threat intel / SOAR event ingestion APIs. Enabled when NEXT_PUBLIC_EXTERNAL_API_URL is set. Calls are best-effort and never block the main app.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Data Management</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Data comes from live ingest (webhooks, SIEM, manual incidents, and configured connectors). Demo seeding is disabled.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}