import { db } from '@/lib/db';
import { alertToSoar, caseToIncident } from '@/lib/soar-api/mappers';
import { decryptIntegrationConfig, maskIntegrationConfig } from '@/lib/integrations/config-secrets';
import { integrationToConnector } from '@/lib/soar-api/mappers';

const DEFAULT_LIMIT = 20;

export async function globalSearch(
  tenantWhere: Record<string, unknown>,
  query: string,
  limit = DEFAULT_LIMIT,
) {
  const q = query.trim();
  if (!q || q.length < 2) {
    return {
      query: q,
      incidents: [],
      alerts: [],
      artifacts: [],
      connectors: [],
    };
  }

  const contains = { contains: q };

  const [incidents, alerts, artifacts, connectors] = await Promise.all([
    db.case.findMany({
      where: {
        ...tenantWhere,
        OR: [
          { title: contains },
          { description: contains },
          { tags: contains },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { assignee: { select: { email: true } } },
    }),
    db.alert.findMany({
      where: {
        ...tenantWhere,
        OR: [
          { title: contains },
          { description: contains },
          { source: contains },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    db.soarArtifact.findMany({
      where: {
        ...tenantWhere,
        OR: [
          { value: contains },
          { type: contains },
          { description: contains },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    db.integration.findMany({
      where: {
        ...tenantWhere,
        OR: [
          { name: contains },
          { type: contains },
          { description: contains },
        ],
      },
      orderBy: { name: 'asc' },
      take: limit,
    }),
  ]);

  return {
    query: q,
    incidents: incidents.map(caseToIncident),
    alerts: alerts.map((a) => alertToSoar(a)),
    artifacts: artifacts.map((a) => ({
      id: a.id,
      type: a.type,
      value: a.value,
      description: a.description,
      incident_id: a.incidentId,
      created_at: a.createdAt.toISOString(),
    })),
    connectors: connectors.map((i) => ({
      ...integrationToConnector(i),
      config: maskIntegrationConfig(decryptIntegrationConfig(i.config)),
    })),
  };
}
