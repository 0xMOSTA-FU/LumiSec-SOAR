/**
 * /api/metrics — Prometheus exposition endpoint
 * ---------------------------------------------------------------------------
 * Scraped by Prometheus / VictoriaMetrics / Grafana Agent. No auth (the
 * endpoint is intended to be exposed on an internal scrape port; in
 * production, restrict via k8s NetworkPolicy).
 *
 * Compliance: SOC2 CC7.1 (system monitoring)
 */
import { NextResponse } from 'next/server';
import { metrics } from '@/lib/soar/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const body = metrics.render();
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
