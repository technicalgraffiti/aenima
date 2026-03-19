// api/create-checkout.js
// Vercel serverless function — Stripe Checkout session creator
// Deploy this file to /api/create-checkout.js in your Vercel project

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  starter_mo:  process.env.STRIPE_STARTER_MO  || 'price_1TCGFwJB2Su5DD2s63b7Y3CB',
  starter_qtr: process.env.STRIPE_STARTER_QTR || 'price_1TCGGUJB2Su5DD2s4UEFEpsk',
  starter_yr:  process.env.STRIPE_STARTER_YR  || 'price_1TCGH1JB2Su5DD2svomn2yh4',
  pro_mo:      process.env.STRIPE_PRO_MO      || 'price_1TCGHaJB2Su5DD2s1OS6hwpM',
  pro_qtr:     process.env.STRIPE_PRO_QTR     || 'price_1TCGI7JB2Su5DD2spypCec2F',
  pro_yr:      process.env.STRIPE_PRO_YR      || 'price_1TCGIbJB2Su5DD2s6ojHU3qr',
  agency_mo:   process.env.STRIPE_AGENCY_MO   || 'price_1TCGJ1JB2Su5DD2swYB5UDh6',
};

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { plan, billing, email } = req.body;
  const key   = `${plan}_${billing || 'mo'}`;
  const price = PRICE_IDS[key];

  if (!price) {
    res.status(400).json({ error: `Unknown plan/billing combination: ${key}` });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode:                 'subscription',
      customer_email:       email || undefined, // pre-fills checkout email
      line_items:           [{ price, quantity: 1 }],
      success_url:          `${process.env.NEXT_PUBLIC_URL}/?upgraded=1&plan=${plan}`,
      cancel_url:           `${process.env.NEXT_PUBLIC_URL}/#pricing`,
      subscription_data: {
        metadata: { plan, billing: billing || 'mo' },
      },
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
};
