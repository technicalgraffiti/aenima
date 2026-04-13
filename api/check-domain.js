// api/check-domain.js
// Real domain technical checks for AI visibility
// Checks: HTTPS, Schema, llms.txt, robots.txt AI access, meta description, Companies House

const https = require('https');
const http = require('http');

// Fetch a URL with timeout, follow redirects, return {status, body, error}
function fetchUrl(url, timeoutMs = 15000, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 3) return resolve({ status: 0, body: '', error: 'too many redirects' });
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AenimaBot/1.0; +https://aenima.co.uk)',
        'Accept': 'text/html,text/plain,*/*',
      },
      timeout: timeoutMs,
    }, (res) => {
      // Follow 301/302/307/308 redirects
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        let location = res.headers.location;
        // Handle relative redirects
        if (location.startsWith('/')) {
          const parsed = new URL(url);
          location = `${parsed.protocol}//${parsed.host}${location}`;
        }
        res.resume(); // discard body
        resolve(fetchUrl(location, timeoutMs, redirectCount + 1));
        return;
      }
      let body = '';
      res.on('data', chunk => { if (body.length < 500000) body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, error: null }));
    });
    req.on('error', (err) => resolve({ status: 0, body: '', error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

// ── COMPANIES HOUSE HELPERS ───────────────────────────────────────────────────

// Extract all sameAs URLs from JSON-LD blocks in the page HTML
function extractSameAsUrls(html) {
  const urls = [];
  const scriptRe = /<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(html)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      // Handle both single object and @graph array
      const nodes = obj['@graph'] ? obj['@graph'] : [obj];
      for (const node of nodes) {
        if (node.sameAs) {
          const sa = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
          for (const u of sa) {
            if (typeof u === 'string') urls.push(u);
          }
        }
      }
    } catch (e) {
      // Ignore malformed JSON-LD blocks
    }
  }
  return urls;
}

// Extract company number from a Companies House URL
// Handles: find-and-update.company-information.service.gov.uk/company/12345678
function extractCompanyNumber(url) {
  const match = url.match(/company-information\.service\.gov\.uk\/company\/([A-Z0-9]{8})/i);
  return match ? match[1].toUpperCase() : null;
}

// Call Companies House API and return company data
function fetchCompaniesHouse(companyNumber) {
  return new Promise((resolve) => {
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) return resolve({ error: 'no_api_key' });

    // CH API uses HTTP Basic Auth — API key as username, empty password
    const auth = Buffer.from(`${apiKey}:`).toString('base64');
    const options = {
      hostname: 'api.company-information.service.gov.uk',
      path: `/company/${companyNumber}`,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
      timeout: 8000,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve({ data: JSON.parse(body), error: null });
          } catch (e) {
            resolve({ error: 'parse_error' });
          }
        } else if (res.statusCode === 404) {
          resolve({ error: 'not_found' });
        } else {
          resolve({ error: `http_${res.statusCode}` });
        }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

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

  // ── PRE-CHECK: DOMAIN EXISTS ─────────────────────────────────────────────
  const domainCheck = await fetchUrl(baseUrl, 8000);
  if (domainCheck.status === 0) {
    const httpFallback = await fetchUrl(`http://${raw}`, 8000);
    if (httpFallback.status === 0) {
      return res.status(200).json({
        domain: raw,
        overall: 0,
        error: 'domain_not_found',
        errorMessage: `The domain "${raw}" does not exist or is not reachable. Please check the URL and try again.`,
        cats: {},
        issues: [{ p: 'critical', t: `Domain not found — "${raw}" could not be reached. Check the URL is correct.`, cta: false }],
        checks: {},
        ts: new Date().toISOString(),
      });
    }
  }

  // ── CHECK 1: HTTPS ───────────────────────────────────────────────────────
  const httpsCheck = domainCheck.status > 0 ? domainCheck : await fetchUrl(baseUrl);
  results.https = {
    pass: httpsCheck.status >= 200 && httpsCheck.status < 400,
    detail: httpsCheck.status > 0 ? `HTTP ${httpsCheck.status}` : `Not reachable (${httpsCheck.error || 'no response'})`,
    score: 0,
    max: 20,
  };
  results.https.score = results.https.pass ? 20 : 0;

  // ── CHECK 2: SCHEMA MARKUP ───────────────────────────────────────────────
  const homepageBody = httpsCheck.body || '';
  const hasSchema = homepageBody.includes('application/ld+json') || 
    homepageBody.includes('application\/ld+json') ||
    homepageBody.includes('itemtype') || 
    homepageBody.includes('schema.org');
  const hasLocalBizSchema = homepageBody.includes('LocalBusiness') || 
    homepageBody.includes('Organization') || 
    homepageBody.includes('ProfessionalService') ||
    homepageBody.includes('Person');
  results.schema = {
    pass: hasSchema,
    hasLocalBiz: hasLocalBizSchema,
    detail: hasSchema
      ? (hasLocalBizSchema ? 'Schema markup found — includes business type' : 'Schema markup found — no LocalBusiness type')
      : 'No Schema markup detected on homepage',
    score: hasSchema ? (hasLocalBizSchema ? 20 : 12) : 0,
    max: 20,
  };

  // ── ADVANCED SCHEMA SIGNALS (advisory — not scored, but flagged) ───────────
  const hasKnowsAbout = homepageBody.includes('knowsAbout') || homepageBody.includes('DefinedTerm');
  const hasPriceSpec = homepageBody.includes('PriceSpecification') || homepageBody.includes('minPrice');
  const hasDateModified = homepageBody.includes('dateModified');
  const hasSameAs = (homepageBody.match(/"sameAs"/g) || []).length >= 1;
  const hasSameAsMultiple = (homepageBody.match(/"sameAs"/g) || []).length >= 2 ||
    (homepageBody.match(/sameAs.*\[/g) || []).length >= 1;
  const hasReviewNode = homepageBody.includes('"Review"') || homepageBody.includes('@type":"Review');

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

  function isBotBlocked(body, botName) {
    const lines = body.split('\n');
    let inBotBlock = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('user-agent:')) {
        inBotBlock = trimmed.includes(botName);
      }
      if (inBotBlock && trimmed.startsWith('disallow:')) {
        const path = trimmed.replace('disallow:', '').trim();
        if (path === '/' || path === '') return true;
      }
    }
    return false;
  }
  const blocksGPTBot = isBotBlocked(robotsBody, 'gptbot');
  const blocksClaudeBot = isBotBlocked(robotsBody, 'claudebot');
  const blocksPerplexity = isBotBlocked(robotsBody, 'perplexitybot');
  const anyAiBlocked = blocksGPTBot || blocksClaudeBot || blocksPerplexity;

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
  const metaMatch = homepageBody.match(/<meta[^>]+name=["']?description["']?[^>]+content=["']?([^"'>\s][^"'>]{9,})["']?/i)
    || homepageBody.match(/<meta[^>]+content=["']?([^"'>\s][^"'>]{9,})["']?[^>]+name=["']?description["']?/i);
  const metaDesc = metaMatch ? metaMatch[1] : null;
  const ogDesc = homepageBody.match(/<meta[^>]+property=["']?og:description["']?[^>]+content=["']?([^"'>\s][^"'>]{9,})["']?/i);
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

  // ── CHECK 6: COMPANIES HOUSE VERIFICATION ────────────────────────────────
  // Extract sameAs URLs from JSON-LD, look for a Companies House URL,
  // call the CH API to confirm active status and name match
  const sameAsUrls = extractSameAsUrls(homepageBody);
  const chUrl = sameAsUrls.find(u => u.includes('company-information.service.gov.uk/company/'));
  const companyNumber = chUrl ? extractCompanyNumber(chUrl) : null;

  let chResult = {
    checked: false,
    companyNumber: null,
    companyName: null,
    status: null,
    active: false,
    urlPresent: !!chUrl,
    detail: '',
    error: null,
  };

  if (companyNumber) {
    const chResponse = await fetchCompaniesHouse(companyNumber);
    if (chResponse.error) {
      chResult = {
        checked: true,
        companyNumber,
        urlPresent: true,
        active: false,
        detail: chResponse.error === 'not_found'
          ? `Company number ${companyNumber} not found at Companies House — check the URL is correct`
          : `Companies House check could not complete — ${chResponse.error}`,
        error: chResponse.error,
      };
    } else {
      const company = chResponse.data;
      const isActive = company.company_status === 'active';
      chResult = {
        checked: true,
        companyNumber,
        companyName: company.company_name || null,
        status: company.company_status || null,
        active: isActive,
        urlPresent: true,
        detail: isActive
          ? `Companies House confirmed — ${company.company_name} is active`
          : `Companies House found — ${company.company_name} status is "${company.company_status}" — not active`,
        error: null,
      };
    }
  } else if (chUrl) {
    // URL present but company number could not be extracted
    chResult.detail = 'Companies House URL found but company number could not be read — check the URL format';
    chResult.checked = true;
    chResult.error = 'bad_url_format';
  } else {
    // No CH URL in sameAs at all
    chResult.detail = 'No Companies House URL in schema sameAs — add your Companies House record to confirm your business is real and registered';
  }

  results.companiesHouse = chResult;

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

  // Companies House issues
  if (!chResult.urlPresent) {
    issues.push({ p: 'high', t: 'No Companies House URL in schema — add your UK government registration record to confirm your business is real to AI engines', cta: true });
  } else if (chResult.checked && !chResult.active) {
    issues.push({ p: 'critical', t: `Companies House check failed — ${chResult.detail}`, cta: true });
  }

  // ── ADVISORY ISSUES (advanced signals — Gemini-level optimisation) ────────
  const advisory = [];
  if(results.schema.pass && !hasKnowsAbout)
    advisory.push({ p: 'advisory', t: 'No knowsAbout/DefinedTerm in schema — AI engines cannot verify your topical authority. Add knowsAbout with DefinedTerm nodes for your key services.' });
  if(results.schema.pass && !hasPriceSpec)
    advisory.push({ p: 'advisory', t: 'No PriceSpecification in schema — AI comparison tools cannot extract your pricing. Add minPrice and maxPrice to each service offer.' });
  if(results.schema.pass && !hasDateModified)
    advisory.push({ p: 'advisory', t: 'No dateModified in schema — AI engines may deprioritise content without a freshness signal. Add dateModified to your schema.' });
  if(results.schema.pass && !hasSameAsMultiple)
    advisory.push({ p: 'advisory', t: 'Weak sameAs signals — AI engines verify identity by cross-referencing multiple sources. Add sameAs links to Google Business Profile, Companies House, and directory listings.' });
  if(results.schema.pass && !hasReviewNode)
    advisory.push({ p: 'advisory', t: 'No Review schema node — adding a verifiable review or testimonial as structured data increases AI recommendation confidence.' });

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
    advisory,
    checks: results,
    companiesHouse: chResult,
    advancedSignals: {
      knowsAbout: hasKnowsAbout,
      priceSpecification: hasPriceSpec,
      dateModified: hasDateModified,
      sameAsMultiple: hasSameAsMultiple,
      reviewNode: hasReviewNode,
    },
    ts: new Date().toISOString(),
  });
};
