let clientPromise;

async function getClient() {
  const token = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;
  if (!token || !host) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const { PostHog } = await import('posthog-node');
        return new PostHog(token, { host, flushAt: 1, flushInterval: 0, requestTimeout: 2000, fetchRetryCount: 0 });
      } catch {
        // Optional analytics must never prevent an API route from loading.
        return null;
      }
    })();
  }
  return clientPromise;
}

export async function capturePosthog(event, properties) {
  try {
    const client = await getClient();
    if (!client) return;
    client.capture({ event, ...(properties ? { properties } : {}) });
    await client.flush();
  } catch {
    // An analytics outage must not change an application response.
  }
}
