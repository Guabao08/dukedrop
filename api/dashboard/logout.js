import { clearDashboardSession } from '../../lib/dashboard-session.js';
import { flushPosthog, posthog } from '../../lib/posthog.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  clearDashboardSession(req, res);
  if (posthog) {
    posthog.capture({ event: 'dashboard_signed_out' });
    await flushPosthog();
  }
  return res.status(200).json({ ok: true });
}
