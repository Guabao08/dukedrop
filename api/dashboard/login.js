import { dashboardConfigured, passwordMatches, setDashboardSession } from '../../lib/dashboard-session.js';
import { capturePosthog } from '../../lib/posthog.js';
import { consumeRateLimit } from '../../lib/api-security.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!dashboardConfigured()) return res.status(503).json({ error: 'Dashboard access is not configured.' });

  try {
    if (!await consumeRateLimit(req, 'dashboard-login', 10, 900)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  } catch { return res.status(503).json({ error: 'Sign-in service is temporarily unavailable.' }); }

  const candidate = req.body?.password;
  if (typeof candidate !== 'string' || !passwordMatches(candidate, process.env.DASHBOARD_PASSWORD)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  setDashboardSession(req, res, process.env.DASHBOARD_PASSWORD);
  await capturePosthog('dashboard_signed_in');
  return res.status(200).json({ ok: true });
}
