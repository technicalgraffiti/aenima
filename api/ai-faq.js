// api/ai-faq.js
// Proxies FAQ generation requests to Anthropic API server-side

const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content?.[0]?.text || '';
    return res.status(200).json({ text });
  } catch (err) {
    console.error('AI FAQ error:', err.message);
    return res.status(500).json({ error: 'AI generation failed' });
  }
};
