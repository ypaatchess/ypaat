export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ configured: Boolean(url && key), url: url || null, key: key || null });
}
