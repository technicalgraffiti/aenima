const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { bizName, bizType, town, domain, scoreData, plan } = req.body;
    const isPro = plan === 'pro' || plan === 'agency';
    const isStarter = plan === 'starter';

    // Next Steps vary by plan — no point upselling someone already on Pro
    let nextSteps;
    if (isPro) {
      nextSteps = `Your Aenima Pro subscription is already handling the technical fixes automatically — your files update every month without any action from you. The one area where additional support adds value is if your website itself needs structural work.

**New Website — from £795**
We build a five-page professional WordPress site in 7 working days with every AI visibility signal built in from day one. If your current site has limitations that schema alone cannot fix, this is the solution.

To discuss, contact Stewart direct: technicalgraffiti.co.uk`;
    } else if (isStarter) {
      nextSteps = `Your Aenima Starter subscription generates your visibility files each month — you download and upload them yourself. If you'd prefer it fully managed, or if your site needs deeper work:

**Upgrade to Pro — £7.50/month**
The Aenima WordPress plugin installs and updates your files automatically every month. Nothing to do after setup.

**Monthly Managed Presence — £49/month**
We handle everything — monthly review, file generation, installation and reporting. Nothing on your end.

**New Website — from £795**
If your current site is limiting what's possible, we build a five-page professional WordPress site in 7 working days with every AI visibility signal built in from day one.

To discuss any option, contact Stewart direct: technicalgraffiti.co.uk`;
    } else {
      nextSteps = `Technical Graffiti can implement everything in this report.

**Aenima Starter — £5.50/month**
We generate your Schema and llms.txt files every month. You download and upload them yourself. Fix the core issues immediately.

**Aenima Pro — £7.50/month**
Everything in Starter, plus the WordPress plugin installs and updates your files automatically every month. Nothing to do after setup.

**Monthly Managed Presence — £49/month**
We handle everything — monthly review, file generation, installation and reporting. Nothing on your end.

**New Website — from £795**
If your current site is limiting what's possible, we build a five-page professional WordPress site in 7 working days with every AI visibility signal built in from day one.

To discuss any option, contact Stewart direct: technicalgraffiti.co.uk`;
    }

    const prompt = `You are a senior AI visibility consultant at Technical Graffiti, writing a professional audit report. The report must feel authoritative, specific and worth reading — no waffle, no filler, no generic advice that could apply to any business.

BUSINESS DETAILS:
- Business name: ${bizName}
- Business type: ${bizType || 'local business'}
- Town: ${town || 'UK'}
- Website: ${domain}
- Keywords / services they want to be found for: derived from business type and location

AUDIT RESULTS:
- Overall AI visibility score: ${scoreData.overall}/100
- Issues found: ${scoreData.issues?.map(i => `${i.p.toUpperCase()}: ${i.t}`).join(', ') || 'None'}
- Category breakdown: ${Object.entries(scoreData.cats || {}).map(([k,v]) => `${k}: ${v.score}/${v.max}`).join(', ')}

Write the report in this exact structure:

## EXECUTIVE SUMMARY
2-3 sentences. State the score, what it means specifically for THIS business in THIS town, and the single most important thing holding them back — or confirming their strong position if score is 80+. Be direct.

## WHAT THIS MEANS FOR YOUR BUSINESS
Make it real and commercial. Describe the specific searches their customers are making right now — name the trade, the town, the type of query. Explain what happens when AI systems like ChatGPT, Perplexity or Google AI can or cannot identify them properly. Reference their actual situation.

## WHAT THE AUDIT FOUND
3-4 specific findings tied to their actual score data. Each finding should name the exact issue or strength, explain why it matters for AI visibility, and reference their specific business type and location.

## PRIORITY ACTIONS
Numbered list of 4-5 actions in strict order of impact. Each action must name the specific fix, explain what it does for AI visibility, and reference their actual business or location.

## NEXT STEPS
${nextSteps}

---
*AI Visibility Audit conducted by Technical Graffiti Ltd. Report generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.*

CRITICAL RULES:
- Reference ${bizName}, ${bizType}, and ${town} throughout — must not read like a template
- No technical jargon — write for a smart business owner who knows nothing about web technology
- Tone: authoritative, direct, respectful. Like a trusted expert, not a salesperson
- Do not mention any subscription prices in the body sections — only in Next Steps`;

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
