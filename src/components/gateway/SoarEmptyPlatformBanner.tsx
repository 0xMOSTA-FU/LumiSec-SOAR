'use client';

import { Plug, Webhook, Bell } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Shown when SOAR has no live ingest yet — explains that lists stay empty until real sources connect.
 */
export function SoarEmptyPlatformBanner() {
  return (
    <Alert className="border-primary/30 bg-primary/5">
      <Bell className="h-4 w-4" />
      <AlertTitle>No live security data yet</AlertTitle>
      <AlertDescription className="space-y-2 text-sm">
        <p>
          Alerts, incidents, artifacts, and vault entries appear only after real ingest — not from demo or seed data.
        </p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>
            <strong>Elasticsearch</strong> — primary SIEM; poll security alerts into SOAR
          </li>
          <li>
            <span className="inline-flex items-center gap-1">
              <Plug className="h-3.5 w-3.5" /> Firewall
            </span>
            {' — FortiGate / OPNsense / pfSense for block & contain'}
          </li>
          <li>
            <strong>VirusTotal</strong> — hash & IP enrichment on incidents
          </li>
          <li>
            <strong>Email (SMTP)</strong> — notify analysts by email
          </li>
          <li>
            <strong>Telegram</strong> — bot alerts to phones via chat_id map
          </li>
        </ul>
        <p className="text-muted-foreground">
          Build workflows and playbooks first; they run against real connector APIs when triggered.
        </p>
      </AlertDescription>
    </Alert>
  );
}
