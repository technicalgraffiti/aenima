// api/check-domain.js
// Real domain technical checks for AI visibility
// Checks: HTTPS, Schema, llms.txt, robots.txt AI access, meta description, Companies House, sameAs authority, FAQ schema, OpenGraph

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

// ── SAMEAS AUTHORITY CLASSIFIER ──────────────────────────────────────────────
// Classifies each sameAs URL by authority tier
// Returns { tiers, hasHighAuthority, missingHighAuthority, classified }

function classifySameAsAuthority(urls) {
  const tiers = {
    government:   { label: 'Government registry',   urls: [] },
    knowledge:    { label: 'Knowledge graph',        urls: [] },
    professional: { label: 'Professional network',   urls: [] },
    directory:    { label: 'Established directory',  urls: [] },
    social:       { label: 'Social media',           urls: [] },
    other:        { label: 'Other',                  urls: [] },
  };

  const patterns = {
    government:   [/company-information\.service\.gov\.uk/, /find-and-update\.company-information/],
    knowledge:    [/wikidata\.org/, /dbpedia\.org/],
    professional: [/linkedin\.com\/company\//],
    directory:    [/yell\.com/, /google\.com\/maps/, /maps\.google/, /g\.page/, /yelp\.co/, /tripadvisor\.co/, /checkatrade\.com/, /ratedpeople\.com/, /trustpilot\.com/],
    social:       [/facebook\.com/, /twitter\.com/, /x\.com/, /instagram\.com/, /tiktok\.com/, /youtube\.com/],
  };

  for (const url of urls) {
    let matched = false;
    for (const [tier, pats] of Object.entries(patterns)) {
      if (pats.some(p => p.test(url))) {
        tiers[tier].urls.push(url);
        matched = true;
        break;
      }
    }
    if (!matched) tiers.other.urls.push(url);
  }

  const hasGovernment   = tiers.government.urls.length > 0;
  const hasProfessional = tiers.professional.urls.length > 0;
  const hasKnowledge    = tiers.knowledge.urls.length > 0;
  const hasHighAuthority = hasGovernment || hasProfessional || hasKnowledge;

  // LinkedIn personal profile check — /in/ not /company/
  const hasLinkedInPersonal = urls.some(u => /linkedin\.com\/in\//.test(u));
  const hasLinkedInCompany  = tiers.professional.urls.length > 0;

  const missing = [];
  if (!hasGovernment)   missing.push('Companies House (UK government registry)');
  if (!hasProfessional) missing.push('LinkedIn company page');
  if (!hasKnowledge)    missing.push('Wikidata knowledge graph entry');

  return {
    tiers,
    hasHighAuthority,
    hasGovernment,
    hasProfessional,
    hasKnowledge,
    hasLinkedInPersonal,
    hasLinkedInCompany,
    missing,
    totalUrls: urls.length,
  };
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

  // ── CHECK 6: FAQ SCHEMA ──────────────────────────────────────────────────
  // FAQPage schema makes your answers available directly in AI responses
  const hasFaqSchema = homepageBody.includes('"FAQPage"') ||
    homepageBody.includes("'FAQPage'") ||
    homepageBody.includes('@type":"FAQPage') ||
    homepageBody.includes('@type\': \'FAQPage');
  const hasFaqQuestions = homepageBody.includes('"Question"') ||
    homepageBody.includes('@type":"Question');
  results.faq = {
    pass: hasFaqSchema,
    hasQuestions: hasFaqQuestions,
    detail: hasFaqSchema
      ? (hasFaqQuestions ? 'FAQPage schema found with Question nodes' : 'FAQPage schema found but no Question nodes detected')
      : 'No FAQPage schema — AI engines cannot pull your answers directly into search responses',
    score: hasFaqSchema ? (hasFaqQuestions ? 10 : 5) : 0,
    max: 10,
  };

  // ── CHECK 7: OPENGRAPH TAGS ──────────────────────────────────────────────
  // OpenGraph controls what appears when your site is shared on LinkedIn, WhatsApp etc
  const ogTitle = homepageBody.match(/<meta[^>]+property=["']?og:title["']?[^>]+content=["']?([^"'>]{3,})["']?/i);
  const ogImage = homepageBody.match(/<meta[^>]+property=["']?og:image["']?[^>]+content=["']?([^"'>]{3,})["']?/i);
  const ogType  = homepageBody.match(/<meta[^>]+property=["']?og:type["']?/i);
  const ogUrl   = homepageBody.match(/<meta[^>]+property=["']?og:url["']?/i);
  const ogCount = [ogTitle, ogImage, ogDesc, ogType, ogUrl].filter(Boolean).length;
  const ogPass  = !!(ogTitle && ogImage && ogDesc);
  results.og = {
    pass: ogPass,
    hasTitle:  !!ogTitle,
    hasImage:  !!ogImage,
    hasDesc:   !!ogDesc,
    hasType:   !!ogType,
    hasUrl:    !!ogUrl,
    count:     ogCount,
    detail: ogPass
      ? `OpenGraph tags complete — title, image and description present`
      : `OpenGraph tags incomplete — missing: ${[!ogTitle && 'title', !ogImage && 'image', !ogDesc && 'description'].filter(Boolean).join(', ')}`,
    score: ogPass ? 10 : (ogCount >= 2 ? 5 : 0),
    max: 10,
  };

  // ── CHECK 8: COMPANIES HOUSE VERIFICATION ────────────────────────────────
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

  // ── CHECK 7: SAMEAS AUTHORITY CLASSIFICATION ─────────────────────────────
  const sameAsAuthority = classifySameAsAuthority(sameAsUrls);
  results.sameAsAuthority = sameAsAuthority;

  // ── TOTAL SCORE ───────────────────────────────────────────────────────────
  // ── IDENTITY SIGNAL SCORES (advisory-weighted — 5pts each) ─────────────
  // CH: active confirmed = 5, URL present but unverified = 2, missing = 0
  const chScore = (chResult.urlPresent && chResult.active) ? 5
    : chResult.urlPresent ? 2
    : 0;

  // sameAs: high authority present = 5, low authority only = 2, none = 0
  const sameAsScore = sameAsAuthority.hasHighAuthority ? 5
    : sameAsUrls.length > 0 ? 2
    : 0;

  // Raw total out of 130, scaled to 100
  const rawTotal = results.https.score + results.schema.score + results.llms.score + results.robots.score + results.meta.score + results.faq.score + results.og.score + chScore + sameAsScore;
  const overall = Math.min(100, Math.round(rawTotal * 100 / 130));

  // ── ISSUES LIST ───────────────────────────────────────────────────────────
  const issues = [];
  if (!results.https.pass) issues.push({ p: 'critical', t: 'Your site is not loading securely — AI engines will not trust or index a site without HTTPS. You need an SSL certificate.', cta: true });
  if (!results.schema.pass) issues.push({ p: 'critical', t: 'No Schema markup found — this is the file that tells AI engines who you are, what you do, and where you are. Without it, AI search ignores your business entirely.', cta: true });
  else if (!results.schema.hasLocalBiz) issues.push({ p: 'high', t: 'You have some Schema markup but it does not identify you as a local business — AI engines cannot classify what type of business you are or where you operate.', cta: true });
  if (!results.llms.pass) issues.push({ p: 'critical', t: 'No llms.txt file found — this is a plain text summary of your business written specifically for AI systems like ChatGPT and Gemini. Without it, AI has nothing reliable to read about you.', cta: true });
  else if (!results.llms.hasContent) issues.push({ p: 'high', t: 'You have an llms.txt file but it appears to be empty — AI systems cannot use a blank file. It needs your business description, services and location.', cta: true });
  if (results.robots.blocksGPTBot) issues.push({ p: 'critical', t: 'Your website is actively blocking ChatGPT from reading your pages — this means ChatGPT cannot include your business in any AI-generated results.', cta: true });
  if (results.robots.blocksClaudeBot) issues.push({ p: 'critical', t: 'Your website is actively blocking Claude (Anthropic) from reading your pages — AI-powered tools using Claude will not know your business exists.', cta: true });
  if (results.robots.blocksPerplexity) issues.push({ p: 'critical', t: 'Your website is actively blocking Perplexity from reading your pages — Perplexity AI search will not include your business in results.', cta: true });
  if (results.robots.hasWildcardBlock) issues.push({ p: 'critical', t: 'Your robots.txt file is blocking all automated systems from your site — this includes every AI search engine. No AI tool can read or recommend your business.', cta: true });
  if (!results.meta.pass) issues.push({ p: 'high', t: 'No meta description found — this is the short sentence that describes your business in search results and AI summaries. Without it, AI engines have nothing to quote about you.', cta: true });
  if (!results.faq.pass) issues.push({ p: 'high', t: 'No FAQ Schema found — when someone asks an AI a question your business could answer, FAQ schema is what makes your business the source the AI quotes. You are missing every opportunity to be the answer.', cta: true });
  if (!results.og.pass) issues.push({ p: 'high', t: `Your social sharing tags are incomplete — when someone shares your website on LinkedIn or WhatsApp, the preview appears broken or blank. Missing: ${[!results.og.hasTitle && 'page title', !results.og.hasImage && 'preview image', !results.og.hasDesc && 'description'].filter(Boolean).join(', ')}.`, cta: true });

  // Companies House issues
  if (!chResult.urlPresent) {
    issues.push({ p: 'advisory', t: 'No Companies House link in your schema — adding your official UK government registration URL tells AI engines your business is verified and real. Without it, AI has no way to confirm you are a legitimate registered company.', cta: true });
  } else if (chResult.checked && !chResult.active) {
    issues.push({ p: 'critical', t: `Companies House check failed — ${chResult.detail}`, cta: true });
  }

  // sameAs authority issues
  if (sameAsUrls.length === 0) {
    issues.push({ p: 'advisory', t: 'No business profile links in your schema — AI engines verify your business is real by cross-referencing it against trusted sources like LinkedIn, Google Business Profile and Companies House. You have none of these linked, so AI cannot confirm your identity.', cta: true });
  } else if (!sameAsAuthority.hasHighAuthority) {
    issues.push({ p: 'advisory', t: `Your schema links to some business profiles but they are low-authority sources — AI engines need links to trusted platforms like LinkedIn, Google Business Profile or government registries to fully trust your business identity. You are missing: ${sameAsAuthority.missing.join(', ')}.`, cta: true });
  } else if (sameAsAuthority.missing.length > 0) {
    issues.push({ p: 'advisory', t: `Your schema includes some business profile links but is missing the most trusted ones — adding LinkedIn, Google Business Profile or your Companies House record would significantly strengthen how AI engines verify your business. Missing: ${sameAsAuthority.missing.join(', ')}.`, cta: true });
  }

  // LinkedIn personal profile warning
  if (sameAsAuthority.hasLinkedInPersonal && !sameAsAuthority.hasLinkedInCompany) {
    issues.push({ p: 'high', t: 'Your schema links to a personal LinkedIn profile rather than a LinkedIn company page — AI engines treat these very differently. A personal profile does not verify your business. You need a LinkedIn company page URL.', avail: 'Complete package', cta: true });
  }

  // ── UNVERIFIABLE CHECKS — Extended tier deliverables ─────────────────────
  issues.push({ p: 'advisory', t: 'Your business name, address and phone number could not be verified across the web. Inconsistent business details across directories, Google and your website is one of the most common reasons AI engines lose confidence in a local business. A full NAP consistency report shows exactly where your details are wrong and what to fix.', avail: 'Extended & Complete packages', cta: true });
  issues.push({ p: 'advisory', t: 'We cannot tell from your website what ChatGPT says about your business when someone asks for recommendations in your area. Most businesses are invisible — or described incorrectly. A live ChatGPT visibility check shows exactly what AI says about you right now.', avail: 'Extended & Complete packages', cta: true });
  issues.push({ p: 'advisory', t: 'We cannot tell from your website what Google Gemini says about your business when someone searches for services like yours. A live Gemini visibility check shows exactly what Google\'s AI says about you right now.', avail: 'Extended & Complete packages', cta: true });

  // ── UNVERIFIABLE CHECKS — Complete tier deliverables ─────────────────────
  issues.push({ p: 'advisory', t: 'We cannot confirm whether your Google Business Profile is optimised for AI search. Google Gemini pulls directly from GBP when recommending local businesses — if your profile is incomplete or missing, you will not appear. Professionally written GBP copy, ready to apply immediately, is included.', avail: 'Complete package', cta: true });

  // LinkedIn — complete tier
  if (sameAsAuthority.hasLinkedInCompany) {
    issues.push({ p: 'advisory', t: 'Your LinkedIn company page is linked but we cannot verify the content is optimised for AI search. Professionally written LinkedIn About copy positions your business correctly for AI recommendations.', avail: 'Complete package', cta: true });
  } else {
    issues.push({ p: 'advisory', t: 'We could not find a LinkedIn company page linked to your website. AI engines use LinkedIn company pages as a trust signal to verify your business is legitimate and active. Professionally written LinkedIn About copy positions your business correctly for AI recommendations.', avail: 'Complete package', cta: true });
  }

  // Facebook — complete tier
  if (sameAsAuthority.tiers.social.urls.some(u => /facebook\.com/.test(u))) {
    issues.push({ p: 'advisory', t: 'Your Facebook business page is linked but we cannot verify the content is optimised for AI trust signals. Professionally written Facebook page copy strengthens your business identity across AI platforms.', avail: 'Complete package', cta: true });
  } else {
    issues.push({ p: 'advisory', t: 'We could not find a Facebook business page linked to your website. AI engines cross-reference your business across social platforms to confirm your identity. Professionally written Facebook page copy optimised for AI trust signals is included.', avail: 'Complete package', cta: true });
  }

  issues.push({ p: 'advisory', t: 'Your homepage meta title and description could not be assessed for AI optimisation quality. A well-written meta description is one of the first things AI engines read to understand your business. Professionally written homepage meta copy, optimised for both search and AI, is included.', avail: 'Complete package', cta: true });

  // ── ADVISORY ISSUES (advanced signals — Gemini-level optimisation) ────────
  const advisory = [];
  if(results.schema.pass && !hasKnowsAbout)
    advisory.push({ p: 'advisory', t: 'Your schema does not list your specialist services — AI engines cannot verify what you are an expert in. Adding your key services as structured data makes you the authority AI quotes for those topics.' });
  if(results.schema.pass && !hasPriceSpec)
    advisory.push({ p: 'advisory', t: 'No pricing information in your schema — AI comparison tools cannot show your prices when people ask. Adding your price range as structured data puts you in front of customers at the moment they are ready to buy.' });
  if(results.schema.pass && !hasDateModified)
    advisory.push({ p: 'advisory', t: 'Your schema has no last updated date — AI engines may treat your content as old or unreliable. Adding a date tells AI systems your information is current and worth recommending.' });
  if(results.schema.pass && !hasSameAsMultiple)
    advisory.push({ p: 'advisory', t: 'Your business profile links are weak or missing — AI engines verify your business is real by checking it against trusted sources like Google Business Profile, Companies House and LinkedIn. The more verified sources you link to, the more AI trusts and recommends you.' });
  if(results.schema.pass && !hasReviewNode)
    advisory.push({ p: 'advisory', t: 'No reviews in your schema — AI recommendation engines trust businesses with verified customer feedback. Adding even one structured review to your schema makes you significantly more likely to be recommended.' });

  // ── CATEGORIES for display ────────────────────────────────────────────────
  const cats = {
    'AI Identity File':    { score: results.llms.score,   max: 20, detail: results.llms.detail },
    'Structured Data':     { score: results.schema.score, max: 20, detail: results.schema.detail },
    'AI Crawler Access':   { score: results.robots.score, max: 20, detail: results.robots.detail },
    'Security & Trust':    { score: results.https.score,  max: 20, detail: results.https.detail },
    'Search Signals':      { score: results.meta.score,   max: 20, detail: results.meta.detail },
    'FAQ Schema':          { score: results.faq.score,    max: 10, detail: results.faq.detail },
    'Social Sharing':      { score: results.og.score,     max: 10, detail: results.og.detail },
    'Companies House':     { score: chScore,   max: 5,  detail: chResult.urlPresent ? (chResult.active ? 'Verified and active' : 'URL present — not verified active') : 'No Companies House URL in schema' },
    'Identity Signals':    { score: sameAsScore, max: 5, detail: sameAsUrls.length > 0 ? (sameAsAuthority.hasHighAuthority ? 'High-authority sameAs links present' : 'Low-authority sameAs links only') : 'No sameAs links in schema' },
  };

  res.status(200).json({
    domain: raw,
    overall,
    cats,
    issues,
    advisory,
    checks: results,
    companiesHouse: chResult,
    sameAsAuthority,
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
