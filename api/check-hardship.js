// api/check-hardship.js
// Checks if a domain has already used the hardship plan
// Also handles saving a domain after successful hardship payment

const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { domain, email, save } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain required' });

  const clean = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();

  try {
    // Save mode — store domain after successful payment
    if (save) {
      const { error } = await SB
        .from('hardship_domains')
        .upsert({ domain: clean, email: email || '' }, { onConflict: 'domain' });
      if (error) {
        console.error('Hardship domain save error:', error);
        return res.status(500).json({ error: 'Save failed' });
      }
      console.log(`Hardship domain saved: ${clean}`);
      return res.status(200).json({ saved: true });
    }

    // Check mode — is domain eligible?
    const { data, error } = await SB
      .from('hardship_domains')
      .select('domain')
      .eq('domain', clean)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Hardship check error:', error);
      return res.status(500).json({ error: 'Check failed' });
    }

    return res.status(200).json({ eligible: !data });

  } catch (e) {
    console.error('Hardship check exception:', e.message);
    return res.status(500).json({ error: 'Check failed' });
  }
};
