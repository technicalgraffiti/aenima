const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  // Allow Vercel cron calls and authorised manual calls
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isManual = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    // Lightweight ping — just count users, touches DB without loading data
    const { count, error } = await SB
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    console.log(`Supabase keepalive ping — ${count} users in DB`);
    return res.status(200).json({ ok: true, users: count, pinged: new Date().toISOString() });

  } catch (err) {
    console.error('Keepalive ping failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
