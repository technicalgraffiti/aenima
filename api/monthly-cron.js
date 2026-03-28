const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_URL || 'https://aenima.co.uk';
const CHECK_URL = `${APP_URL}/api/check-domain`;

async function runScoreCheck(domain) {
  try {
    const resp = await fetch(CHECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain })
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch(e) {
    console.error(`Score check failed for ${domain}:`, e.message);
    return null;
  }
}

async function sendMonthlyReport(user, score, previousScore) {
  if (!RESEND_API_KEY || !user.email) return;

  const change = previousScore !== null ? score.overall - previousScore : null;
  const changeText = change === null ? '' : change > 0 ? `▲ Up ${change} points from last month` : change < 0 ? `▼ Down ${Math.abs(change)} points from last month` : '→ No change from last month';
  const changeColour = change > 0 ? '#1A8A40' : change < 0 ? '#CC2200' : '#777777';
  const changeBg = change > 0 ? '#E6F7ED' : change < 0 ? '#FFF0EE' : '#F5F5F5';

  const criticals = score.issues?.filter(i => i.p === 'critical') || [];
  const highs = score.issues?.filter(i => i.p === 'high') || [];
  const topIssue = criticals[0] || highs[0] || null;

  const scoreColour = score.overall < 30 ? '#CC2200' : score.overall < 55 ? '#CC6600' : '#1A8A40';
  const scoreLabel = score.overall < 30 ? 'Not visible to AI search' : score.overall < 55 ? 'Limited AI visibility' : score.overall < 80 ? 'Moderate visibility' : 'Good visibility';
  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const name = user.name || user.business || 'there';

  const catRows = score.cats ? Object.entries(score.cats).map(([catName, cat]) => {
    const pct = Math.round((cat.score / cat.max) * 100);
    const barColour = pct < 40 ? '#CC2200' : pct < 65 ? '#CC6600' : '#1A8A40';
    return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #F0F0F0">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:14px;color:#3D3D3D;font-weight:600;width:50%">${catName}</td>
            <td style="text-align:right;font-size:14px;font-weight:700;color:${barColour};width:50%">${cat.score}/${cat.max}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding-top:6px">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#EEEEEE;border-radius:4px;height:6px">
                    <table width="${pct}%" cellpadding="0" cellspacing="0"><tr><td style="background:${barColour};border-radius:4px;height:6px;display:block">&nbsp;</td></tr></table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }).join('') : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your AI Visibility Report — ${monthName}</title>
</head>
<body style="margin:0;padding:0;background:#F0EFed;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0EFed;padding:40px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- HEADER -->
  <tr><td style="background:#0A1628;border-radius:14px 14px 0 0;padding:36px 40px 32px">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:rgba(255,255,255,0.35)">Monthly AI Visibility Report · ${monthName}</p>
          <h1 style="margin:0 0 2px;font-size:32px;font-weight:800;color:#FFFFFF;letter-spacing:-0.04em;line-height:1">Aenima<span style="color:#F05A22">.</span></h1>
          <p style="margin:10px 0 0;font-size:15px;color:rgba(255,255,255,0.45)">${score.domain}</p>
        </td>
        <td align="right" valign="top">
          <div style="background:rgba(255,255,255,0.08);border-radius:10px;padding:14px 20px;text-align:center;display:inline-block">
            <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.35)">Score</p>
            <p style="margin:4px 0 0;font-size:42px;font-weight:800;color:${scoreColour};letter-spacing:-0.04em;line-height:1">${score.overall}</p>
            <p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,0.35)">/100</p>
          </div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- SCORE BAND -->
  <tr><td style="background:#FFFFFF;padding:28px 40px;border-left:1px solid #E8E8E8;border-right:1px solid #E8E8E8">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#0A1628;letter-spacing:-0.02em">Hi ${name},</p>
          <p style="margin:0;font-size:16px;color:#555555;line-height:1.6">Here's your AI visibility update for ${monthName}. Your domain scored <strong style="color:${scoreColour}">${score.overall}/100</strong> — ${scoreLabel.toLowerCase()}.</p>
        </td>
      </tr>
      ${change !== null ? `<tr><td style="padding-top:16px">
        <table cellpadding="0" cellspacing="0">
          <tr><td style="background:${changeBg};color:${changeColour};font-size:14px;font-weight:700;padding:8px 18px;border-radius:20px">${changeText}</td></tr>
        </table>
      </td></tr>` : ''}
    </table>
  </td></tr>

  <!-- PRIORITY ACTION -->
  <tr><td style="background:${topIssue ? '#FFFBF0' : '#F0FBF4'};border-left:4px solid ${topIssue ? '#CC6600' : '#1A8A40'};border-right:1px solid #E8E8E8;padding:24px 40px">
    <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${topIssue ? '#CC6600' : '#1A8A40'}">${topIssue ? "This month's priority action" : "All clear"}</p>
    <p style="margin:0;font-size:17px;font-weight:600;color:#1A1A1A;line-height:1.5">${topIssue ? topIssue.t : 'No critical issues found this month. Keep your files updated to maintain your position.'}</p>
  </td></tr>

  <!-- CATEGORY BREAKDOWN -->
  <tr><td style="background:#FFFFFF;padding:28px 40px;border-left:1px solid #E8E8E8;border-right:1px solid #E8E8E8">
    <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#AAAAAA">Category breakdown</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${catRows}
    </table>
  </td></tr>

  <!-- ISSUES -->
  <tr><td style="background:#FAFAFA;padding:24px 40px;border-left:1px solid #E8E8E8;border-right:1px solid #E8E8E8">
    <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#AAAAAA">Issues found (${score.issues?.length || 0})</p>
    ${score.issues?.length > 0 ? score.issues.slice(0,5).map(i => `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px">
      <tr>
        <td valign="top" style="width:90px;padding-top:1px">
          <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:${i.p==='critical'?'#FFF0EE':'#FFF8E6'};color:${i.p==='critical'?'#CC2200':'#CC6600'}">${i.p.toUpperCase()}</span>
        </td>
        <td style="font-size:15px;color:#3D3D3D;line-height:1.5;padding-left:8px">${i.t}</td>
      </tr>
    </table>`).join('') : '<p style="margin:0;font-size:15px;color:#1A8A40;font-weight:600">✓ No issues found this month</p>'}
  </td></tr>

  <!-- ADVANCED SIGNALS ADVISORY -->
  ${score.advisory?.length ? `
  <tr><td style="background:#F8F4FF;border-left:4px solid #7B5EA7;border-right:1px solid #E8E8E8;padding:24px 40px">
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7B5EA7">Advanced signal improvements</p>
    <p style="margin:0 0 12px;font-size:14px;color:#555555;line-height:1.6">These are not scoring issues — your baseline is solid. These are the next-level signals that separate a visible business from a confidently recommended one:</p>
    ${score.advisory.map(a => `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px">
      <tr>
        <td valign="top" style="width:80px;padding-top:1px">
          <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:#EDE8F7;color:#7B5EA7">ADVISORY</span>
        </td>
        <td style="font-size:14px;color:#3D3D3D;line-height:1.5;padding-left:8px">${a.t}</td>
      </tr>
    </table>`).join('')}
  </td></tr>` : ''}

  <!-- CTA -->
  <tr><td style="background:#FFFFFF;padding:32px 40px;border-left:1px solid #E8E8E8;border-right:1px solid #E8E8E8;text-align:center">
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0A1628;letter-spacing:-0.01em">Your updated visibility files are ready.</p>
    <p style="margin:0 0 24px;font-size:15px;color:#777777">Log in to your dashboard to download and install them.</p>
    <a href="${APP_URL}" style="display:inline-block;background:#F05A22;color:#FFFFFF;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:16px;font-weight:800;letter-spacing:-0.02em">Open my dashboard →</a>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#0A1628;border-radius:0 0 14px 14px;padding:24px 40px;text-align:center">
    <p style="margin:0 0 4px;font-size:13px;color:rgba(255,255,255,0.3)">Aenima · AI Visibility for local businesses</p>
    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.2)">Powered by <a href="https://technicalgraffiti.co.uk" style="color:rgba(255,255,255,0.3);text-decoration:none">Technical Graffiti Ltd</a> · Company No. 07180346</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Aenima <ai@aenima.co.uk>',
        to: user.email,
        subject: `Your AI visibility report — ${monthName} · ${score.overall}/100`,
        html
      })
    });
    console.log(`Report sent: ${user.email}`);
  } catch(e) {
    console.error(`Email failed for ${user.email}:`, e.message);
  }
}

module.exports = async (req, res) => {
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers["x-vercel-cron"] === "1";
  const isManual = authHeader === `Bearer ${cronSecret}`;
  if (cronSecret && !isVercelCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  console.log('Monthly cron started');

  const { data: users, error } = await SB
    .from('users')
    .select('id, email, name, business, website, plan')
    .in('plan', ['starter', 'pro', 'agency'])
    .not('website', 'is', null);

  if (error) {
    console.error('Failed to fetch users:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }

  console.log(`Processing ${users.length} paid users`);
  const results = [];

  for (const user of users) {
    try {
      const domain = user.website
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0]
        .trim();

      if (!domain) continue;

      const { data: prevScores } = await SB
        .from('scores')
        .select('score')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(2);

      const previousScore = prevScores?.[1]?.score ?? null;

      const score = await runScoreCheck(domain);
      if (!score) { console.warn(`Score check failed for ${domain}`); continue; }

      await SB.from('scores').insert({
        user_id: user.id,
        url: domain,
        score: score.overall,
        results: { cats: score.cats, issues: score.issues },
        created_at: new Date().toISOString()
      });

      await sendMonthlyReport(user, score, previousScore);
      results.push({ email: user.email, domain, score: score.overall });

    } catch(e) {
      console.error(`Error processing ${user.email}:`, e.message);
    }
  }

  console.log(`Monthly cron complete — processed ${results.length} users`);
  res.status(200).json({ processed: results.length, results });
};
