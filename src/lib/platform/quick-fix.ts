/**
 * MVP platform quick-fix actions — test connectors, sync artifacts, health probe.
 */
import { db } from '@/lib/db';
import { decryptIntegrationConfig } from '@/lib/integrations/config-secrets';
import {
  resolveExecutorType,
  NO_KEY_CONNECTOR_TYPES,
  integrationHasSecrets,
} from '@/lib/integrations/catalog';
import { testIntegrationConnectivity } from '@/lib/integrations/test-connectivity';
import { syncAllCaseArtifacts } from '@/lib/incidents/sync-artifacts';
import { checkMongoHealth, isMongoEnabled } from '@/lib/mongo';
import { pingExternalBackend, isExternalBackendEnabled } from '@/lib/external-api';

export interface ConnectorTestSummary {
  id: string;
  name: string;
  type: string;
  ok: boolean;
  message: string;
  skipped?: boolean;
  durationMs?: number;
}

export interface QuickFixResult {
  action: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export async function runHealthCheck(tenantId?: string | null): Promise<QuickFixResult> {
  const checks: Record<string, { ok: boolean; detail?: string; latencyMs?: number }> = {};

  const dbStart = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (e) {
    checks.database = {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  if (isMongoEnabled()) {
    const mongo = await checkMongoHealth();
    checks.mongodb = {
      ok: mongo.connected,
      latencyMs: mongo.latencyMs,
      detail: mongo.connected ? undefined : mongo.lastError,
    };
  } else {
    checks.mongodb = { ok: false, detail: 'not configured' };
  }

  if (isExternalBackendEnabled()) {
    const ping = await pingExternalBackend();
    checks.external_backend = {
      ok: ping.ok,
      latencyMs: ping.latencyMs,
      detail: ping.error,
    };
  } else {
    checks.external_backend = { ok: false, detail: 'not configured' };
  }

  const integrationCounts = await db.integration.groupBy({
    by: ['status'],
    where: tenantId ? { tenantId } : {},
    _count: true,
  });

  const connected = integrationCounts.find(g => g.status === 'connected')?._count ?? 0;
  const total = integrationCounts.reduce((n, g) => n + g._count, 0);

  const coreOk = checks.database.ok;
  return {
    action: 'health_check',
    ok: coreOk,
    message: coreOk
      ? `Database OK · ${connected}/${total} connectors connected`
      : 'Database unreachable — check DATABASE_URL',
    details: { checks, connectors: { connected, total } },
  };
}

export async function testAllConnectors(
  tenantId?: string | null,
  opts: { onlyConfigured?: boolean; includeNoKey?: boolean } = {},
): Promise<QuickFixResult> {
  const { onlyConfigured = true, includeNoKey = true } = opts;
  const rows = await db.integration.findMany({
    where: tenantId ? { tenantId } : {},
    orderBy: { name: 'asc' },
  });

  const results: ConnectorTestSummary[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const hasSecrets = integrationHasSecrets(row.config);
    const isNoKey = NO_KEY_CONNECTOR_TYPES.has(row.type);

    if (onlyConfigured && !hasSecrets && !(includeNoKey && isNoKey)) {
      skipped += 1;
      results.push({
        id: row.id,
        name: row.name,
        type: row.type,
        ok: false,
        skipped: true,
        message: 'No credentials configured — add API key then Test',
      });
      continue;
    }

    const config = decryptIntegrationConfig(row.config);
    const testType = resolveExecutorType(row.type, row.name);
    const t0 = Date.now();
    const result = await testIntegrationConnectivity(testType, config, row.name);
    const durationMs = result.durationMs ?? Date.now() - t0;

    await db.integration.update({
      where: { id: row.id },
      data: {
        status: result.ok ? 'connected' : 'error',
        lastTestedAt: new Date(),
        lastTestResult: {
          ok: result.ok,
          message: result.message,
          durationMs,
        },
      },
    }).catch(() => {});

    if (result.ok) passed += 1;
    else failed += 1;

    results.push({
      id: row.id,
      name: row.name,
      type: row.type,
      ok: result.ok,
      message: result.message,
      durationMs,
    });
  }

  return {
    action: 'test_all_connectors',
    ok: failed === 0 && passed > 0,
    message: `Tested ${passed + failed} connector(s): ${passed} passed, ${failed} failed, ${skipped} skipped`,
    details: { passed, failed, skipped, results },
  };
}

export async function connectFreeTierConnectors(
  tenantId?: string | null,
): Promise<QuickFixResult> {
  const rows = await db.integration.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      type: { in: Array.from(NO_KEY_CONNECTOR_TYPES) },
    },
  });

  const results: ConnectorTestSummary[] = [];
  let passed = 0;

  for (const row of rows) {
    const config = decryptIntegrationConfig(row.config);
    const result = await testIntegrationConnectivity(
      resolveExecutorType(row.type, row.name),
      config,
      row.name,
    );

    if (result.ok) {
      await db.integration.update({
        where: { id: row.id },
        data: {
          status: 'connected',
          lastTestedAt: new Date(),
          lastTestResult: { ok: true, message: result.message, durationMs: result.durationMs },
        },
      }).catch(() => {});
      passed += 1;
    }

    results.push({
      id: row.id,
      name: row.name,
      type: row.type,
      ok: result.ok,
      message: result.message,
      durationMs: result.durationMs,
    });
  }

  return {
    action: 'connect_free_tier',
    ok: passed > 0,
    message: passed > 0
      ? `Connected ${passed} free-tier connector(s) (e.g. IPInfo)`
      : 'No free-tier connectors available or connection failed',
    details: { passed, results },
  };
}

export async function syncPlatformArtifacts(
  tenantId?: string | null,
): Promise<QuickFixResult> {
  const tenantWhere = tenantId ? { tenantId } : {};
  const sync = await syncAllCaseArtifacts(tenantWhere);

  return {
    action: 'sync_artifacts',
    ok: true,
    message: `Artifacts synced: ${sync.created} created across ${sync.synced} case(s)`,
    details: sync as unknown as Record<string, unknown>,
  };
}

export type QuickFixAction =
  | 'health_check'
  | 'test_all_connectors'
  | 'connect_free_tier'
  | 'sync_artifacts'
  | 'fix_all';

export async function runQuickFix(
  action: QuickFixAction,
  tenantId?: string | null,
): Promise<{ ok: boolean; steps: QuickFixResult[] }> {
  if (action === 'fix_all') {
    const steps: QuickFixResult[] = [];
    steps.push(await runHealthCheck(tenantId));
    steps.push(await connectFreeTierConnectors(tenantId));
    steps.push(await testAllConnectors(tenantId, { onlyConfigured: true, includeNoKey: true }));
    steps.push(await syncPlatformArtifacts(tenantId));
    const healthOk = steps.find(s => s.action === 'health_check')?.ok ?? false;
    return { ok: healthOk, steps };
  }

  const runners: Record<Exclude<QuickFixAction, 'fix_all'>, () => Promise<QuickFixResult>> = {
    health_check: () => runHealthCheck(tenantId),
    test_all_connectors: () => testAllConnectors(tenantId),
    connect_free_tier: () => connectFreeTierConnectors(tenantId),
    sync_artifacts: () => syncPlatformArtifacts(tenantId),
  };

  const step = await runners[action]();
  return { ok: step.ok, steps: [step] };
}
