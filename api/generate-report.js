const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { bizName, bizType, town, domain, keywords, scoreData } = req.body;

    const prompt = `You are an AI visibility consultant writing a professional audit report for a local business client.

Business details:
- Business name: ${bizName}
- Business type: ${bizType || 'local business'}
- Town: ${town}
- Domain: ${domain}
- Keywords they want to rank for: ${keywords || 'not specified'}

Score check results:
- Overall score: ${scoreData.overall}/100
- Issues found: ${scoreData.issues?.map(i => `${i.p.toUpperCase()}: ${i.t}`).join(', ') || 'None'}
- Category scores: ${Object.entries(scoreData.cats || {}).map(([k,v]) => `${k}: ${v.score}/${v.max}`).join(', ')}

Write a professional AI visibility audit report with these sections:
1. EXECUTIVE SUMMARY (2-3 sentences, plain English, no jargon)
2. WHAT THIS MEANS FOR YOUR BUSINESS (explain impact in business terms - customers finding them, missing out on enquiries)
3. PRIORITY ACTIONS (numbered list, 3-5 specific actions in order of importance, plain English)
4. NEXT STEPS (how Technical Graffiti can help - mention the monthly managed service at £49/month and the one-off audit at £195)

Write in a professional but friendly tone. No technical jargon. Address the business owner directly. Keep it concise.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    res.status(200).json({ report: message.content[0].text });
  } catch (err) {
    console.error('Report generation error:', err);
    res.status(500).json({ error: err.message });
  }
};
