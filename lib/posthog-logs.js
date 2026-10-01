import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';

const projectToken = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

if (!projectToken || !host) {
  if (!isProduction) {
    const missingVariable = !projectToken ? 'POSTHOG_PROJECT_TOKEN' : 'POSTHOG_HOST';
    throw new Error(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`);
  }
}

const logProcessor = projectToken && host
  ? new BatchLogRecordProcessor(new OTLPLogExporter({
    url: `${host.replace(/\/$/, '')}/i/v1/logs`,
    headers: { Authorization: `Bearer ${projectToken}` },
  }))
  : null;

if (logProcessor) {
  const logSdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': 'dukedrop-api' }),
    logRecordProcessors: [logProcessor],
  });
  logSdk.start();
}

const logger = logs.getLogger('dukedrop.posthog');

export function logOrderCreated({ service, quantity }) {
  logger.emit({ severityText: 'info', body: 'order created', attributes: { service, quantity } });
}

export function logDashboardOrderUpdated({ updatedFields }) {
  logger.emit({ severityText: 'info', body: 'dashboard order updated', attributes: { updated_fields: updatedFields } });
}

export function logPaymentVerificationCompleted({ updatedCount, failedCount, ambiguousCount }) {
  logger.emit({ severityText: 'info', body: 'payment verification completed', attributes: { updated_count: updatedCount, failed_count: failedCount, ambiguous_count: ambiguousCount } });
}

export function logTrackingSyncCompleted() {
  logger.emit({ severityText: 'info', body: 'tracking sync completed' });
}

export async function flushPosthogLogs() {
  if (!logProcessor) return;
  try { await logProcessor.forceFlush(); } catch {}
}
