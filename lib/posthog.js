import { PostHog } from 'posthog-node';

const projectToken = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

if (!projectToken || !host) {
  if (!isProduction) {
    const missingVariable = !projectToken ? 'POSTHOG_PROJECT_TOKEN' : 'POSTHOG_HOST';
    throw new Error(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`);
  }
}

export const posthog = projectToken && host
  ? new PostHog(projectToken, { host, enableExceptionAutocapture: true, flushAt: 1, flushInterval: 0 })
  : null;

export async function flushPosthog() {
  if (!posthog) return;
  try { await posthog.flush(); } catch {}
}
