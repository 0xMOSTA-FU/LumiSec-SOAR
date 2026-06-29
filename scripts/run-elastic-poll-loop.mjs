#!/usr/bin/env node
/**
 * Background Elastic poll loop (dev / pilot).
 * Usage: npm run jobs:elastic-poll-loop
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const intervalMs = Number(process.env.ELASTIC_POLL_INTERVAL_MS || 5 * 60 * 1000);
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-elastic-poll.mjs');

function runOnce() {
  const child = spawn(process.execPath, [script], { stdio: 'inherit', env: process.env });
  child.on('close', (code) => {
    console.log(`[elastic-poll] finished exit=${code} — next in ${intervalMs / 1000}s`);
  });
}

console.log(`[elastic-poll] starting loop every ${intervalMs / 1000}s`);
runOnce();
setInterval(runOnce, intervalMs);
