'use client';

import React from 'react';
import { Globe, MapPin, Shield, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { EnrichmentSnapshot } from '@/lib/platform/enrichment-parse';

interface EnrichmentResultsCardsProps {
  ip: string;
  enrichment: EnrichmentSnapshot;
  durationMs?: number;
  executionId?: string;
}

export function EnrichmentResultsCards({
  ip,
  enrichment,
  durationMs,
  executionId,
}: EnrichmentResultsCardsProps) {
  const vt = enrichment.virustotal;
  const ipinfo = enrichment.ipinfo;
  const abuse = enrichment.abuseipdb;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="outline" className="font-mono">{ip}</Badge>
        {durationMs != null && <span>· {durationMs}ms total</span>}
        {executionId && (
          <span className="text-xs font-mono truncate max-w-[200px]" title={executionId}>
            · exec {executionId.slice(0, 8)}…
          </span>
        )}
        <Badge variant="secondary" className="text-[10px]">LIVE API</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className={vt?.ok ? 'border-emerald-500/30' : 'border-red-500/30'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-red-500" />
              VirusTotal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {vt?.ok ? (
              <>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-3xl font-bold tabular-nums">
                      {vt.malicious}
                      <span className="text-lg text-muted-foreground font-normal">/{vt.total}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">engines flagged malicious</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      vt.is_malicious
                        ? 'bg-red-500/10 text-red-600 border-red-500/30'
                        : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                    }
                  >
                    {vt.is_malicious ? 'Suspicious' : 'Clean'}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>Detection score</span>
                    <span className="font-medium">{vt.score}%</span>
                  </div>
                  <Progress value={Math.min(100, vt.score)} className="h-2" />
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                  <span>Harmless: {vt.harmless}</span>
                  <span>Undetected: {vt.undetected}</span>
                  {vt.reputation != null && <span>Rep: {vt.reputation}</span>}
                  {vt.as_owner && <span className="col-span-2 truncate" title={vt.as_owner}>AS: {vt.as_owner}</span>}
                </div>
              </>
            ) : (
              <p className="text-sm text-destructive">{vt?.error || 'No VirusTotal data — configure API key'}</p>
            )}
          </CardContent>
        </Card>

        <Card className={ipinfo?.ok ? 'border-blue-500/30' : 'border-red-500/30'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-500" />
              IPInfo Geolocation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ipinfo?.ok ? (
              <>
                <p className="text-2xl font-bold">{ipinfo.country || '—'}</p>
                <p className="text-sm text-muted-foreground">
                  {[ipinfo.city, ipinfo.region].filter(Boolean).join(', ') || '—'}
                </p>
                <p className="text-xs break-words">{ipinfo.org || ipinfo.asn || '—'}</p>
                {ipinfo.timezone && (
                  <p className="text-xs text-muted-foreground">TZ: {ipinfo.timezone}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-destructive">{ipinfo?.error || 'IPInfo lookup failed'}</p>
            )}
          </CardContent>
        </Card>

        <Card className={abuse?.ok ? 'border-amber-500/30' : 'border-muted'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              AbuseIPDB
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {abuse?.ok ? (
              <>
                <p className="text-3xl font-bold tabular-nums">{abuse.abuse_score ?? 0}%</p>
                <p className="text-xs text-muted-foreground">abuse confidence score</p>
                <p className="text-xs">Reports: {abuse.total_reports ?? 0}</p>
                {abuse.isp && <p className="text-xs truncate" title={abuse.isp}>{abuse.isp}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {abuse?.error || 'Optional — add AbuseIPDB API key in Integrations'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Globe className="h-3 w-3" />
        Results fetched live from external threat-intel APIs and stored in workflow execution logs.
      </p>
    </div>
  );
}
