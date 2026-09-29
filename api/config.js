export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const orderStorageEnabled = process.env.ORDER_STORAGE_ENABLED === 'true' && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  res.status(200).json({ supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '', orderStorageEnabled });
}
