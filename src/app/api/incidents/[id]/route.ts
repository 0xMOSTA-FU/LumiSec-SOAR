import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, internalErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/lib/auth';
import { loadFullIncidentContext } from '@/lib/incidents/load-context';
import { buildRecommendedActions, resolveConnectedIntegrations } from '@/lib/incidents/recommended-actions';
import type { ParsedArtifact } from '@/lib/incidents/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJson<T>(val: string | null | undefined, fallback: T): T {
  try {
    return JSON.parse(val || JSON.stringify(fallback)) as T;
  } catch {
    return fallback;
  }
}

function normalizeTimeline(
  entries: { time?: string; event?: string; actor?: string; message?: string; actorType?: string }[],
): { time: string; actor: string; actorType: string; message: string }[] {
  return entries.map(e => ({
    time: e.time || new Date().toISOString(),
    actor: e.actor || 'System',
    actorType: e.actorType || 'system',
    message: e.message || e.event || 'Event',
  }));
}

function toUiArtifacts(artifacts: ParsedArtifact[]) {
  return artifacts.map(a => ({
    type: (['ip', 'hash', 'domain', 'file'].includes(a.type) ? a.type : 'file') as 'ip' | 'hash' | 'domain' | 'file',
    value: a.value,
  }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authed = await requireAuth(req, PERMISSIONS.CASE_READ);
  if (authed instanceof NextResponse) return authed;
  const { tenantWhere } = authed;
  const { id } = await params;

  try {
    const integrations = await db.integration.findMany({
      where: tenantWhere,
      select: { type: true, status: true, name: true },
    });
    const connected = resolveConnectedIntegrations(integrations);

    const context = await loadFullIncidentContext(id, tenantWhere);
    if (!context) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    const row = context.kind === 'case'
      ? await db.case.findFirst({ where: { id, ...tenantWhere } })
      : await db.alert.findFirst({ where: { id, ...tenantWhere } });

    const linkedAlerts = context.kind === 'case'
      ? await db.alert.findMany({
        where: { caseId: id, ...tenantWhere },
        select: { id: true, title: true, source: true, severity: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
      : [];

    const timelineRaw = context.kind === 'case'
      ? parseJson(
        (row && 'timeline' in row ? row.timeline : null) as string | null | undefined,
        [],
      )
      : (context.caseId
        ? parseJson((await db.case.findUnique({ where: { id: context.caseId } }))?.timeline || '[]', [])
        : []);

    const related = context.kind === 'case'
      ? await db.case.findMany({
        where: { id: { not: id }, ...tenantWhere },
        select: { id: true, title: true, createdAt: true },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      })
      : [];

    const recommendations = buildRecommendedActions(context, connected);

    return NextResponse.json({
      incident: {
        id: context.id,
        kind: context.kind,
        title: context.title,
        description: context.description,
        severity: context.severity,
        status: context.status,
        source: context.source,
        tags: context.tags,
        createdAt: row?.createdAt,
        caseId: context.caseId,
      },
      artifacts: toUiArtifacts(context.artifacts),
      timeline: normalizeTimeline(timelineRaw),
      linkedAlerts: linkedAlerts.map(a => ({
        id: a.id,
        title: a.title,
        source: a.source,
        severity: a.severity,
        time: new Date(a.createdAt).toLocaleString(),
      })),
      relatedIncidents: related.map(r => ({
        id: r.id,
        title: r.title,
        date: new Date(r.createdAt).toLocaleDateString(),
      })),
      recommendations,
      connectedIntegrations: connected,
    });
  } catch (err) {
    return internalErrorResponse(err, 'Failed to load incident');
  }
}
