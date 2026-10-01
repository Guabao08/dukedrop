let providerPromise;
const pending = [];

function record(body, attributes = {}) {
  if (!process.env.POSTHOG_PROJECT_TOKEN || !process.env.POSTHOG_HOST) return;
  if (pending.length < 100) pending.push({ severityText: 'info', body, attributes });
}

async function getProvider() {
  if (!providerPromise) {
    providerPromise = (async () => {
      try {
        const [{ OTLPLogExporter }, { resourceFromAttributes }, { BatchLogRecordProcessor, LoggerProvider }] = await Promise.all([
          import('@opentelemetry/exporter-logs-otlp-http'),
          import('@opentelemetry/resources'),
          import('@opentelemetry/sdk-logs'),
        ]);
        const exporter = new OTLPLogExporter({
          url: `${process.env.POSTHOG_HOST.replace(/\/$/, '')}/i/v1/logs`,
          headers: { Authorization: `Bearer ${process.env.POSTHOG_PROJECT_TOKEN}` },
          timeoutMillis: 2000,
        });
        return new LoggerProvider({
          resource: resourceFromAttributes({ 'service.name': 'dukedrop-api' }),
          processors: [new BatchLogRecordProcessor(exporter, { exportTimeoutMillis: 2000 })],
        });
      } catch {
        return null;
      }
    })();
  }
  return providerPromise;
}

export function logOrderCreated({ service, quantity }) {
  record('order created', { service, quantity });
}

export function logDashboardOrderUpdated({ updatedFields }) {
  record('dashboard order updated', { updated_fields: updatedFields });
}

export function logPaymentVerificationCompleted({ updatedCount, failedCount, ambiguousCount }) {
  record('payment verification completed', { updated_count: updatedCount, failed_count: failedCount, ambiguous_count: ambiguousCount });
}

export function logTrackingSyncCompleted() {
  record('tracking sync completed');
}

export async function flushPosthogLogs() {
  const records = pending.splice(0);
  if (!records.length) return;
  try {
    const provider = await getProvider();
    if (!provider) return;
    const logger = provider.getLogger('dukedrop.posthog');
    for (const entry of records) logger.emit(entry);
    await provider.forceFlush({ timeoutMillis: 2000 });
  } catch {
    // Logs are optional; a failed exporter must not affect saved orders.
  }
}
