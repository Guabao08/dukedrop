import { passwordMatches } from '../../lib/dashboard-session.js';
import { syncTracking } from '../../lib/carrier-tracking.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  if (!process.env.CRON_SECRET || !passwordMatches(req.headers.authorization || '', `Bearer ${process.env.CRON_SECRET}`)) return res.status(401).json({ error: 'Unauthorized.' });
  try { return res.status(200).json(await syncTracking({ limit: 50 })); }
  catch { return res.status(503).json({ error: 'Tracking reconciliation failed.' }); }
}
