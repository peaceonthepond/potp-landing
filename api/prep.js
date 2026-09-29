// Public client prep form. GET ?t=TOKEN -> questions and saved answers. POST { t, answers } -> save.
const L = require("./_lib");
const fs = require("fs");
const path = require("path");

const schema = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "discovery-schema.json"), "utf8"));
const prepFields = () => schema().sections.flatMap((s) => s.fields).filter((f) => f.prep);

module.exports = async (req, res) => {
  try {
    const token = req.method === "GET" ? req.query && req.query.t : (req.body || {}).t;
    const rec = await L.findDiscoveryByToken(token);
    if (!rec) return L.send(res, 404, { error: "This link isn't active. Please contact Peace on the Pond at (424) 482-1765." });

    const fields = prepFields();
    if (req.method === "GET") {
      const answers = {};
      for (const f of fields) answers[f.key] = (rec.prep && rec.prep[f.key]) || rec.fields[f.key] || "";
      return L.send(res, 200, {
        firstName: String(rec.fields.name || "").split(/\s+/)[0],
        questions: fields.map(({ key, label, prepLabel, type, options, placeholder, required }) => ({ key, label: prepLabel || label, type, options, placeholder, required })),
        answers,
        submitted: Boolean(rec.prepSubmittedAt),
      });
    }
    if (req.method !== "POST") return L.send(res, 405, { error: "Use GET or POST." });

    const input = (req.body || {}).answers || {};
    const clean = {};
    for (const f of fields) {
      const v = input[f.key];
      if (v == null) continue;
      clean[f.key] = f.type === "number" ? String(Math.max(0, Math.min(1000, Math.round(Number(v) || 0)))) : String(v).trim().slice(0, f.type === "textarea" ? 4000 : 300);
    }
    if (!clean.name) return L.send(res, 400, { error: "Please add your name." });
    rec.prep = clean;
    rec.prepSubmittedAt = new Date().toISOString();
    // Fill any blanks in the call record, without overwriting what was already noted.
    for (const [k, v] of Object.entries(clean)) if (v && !rec.fields[k]) rec.fields[k] = v;
    rec.updatedAt = rec.prepSubmittedAt;
    await L.saveDiscovery(rec);
    return L.send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return L.send(res, 500, { error: "Something went wrong. Please try again." });
  }
};
