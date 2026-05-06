const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ── FAQ GENERATION MODE ──
    if (req.body.mode === 'faq') {
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: 'No prompt' });
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      });
      return res.status(200).json({ text: msg.content[0].text });
    }

    const {
      bizName, bizType, town, domain, scoreData, plan,
      companiesHouseNumber, companiesHouseUrl,
      sameAsGoogle, sameAsLinkedIn, sameAsFacebook, sameAsOther
    } = req.body;
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

    const advisoryText = scoreData.advisory?.length
      ? scoreData.advisory.map(a => a.t).join('; ')
      : 'None identified';
    const advSigs = scoreData.advancedSignals || {};

    // ── Companies House (optional — not all businesses are Ltd cos) ──
    const hasCompaniesHouse = !!(companiesHouseNumber || companiesHouseUrl);
    const chLine = hasCompaniesHouse
      ? `PRESENT — number: ${companiesHouseNumber || 'not provided'}, URL: ${companiesHouseUrl || 'not provided'}`
      : 'NOT PROVIDED — business may not be a limited company, or details not yet added to schema';

    // ── sameAs social links (all optional) ──
    const sameAsProvided = [sameAsGoogle, sameAsLinkedIn, sameAsFacebook, sameAsOther]
      .filter(Boolean);
    const sameAsLine = sameAsProvided.length > 0
      ? `PRESENT — ${sameAsProvided.length} link(s): ${sameAsProvided.join(', ')}`
      : 'NOT PROVIDED — no social/directory links supplied yet';

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

SCORE CATEGORIES CHECKED (seven scored signals + two identity signals):
Scored signals (contribute to the 100-point score):
1. AI Identity File (llms.txt): category score from scoreData
2. Structured Data (Schema markup): category score from scoreData
3. AI Crawler Access (robots.txt permissions): category score from scoreData
4. Security & Trust (HTTPS/HTTP 200): category score from scoreData
5. Search Signals (meta description): category score from scoreData
6. FAQ Schema: category score from scoreData
7. OpenGraph tags: category score from scoreData

Identity signals (not scored — presence/absence noted in report):
- Companies House verification: ${chLine}
- sameAs social/directory links: ${sameAsLine}

Advanced schema signals (Gemini-level — six checks):
- knowsAbout/DefinedTerm (topical authority): ${advSigs.knowsAbout ? 'PRESENT' : 'MISSING — AI cannot verify topical authority'}
- PriceSpecification (AI price comparison): ${advSigs.priceSpecification ? 'PRESENT' : 'MISSING — AI cannot extract pricing for comparison grids'}
- dateModified (freshness signal): ${advSigs.dateModified ? 'PRESENT' : 'MISSING — content may be deprioritised as stale'}
- sameAs multiple sources (entity verification): ${advSigs.sameAsMultiple ? 'PRESENT' : 'MISSING — insufficient cross-platform identity verification'}
- Review schema node (verifiable evidence): ${advSigs.reviewNode ? 'PRESENT' : 'MISSING — no structured social proof for AI engines'}

Advisory items (website fixes — not generated by Aenima): ${advisoryText}

Write the report in this exact structure:

## EXECUTIVE SUMMARY
2-3 sentences. State the score, what it means specifically for THIS business in THIS town, and the single most important thing holding them back — or confirming their strong position if score is 80+. Be direct.

## WHAT THIS MEANS FOR YOUR BUSINESS
Make it real and commercial. Describe the specific searches their customers are making right now — name the trade, the town, the type of query. Explain what happens when AI systems like ChatGPT, Perplexity or Google AI can or cannot identify them properly. Reference their actual situation.

## WHAT THE AUDIT FOUND
3-4 specific findings tied to their actual score data. Each finding should name the exact issue or strength, explain why it matters for AI visibility, and reference their specific business type and location.

## IDENTITY SIGNALS
Always include this short section. For Companies House: if present, confirm it strengthens AI trust. If not provided, state it is optional for non-limited companies but recommended if the business is incorporated — they can add it via technicalgraffiti.co.uk. For sameAs links: if present, confirm cross-platform identity is reinforced. If not provided, recommend adding Google Business Profile and LinkedIn URLs to their schema — this can be done via technicalgraffiti.co.uk.

## ADVANCED SIGNAL GAPS
If any of the six advanced signals are missing, include a concise section here. Name each missing signal, explain in one sentence what it does for AI visibility, and state the specific fix. Skip this section entirely if all six are present.

## ADVISORY ITEMS
If any of the following were flagged — meta description missing, FAQ schema missing, OpenGraph tags incomplete — include them here clearly labelled as ADVISORY. Explain each in one sentence. Then state: "These are website fixes rather than file generation issues. Your web developer or WordPress theme can address these, or Technical Graffiti can advise: technicalgraffiti.co.uk." Do not include these in Priority Actions.

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
