import twilio from 'twilio';

const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = () => `${process.env.SUPABASE_URL}/rest/v1`;
const headers = () => ({ apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' });

export function smsConfigured() {
  return Boolean(process.env.SUPABASE_URL && serviceKey() && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && e164(process.env.TWILIO_FROM_NUMBER) && /^https:\/\//.test(process.env.TWILIO_WEBHOOK_URL || ''));
}

export function e164(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

export function followupText(order) {
  const name = String(order.recipient_name || '').trim().split(/\s+/)[0];
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const request = order.retailer === 'amazon'
    ? 'Amazon shipping/tracking link'
    : 'tracking number';
  return `${greeting} DukeDrop: Order #${order.id.slice(0, 8).toUpperCase()}. Send your ${request} and estimated delivery date (YYYY-MM-DD). Reply STOP to opt out.`;
}

export async function db(path, options = {}) {
  const response = await fetch(`${base()}/${path}`, {
    method: options.method || 'GET', headers: { ...headers(), ...(options.prefer ? { Prefer: options.prefer } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Order storage returned ${response.status}.`);
  return response.status === 204 ? null : response.json();
}

export async function sendDueFollowups({ limit = 30 } = {}) {
  if (!smsConfigured()) throw new Error('SMS is not configured.');
  const due = await db(`orders?select=id&tracking_followup_status=eq.pending&payment_status=eq.paid&sms_opt_in=eq.true&tracking_followup_due_at=lte.${encodeURIComponent(new Date().toISOString())}&tracking_followup_claimed_at=is.null&order=tracking_followup_due_at.asc&limit=${limit}`);
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const result = { due: due.length, sent: 0, skipped: 0, uncertain: 0 };
  for (const row of due) {
    const claimed = await db('rpc/claim_sms_followup', { method: 'POST', body: { p_order_id: row.id } });
    if (!claimed?.length) continue;
    const order = claimed[0];
    const to = e164(order.phone);
    if (!to) {
      await db(`orders?id=eq.${order.id}`, { method: 'PATCH', body: { tracking_followup_status: 'skipped' } });
      result.skipped++;
      continue;
    }
    try {
      const message = await client.messages.create({ to, from: process.env.TWILIO_FROM_NUMBER, body: followupText(order) });
      await db(`orders?id=eq.${order.id}`, { method: 'PATCH', body: {
        tracking_followup_status: 'sent', tracking_followup_sent_at: new Date().toISOString(), tracking_followup_message_sid: message.sid,
      } });
      result.sent++;
    } catch {
      // The provider may have accepted the request. Keep the claim to prevent a duplicate.
      result.uncertain++;
    }
  }
  return result;
}

export function validTwilioRequest(signature, url, params) {
  return Boolean(signature && process.env.TWILIO_AUTH_TOKEN && twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, params));
}

export function replyDetails(body) {
  const text = String(body || '').slice(0, 1600);
  const date = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const eta = date && !Number.isNaN(Date.parse(`${date[0]}T00:00:00Z`)) && new Date(`${date[0]}T00:00:00Z`).toISOString().slice(0, 10) === date[0] ? date[0] : null;
  const link = text.match(/https:\/\/[^\s<>"']+/i)?.[0].replace(/[.,;!?]+$/, '') || null;
  return { eta, link };
}
