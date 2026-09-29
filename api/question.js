// POST { code, name, email, text } -> a client question, saved for the admin page.
const L = require("./_lib");
const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, { error: "Use POST." });
  const { code, name, email, text } = req.body || {};
  const found = await L.findProposalByCode(code);
  if (!found) return L.send(res, 401, { error: "Your access code has expired. Reload the page and enter it again." });
  const q = String(text || "").trim().slice(0, 2000);
  const who = String(name || "").trim().slice(0, 100);
  const mail = String(email || "").trim().slice(0, 160);
  if (!who) return L.send(res, 400, { error: "Please add your name." });
  if (!/^\S+@\S+\.\S+$/.test(mail)) return L.send(res, 400, { error: "Please add an email so we can reply." });
  if (q.length < 3) return L.send(res, 400, { error: "Please type your question." });
  if (!L.dbEnabled()) return L.send(res, 503, { error: "Please email info@peaceonthepond.com with your question." });
  await L.updateActivity(found.proposal.id, (a) => {
    a.questions = (a.questions || []).slice(-49);
    a.questions.push({ id: crypto.randomBytes(4).toString("hex"), at: new Date().toISOString(), name: who, email: mail, role: found.role, text: q, answered: false });
  });
  return L.send(res, 200, { ok: true });
};
