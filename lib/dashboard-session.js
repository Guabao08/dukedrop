import { createHmac, timingSafeEqual } from 'node:crypto';

export const DASHBOARD_COOKIE = 'dd_dashboard_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function dashboardConfigured() {
  return Boolean(process.env.DASHBOARD_PASSWORD && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function passwordMatches(candidate, expected) {
  const candidateHash = createHmac('sha256', 'dukedrop-dashboard-password-check').update(String(candidate)).digest();
  const expectedHash = createHmac('sha256', 'dukedrop-dashboard-password-check').update(String(expected)).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function signature(expiresAt, secret) {
  return createHmac('sha256', secret).update(`${DASHBOARD_COOKIE}.${expiresAt}`).digest('base64url');
}

export function setDashboardSession(req, res, secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const value = `${expiresAt}.${signature(expiresAt, secret)}`;
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${DASHBOARD_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api/dashboard; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

export function clearDashboardSession(req, res) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${DASHBOARD_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/dashboard; Max-Age=0${secure}`);
}

export function hasDashboardSession(req, secret) {
  const cookie = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${DASHBOARD_COOKIE}=`));
  if (!cookie) return false;
  const value = cookie.slice(DASHBOARD_COOKIE.length + 1);
  const separator = value.indexOf('.');
  if (separator < 1) return false;
  const expiresAt = value.slice(0, separator);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  const actual = Buffer.from(value.slice(separator + 1), 'base64url');
  const expected = Buffer.from(signature(expiresAt, secret), 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
