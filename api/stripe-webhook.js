// api/stripe-webhook.js
// Stripe webhook handler — updates user plan in Supabase after payment

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const SB = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // Service key — not anon key
);

const PLAN_MAP = {
  'price_1TCGFwJB2Su5DD2s63b7Y3CB': 'starter', // Starter Monthly
  'price_1TCGGUJB2Su5DD2s4UEFEpsk': 'starter', // Starter Quarterly
  'price_1TCGH1JB2Su5DD2svomn2yh4': 'starter', // Starter Annual
  'price_1TCGHaJB2Su5DD2s1OS6hwpM': 'pro',     // Pro Monthly
  'price_1TCGI7JB2Su5DD2spypCec2F': 'pro',     // Pro Quarterly
  'price_1TCGIbJB2Su5DD2s6ojHU3qr': 'pro',     // Pro Annual
  'price_1TCGJ1JB2Su5DD2swYB5UDh6': 'agency',  // Agency Monthly
  'price_1TCGKFJB2Su5DD2sQSkAf0Tz': 'starter', // Hardship
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Handle relevant events
  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object;
      const email = session.customer_email;
      const subId = session.subscription;

      if (!email || !subId) break;

      // Get subscription to find price ID
      const sub = await stripe.subscriptions.retrieve(subId);
      const priceId = sub.items.data[0]?.price?.id;
      const plan = PLAN_MAP[priceId] || 'starter';

      // Update user plan in Supabase
      const { error } = await SB
        .from('users')
        .update({
          plan,
          stripe_customer_id: session.customer,
          stripe_subscription_id: subId,
          plan_updated_at: new Date().toISOString()
        })
        .eq('email', email);

      if (error) console.error('Supabase update failed:', error);
      else console.log(`Plan updated: ${email} → ${plan}`);
      break;
    }

    case 'customer.subscription.deleted': {
      // Subscription cancelled — revert to free
      const sub = event.data.object;
      const customerId = sub.customer;

      const { error } = await SB
        .from('users')
        .update({ plan: 'free', stripe_subscription_id: null })
        .eq('stripe_customer_id', customerId);

      if (error) console.error('Supabase downgrade failed:', error);
      else console.log(`Plan reverted to free: customer ${customerId}`);
      break;
    }

    case 'invoice.payment_failed': {
      // Payment failed — notify but don't immediately cancel
      const invoice = event.data.object;
      console.log(`Payment failed for customer: ${invoice.customer}`);
      // Stripe will retry — only cancel after all retries exhausted
      break;
    }

    default:
      // Ignore other events
      break;
  }

  res.status(200).json({ received: true });
};
