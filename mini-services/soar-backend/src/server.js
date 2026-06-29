// SOAR External Backend — main server entry.
// Run with: node src/server.js
// Listens on PORT (default 4000).

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { connectMongo, isMongoConfigured } from './mongo.js';
import { ensureModels } from './models.js';
import { ensureSoarModels } from './models/soar.js';
import { ensureShuffleModels } from './shuffle/models.js';
import { apiKeyAuth } from './middleware/auth.js';
import healthRouter from './routes/health.js';
import incidentsRouter from './routes/incidents.js';
import assetsRouter from './routes/assets.js';
import threatIntelRouter from './routes/threat-intel.js';
import soarEventsRouter from './routes/soar-events.js';
import soarApiRouter from './routes/soar/index.js';
import shuffleV1Router from './routes/shuffle-v1.js';
import { initScheduler } from './shuffle/scheduler.js';

const PORT = Number(process.env.PORT) || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 300;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const app = express();

// ===== Security & middleware =====
app.use(helmet());
app.use(cors({
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'Org-Id', 'Org'],
  credentials: false,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (LOG_LEVEL !== 'silent') {
  app.use(morgan(LOG_LEVEL === 'debug' ? 'dev' : 'tiny'));
}

// Rate limiting (per-IP)
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Auth (after rate limit, before routes)
app.use('/api/', apiKeyAuth);

// Shuffle-compatible SOAR API (reference: Shuffle TECHNICAL_DOCUMENTATION_AR.md §7)
app.use('/api/v1', shuffleV1Router);

// Industry SOAR API (MongoDB) — matches /api/soar/* contract
app.use('/api/soar', soarApiRouter);

// Legacy external APIs
app.use('/api', healthRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/threat-intel', threatIntelRouter);
app.use('/api/soar-events', soarEventsRouter);

// Root
app.get('/', (req, res) => {
  res.json({
    name: 'SOAR External Backend',
    version: '1.2.0',
    docs: '/api/info',
    health: '/api/health',
    soar_api: '/api/soar/system/status',
    shuffle_api: '/api/v1/health',
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ===== Start =====
let server = null;

async function start() {
  if (isMongoConfigured()) {
    try {
      await connectMongo();
      await ensureModels();
      await ensureSoarModels();
      await ensureShuffleModels();
      await initScheduler();
    } catch (e) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[startup] Mongo connection failed in production:', e.message);
        process.exit(1);
      }
      console.warn('[startup] Mongo connection failed, SOAR /api/soar/* routes will return 503:', e.message);
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[startup] MONGODB_URI required in production');
    process.exit(1);
  } else {
    console.warn('[startup] MONGODB_URI not set — /api/soar/* requires MongoDB');
  }

  server = app.listen(PORT, () => {
    console.log(`\n┌──────────────────────────────────────────────────┐`);
    console.log(`│  SOAR External Backend                           │`);
    console.log(`│  Listening:  http://localhost:${PORT}              │`);
    console.log(`│  Mongo:      ${isMongoConfigured() ? 'configured' : 'in-memory mode'}${' '.repeat(Math.max(0, 16 - (isMongoConfigured() ? 'configured'.length : 'in-memory mode'.length)))}│`);
    console.log(`│  CORS:       ${CORS_ORIGIN === '*' ? 'open' : 'restricted'}${' '.repeat(Math.max(0, 22 - (CORS_ORIGIN === '*' ? 'open'.length : 'restricted'.length)))}│`);
    console.log(`│  Health:     http://localhost:${PORT}/api/health   │`);
    console.log(`└──────────────────────────────────────────────────┘\n`);
  });
}

function shutdown(signal) {
  console.log(`[shutdown] ${signal} received, closing server…`);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => {
    console.log('[shutdown] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
