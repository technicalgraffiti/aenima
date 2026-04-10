// api/create-checkout.js
// Vercel serverless function — Stripe Checkout session creator
// Handles new subscriptions AND upgrades (Starter → Pro with proration)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { plan, billing, email, user_id } = req.body;
  const key   = `${plan}_${billing || 'mo'}`;
  const price = PRICE_IDS[key];

  if (!price) {
    return res.status(400).json({ error: `Unknown plan/billing combination: ${key}` });
  }

  try {
    // ── CHECK IF USER HAS AN EXISTING SUBSCRIPTION (upgrade path) ──────────
    if (user_id) {
      const { data: user } = await SB
        .from('users')
        .select('stripe_customer_id, stripe_subscription_id, plan')
        .eq('id', user_id)
        .single();

      // If they have an active subscription, upgrade it via proration
      if (user?.stripe_subscription_id && user?.plan && user.plan !== 'free') {
        try {
          // Retrieve current subscription to get the item ID
          const subscription = await stripe.subscriptions.retrieve(
            user.stripe_subscription_id
          );

          const subscriptionItemId = subscription.items.data[0]?.id;

          if (subscriptionItemId) {
            // Update subscription — Stripe prorates automatically
            await stripe.subscriptions.update(user.stripe_subscription_id, {
              items: [{
                id: subscriptionItemId,
                price: price,
              }],
              proration_behavior: 'always_invoice',
              payment_behavior: 'error_if_incomplete',
              metadata: { plan, billing: billing || 'mo' },
            });

            // Update Supabase plan immediately
            await SB
              .from('users')
              .update({ plan })
              .eq('id', user_id);

            // Return success — no redirect needed, subscription updated directly
            return res.status(200).json({
              upgraded: true,
              plan,
              message: `Upgraded to ${plan}. You have only been charged the difference.`
            });
          }
        } catch (upgradeErr) {
          console.error('Upgrade error, falling back to new checkout:', upgradeErr.message);
          // Fall through to new checkout session if upgrade fails
        }
      }
    }

    // ── NEW SUBSCRIPTION (no existing sub, or upgrade failed) ──────────────
    const sessionParams = {
      payment_method_types: ['card'],
      mode:                 'subscription',
      line_items:           [{ price, quantity: 1 }],
      success_url:          `${process.env.NEXT_PUBLIC_URL}/?upgraded=1&plan=${plan}`,
      cancel_url:           `${process.env.NEXT_PUBLIC_URL}/#pricing`,
      custom_text: {
        submit: { message: 'Cancel anytime. No contract. Keep your files if you cancel.' },
      },
      subscription_data: {
        metadata: { plan, billing: billing || 'mo' },
      },
    };

    // Pre-fill email and attach to existing Stripe customer if available
    if (email) sessionParams.customer_email = email;

    if (user_id) {
      const { data: user } = await SB
        .from('users')
        .select('stripe_customer_id')
        .eq('id', user_id)
        .single();

      if (user?.stripe_customer_id) {
        delete sessionParams.customer_email;
        sessionParams.customer = user.stripe_customer_id;
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session.' });
  }
};
