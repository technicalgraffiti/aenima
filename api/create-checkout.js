// api/create-checkout.js
// Vercel serverless function — Stripe Checkout session creator
// Handles TG tier checkouts AND Aenima new subscriptions AND upgrades

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── TG TIER PRICE IDs ────────────────────────────────────────────────────────
const TG_PRICE_IDS = {
  essential: 'price_1TM8eGJB2Su5DD2sJEESCX3i',
  extended:  'price_1TM8fEJB2Su5DD2s5rL6MQxQ',
  full:      'price_1TM8fpJB2Su5DD2sJAQLna20',
};

const TG_SETUP_FEES = {
  essential: 1900,
  extended:  4900,
  full:      9900,
};

const TG_SETUP_LABELS = {
  essential: 'AI Visibility Essential — files and setup',
  extended:  'AI Visibility Extended — full audit and setup',
  full:      'AI Visibility Full — complete fix and setup',
};

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { plan, billing, email, user_id, tg_tier, domain } = req.body;

  // ── TG TIER CHECKOUT ───────────────────────────────────────────────────────
  if (tg_tier) {
    if (!TG_PRICE_IDS[tg_tier]) {
      return res.status(400).json({ error: `Invalid TG tier: ${tg_tier}` });
    }
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              product_data: { name: TG_SETUP_LABELS[tg_tier] },
              unit_amount: TG_SETUP_FEES[tg_tier],
            },
            quantity: 1,
          },
          {
            price: TG_PRICE_IDS[tg_tier],
            quantity: 1,
          },
        ],
        subscription_data: {
          trial_period_days: 30,
          metadata: { domain: domain || '', tg_tier },
        },
        metadata: { domain: domain || '', tg_tier },
        success_url: `https://technicalgraffiti.co.uk/free-assessment/?success=1&tier=${tg_tier}`,
        cancel_url:  `https://technicalgraffiti.co.uk/free-assessment/?cancelled=1`,
      });
      return res.status(200).json({ url: session.url });
    } catch (err) {
      console.error('TG checkout error:', err.message);
      return res.status(500).json({ error: 'Could not create TG checkout session.' });
    }
  }

  // ── EXISTING AENIMA LOGIC BELOW — UNCHANGED ───────────────────────────────
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

            // ── PREVIEW MODE — return proration amount for confirmation modal ──
            if (req.body.preview) {
              const preview = await stripe.invoices.retrieveUpcoming({
                customer: subscription.customer,
                subscription: user.stripe_subscription_id,
                subscription_items: [{ id: subscriptionItemId, price }],
                subscription_proration_behavior: 'always_invoice',
              });
              const prorationLine = preview.lines.data.find(l => l.proration);
              const prorationAmount = prorationLine
                ? Math.abs(preview.amount_due) / 100
                : null;
              const nextDate = new Date(subscription.current_period_end * 1000)
                .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
              return res.status(200).json({
                preview: true,
                prorationAmount,
                nextBillingDate: nextDate,
                nextBillingAmount: 7.50,
              });
            }

            // Update subscription — Stripe prorates automatically
            await stripe.subscriptions.update(user.stripe_subscription_id, {
              items: [{
                id: subscriptionItemId,
                price: price,
              }],
              proration_behavior: 'always_invoice',
              payment_behavior: 'error_if_incomplete',
              metadata: { plan, billing: billing || 'mo' },
              description: `Aenima plan upgrade to ${plan.charAt(0).toUpperCase() + plan.slice(1)} — pro-rata charge for remainder of billing period`,
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
