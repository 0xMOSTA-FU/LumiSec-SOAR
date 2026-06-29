#!/usr/bin/env node
/**
 * One-shot Elastic security alerts poll → SOAR alerts.
 * Usage: npm run jobs:elastic-poll
 */
const base = process.env.SOAR_BASE_URL || 'http://localhost:3000';
const key = process.env.SOAR_INTERNAL_API_KEY || 'dev-soar-key';
const minutes = Number(process.env.ELASTIC_POLL_MINUTES || 60);
const limit = Number(process.env.ELASTIC_POLL_LIMIT || 100);

const res = await fetch(`${base}/api/soar/integrations/elastic/poll`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'X-Internal-Api-Key': key,
  },
  body: JSON.stringify({ minutes, limit }),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = { raw: text };
}

console.log(JSON.stringify(json, null, 2));
process.exit(res.ok ? 0 : 1);
