export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const orderStorageEnabled = process.env.ORDER_STORAGE_ENABLED === 'true' && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const stripeReady = Boolean(process.env.STRIPE_PUBLISHABLE_KEY && process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID && orderStorageEnabled);
  res.status(200).json({ supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '', orderStorageEnabled, stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '', stripeReady });
}
