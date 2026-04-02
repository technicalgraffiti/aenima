// api/hardship-apply.js
// Handles hardship plan applications with domain-based repeat prevention
// Prevents re-applications using a new email for the same domain

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Hardship price ID — £3.50/month for 3 months
// Create this in Stripe as a one-off 3-month price or use a coupon on Starter
const HARDSHIP_PRICE_ID = process.env.STRIPE_HARDSHIP_MO || '';

function normaliseDomain(raw) {
  return (raw || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user_id, website } = req.body;

    if (!user_id || !website) {
      return res.status(400).json({ error: 'user_id and website are required' });
    }

    const domain = normaliseDomain(website);
    if (!domain) {
      return res.status(400).json({ error: 'Invalid website URL' });
    }

    // ── 1. DOMAIN REPEAT CHECK ─────────────────────────────────────────────
    // Check if this domain has EVER had a hardship plan — regardless of email
    const { data: existingHardship } = await SB
      .from('users')
      .select('id, email, hardship_used_at')
      .eq('hardship_domain', domain)
      .not('hardship_used_at', 'is', null)
      .limit(1);

    if (existingHardship && existingHardship.length > 0) {
      return res.status(403).json({
        error: 'hardship_already_used',
        message: 'The hardship rate has already been used for this domain. Each domain can only access the hardship rate once.'
      });
    }

    // ── 2. FETCH CURRENT USER ──────────────────────────────────────────────
    const { data: user, error: userError } = await SB
      .from('users')
      .select('id, email, plan, stripe_customer_id')
      .eq('id', user_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only allow hardship if currently on free plan
    if (user.plan !== 'free') {
      return res.status(403).json({
        error: 'already_subscribed',
        message: 'Hardship rate is only available to users on the free plan.'
      });
    }

    // ── 3. CREATE STRIPE CHECKOUT FOR HARDSHIP ─────────────────────────────
    if (!HARDSHIP_PRICE_ID) {
      return res.status(500).json({ error: 'Hardship price not configured. Contact Stewart.' });
    }

    const sessionParams = {
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: HARDSHIP_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_URL}/?upgraded=1&plan=starter&hardship=1`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL}/#pricing`,
      subscription_data: {
        metadata: {
          plan: 'starter',
          hardship: 'true',
          hardship_domain: domain,
        },
      },
    };

    if (user.stripe_customer_id) {
      sessionParams.customer = user.stripe_customer_id;
    } else if (user.email) {
      sessionParams.customer_email = user.email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // ── 4. RECORD DOMAIN AGAINST USER IMMEDIATELY ──────────────────────────
    // Record hardship_domain now so it's locked even before payment completes
    // Payment completion (stripe-webhook) will set hardship_used_at timestamp
    await SB
      .from('users')
      .update({
        hardship_domain: domain,
        website: website,
      })
      .eq('id', user_id);

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Hardship apply error:', err.message);
    return res.status(500).json({ error: 'Failed to process hardship application.' });
  }
};
