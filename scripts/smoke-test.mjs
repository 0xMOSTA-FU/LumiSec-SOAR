#!/usr/bin/env node
/**
 * Deployment smoke test — run after `npm run dev`.
 * Usage: node scripts/smoke-test.mjs [--base http://localhost:3000]
 */
const base = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:3000';

const backendBase = process.env.SOAR_BACKEND_URL || 'http://localhost:4000';
const apiKey = process.env.SOAR_INTERNAL_API_KEY || 'dev-soar-key';

const soarPaths = [
  'system/status',
  'incidents?limit=5',
  'alerts?limit=5',
  'connectors?limit=5',
  'vault?limit=5',
  'artifacts?limit=5',
  'playbooks',
  'playbook-runs?limit=5',
  'dashboard/overview',
  'dashboard/incidents?limit=5',
  'notifications/unread-count',
  'webhook-sources',
  'analytics/kpis',
  'platform/status',
];

const legacyPaths = ['/api/health', '/api/dashboard', '/api/workflows'];

let failed = 0;
let passed = 0;

async function check(label, url, opts = {}) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
    const ok = res.ok;
    if (ok) {
      passed++;
      console.log(`✓ ${label} (${res.status})`);
    } else {
      failed++;
      const text = await res.text();
      console.log(`✗ ${label} (${res.status}) ${text.slice(0, 120)}`);
    }
  } catch (err) {
    failed++;
    console.log(`✗ ${label} — ${err.message}`);
  }
}

console.log(`\n=== LumiSec SOAR Smoke Test ===`);
console.log(`Web: ${base}\n`);

console.log('— Legacy / BFF —');
for (const p of legacyPaths) {
  await check(p, `${base}${p}`);
}

console.log('\n— SOAR API (Next BFF) —');
for (const p of soarPaths) {
  await check(`/api/soar/${p}`, `${base}/api/soar/${p}`);
}

console.log('\n— Node backend (direct) —');
const healthRes = await fetch(`${backendBase}/api/health`, {
  headers: { 'X-API-Key': apiKey },
  signal: AbortSignal.timeout(10000),
}).catch(() => null);
const mongoOk = healthRes?.ok && (await healthRes.json().catch(() => ({})))?.checks?.database?.status === 'connected';

for (const p of ['health', ...soarPaths.slice(0, 4)]) {
  const path = p === 'health' ? '/api/health' : `/api/soar/${p}`;
  if (!mongoOk && p !== 'health') {
    console.log(`⊘ backend ${path} (skipped — MongoDB not connected)`);
    continue;
  }
  await check(`backend ${path}`, `${backendBase}${path}`, {
    headers: { 'X-API-Key': apiKey },
  });
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
