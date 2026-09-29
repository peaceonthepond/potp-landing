// Book a discovery call from the website.
// GET -> open times. POST { date, time, name, email, phone, organization, note } -> creates a discovery record.
const L = require("./_lib");
const crypto = require("crypto");

const label12 = (hhmm) => { let [h, m] = hhmm.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${ap}`; };

module.exports = async (req, res) => {
  try {
    if (!L.dbEnabled()) return L.send(res, 503, { error: "Online booking isn't available right now. Please call (424) 482-1765." });
    if (req.method === "GET") {
      return L.send(res, 200, { slots: await L.openSlots("call"), minutes: L.availability().callMinutes });
    }
    if (req.method !== "POST") return L.send(res, 405, { error: "Use GET or POST." });
    if (await L.tooManyAttempts(req)) return L.send(res, 429, { error: "Too many tries. Please call (424) 482-1765." });

    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 100);
    const email = String(b.email || "").trim().slice(0, 160);
    const phone = String(b.phone || "").trim().slice(0, 40);
    if (!name) return L.send(res, 400, { error: "Please add your name." });
    if (!/^\S+@\S+\.\S+$/.test(email)) return L.send(res, 400, { error: "Please add your email." });
    if (phone.replace(/\D/g, "").length < 10) return L.send(res, 400, { error: "Please add a phone number so we can call you." });

    // Re-check the time is still open (someone else may have just taken it).
    const slots = await L.openSlots("call");
    if (!(slots[b.date] || []).includes(b.time)) {
      return L.send(res, 409, { error: "Sorry, that time was just taken. Please choose another.", slots });
    }

    const now = new Date().toISOString();
    const rec = {
      id: `disc-${crypto.randomBytes(5).toString("hex")}`,
      prepToken: crypto.randomBytes(12).toString("hex"),
      createdAt: now, updatedAt: now,
      status: "Call scheduled",
      callDate: b.date, callTime: label12(b.time), callMinutes: L.availability().callMinutes,
      bookedOnline: true,
      fields: {
        name, email, phone,
        organization: String(b.organization || "").trim().slice(0, 120),
        source: "Booked on the website",
        notes: b.note ? `From the booking form: ${String(b.note).trim().slice(0, 1000)}` : "",
      },
    };
    await L.saveDiscovery(rec);
    return L.send(res, 200, { ok: true, prepToken: rec.prepToken, date: rec.callDate, time: rec.callTime, minutes: rec.callMinutes });
  } catch (e) {
    console.error(e);
    return L.send(res, 500, { error: "Something went wrong. Please call (424) 482-1765." });
  }
};
