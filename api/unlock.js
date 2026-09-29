// POST { code } -> the proposal and enhancements catalog, if the code matches.
const { findProposalByCode, tooManyAttempts, publicProposal, loadCatalog, loadActivity, updateActivity, send } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const { code } = req.body || {};
  if (await tooManyAttempts(req)) {
    return send(res, 429, { error: "Too many tries. Please wait a few minutes, or call (424) 482-1765 for help." });
  }
  const found = await findProposalByCode(code);
  if (!found) {
    // Small delay makes guessing codes slower.
    await new Promise((r) => setTimeout(r, 600));
    return send(res, 401, { error: "That code doesn't match a proposal. Check it and try again." });
  }
  const p = found.proposal;
  let act = null;
  try {
    const now = new Date().toISOString();
    if ((req.body || {}).preview) act = await loadActivity(p.id); // your own "View as client" doesn't count
    else act = await updateActivity(p.id, (a) => {
      if (found.role === "guest") { a.guestViews = (a.guestViews || 0) + 1; a.guestFirstViewedAt = a.guestFirstViewedAt || now; }
      else { a.views = (a.views || 0) + 1; a.firstViewedAt = a.firstViewedAt || now; a.lastViewedAt = now; }
    });
  } catch (e) { console.error(e); }
  send(res, 200, {
    accepted: act && act.acceptedAt ? { at: act.acceptedAt, by: act.acceptedBy } : null,
    proposal: publicProposal(found.proposal, found.role),
    catalog: loadCatalog(),
    paymentsEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
  });
};
