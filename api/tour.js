// Private tour requests.
// GET  ?code=ACCESS or ?d=PREPTOKEN -> prefill details and booked dates
// POST { code?, d?, name, email, phone, guests, times: [{date, time}], note } -> saves a request
const L = require("./_lib");
const crypto = require("crypto");

async function context(q) {
  const out = { proposal: null, disc: null };
  if (q.code) { const f = await L.findProposalByCode(q.code); if (f) out.proposal = f.proposal; }
  if (q.d) out.disc = await L.findDiscoveryByToken(q.d);
  return out;
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const { proposal, disc } = await context(req.query || {});
      const booked = (await L.bookedRetreats()).filter((r) => r.booked).map((r) => ({ start: r.start, end: r.end }));
      const f = disc ? disc.fields : {};
      return L.send(res, 200, {
        name: (proposal && proposal.client.name) || f.name || "",
        email: f.email || "", phone: f.phone || "",
        booked, today: L.todayEastern(),
        slots: await L.openSlots("tour"),
      });
    }
    if (req.method !== "POST") return L.send(res, 405, { error: "Use GET or POST." });
    if (!L.dbEnabled()) return L.send(res, 503, { error: "Please call (424) 482-1765 to schedule a tour." });
    if (await L.tooManyAttempts(req)) return L.send(res, 429, { error: "Too many tries. Please call (424) 482-1765." });

    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 100);
    const email = String(b.email || "").trim().slice(0, 160);
    if (!name) return L.send(res, 400, { error: "Please add your name." });
    if (!/^\S+@\S+\.\S+$/.test(email)) return L.send(res, 400, { error: "Please add an email so we can confirm." });

    const open = await L.openSlots("tour");
    const times = [];
    for (const x of (Array.isArray(b.times) ? b.times : []).slice(0, 3)) {
      const date = String((x && x.date) || ""), time = String((x && x.time) || "");
      if (!(open[date] || []).includes(time)) return L.send(res, 400, { error: "One of your times is no longer available. Please choose again.", slots: open });
      times.push({ date, time });
    }
    if (!times.length) return L.send(res, 400, { error: "Please suggest at least one date and time." });

    const { proposal, disc } = await context(b);
    const tour = {
      id: `tour-${crypto.randomBytes(5).toString("hex")}`,
      status: "Requested", createdAt: new Date().toISOString(),
      name, email, phone: String(b.phone || "").trim().slice(0, 40),
      guests: String(Math.max(1, Math.min(50, parseInt(b.guests, 10) || 1))),
      times, note: String(b.note || "").trim().slice(0, 1000),
      proposalId: proposal ? proposal.id : "", discoveryId: disc ? disc.id : "",
      confirmedDate: "", confirmedTime: "", duration: 60,
    };
    await L.saveTour(tour);
    return L.send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return L.send(res, 500, { error: "Something went wrong. Please call (424) 482-1765." });
  }
};
