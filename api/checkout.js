// POST { code, payer, paymentType, shares, customAmount, cart } -> { url } of a Stripe Checkout page.
const { findProposalByCode, loadCatalog, priceCart, UserError, send, stripe, stripeKey } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const body = req.body || {};
  const found = await findProposalByCode(body.code);
  const proposal = found && found.proposal;
  if (!proposal) return send(res, 401, { error: "Your access code has expired. Reload the page and enter it again." });
  if (!stripeKey()) return send(res, 503, { error: "Online payments aren't switched on yet. Contact Peace on the Pond to pay." });

  const name = String((body.payer && body.payer.name) || "").trim().slice(0, 80);
  const email = String((body.payer && body.payer.email) || "").trim().slice(0, 120);
  if (!name) return send(res, 400, { error: "Enter your name so we know who paid." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: "Enter a valid email for your receipt." });

  let priced;
  try {
    priced = priceCart(proposal, loadCatalog(), body, found.role);
  } catch (e) {
    if (e instanceof UserError) return send(res, 400, { error: e.message });
    throw e;
  }

  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const metadata = {
    proposal: proposal.id,
    payer: name,
    view: found.role,
    payment_type: body.paymentType,
    retreat_cents: priced.retreatCents,
    addon_cents: priced.addonCents,
    lodging_cents: priced.lodgingCents,
    requests: priced.requests.join("; ").slice(0, 480),
  };

  try {
    const session = await stripe("POST", "checkout/sessions", {
      mode: "payment",
      success_url: `${origin}/?paid=1`,
      cancel_url: `${origin}/?canceled=1`,
      // No payment_method_types here on purpose: Stripe shows every method you've
      // turned on in the Dashboard (cards, Apple Pay, Klarna, Afterpay, Affirm)
      // when the amount qualifies.
      line_items: priced.lines.map((l) => ({
        quantity: l.quantity,
        price_data: {
          currency: "usd",
          unit_amount: l.unitAmount,
          product_data: { name: `${l.name}, ${proposal.retreat.title}` },
        },
      })),
      metadata,
      payment_intent_data: {
        description: `${proposal.retreat.title}: ${name}`,
        metadata,
      },
    });
    send(res, 200, { url: session.url });
  } catch (e) {
    console.error(e);
    send(res, 502, { error: "The payment page couldn't be opened. Try again in a moment." });
  }
};
