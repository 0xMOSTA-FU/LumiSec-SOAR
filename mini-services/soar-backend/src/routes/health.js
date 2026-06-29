// Health & info endpoints (public, no auth).

import express from 'express';
import { isMongoConnected } from '../mongo.js';

const router = express.Router();

const BACKEND_INFO = {
  name: 'SOAR External Backend',
  version: '1.2.0',
  description: 'Node.js + MongoDB backend — industry SOAR API + legacy REST',
  endpoints: [
    'GET    /api/health',
    'GET    /api/info',
    'GET    /api/soar/*',
    'POST   /api/soar/seed',
    'GET    /api/incidents',
    'GET    /api/incidents/:id',
    'POST   /api/incidents',
    'PUT    /api/incidents/:id',
    'GET    /api/assets',
    'GET    /api/assets/:id',
    'GET    /api/threat-intel/lookup?ioc=',
    'POST   /api/soar-events',
    'GET    /api/soar-events',
  ],
};

router.get('/info', (req, res) => {
  res.json(BACKEND_INFO);
});

router.get('/health', async (req, res) => {
  const start = Date.now();
  let dbStatus = 'disconnected';
  let dbLatency = null;
  if (isMongoConnected()) {
    try {
      const t0 = Date.now();
      // Ping-ish: list collections
      await (await import('mongoose')).connection.db.admin().ping();
      dbLatency = Date.now() - t0;
      dbStatus = 'connected';
    } catch (e) {
      dbStatus = 'error';
    }
  } else if (!process.env.MONGODB_URI) {
    dbStatus = 'not_configured';
  }
  res.json({
    status: isMongoConnected() ? 'ok' : 'degraded',
    uptime_sec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks: {
      database: { status: dbStatus, latency_ms: dbLatency },
      memory: { rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024) },
    },
    latency_ms: Date.now() - start,
  });
});

export default router;
