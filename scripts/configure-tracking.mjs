// Run with the same server environment variables as Vercel. Never prints secrets.
import { ensureTrackingWebhook, trackingConfigured } from '../lib/carrier-tracking.js';
if (!trackingConfigured()) throw new Error('Set EASYPOST_API_KEY and EASYPOST_WEBHOOK_SECRET in your environment.');
try {
  await ensureTrackingWebhook();
  console.log('EasyPost production tracking webhook configured.');
} catch { throw new Error('Could not configure the EasyPost production webhook. Check the production key and account configuration.'); }
