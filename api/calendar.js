// Private calendar feed for Outlook (subscribe once). GET /api/calendar?t=TOKEN
const L = require("./_lib");

const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dayStr = (iso) => iso.replace(/-/g, "");
const nextDay = (iso) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
// Lines over 75 characters are folded, as calendar apps expect.
const fold = (line) => line.length <= 74 ? line : line.match(/.{1,73}/g).join("\r\n ");

module.exports = async (req, res) => {
  try {
    const t = String((req.query || {}).t || "");
    if (!L.dbEnabled()) return res.status(404).send("Not found");
    const token = await L.getCalendarToken();
    if (!token || t !== token) return res.status(404).send("Not found");

    const now = stamp(new Date());
    const ev = [];
    const add = (uid, fields) => ev.push(["BEGIN:VEVENT", `UID:${uid}@peaceonthepond`, `DTSTAMP:${now}`, ...fields, "END:VEVENT"]);

    for (const r of await L.bookedRetreats()) {
      if (!r.booked) continue;
      add(`retreat-${r.id}`, [`DTSTART;VALUE=DATE:${dayStr(r.start)}`, `DTEND;VALUE=DATE:${dayStr(nextDay(r.end))}`,
        `SUMMARY:${esc(`Retreat: ${r.title}`)}`, `DESCRIPTION:${esc(`Booked. ${r.client}. ${r.status}.`)}`, "TRANSP:OPAQUE"]);
    }
    for (const d of await L.listDiscoveries()) {
      if (!d.callDate || d.status === "Not moving forward") continue;
      const time = L.parseTime(d.callTime);
      const summary = `SUMMARY:${esc(`Discovery call: ${d.fields.name || "Client"}`)}`;
      const desc = `DESCRIPTION:${esc([d.fields.organization, d.fields.phone, d.fields.email].filter(Boolean).join(" | "))}`;
      if (time) {
        const start = L.easternToUtc(d.callDate, time);
        const mins = Number(d.callMinutes) || L.availability().callMinutes || 30;
        add(`call-${d.id}`, [`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + mins * 60000))}`, summary, desc]);
      } else add(`call-${d.id}`, [`DTSTART;VALUE=DATE:${dayStr(d.callDate)}`, `DTEND;VALUE=DATE:${dayStr(nextDay(d.callDate))}`, summary, desc]);
    }
    for (const tr of await L.listTours()) {
      if (tr.status !== "Confirmed" || !tr.confirmedDate || !tr.confirmedTime) continue;
      const start = L.easternToUtc(tr.confirmedDate, tr.confirmedTime);
      add(`tour-${tr.id}`, [`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + (tr.duration || 60) * 60000))}`,
        `SUMMARY:${esc(`Private tour: ${tr.name}`)}`, `DESCRIPTION:${esc([`${tr.guests} guest(s)`, tr.phone, tr.email, tr.note].filter(Boolean).join(" | "))}`]);
    }

    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Peace on the Pond//Admin//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "X-WR-CALNAME:Peace on the Pond", "X-WR-TIMEZONE:America/New_York", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
      ...ev.flat(), "END:VCALENDAR"].map(fold);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(lines.join("\r\n") + "\r\n");
  } catch (e) {
    console.error(e);
    return res.status(500).send("Calendar unavailable");
  }
};

