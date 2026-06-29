#!/usr/bin/env node
/**
 * Verify live SOAR stack — no mocks. Checks API, Mongo, platform URL, priority connectors.
 * Usage: npm run stack:verify
 */
import { PrismaClient } from '@prisma/client';

const base = process.env.SOAR_BASE_URL || 'http://localhost:3000';
const key = process.env.SOAR_INTERNAL_API_KEY || 'dev-soar-key';
let failed = 0;
let passed = 0;

function ok(label) {
  passed++;
  console.log(`✓ ${label}`);
}
function bad(label, detail = '') {
  failed++;
  console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`);
}
function warn(label) {
  console.log(`⚠ ${label}`);
}

async function get(path, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { ...headers, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { res, json };
}

console.log('\n=== LumiSec SOAR — Live Stack Verification ===\n');

// Env
if (process.env.LUMISEC_PLATFORM_URL) ok(`LUMISEC_PLATFORM_URL=${process.env.LUMISEC_PLATFORM_URL}`);
else warn('LUMISEC_PLATFORM_URL not set (Outbound Actions need monolith)');

if (process.env.MONGODB_URI) ok('MONGODB_URI configured');
else warn('MONGODB_URI not set (forensic audit disabled)');

// DB counts
try {
  const prisma = new PrismaClient();
  const [alerts, integrations, workflows] = await Promise.all([
    prisma.alert.count(),
    prisma.integration.count(),
    prisma.workflow.count(),
  ]);
  ok(`SQLite: ${alerts} alerts, ${integrations} connectors, ${workflows} workflows`);
  const priority = ['elastic', 'fortigate', 'virustotal', 'email', 'telegram'];
  const connected = await prisma.integration.findMany({
    where: { status: 'connected', type: { in: priority } },
    select: { type: true, name: true },
  });
  if (connected.length) {
    ok(`Priority connectors connected: ${connected.map((c) => c.type).join(', ')}`);
  } else {
    warn('No priority connectors connected yet — add Elastic, Firewall, VT, Email, Telegram in UI');
  }
  await prisma.$disconnect();
} catch (e) {
  bad('SQLite / Prisma', e.message);
}

// API
try {
  const { res } = await get('/api/soar/system/status');
  if (res.ok) ok('GET /api/soar/system/status');
  else bad('GET /api/soar/system/status', String(res.status));
} catch (e) {
  bad('SOAR API unreachable — is npm run dev running?', e.message);
}

try {
  const { res, json } = await get('/api/soar/platform/status');
  if (res.ok) {
    const configured = json?.data?.configured ?? json?.configured;
    if (configured) ok('Platform status probe');
    else warn('Platform not configured (set LUMISEC_PLATFORM_URL)');
  } else if (res.status === 501) warn('Platform status 501 — monolith not configured');
} catch {
  /* optional */
}

try {
  const { res } = await get('/api/soar/integrations/elastic/poll', {
    Authorization: `Bearer ${key}`,
    'X-Internal-Api-Key': key,
    'Content-Type': 'application/json',
  });
  // GET might 404 — use POST
  if (res.status === 404 || res.status === 405) {
    const post = await fetch(`${base}/api/soar/integrations/elastic/poll`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'X-Internal-Api-Key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ minutes: 60, limit: 10 }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await post.json().catch(() => ({}));
    if (post.ok) ok(`Elastic poll: ${body?.data?.ingested ?? 0} new alerts`);
    else warn(`Elastic poll: ${body?.message || post.status} (connect Elastic connector first)`);
  }
} catch (e) {
  warn(`Elastic poll skipped: ${e.message}`);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
