const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ACTIVE_PLANS = ['starter', 'pro', 'agency'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { token, domain } = req.body;

    if (!token || typeof token !== 'string' || !token.startsWith('aenima_tok_')) {
      return res.status(401).json({ active: false, error: 'Invalid token format' });
    }

    if (!domain) {
      return res.status(400).json({ active: false, error: 'Domain required' });
    }

    // Look up the token in Supabase users table
    const { data: user, error } = await SB
      .from('users')
      .select('id, plan, email, website, api_token')
      .eq('api_token', token)
      .single();

    if (error || !user) {
      return res.status(401).json({ active: false, error: 'Token not recognised' });
    }

    // Check plan is active
    if (!ACTIVE_PLANS.includes(user.plan)) {
      return res.status(403).json({ active: false, error: 'Subscription inactive', plan: user.plan });
    }

    // Fetch latest score for this user if available
    const { data: scoreRow } = await SB
      .from('scores')
      .select('score')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const score = scoreRow ? scoreRow.score : null;

    // Success — return active status, plan and score
    return res.status(200).json({
      active: true,
      plan: user.plan,
      score: score,
    });

  } catch (err) {
    console.error('verify-licence error:', err.message);
    return res.status(500).json({ active: false, error: 'Server error' });
  }
};
