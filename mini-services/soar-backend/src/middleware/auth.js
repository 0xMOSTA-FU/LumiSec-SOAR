// API key authentication middleware.
// Requests must include X-API-Key header matching EXTERNAL_API_KEY.
// Public endpoints (/api/info, /api/health) bypass auth.

const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || '';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || process.env.SOAR_INTERNAL_API_KEY || '';
const WORKER_API_KEY = process.env.WORKER_API_KEY || '';

const PUBLIC_PATHS = new Set(['/api/info', '/api/health']);

function isWorkerRequest(req) {
  if (!WORKER_API_KEY) return false;
  const auth = req.headers.authorization || '';
  const bearer = auth.replace(/^Bearer\s+/i, '');
  return bearer === WORKER_API_KEY
    || req.headers['x-worker-key'] === WORKER_API_KEY;
}

function isShuffleWorkerPath(path) {
  return path === '/api/v1/workflows/queue'
    || path === '/api/v1/workflows/queue/confirm'
    || path === '/api/v1/streams'
    || path === '/api/v1/streams/results'
    || path === '/api/v1/streams/finish';
}

export function apiKeyAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (isWorkerRequest(req) && isShuffleWorkerPath(req.path)) return next();
  if (/^\/api\/v1\/hooks\/[^/]+$/.test(req.path)) return next();

  if (!EXTERNAL_API_KEY && !INTERNAL_API_KEY) {
    // No key configured = open mode (dev only). Warn but allow.
    console.warn('[auth] EXTERNAL_API_KEY not set — running in open mode (dev only!)');
    return next();
  }

  const provided = req.headers['x-api-key']
    || req.headers['x-internal-api-key']
    || req.headers['x-service-key'];
  if (!provided || (provided !== EXTERNAL_API_KEY && provided !== INTERNAL_API_KEY)) {
    return res.status(401).json({ error: 'Missing or invalid API key' });
  }

  next();
}
