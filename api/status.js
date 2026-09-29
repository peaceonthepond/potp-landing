// POST { code } -> totals paid so far for this proposal, from Stripe.
const { findProposalByCode, paidTotals, loadActivity, offlineTotal, send, stripeKey } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const found = await findProposalByCode((req.body || {}).code);
  if (!found) return send(res, 401, { error: "Invalid code." });
  if (found.role === "guest") return send(res, 200, { enabled: false });
  const proposal = found.proposal;
  const act = await loadActivity(proposal.id).catch(() => null);
  const offline = act ? offlineTotal(act) : 0;
  if (!stripeKey()) return send(res, 200, offline ? { enabled: true, retreatPaid: offline, addonsPaid: 0, payers: [] } : { enabled: false });

  try {
    const t = await paidTotals(proposal.id);
    send(res, 200, {
      enabled: true,
      retreatPaid: t.retreatPaid + offline,
      addonsPaid: t.addonsPaid,
      payers: proposal.showPayerNames ? [...new Set(t.payers.map(shortName))] : [],
    });
  } catch (e) {
    console.error(e);
    send(res, 200, { enabled: true, error: "Payment totals are unavailable right now." });
  }
};

function shortName(full) {
  const parts = String(full).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}
