const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports.config = {
  api: { bodyParser: false },
};

const PLAN_MAP = {
  'price_1TCGFwJB2Su5DD2s63b7Y3CB': 'starter',
  'price_1TCGGUJB2Su5DD2s4UEFEpsk': 'starter',
  'price_1TCGH1JB2Su5DD2svomn2yh4': 'starter',
  'price_1TCGHaJB2Su5DD2s1OS6hwpM': 'pro',
  'price_1TCGI7JB2Su5DD2spypCec2F': 'pro',
  'price_1TCGIbJB2Su5DD2s6ojHU3qr': 'pro',
  'price_1TCGJ1JB2Su5DD2swYB5UDh6': 'agency',
  'price_1TCGKFJB2Su5DD2sQSkAf0Tz': 'starter',
};

const HARDSHIP_PRICE_ID = 'price_1TCGKFJB2Su5DD2sQSkAf0Tz';

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  switch (event.type) {

    // ── New checkout completed (first-time purchase) ──────────────────────
    case 'checkout.session.completed': {
      const session = event.data.object;
      const email = session.customer_details?.email || session.customer_email;
      const customerId = session.customer;
      const subId = session.subscription;

      console.log(`Checkout completed — email: ${email}, customer: ${customerId}, sub: ${subId}`);

      if (!subId) { console.log('No subscription ID — skipping'); break; }

      const sub = await stripe.subscriptions.retrieve(subId);
      const priceId = sub.items.data[0]?.price?.id;
      const plan = PLAN_MAP[priceId] || 'starter';
      console.log(`Price: ${priceId}, Plan: ${plan}`);

      const { data, error } = await SB
        .from('users')
        .update({
          plan,
          stripe_customer_id: customerId,
          stripe_subscription_id: subId,
          plan_updated_at: new Date().toISOString(),
          payment_failed: false,
        })
        .eq('email', email)
        .select();

      if (error) console.error('Supabase update failed:', error);
      else if (!data || data.length === 0) console.error(`No user found with email: ${email}`);
      else console.log(`Plan updated: ${email} → ${plan}`);

      // If hardship plan — log domain to prevent repeat use
      if (priceId === HARDSHIP_PRICE_ID) {
        const domain = sub.metadata?.domain || session.metadata?.domain || null;
        if (domain) {
          const clean = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
          const { error: hdErr } = await SB
            .from('hardship_domains')
            .upsert({ domain: clean, email: email || '' }, { onConflict: 'domain' });
          if (hdErr) console.error('Failed to log hardship domain:', hdErr);
          else console.log(`Hardship domain logged: ${clean}`);
        } else {
          console.warn('Hardship checkout — no domain in metadata, cannot log');
        }
      }
      break;
    }

    // ── Subscription changed mid-cycle (upgrade / downgrade / proration) ──
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const priceId = sub.items.data[0]?.price?.id;
      const plan = PLAN_MAP[priceId] || 'starter';
      const customerId = sub.customer;

      console.log(`Subscription updated — customer: ${customerId}, price: ${priceId}, plan: ${plan}`);

      const { error } = await SB
        .from('users')
        .update({
          plan,
          stripe_subscription_id: sub.id,
          plan_updated_at: new Date().toISOString(),
          payment_failed: false,
        })
        .eq('stripe_customer_id', customerId);

      if (error) console.error('Subscription update failed:', error);
      else console.log(`Plan updated via subscription change: ${customerId} → ${plan}`);
      break;
    }

    // ── Subscription cancelled / expired ─────────────────────────────────
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customerId = sub.customer;

      const { error } = await SB
        .from('users')
        .update({
          plan: 'free',
          stripe_subscription_id: null,
          plan_updated_at: new Date().toISOString(),
          payment_failed: false,
        })
        .eq('stripe_customer_id', customerId);

      if (error) console.error('Supabase downgrade failed:', error);
      else console.log(`Plan reverted to free: customer ${customerId}`);
      break;
    }

    // ── Payment failed — flag the user ────────────────────────────────────
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer;

      console.log(`Payment failed for customer: ${customerId}`);

      const { error } = await SB
        .from('users')
        .update({
          payment_failed: true,
          payment_failed_at: new Date().toISOString(),
        })
        .eq('stripe_customer_id', customerId);

      if (error) console.error('Failed to flag payment failure:', error);
      else console.log(`Payment failed flagged for: ${customerId}`);
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
      break;
  }

  res.status(200).json({ received: true });
};
