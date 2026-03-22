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

    const html = `<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif">
      <div style="background:#0A0A0A;padding:28px;border-radius:8px 8px 0 0">
        <h1 style="color:#DD5827;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px">AI Visibility Audit Report</h1>
        <h2 style="color:#FFFFFF;font-size:24px;font-weight:800;margin:0;letter-spacing:-0.02em">${bizName}</h2>
        <p style="color:rgba(255,255,255,0.4);font-size:13px;margin:6px 0 0">${domain} &middot; ${date}</p>
      </div>
      <div style="background:#FFFFFF;border:1px solid #EEE;padding:28px;text-align:center">
        <div style="font-size:72px;font-weight:800;color:${scoreColour};line-height:1;letter-spacing:-0.04em">${score}</div>
        <div style="font-size:16px;color:#777;margin-top:4px">/100 &mdash; ${scoreLabel}</div>
      </div>
      <div style="background:#FFFFFF;border:1px solid #EEE;border-top:none;padding:28px">
        ${note ? `<p style="font-size:15px;color:#3D3D3D;border-left:3px solid #DD5827;padding-left:14px;margin-bottom:20px">${note}</p>` : ''}
        <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:15px;color:#3D3D3D;line-height:1.8">${reportText}</pre>
      </div>
      <div style="background:#0A0A0A;padding:20px 28px;border-radius:0 0 8px 8px;text-align:center">
        <p style="color:rgba(255,255,255,0.3);font-size:12px;margin:0">Technical Graffiti Ltd &middot; Company No. 07180346 &middot; technicalgraffiti.co.uk &middot; 07726 318601</p>
      </div>
    </div>`;

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
