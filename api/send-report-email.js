function mdToHtmlOutlook(text) {
  const lines = text.split('\n');
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
    if (/^## (.+)/.test(line)) {
      out += `<p style="margin:24px 0 6px 0;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#DD5827">${line.replace(/^## /,'')}</p>`;
    } else if (/^# (.+)/.test(line)) {
      out += `<p style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#1a1a1a">${line.replace(/^# /,'')}</p>`;
    } else if (/^---$/.test(line)) {
      out += `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 16px 0"><tr><td style="border-top:1px solid #DDDDDD;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
    } else if (/^(\d+)\.\s+(.+)/.test(line)) {
      const m = line.match(/^(\d+)\.\s+(.+)/);
      out += `<table cellpadding="0" cellspacing="0" border="0" style="margin:5px 0 5px 0"><tr><td width="22" valign="top" style="font-family:Arial,sans-serif;font-size:14px;color:#DD5827;font-weight:bold;padding-right:6px">${m[1]}.</td><td style="font-family:Arial,sans-serif;font-size:14px;color:#3D3D3D;line-height:1.6">${m[2]}</td></tr></table>`;
    } else if (line.trim() === '') {
      out += '';
    } else {
      out += `<p style="margin:0 0 10px 0;font-family:Arial,sans-serif;font-size:14px;color:#3D3D3D;line-height:1.7">${line}</p>`;
    }
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { to, bizName, domain, score, reportText, note } = req.body;
    if (!to) return res.status(400).json({ error: 'No recipient email' });

    const scoreColour = score < 30 ? '#CC2200' : score < 55 ? '#CC6600' : '#1A8A40';
    const scoreLabel = score < 30 ? 'Not visible to AI search' : score < 55 ? 'Limited AI visibility' : score < 80 ? 'Moderate visibility' : 'Good visibility';
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const html = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F0F0;font-family:Arial,sans-serif">
<tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- HEADER -->
  <tr><td style="background:#0A0A0A;padding:36px 40px 32px 40px;border-radius:8px 8px 0 0">
    <p style="color:#DD5827;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px 0">AI Visibility Audit Report</p>
    <h2 style="color:#FFFFFF;font-size:26px;font-weight:800;margin:0 0 8px 0;letter-spacing:-0.02em">${bizName}</h2>
    <p style="color:rgba(255,255,255,0.35);font-size:13px;margin:0">${domain} &middot; ${date}</p>
  </td></tr>

  <!-- SCORE -->
  <tr><td style="background:#FFFFFF;padding:32px 40px;border-left:1px solid #E5E5E5;border-right:1px solid #E5E5E5">
    <p style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#AAAAAA;margin:0 0 10px 0">AI Visibility Score</p>
    <div style="font-size:72px;font-weight:800;color:${scoreColour};line-height:1;letter-spacing:-0.04em">${score}</div>
    <p style="font-size:16px;color:#777777;margin:8px 0 0 0">/100 &mdash; ${scoreLabel}</p>
  </td></tr>

  <!-- REPORT -->
  <tr><td style="background:#FFFFFF;padding:28px 40px 36px 40px;border:1px solid #E5E5E5;border-top:none">
    ${note ? `<p style="font-size:15px;color:#3D3D3D;border-left:4px solid #DD5827;padding:10px 14px;background:#FFF8F5;margin:0 0 24px 0;line-height:1.6">${note}</p>` : ''}
    ${mdToHtmlOutlook(reportText)}
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#0A0A0A;padding:28px 40px;border-radius:0 0 8px 8px">
    <p style="color:rgba(255,255,255,0.35);font-size:12px;margin:0;line-height:2">
      Technical Graffiti Ltd &middot; Company No. 07180346 &middot; ICO No. C1894540<br>
      technicalgraffiti.co.uk &middot; 07726 318601
    </p>
  </td></tr>

</table>
</td></tr>
</table>`;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Technical Graffiti <ai@aenima.co.uk>',
        to,
        subject: `AI Visibility Audit Report — ${bizName} — ${score}/100`,
        html
      })
    });

    const result = await resp.json();
    if (!resp.ok) throw new Error(result.message || 'Resend error');
    res.status(200).json({ sent: true });
  } catch(err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
