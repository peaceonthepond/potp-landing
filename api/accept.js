// POST { code, name, agree } -> the organizer accepts the proposal and its terms.
const L = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, { error: "Use POST." });
  const { code, name, agree } = req.body || {};
  const found = await L.findProposalByCode(code);
  if (!found) return L.send(res, 401, { error: "Your access code has expired. Reload the page and enter it again." });
  if (found.role !== "organizer") return L.send(res, 403, { error: "Only the organizer can accept this proposal." });
  const typed = String(name || "").trim().slice(0, 120);
  if (typed.length < 2) return L.send(res, 400, { error: "Type your full name to accept." });
  if (agree !== true) return L.send(res, 400, { error: "Please check the box to agree to the terms." });
  if (!L.dbEnabled()) return L.send(res, 503, { error: "Accepting online isn't available yet. Please call (424) 482-1765." });
  const act = await L.updateActivity(found.proposal.id, (a) => {
    if (a.acceptedAt) return;
    a.acceptedAt = new Date().toISOString();
    a.acceptedBy = typed;
    a.acceptedIp = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    a.acceptedTerms = found.proposal.terms || [];
    a.acceptedTotal = found.proposal.package.total;
  });
  return L.send(res, 200, { ok: true, accepted: { at: act.acceptedAt, by: act.acceptedBy } });
};
