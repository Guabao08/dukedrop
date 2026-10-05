import { db, e164, replyDetails, validTwilioRequest } from '../../lib/sms-followup.js';

const xml = '<Response></Response>';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const origin = process.env.TWILIO_WEBHOOK_URL;
  const params = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body))
    : req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  if (!origin || !validTwilioRequest(req.headers['x-twilio-signature'], origin, params)) return res.status(403).send('Forbidden');
  const from = e164(params.From);
  const sid = String(params.MessageSid || '');
  const body = String(params.Body || '').slice(0, 1600);
  res.setHeader('Content-Type', 'text/xml');
  if (!from || !e164(process.env.TWILIO_FROM_NUMBER) || e164(params.To) !== e164(process.env.TWILIO_FROM_NUMBER) || !/^SM[0-9a-f]{32}$/i.test(sid) || !body) return res.status(200).send(xml);
  try {
    const reference = body.match(/#([0-9a-f]{8})\b/i)?.[1]?.toLowerCase();
    const candidates = await db('orders?select=id,phone,tracking_followup_status,tracking_followup_sent_at,tracking_followup_claimed_at,retailer&tracking_followup_status=in.(pending,sent,received)&order=created_at.desc&limit=500');
    const matches = candidates.filter(order => e164(order.phone) === from && (order.tracking_followup_status !== 'pending' || order.tracking_followup_claimed_at) && (!reference || order.id.toLowerCase().startsWith(reference)));
    const order = matches[0];
    if (!order) return res.status(200).send(xml);
    try {
      await db('order_sms_messages', { method: 'POST', body: { sid, order_id: order.id, body } });
    } catch (error) {
      // A retry of the same Twilio message was already saved.
      if (!String(error.message).includes('409')) throw error;
    }
    const details = replyDetails(body);
    const keyword = String(params.OptOutType || '').toUpperCase();
    const stopped = keyword === 'STOP' || /^(?:STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/i.test(body.trim());
    const informational = keyword === 'HELP' || keyword === 'START' || /^(?:HELP|INFO|START|UNSTOP)$/i.test(body.trim());
    if (informational && !stopped) return res.status(200).send(xml);
    const updates = stopped ? { tracking_followup_status: 'skipped' }
      : { tracking_followup_status: 'received', tracking_received_at: new Date().toISOString() };
    if (!stopped && details.eta) updates.estimated_delivery_date = details.eta;
    if (!stopped && details.link && order.retailer === 'amazon') updates.shipping_link = details.link;
    await db(`orders?id=eq.${order.id}`, { method: 'PATCH', body: updates });
    return res.status(200).send(xml);
  } catch { return res.status(503).send(xml); }
}
