import { dashboardConfigured, passwordMatches, setDashboardSession } from '../../lib/dashboard-session.js';

const failures = new Map();
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!dashboardConfigured()) return res.status(503).json({ error: 'Dashboard access is not configured.' });

  const forwarded = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const attempt = failures.get(forwarded);
  if (attempt?.lockedUntil > now) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (attempt?.lockedUntil && attempt.lockedUntil <= now) failures.delete(forwarded);

  const candidate = req.body?.password;
  if (typeof candidate !== 'string' || !passwordMatches(candidate, process.env.DASHBOARD_PASSWORD)) {
    const next = (failures.get(forwarded)?.count || 0) + 1;
    failures.set(forwarded, { count: next, lockedUntil: next >= MAX_FAILURES ? now + LOCKOUT_MS : 0 });
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  failures.delete(forwarded);
  setDashboardSession(req, res, process.env.DASHBOARD_PASSWORD);
  return res.status(200).json({ ok: true });
}
