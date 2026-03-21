// api/monthly-cron.js
// Monthly cron job — reruns score checks for all paid users, sends reports via Resend

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

  const change = previousScore ? score.overall - previousScore : null;
  const changeText = change === null ? '' : change > 0 ? `▲ Up ${change} points` : change < 0 ? `▼ Down ${Math.abs(change)} points` : '→ No change';
  const changeColour = change > 0 ? '#1A8A40' : change < 0 ? '#CC2200' : '#777777';

  // Find top priority issue
  const criticals = score.issues?.filter(i => i.p === 'critical') || [];
  const highs = score.issues?.filter(i => i.p === 'high') || [];
  const topIssue = criticals[0] || highs[0] || null;

  // Score colour
  const scoreColour = score.overall < 30 ? '#CC2200' : score.overall < 55 ? '#CC6600' : '#1A8A40';
  const scoreLabel = score.overall < 30 ? 'Not visible to AI search' : score.overall < 55 ? 'Limited AI visibility' : score.overall < 80 ? 'Moderate visibility' : 'Good visibility';

  const monthName = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8F7F5;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">

  <!-- Header -->
  <div style="background:#0A1628;border-radius:12px 12px 0 0;padding:32px;margin-bottom:0">
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.4)">Monthly AI Visibility Report</p>
    <h1 style="margin:0;font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.03em">Aenima<span style="color:#F05A22">.</span></h1>
    <p style="margin:8px 0 0;font-size:15px;color:rgba(255,255,255,0.5)">${monthName} · ${score.domain}</p>
  </div>

  <!-- Score -->
  <div style="background:#FFFFFF;border-left:1.5px solid #E5E5E5;border-right:1.5px solid #E5E5E5;padding:32px;text-align:center">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#777">Your score this month</p>
    <div style="font-size:88px;font-weight:800;color:${scoreColour};line-height:1;letter-spacing:-0.04em;margin-bottom:4px">${score.overall}</div>
    <div style="font-size:18px;color:#777;margin-bottom:8px">/100 — ${scoreLabel}</div>
    ${change !== null ? `<div style="display:inline-block;background:${changeColour}20;color:${changeColour};font-size:14px;font-weight:700;padding:4px 14px;border-radius:20px">${changeText} from last month</div>` : ''}
  </div>

  <!-- Priority Action -->
  ${topIssue ? `
  <div style="background:#FFF8E6;border-left:4px solid #CC6600;border-right:1.5px solid #E5E5E5;padding:24px 28px">
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#CC6600">This month's priority action</p>
    <p style="margin:0;font-size:17px;color:#1A1A1A;line-height:1.5">${topIssue.t}</p>
  </div>` : `
  <div style="background:#E6F7ED;border-left:4px solid #1A8A40;border-right:1.5px solid #E5E5E5;padding:24px 28px">
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#1A8A40">Great news</p>
    <p style="margin:0;font-size:17px;color:#1A1A1A;line-height:1.5">No critical issues found this month. Keep your files updated to maintain your visibility.</p>
  </div>`}

  <!-- Issues summary -->
  <div style="background:#FFFFFF;border-left:1.5px solid #E5E5E5;border-right:1.5px solid #E5E5E5;padding:28px">
    <p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#777">Issues found (${score.issues?.length || 0})</p>
    ${score.issues?.length > 0 ? score.issues.slice(0,4).map(i => `
    <div style="display:flex;gap:12px;margin-bottom:10px;align-items:flex-start">
      <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;background:${i.p==='critical'?'#FFF0EE':'#FFF8E6'};color:${i.p==='critical'?'#CC2200':'#CC6600'}">${i.p.toUpperCase()}</span>
      <span style="font-size:15px;color:#3D3D3D;line-height:1.5">${i.t}</span>
    </div>`).join('') : '<p style="margin:0;font-size:15px;color:#1A8A40;font-weight:600">✓ No issues found</p>'}
  </div>

  <!-- CTA -->
  <div style="background:#FFFFFF;border:1.5px solid #E5E5E5;border-top:none;border-radius:0 0 12px 12px;padding:28px;text-align:center">
    <p style="margin:0 0 20px;font-size:16px;color:#3D3D3D">Your updated visibility files are ready in your dashboard.</p>
    <a href="${APP_URL}" style="display:inline-block;background:#F05A22;color:#FFFFFF;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:-0.01em">Open my dashboard →</a>
  </div>

  <!-- Footer -->
  <div style="padding:24px;text-align:center">
    <p style="margin:0 0 4px;font-size:13px;color:#AAAAAA">Aenima · AI Visibility for local businesses</p>
    <p style="margin:0;font-size:12px;color:#CCCCCC">Powered by <a href="https://technicalgraffiti.co.uk" style="color:#CCCCCC">Technical Graffiti Ltd</a> · Company No. 07180346</p>
  </div>

</div>
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
  // Security — only allow Vercel cron or manual trigger with secret
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  console.log('Monthly cron started');

  // Get all paid users with a website
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
      // Clean domain from website URL
      const domain = user.website
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0]
        .trim();

      if (!domain) continue;

      // Get previous score
      const { data: prevScores } = await SB
        .from('scores')
        .select('score')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(2);

      const previousScore = prevScores?.[1]?.score || null;

      // Run new score check
      const score = await runScoreCheck(domain);
      if (!score) {
        console.warn(`Score check failed for ${domain}`);
        continue;
      }

      // Save to Supabase
      await SB.from('scores').insert({
        user_id: user.id,
        url: domain,
        score: score.overall,
        results: { cats: score.cats, issues: score.issues },
        created_at: new Date().toISOString()
      });

      // Send email report
      await sendMonthlyReport(user, score, previousScore);

      results.push({ email: user.email, domain, score: score.overall });

    } catch(e) {
      console.error(`Error processing user ${user.email}:`, e.message);
    }
  }

  console.log(`Monthly cron complete — processed ${results.length} users`);
  res.status(200).json({ processed: results.length, results });
};
