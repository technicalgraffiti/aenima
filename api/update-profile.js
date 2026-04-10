// api/update-profile.js
// Updates user profile in Supabase using service key (bypasses RLS)

const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { user_id, updates } = req.body;
  if (!user_id || !updates) return res.status(400).json({ error: 'Missing user_id or updates' });

  const allowed = ['name','business','website','phone','town','postcode'];
  const safe = {};
  allowed.forEach(k => { if (updates[k] !== undefined) safe[k] = updates[k]; });

  if (!Object.keys(safe).length) return res.status(400).json({ error: 'No valid fields to update' });

  try {
    const { error } = await SB.from('users').update(safe).eq('id', user_id);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Profile update error:', err.message);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
};
