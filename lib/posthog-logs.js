import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';

const projectToken = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;
let logProcessor = null;
if (projectToken && host) {
  try {
    logProcessor = new BatchLogRecordProcessor(new OTLPLogExporter({
      url: `${host.replace(/\/$/, '')}/i/v1/logs`,
      headers: { Authorization: `Bearer ${projectToken}` },
    }));
    const logSdk = new NodeSDK({
      resource: resourceFromAttributes({ 'service.name': 'dukedrop-api' }),
      logRecordProcessors: [logProcessor],
    });
    logSdk.start();
  } catch {
    logProcessor = null;
  }
}

const logger = logs.getLogger('dukedrop.posthog');

export function logOrderCreated({ service, quantity }) {
  try { logger.emit({ severityText: 'info', body: 'order created', attributes: { service, quantity } }); } catch {}
}

export function logDashboardOrderUpdated({ updatedFields }) {
  try { logger.emit({ severityText: 'info', body: 'dashboard order updated', attributes: { updated_fields: updatedFields } }); } catch {}
}

export function logPaymentVerificationCompleted({ updatedCount, failedCount, ambiguousCount }) {
  try { logger.emit({ severityText: 'info', body: 'payment verification completed', attributes: { updated_count: updatedCount, failed_count: failedCount, ambiguous_count: ambiguousCount } }); } catch {}
}

export function logTrackingSyncCompleted() {
  try { logger.emit({ severityText: 'info', body: 'tracking sync completed' }); } catch {}
}

export async function flushPosthogLogs() {
  if (!logProcessor) return;
  try { await logProcessor.forceFlush(); } catch {}
}
