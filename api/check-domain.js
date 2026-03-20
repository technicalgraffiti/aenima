// api/check-domain.js
// Real domain technical checks for AI visibility
// Checks: HTTPS, Schema, llms.txt, robots.txt AI access, meta description

const https = require('https');
const http = require('http');

// Fetch a URL with timeout, return {status, body, error}
function fetchUrl(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AenimaBot/1.0; +https://aenima.co.uk)',
        'Accept': 'text/html,text/plain,*/*',
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.on('data', chunk => { if (body.length < 500000) body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, error: null }));
    });
    req.on('error', (err) => resolve({ status: 0, body: '', error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'Domain required' });

  // Normalise domain
  const raw = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
  if (!raw) return res.status(400).json({ error: 'Invalid domain' });

  const baseUrl = `https://${raw}`;
  const results = {};

  // ── CHECK 1: HTTPS ───────────────────────────────────────────────────────
  const httpsCheck = await fetchUrl(baseUrl);
  results.https = {
    pass: httpsCheck.status >= 200 && httpsCheck.status < 400,
    detail: httpsCheck.status > 0 ? `HTTP ${httpsCheck.status}` : `Not reachable (${httpsCheck.error || 'no response'})`,
    score: 0,
    max: 20,
  };
  results.https.score = results.https.pass ? 20 : 0;

  // ── CHECK 2: SCHEMA MARKUP ───────────────────────────────────────────────
  const homepageBody = httpsCheck.body || '';
  const hasSchema = homepageBody.includes('application/ld+json') || homepageBody.includes('itemtype') || homepageBody.includes('schema.org');
  const hasLocalBizSchema = homepageBody.includes('LocalBusiness') || homepageBody.includes('Organization') || homepageBody.includes('Person');
  results.schema = {
    pass: hasSchema,
    hasLocalBiz: hasLocalBizSchema,
    detail: hasSchema
      ? (hasLocalBizSchema ? 'Schema markup found — includes business type' : 'Schema markup found — no LocalBusiness type')
      : 'No Schema markup detected on homepage',
    score: hasSchema ? (hasLocalBizSchema ? 20 : 12) : 0,
    max: 20,
  };

  // ── CHECK 3: LLMS.TXT ────────────────────────────────────────────────────
  const llmsCheck = await fetchUrl(`${baseUrl}/llms.txt`);
  const llmsExists = llmsCheck.status === 200 && llmsCheck.body.length > 10;
  const llmsHasContent = llmsExists && (llmsCheck.body.includes('# ') || llmsCheck.body.includes('Description:') || llmsCheck.body.length > 100);
  results.llms = {
    pass: llmsExists,
    hasContent: llmsHasContent,
    detail: llmsExists
      ? (llmsHasContent ? 'llms.txt found and has content' : 'llms.txt found but appears empty')
      : `llms.txt not found (${llmsCheck.status > 0 ? 'HTTP ' + llmsCheck.status : 'not reachable'})`,
    score: llmsExists ? (llmsHasContent ? 20 : 10) : 0,
    max: 20,
  };

  // ── CHECK 4: ROBOTS.TXT AI ACCESS ───────────────────────────────────────
  const robotsCheck = await fetchUrl(`${baseUrl}/robots.txt`);
  const robotsBody = (robotsCheck.body || '').toLowerCase();
  const robotsExists = robotsCheck.status === 200;

  // Check if AI bots are explicitly blocked
  const blocksGPTBot = robotsBody.includes('gptbot') && (robotsBody.includes('disallow: /') || robotsBody.includes('disallow:/'));
  const blocksClaudeBot = robotsBody.includes('claudebot') && (robotsBody.includes('disallow: /') || robotsBody.includes('disallow:/'));
  const blocksPerplexity = robotsBody.includes('perplexitybot') && (robotsBody.includes('disallow: /') || robotsBody.includes('disallow:/'));
  const anyAiBlocked = blocksGPTBot || blocksClaudeBot || blocksPerplexity;

  // Check for wildcard block — must be exact 'disallow: /' not 'disallow: /something'
  const hasWildcardBlock = robotsBody.includes('user-agent: *') && 
    /disallow:\s*\/\s*(\r?\n|$)/m.test(robotsBody);

  results.robots = {
    pass: !anyAiBlocked && !hasWildcardBlock,
    blocksGPTBot,
    blocksClaudeBot,
    blocksPerplexity,
    hasWildcardBlock,
    robotsExists,
    detail: anyAiBlocked
      ? `AI crawlers blocked: ${[blocksGPTBot && 'GPTBot', blocksClaudeBot && 'ClaudeBot', blocksPerplexity && 'PerplexityBot'].filter(Boolean).join(', ')}`
      : hasWildcardBlock
        ? 'All crawlers blocked by wildcard rule — AI cannot access your site'
        : robotsExists
          ? 'AI crawlers permitted'
          : 'No robots.txt found — AI crawlers permitted by default',
    score: anyAiBlocked || hasWildcardBlock ? 0 : 20,
    max: 20,
  };

  // ── CHECK 5: META DESCRIPTION ────────────────────────────────────────────
  const metaMatch = homepageBody.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,})["']/i)
    || homepageBody.match(/<meta[^>]+content=["']([^"']{10,})["'][^>]+name=["']description["']/i);
  const metaDesc = metaMatch ? metaMatch[1] : null;
  const ogDesc = homepageBody.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,})["']/i);
  results.meta = {
    pass: !!(metaDesc || ogDesc),
    content: metaDesc || (ogDesc ? ogDesc[1] : null),
    detail: metaDesc
      ? `Meta description found (${metaDesc.length} characters)`
      : ogDesc
        ? 'Open Graph description found (no meta description)'
        : 'No meta description detected',
    score: metaDesc ? 20 : (ogDesc ? 10 : 0),
    max: 20,
  };

  // ── TOTAL SCORE ───────────────────────────────────────────────────────────
  const overall = results.https.score + results.schema.score + results.llms.score + results.robots.score + results.meta.score;

  // ── ISSUES LIST ───────────────────────────────────────────────────────────
  const issues = [];
  if (!results.https.pass) issues.push({ p: 'critical', t: 'Site not reachable over HTTPS — AI engines cannot access or trust your site', cta: true });
  if (!results.schema.pass) issues.push({ p: 'critical', t: 'No Schema markup — AI engines cannot identify your business type, location or services', cta: true });
  else if (!results.schema.hasLocalBiz) issues.push({ p: 'high', t: 'Schema present but no LocalBusiness type — AI cannot classify your business', cta: true });
  if (!results.llms.pass) issues.push({ p: 'critical', t: 'No llms.txt file — AI systems have no machine-readable summary of your business', cta: true });
  else if (!results.llms.hasContent) issues.push({ p: 'high', t: 'llms.txt found but appears empty — needs proper business content', cta: true });
  if (results.robots.blocksGPTBot) issues.push({ p: 'critical', t: 'GPTBot blocked in robots.txt — ChatGPT cannot crawl your site', cta: true });
  if (results.robots.blocksClaudeBot) issues.push({ p: 'critical', t: 'ClaudeBot blocked in robots.txt — Claude cannot crawl your site', cta: true });
  if (results.robots.blocksPerplexity) issues.push({ p: 'critical', t: 'PerplexityBot blocked in robots.txt — Perplexity cannot crawl your site', cta: true });
  if (results.robots.hasWildcardBlock) issues.push({ p: 'critical', t: 'All bots blocked by wildcard rule in robots.txt — no AI engine can access your site', cta: true });
  if (!results.meta.pass) issues.push({ p: 'high', t: 'No meta description — AI engines have no text summary of what your business does', cta: true });

  // ── CATEGORIES for display ────────────────────────────────────────────────
  const cats = {
    'AI Identity File':    { score: results.llms.score,   max: 20, detail: results.llms.detail },
    'Structured Data':     { score: results.schema.score, max: 20, detail: results.schema.detail },
    'AI Crawler Access':   { score: results.robots.score, max: 20, detail: results.robots.detail },
    'Security & Trust':    { score: results.https.score,  max: 20, detail: results.https.detail },
    'Search Signals':      { score: results.meta.score,   max: 20, detail: results.meta.detail },
  };

  res.status(200).json({
    domain: raw,
    overall,
    cats,
    issues,
    checks: results,
    ts: new Date().toISOString(),
  });
};
