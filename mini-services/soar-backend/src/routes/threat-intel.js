// Real threat intel lookup — IPInfo (free tier) + optional VirusTotal API key from env.
// No heuristic good/bad lists in production path.

import express from 'express';
import crypto from 'crypto';
import { getThreatIntelModel, useMongo, getMemoryStores } from '../models.js';
import { asyncHandler } from '../middleware/util.js';

const router = express.Router();

const VT_API_KEY = process.env.VIRUSTOTAL_API_KEY || process.env.VT_API_KEY || '';

function detectIocType(ioc) {
  const v = String(ioc).trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every(n => Number(n) <= 255)) return 'ip';
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(':')) return 'ip';
  if (/^[a-f0-9]{64}$/i.test(v)) return 'hash';
  if (/^[a-f0-9]{40}$/i.test(v)) return 'hash';
  if (/^[a-f0-9]{32}$/i.test(v)) return 'hash';
  if (/^https?:\/\//i.test(v)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  return 'domain';
}

async function lookupIPInfo(ip) {
  const res = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const org = data.org || '';
  const suspicious = /hosting|vpn|proxy|cloud/i.test(org);
  return {
    verdict: suspicious ? 'suspicious' : 'clean',
    confidence: suspicious ? 40 : 70,
    source: 'ipinfo',
    raw: data,
  };
}

async function lookupVirusTotal(ioc, iocType) {
  if (!VT_API_KEY) return null;
  let endpoint = '';
  if (iocType === 'ip') endpoint = `ip_addresses/${encodeURIComponent(ioc)}`;
  else if (iocType === 'domain') endpoint = `domains/${encodeURIComponent(ioc)}`;
  else if (iocType === 'hash') endpoint = `files/${encodeURIComponent(ioc)}`;
  else if (iocType === 'url') {
    const b64 = Buffer.from(ioc).toString('base64').replace(/=/g, '');
    endpoint = `urls/${b64}`;
  } else return null;

  const res = await fetch(`https://www.virustotal.com/api/v3/${endpoint}`, {
    headers: { 'x-apikey': VT_API_KEY, Accept: 'application/json' },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;

  const stats = data?.data?.attributes?.last_analysis_stats;
  if (!stats) return { verdict: 'unknown', confidence: 0, source: 'virustotal', raw: data };
  const malicious = Number(stats.malicious || 0);
  const total = Object.values(stats).reduce((a, b) => a + Number(b), 0);
  const score = total > 0 ? (malicious / total) * 100 : 0;
  return {
    verdict: score >= 10 ? 'malicious' : score >= 3 ? 'suspicious' : 'clean',
    confidence: Math.min(100, Math.round(score)),
    source: 'virustotal',
    raw: { malicious, total, score },
  };
}

async function lookupGreyNoise(ioc) {
  const key = process.env.GREYNOISE_API_KEY || '';
  if (!key || detectIocType(ioc) !== 'ip') return null;
  try {
    const res = await fetch(`https://api.greynoise.io/v3/community/${encodeURIComponent(ioc)}`, {
      headers: { key, Accept: 'application/json' },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const noise = Boolean(data.noise);
    const riot = Boolean(data.riot);
    if (riot) return { verdict: 'clean', confidence: 85, source: 'greynoise_riot', raw: data };
    if (noise) return { verdict: 'suspicious', confidence: 70, source: 'greynoise', raw: data };
    return { verdict: 'clean', confidence: 60, source: 'greynoise', raw: data };
  } catch {
    return null;
  }
}

async function resolveVerdict(ioc, iocType) {
  const vt = await lookupVirusTotal(ioc, iocType);
  if (vt) return vt;
  if (iocType === 'ip') {
    const gn = await lookupGreyNoise(ioc);
    if (gn) return gn;
    const ipinfo = await lookupIPInfo(ioc);
    if (ipinfo) return ipinfo;
  }
  return { verdict: 'unknown', confidence: 0, source: 'no_feed', raw: {} };
}

router.get('/lookup', asyncHandler(async (req, res) => {
  const ioc = String(req.query.ioc || '').trim();
  if (!ioc) return res.status(400).json({ error: 'ioc query parameter is required' });

  const iocType = detectIocType(ioc);
  const checksum = crypto.createHash('sha256').update(`${iocType}:${ioc}`).digest('hex');
  const fresh = await resolveVerdict(ioc, iocType);

  if (useMongo() && getThreatIntelModel()) {
    const cached = await getThreatIntelModel().findOne({ ioc, iocType }).lean();
    const now = Date.now();
    const ttlMs = (cached?.ttl || 86400) * 1000;
    if (cached && cached.lastSeenAt && (now - new Date(cached.lastSeenAt).getTime()) < ttlMs) {
      return res.json({ ioc, iocType, ...cached, cached: true, checksum });
    }

    const record = await getThreatIntelModel().findOneAndUpdate(
      { ioc, iocType },
      {
        $set: {
          verdict: fresh.verdict,
          confidence: fresh.confidence,
          source: fresh.source,
          lastSeenAt: new Date(),
          raw: fresh.raw,
        },
        $setOnInsert: { firstSeenAt: new Date(), ttl: 86400 },
      },
      { new: true, upsert: true },
    ).lean();

    return res.json({ ioc, iocType, ...record, cached: false, checksum });
  }

  const stores = getMemoryStores();
  let record = stores.threatIntel.find(t => t.ioc === ioc && t.iocType === iocType);
  if (!record) {
    record = {
      _id: crypto.randomUUID(),
      ioc, iocType,
      verdict: fresh.verdict,
      confidence: fresh.confidence,
      source: fresh.source,
      raw: fresh.raw,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      ttl: 86400,
    };
    stores.threatIntel.push(record);
  } else {
    Object.assign(record, {
      verdict: fresh.verdict,
      confidence: fresh.confidence,
      source: fresh.source,
      raw: fresh.raw,
      lastSeenAt: new Date().toISOString(),
    });
  }
  res.json({ ioc, iocType, ...record, cached: false, checksum });
}));

router.get('/recent', asyncHandler(async (req, res) => {
  const limit = Math.min(100, Number(req.query.limit || 50));
  if (useMongo() && getThreatIntelModel()) {
    const items = await getThreatIntelModel().find().sort({ lastSeenAt: -1 }).limit(limit).lean();
    return res.json({ data: items, total: items.length });
  }
  const stores = getMemoryStores();
  const items = [...stores.threatIntel]
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
    .slice(0, limit);
  res.json({ data: items, total: items.length });
}));

export default router;
