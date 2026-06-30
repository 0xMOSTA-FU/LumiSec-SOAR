'use client';

import React, { useCallback, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import { globalSearch, type SearchResults } from '@/lib/lumisec-api/browser/soarSearch';
import type { SoarNavigate } from '@/lib/soar/mode';
import { severityBadgeClass } from '@/lib/lumisec-api/browser/incidentUi';

export function GlobalSearchPage({ onNavigate }: { onNavigate?: SoarNavigate }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) {
      toast({ title: 'Enter at least 2 characters', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      setResults(await globalSearch(q));
    } catch (e) {
      toast({ title: 'Search failed', description: getApiErrorMessage(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Search className="h-7 w-7" />
          Global Search
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search incidents, alerts, artifacts, and connectors across the platform.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="IP, hash, title, connector name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <Button onClick={runSearch} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      {results && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Results for &quot;{results.query}&quot;
          </p>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Incidents ({results.incidents.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {results.incidents.length === 0 ? (
                <p className="text-xs text-muted-foreground">None</p>
              ) : (
                results.incidents.map((inc) => (
                  <button
                    key={inc.id}
                    type="button"
                    className="w-full text-left rounded-md border p-2 hover:bg-muted/50"
                    onClick={() => onNavigate?.({ page: 'gateway-incident-detail', incidentId: inc.id })}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={severityBadgeClass(inc.severity)}>
                        {inc.severity}
                      </Badge>
                      <span className="font-medium text-sm">{inc.title}</span>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Alerts ({results.alerts.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {results.alerts.length === 0 ? (
                <p className="text-xs text-muted-foreground">None</p>
              ) : (
                results.alerts.map((alert) => (
                  <button
                    key={alert.id}
                    type="button"
                    className="w-full text-left rounded-md border p-2 hover:bg-muted/50"
                    onClick={() => onNavigate?.({ page: 'alerts', alertId: alert.id })}
                  >
                    <span className="text-sm font-medium">{alert.title}</span>
                    <span className="text-xs text-muted-foreground ml-2">{alert.source}</span>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Artifacts ({results.artifacts.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 font-mono text-xs">
              {results.artifacts.map((a) => (
                <div key={a.id} className="border-b py-1">
                  {a.type}: {a.value}
                </div>
              ))}
              {results.artifacts.length === 0 && (
                <p className="text-xs text-muted-foreground font-sans">None</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Connectors ({results.connectors.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {results.connectors.map((c) => (
                <div key={c.id}>
                  {c.name} <span className="text-muted-foreground">({c.type})</span>
                </div>
              ))}
              {results.connectors.length === 0 && (
                <p className="text-xs text-muted-foreground">None</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
