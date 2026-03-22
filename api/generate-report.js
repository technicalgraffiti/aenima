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

    const prompt = `You are a senior AI visibility consultant at Technical Graffiti, writing a paid professional audit report. This client has paid £195 for this assessment. The report must feel worth every penny — specific, incisive, authoritative. No waffle, no filler, no generic advice that could apply to any business.

BUSINESS DETAILS:
- Business name: ${bizName}
- Business type: ${bizType || 'local business'}
- Town: ${town}
- Website: ${domain}
- Keywords / services they want to be found for: ${keywords || 'not specified'}

AUDIT RESULTS:
- Overall AI visibility score: ${scoreData.overall}/100
- Issues found: ${scoreData.issues?.map(i => `${i.p.toUpperCase()}: ${i.t}`).join(', ') || 'None'}
- Category breakdown: ${Object.entries(scoreData.cats || {}).map(([k,v]) => `${k}: ${v.score}/${v.max}`).join(', ')}

Write the report in this exact structure using these section headers:

## EXECUTIVE SUMMARY
2-3 sentences. State the score, what it means specifically for THIS business in THIS town, and the single most important thing holding them back. Be direct — name the actual problem. Do not use phrases like "your website is performing well" if the score is under 70.

## WHAT THIS MEANS FOR YOUR BUSINESS
Make it real and commercial. Describe the specific searches their ideal customers are making right now — name the trade, the town, the type of query. Explain exactly what happens when AI systems like ChatGPT, Perplexity or Google AI can't identify them properly. Quantify the risk where you can — missed enquiries, competitors appearing instead of them, the growing share of searches going through AI rather than traditional Google. Make them feel the problem in business terms, not technical terms.

## WHAT THE AUDIT FOUND
3-4 specific findings directly tied to their actual score data and issues. Each finding should name the exact problem, explain in one sentence why it matters for AI visibility, and reference their specific business type and location where relevant. This section should feel like you have genuinely examined their site — because the scoring system has.

## PRIORITY ACTIONS
Numbered list of 4-5 actions in strict order of impact. Each action must:
- Name the specific fix (not vague advice like "improve your content")
- Explain in plain English what it does for AI visibility
- Reference their actual business, trade or location specifically
- Be something a web developer or technically-minded person could act on immediately

## NEXT STEPS
Technical Graffiti can implement everything in this report.

**Monthly Managed Presence — £49/month**
Every month we review your AI visibility, regenerate your visibility files and deliver them to you ready to upload. As AI search evolves, your presence evolves with it. Nothing complicated on your end.

**New Website — from £795**
If your current site is limiting what's possible, we build a five-page professional WordPress site in 7 working days with every AI visibility signal built in from day one.

To discuss either option, contact Stewart direct: technicalgraffiti.co.uk

---
*AI Visibility Audit conducted by Technical Graffiti Ltd. Report generated ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}.*

CRITICAL RULES:
- Address the business owner by their business name throughout, not "you" generically
- Every section must reference ${bizName}, ${bizType}, and ${town} specifically — this must not read like a template
- No technical jargon — write as if explaining to a smart business owner who knows nothing about web technology
- No mention of the £195 audit price anywhere in the report — they have already paid
- Tone: authoritative, direct, respectful. Like a trusted expert, not a salesperson`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    res.status(200).json({ report: message.content[0].text });
  } catch (err) {
    console.error('Report generation error:', err);
    res.status(500).json({ error: err.message });
  }
};
