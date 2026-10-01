import { PostHog } from 'posthog-node';

const projectToken = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;
let client = null;
if (projectToken && host) {
  try {
    client = new PostHog(projectToken, { host, enableExceptionAutocapture: true, flushAt: 1, flushInterval: 0 });
  } catch {
    // Analytics is optional. Invalid telemetry configuration must not break API routes.
  }
}

export const posthog = client;

export async function capturePosthog(event, properties) {
  if (!posthog) return;
  try {
    posthog.capture({ event, ...(properties ? { properties } : {}) });
    await posthog.flush();
  } catch {
    // An analytics outage must not change an application response.
  }
}

export async function flushPosthog() {
  if (!posthog) return;
  try { await posthog.flush(); } catch {}
}
