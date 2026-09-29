import { clearDashboardSession } from '../../lib/dashboard-session.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  clearDashboardSession(req, res);
  return res.status(200).json({ ok: true });
}
