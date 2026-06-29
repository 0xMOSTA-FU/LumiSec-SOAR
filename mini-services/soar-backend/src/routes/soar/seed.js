/**
 * POST /api/soar/seed — disabled (live data only).
 */
import { Router } from 'express';
import { soarErr } from '../../lib/envelope.js';

const router = Router();

router.post('/seed', async (req, res) => {
  return soarErr(
    res,
    'Demo seeding is disabled. Ingest data via webhooks, SIEM, or manual incident creation.',
    410,
  );
});

export default router;
