// api/aenima-log.js 
// Silently logs free checker usage to aenima_assessments table
// No personal data — domain and score only

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
  if (req.method !== 'POST') return res.status(405).end();

  try {
    let body = req.body;
    if (!body || typeof body === 'string') {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      body = raw ? JSON.parse(raw) : {};
    }

    const { domain, score } = body;
    if (!domain) return res.status(400).json({ error: 'Domain required' });

    await SB.from('aenima_assessments').insert({
      domain: String(domain).toLowerCase().trim(),
      score: score !== undefined ? parseInt(score, 10) : null,
    });

    return res.status(200).json({ ok: true });

  } catch (e) {
    // Silent fail — never surface errors to the user
    console.error('aenima-log error:', e.message);
    return res.status(200).json({ ok: false });
  }
};
