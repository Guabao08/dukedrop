// Run with the same server environment variables as Vercel. Never prints secrets.
import { ensureTrackingWebhook, trackingConfigured } from '../lib/carrier-tracking.js';
if (!trackingConfigured()) throw new Error('Set a live SHIPPO_API_KEY and SHIPPO_WEBHOOK_SECRET in your environment.');
try {
  await ensureTrackingWebhook();
  console.log('Production Shippo tracking webhook configured.');
} catch { throw new Error('Could not configure the Shippo production webhook. Check the live key and account configuration.'); }
