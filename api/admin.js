// Admin API. Every action except "login" requires the signed admin cookie.
// POST { action, ...params }
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const L = require("./_lib");

const COOKIE = "potp_admin";
const SESSION_DAYS = 14;

module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, { error: "Use POST." });
  const body = req.body || {};
  const secret = process.env.ADMIN_PASSWORD || "";
  if (!secret) return L.send(res, 503, { error: "Admin isn't set up yet. Add ADMIN_PASSWORD in Vercel, then redeploy." });

  try {
    if (body.action === "login") return await login(req, res, body, secret);
    if (!validSession(req, secret)) return L.send(res, 401, { error: "Please sign in." });

    switch (body.action) {
      case "logout":
        res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
        return L.send(res, 200, { ok: true });
      case "session":
        return L.send(res, 200, { ok: true, dbEnabled: L.dbEnabled(), paymentsEnabled: Boolean(L.stripeKey()) });
      case "setup":
        return L.send(res, 200, { defaults: defaults(), catalog: L.loadCatalog(), dbEnabled: L.dbEnabled(), discovery: discSchema() });
      case "discList":
        return await discList(res);
      case "discGet":
        return await discGet(res, body.id);
      case "discSave":
        return await discSave(res, body.record || {});
      case "discDelete":
        return await discDelete(res, body.id);

      case "list":
        return await list(res);
      case "dashboard":
        return await dashboard(res);
      case "calendar":
        return await calendarData(res);
      case "tourSave":
        return await tourSave(res, body.tour || {});
      case "tourDelete":
        return await tourDelete(res, body.id);
      case "calLink":
        return L.send(res, 200, { token: await L.getCalendarToken(Boolean(body.regenerate)) });
      case "activity":
        return await activity(res, body.id);
      case "markSent":
        return await markSent(res, body.id, body.method);
      case "addOffline":
        return await addOffline(res, body.id, body.entry || {});
      case "removeOffline":
        return await removeOffline(res, body.id, body.offlineId);
      case "answerQuestion":
        return await answerQuestion(res, body.id, body.qid, body.answered);
      case "get":
        return await get(res, body.id);
      case "save":
        return await save(res, body);
      case "setActive":
        return await setActive(res, body.id, body.active);
      case "delete":
        return await remove(res, body.id);
      case "events":
        return L.send(res, 200, { ...(await L.loadEventsData()), today: L.todayEastern(), dbEnabled: L.dbEnabled() });
      case "saveEvent":
        return await saveEvent(res, body.event || {});
      case "deleteEvent":
        return await deleteEvent(res, body.id);
      case "saveSettings":
        return await saveSiteSettings(res, body.settings || {});
      default:
        return L.send(res, 400, { error: "Unknown action." });
    }
  } catch (e) {
    if (e instanceof L.UserError) return L.send(res, 400, { error: e.message });
    console.error(e);
    return L.send(res, 500, { error: e.message || "Something went wrong." });
  }
};

// ---------- Auth ----------
const key = (secret) => crypto.createHash("sha256").update("potp-admin:" + secret).digest();
const sign = (secret, exp) => crypto.createHmac("sha256", key(secret)).update(String(exp)).digest("hex");

async function login(req, res, body, secret) {
  const a = crypto.createHash("sha256").update(String(body.password || "")).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 800));
    return L.send(res, 401, { error: "That password isn't right." });
  }
  const exp = Date.now() + SESSION_DAYS * 864e5;
  res.setHeader("Set-Cookie", `${COOKIE}=${exp}.${sign(secret, exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`);
  return L.send(res, 200, { ok: true });
}

function validSession(req, secret) {
  const m = (req.headers.cookie || "").match(new RegExp(`${COOKIE}=(\\d+)\\.([a-f0-9]{64})`));
  if (!m || Number(m[1]) < Date.now()) return false;
  const expected = Buffer.from(sign(secret, m[1]));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// ---------- Actions ----------
function defaults() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "defaults.json"), "utf8"));
}

// Every proposal with its payments, activity, and status.
async function proposalRows() {
  const all = await L.allProposals();
  const acts = await L.loadActivities(all.map((p) => p.id));
  const rows = all.map((p) => {
    const act = acts[p.id] || {};
    return {
      id: p.id, client: p.client.name, firstName: p.client.firstName || "", email: p.client.email || "",
      mode: (p.payment && p.payment.mode) || "split", group: p.client.group || "", title: p.retreat.title,
      startDate: p.retreat.startDate, endDate: p.retreat.endDate, datesLabel: p.retreat.datesLabel,
      code: p.accessCode, guestCode: p.guestCode || "", total: p.package.total, retainer: p.payment.retainer,
      balanceDueDate: p.payment.balanceDueDate, active: p.active !== false, source: p.source,
      updatedAt: p.updatedAt || null, discoveryId: p.discoveryId || "",
      sentAt: act.sentAt || "", views: act.views || 0, guestViews: act.guestViews || 0,
      firstViewedAt: act.firstViewedAt || "", lastViewedAt: act.lastViewedAt || "",
      acceptedAt: act.acceptedAt || "", acceptedBy: act.acceptedBy || "",
      openQuestions: (act.questions || []).filter((q) => !q.answered).length,
      offline: L.offlineTotal(act), stripePaid: null, paid: null,
    };
  });
  if (L.stripeKey()) {
    // A few at a time to stay well inside Stripe's search limits.
    for (let i = 0; i < rows.length; i += 5) {
      await Promise.all(rows.slice(i, i + 5).map(async (r) => {
        try { r.stripePaid = (await L.paidTotals(r.id)).retreatPaid; } catch { r.stripePaid = null; }
      }));
    }
  }
  for (const r of rows) {
    r.paid = (r.stripePaid || 0) + r.offline;
    const p = all.find((x) => x.id === r.id);
    r.status = L.proposalStatus(p, acts[r.id] || {}, r.paid);
  }
  rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return rows;
}

async function list(res) {
  const rows = await proposalRows();
  return L.send(res, 200, { proposals: rows, dbEnabled: L.dbEnabled(), paymentsEnabled: Boolean(L.stripeKey()) });
}

// ---------- Activity for one proposal ----------
async function activity(res, id) {
  const p = await findById(id);
  if (!p) return L.send(res, 404, { error: "That proposal no longer exists." });
  const act = await L.loadActivity(id);
  let stripe = null;
  if (L.stripeKey()) { try { stripe = await L.paidTotals(id); } catch {} }
  const paid = (stripe ? stripe.retreatPaid : 0) + L.offlineTotal(act);
  return L.send(res, 200, { activity: act, stripe, paid, status: L.proposalStatus(p, act, paid) });
}
async function markSent(res, id, method) {
  needDb();
  const act = await L.updateActivity(id, (a) => { a.sentAt = new Date().toISOString(); a.sentMethod = text(method, 40) || "email"; });
  return L.send(res, 200, { ok: true, activity: act });
}
async function addOffline(res, id, e) {
  needDb();
  const amount = Math.round(num(e.amount, 0, 1e7) * 100) / 100;
  if (!(amount > 0)) throw new L.UserError("Enter the amount received.");
  if (!parseDate(e.date)) throw new L.UserError("Choose the date it was received.");
  const act = await L.updateActivity(id, (a) => {
    a.offline = a.offline || [];
    a.offline.push({ id: crypto.randomBytes(4).toString("hex"), date: e.date, amount,
      method: text(e.method, 40) || "Other", payer: text(e.payer, 100), note: text(e.note, 300), addedAt: new Date().toISOString() });
  });
  return L.send(res, 200, { ok: true, activity: act });
}
async function removeOffline(res, id, offlineId) {
  needDb();
  const act = await L.updateActivity(id, (a) => { a.offline = (a.offline || []).filter((o) => o.id !== offlineId); });
  return L.send(res, 200, { ok: true, activity: act });
}
async function answerQuestion(res, id, qid, answered) {
  needDb();
  const act = await L.updateActivity(id, (a) => { (a.questions || []).forEach((q) => { if (q.id === qid) q.answered = Boolean(answered); }); });
  return L.send(res, 200, { ok: true, activity: act });
}

// ---------- Home dashboard ----------
async function dashboard(res) {
  const today = L.todayEastern();
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const rows = await proposalRows();
  const discs = await L.listDiscoveries();
  const acts = await L.loadActivities(rows.map((r) => r.id));
  const live = rows.filter((r) => r.active);
  const calls = discs.filter((d) => d.callDate && d.callDate >= today && d.callDate <= addDays(today, 7) && d.status === "Call scheduled")
    .sort((a, b) => (a.callDate + (a.callTime || "")).localeCompare(b.callDate + (b.callTime || "")))
    .map((d) => ({ id: d.id, name: d.fields.name || "Untitled", organization: d.fields.organization || "", callDate: d.callDate, callTime: d.callTime || "", prepReceived: Boolean(d.prepSubmittedAt) }));
  const waiting = live.filter((r) => ["Draft", "Sent", "Viewed", "Accepted"].includes(r.status) && r.endDate >= today);
  const balances = live.filter((r) => r.paid < r.total - 0.5 && r.balanceDueDate && r.balanceDueDate <= addDays(today, 30) && r.endDate >= today && ["Retainer paid", "Accepted"].includes(r.status))
    .map((r) => ({ ...r, remaining: Math.round((r.total - r.paid) * 100) / 100, overdue: r.balanceDueDate < today }))
    .sort((a, b) => a.balanceDueDate.localeCompare(b.balanceDueDate));
  const upcoming = live.filter((r) => r.startDate >= today && ["Retainer paid", "Paid in full"].includes(r.status))
    .sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 8);
  const questions = [];
  for (const r of rows) for (const q of (acts[r.id].questions || [])) if (!q.answered) questions.push({ ...q, proposalId: r.id, client: r.client, title: r.title });
  questions.sort((a, b) => b.at.localeCompare(a.at));
  const allTours = await L.listTours();
  const tourRequests = allTours.filter((t) => t.status === "Requested").sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const toursSoon = allTours.filter((t) => t.status === "Confirmed" && t.confirmedDate >= today && t.confirmedDate <= addDays(today, 7))
    .sort((x, y) => (x.confirmedDate + x.confirmedTime).localeCompare(y.confirmedDate + y.confirmedTime));
  return L.send(res, 200, { today, calls, waiting, balances, upcoming, questions, tourRequests, toursSoon, dbEnabled: L.dbEnabled(), paymentsEnabled: Boolean(L.stripeKey()) });
}

async function findById(id) {
  return (await L.allProposals()).find((p) => p.id === id) || null;
}

async function get(res, id) {
  const p = await findById(id);
  if (!p) return L.send(res, 404, { error: "That proposal no longer exists." });
  let paid = null;
  if (L.stripeKey()) { try { paid = await L.paidTotals(p.id); } catch {} }
  return L.send(res, 200, { proposal: p, paid });
}

async function save(res, body) {
  if (!L.dbEnabled()) throw new L.UserError("Connect the database in Vercel (Storage tab) before saving proposals.");
  const f = body.fields || {};
  const existing = body.id ? await findById(body.id) : null;
  const all = await L.allProposals();

  const clean = (v) => L.normalizeCode(v).replace(/[^A-Z0-9-]/g, "");
  const code = clean(f.accessCode);
  const guestCode = f.paymentMode === "split" ? clean(f.guestCode) : "";
  if (code.length < 4 || code.length > 24) throw new L.UserError("Use an organizer code of 4 to 24 letters or numbers.");
  if (guestCode && (guestCode.length < 4 || guestCode.length > 24)) throw new L.UserError("Use a guest code of 4 to 24 letters or numbers.");
  if (guestCode && guestCode === code) throw new L.UserError("The guest code needs to be different from the organizer code.");
  for (const c2 of [code, guestCode].filter(Boolean)) {
    const clash = all.find((p) => (!existing || p.id !== existing.id) &&
      [p.accessCode, p.guestCode].filter(Boolean).map(L.normalizeCode).includes(c2));
    if (clash) throw new L.UserError(`The code ${c2} is already used for ${clash.client.name}. Choose another.`);
  }

  const proposal = buildProposal(f, existing, code);
  proposal.guestCode = proposal.payment.mode === "split" ? guestCode || "" : "";
  await L.saveProposal(proposal, existing);
  if (proposal.discoveryId) {
    const rec = await L.loadDiscovery(proposal.discoveryId);
    if (rec && rec.proposalId !== proposal.id) {
      rec.proposalId = proposal.id;
      if (["Call scheduled", "Call done"].includes(rec.status)) rec.status = "Proposal sent";
      rec.updatedAt = new Date().toISOString();
      await L.saveDiscovery(rec);
    }
  }
  return L.send(res, 200, { ok: true, id: proposal.id, code, guestCode });
}

async function setActive(res, id, active) {
  const p = await findById(id);
  if (!p) return L.send(res, 404, { error: "That proposal no longer exists." });
  if (!L.dbEnabled()) throw new L.UserError("Connect the database in Vercel before changing proposals.");
  const { source, ...clean } = p;
  clean.active = Boolean(active);
  clean.updatedAt = new Date().toISOString();
  await L.saveProposal(clean);
  return L.send(res, 200, { ok: true });
}

async function remove(res, id) {
  const p = await findById(id);
  if (!p) return L.send(res, 404, { error: "That proposal no longer exists." });
  if (p.source === "file") throw new L.UserError("This proposal lives in the project files. Close it instead, or delete its file from GitHub.");
  await L.deleteProposal(p);
  return L.send(res, 200, { ok: true });
}

// ---------- Build the stored proposal from the admin form ----------
const text = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
const num = (v, min = 0, max = 1e7) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : NaN; };

function buildProposal(f, existing, code) {
  const name = text(f.clientName, 100);
  if (!name) throw new L.UserError("Add the client's name.");
  const firstName = text(f.firstName, 60) || name.split(/\s+/)[0];
  const group = text(f.group, 100);

  const start = parseDate(f.startDate), end = parseDate(f.endDate);
  if (!start || !end) throw new L.UserError("Choose an arrival and a departure date.");
  const nights = Math.round((end - start) / 864e5);
  if (nights < 1) throw new L.UserError("The departure date needs to be after the arrival date.");

  const rate = num(f.nightlyRate);
  if (!(rate > 0)) throw new L.UserError("Add the nightly rate.");
  const totalOverride = f.totalOverride === "" || f.totalOverride == null ? null : num(f.totalOverride);
  const total = Math.round((totalOverride > 0 ? totalOverride : rate * nights) * 100) / 100;

  const pct = num(f.retainerPct, 0, 100);
  const retainerOverride = f.retainerOverride === "" || f.retainerOverride == null ? null : num(f.retainerOverride);
  const retainer = retainerOverride > 0 ? Math.min(retainerOverride, total) : Math.round(total * (pct || 0) / 100);
  const dueDays = Math.round(num(f.dueDays, 0, 365)) || 0;
  const due = new Date(start.getTime() - dueDays * 864e5);
  const mode = f.paymentMode === "split" ? "split" : "single";
  const groupSize = mode === "split" ? Math.max(2, Math.round(num(f.groupSize, 2, 100)) || 2) : 1;

  const catalog = L.loadCatalog();
  const included = (Array.isArray(f.included) ? f.included : []).map((n) => text(n, 120)).filter(Boolean).map((n) => {
    const item = catalog.items.find((i) => i.name.toLowerCase() === n.toLowerCase());
    return { name: n, catalogId: item ? item.id : null };
  });

  const paras = (v) => String(v || "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const letter = paras(f.letter);
  const terms = paras(f.terms).map((t) => t.replace(/\{firstName\}/g, firstName));

  const id = existing ? existing.id : slug(group || name);
  return {
    id,
    accessCode: code,
    active: f.active !== false,
    showPayerNames: f.showPayerNames !== false,
    createdAt: (existing && existing.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    client: { name, firstName, group, email: text(f.clientEmail, 160) },
    retreat: {
      title: text(f.title, 120) || (group ? `The ${group} Retreat` : `${firstName}'s Retreat`),
      startDate: iso(start), endDate: iso(end),
      datesLabel: rangeLabel(start, end),
      duration: `${nights} night${nights > 1 ? "s" : ""}, ${nights + 1} days`,
      capacity: text(f.capacity, 120),
    },
    letter,
    package: {
      name: text(f.packageName, 120) || "Retreat Package",
      summary: text(f.packageSummary, 300) || `Exclusive use of Peace on the Pond for ${nights} night${nights > 1 ? "s" : ""}, ${nights + 1} days.`,
      lineItem: text(f.lineItem, 120) || "venue access",
      nightlyRate: rate, nights, total,
      inclusions: (Array.isArray(f.inclusions) ? f.inclusions : []).map((s) => text(s, 200)).filter(Boolean).slice(0, 30),
      includedEnhancements: included,
    },
    payment: {
      mode, groupSize, retainer,
      retainerLabel: `${Math.round(retainer / total * 100)}% retainer, due at booking`,
      balanceDueDate: iso(due),
      balanceLabel: `Remaining balance, due ${dueDays} days before arrival`,
    },
    terms,
    lodging: buildLodging(f.lodging, existing),
    recap: (Array.isArray(f.recap) ? f.recap : []).slice(0, 12)
      .map((r) => ({ label: text(r && r.label, 60), text: text(r && r.text, 600) })).filter((r) => r.label && r.text),
    recapGuests: Boolean(f.recapGuests),
    recommended: (Array.isArray(f.recommended) ? f.recommended : []).map((x) => text(x, 60)).filter(Boolean).slice(0, 30),
    discoveryId: text(f.discoveryId, 80) || (existing && existing.discoveryId) || "",
    admin: { retainerPct: pct, retainerOverride, totalOverride, dueDays },
  };
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
const iso = (d) => d.toISOString().slice(0, 10);
function rangeLabel(a, b) {
  const M = (d) => d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const [ay, by] = [a.getUTCFullYear(), b.getUTCFullYear()];
  if (ay !== by) return `${M(a)} ${a.getUTCDate()}, ${ay}–${M(b)} ${b.getUTCDate()}, ${by}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${M(a)} ${a.getUTCDate()}–${b.getUTCDate()}, ${ay}`;
  return `${M(a)} ${a.getUTCDate()}–${M(b)} ${b.getUTCDate()}, ${ay}`;
}
function slug(s) {
  const base = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "proposal";
  return `${base}-${crypto.randomBytes(2).toString("hex")}`;
}

// ---------- Landing page events ----------
function needDb() {
  if (!L.dbEnabled()) throw new L.UserError("Connect the database in Vercel (Storage tab) before making changes.");
}
function cleanUrl(u) {
  const s = text(u, 500);
  if (!s) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { return new URL(withScheme).toString(); } catch { throw new L.UserError("That link doesn't look like a web address."); }
}

async function saveEvent(res, e) {
  needDb();
  const title = text(e.title, 140);
  if (!title) throw new L.UserError("Add the event's name.");
  if (!parseDate(e.date)) throw new L.UserError("Choose the event's date.");
  const endDate = e.endDate ? (parseDate(e.endDate) ? e.endDate : null) : null;
  if (endDate && endDate < e.date) throw new L.UserError("The end date needs to be on or after the start date.");
  const { events } = await L.loadEventsData();
  const item = {
    id: e.id || slug(title),
    date: e.date, endDate: endDate || "",
    time: text(e.time, 60),
    title,
    description: text(e.description, 400),
    link: cleanUrl(e.link),
    linkLabel: text(e.linkLabel, 40) || "Learn more",
  };
  const i = events.findIndex((x) => x.id === item.id);
  if (i >= 0) events[i] = item; else events.push(item);
  events.sort((a, b) => a.date.localeCompare(b.date));
  await L.saveEvents(events);
  return L.send(res, 200, { ok: true, events });
}

async function deleteEvent(res, id) {
  needDb();
  const { events } = await L.loadEventsData();
  const next = events.filter((x) => x.id !== id);
  await L.saveEvents(next);
  return L.send(res, 200, { ok: true, events: next });
}

async function saveSiteSettings(res, s) {
  needDb();
  const phone = text(s.phone, 40);
  if (phone.replace(/\D/g, "").length < 10) throw new L.UserError("Enter a full phone number, including area code.");
  const bookingUrl = cleanUrl(s.bookingUrl);
  if (!bookingUrl) throw new L.UserError("Add the link to your pre-booking form.");
  await L.saveSettings({ phone, bookingUrl });
  return L.send(res, 200, { ok: true, settings: { phone, bookingUrl } });
}

// ---------- Partner lodging on a proposal ----------
function buildLodging(list, existing) {
  const out = [];
  for (const l of Array.isArray(list) ? list.slice(0, 6) : []) {
    const name = text(l.name, 120);
    if (!name) continue;
    const price = l.price === "" || l.price == null ? null : num(l.price);
    const payThroughUs = Boolean(l.payThroughUs);
    const link = cleanUrl(l.link);
    if (payThroughUs && !(price > 0)) throw new L.UserError(`Add a price for ${name}, or turn off paying through Peace on the Pond.`);
    if (!payThroughUs && !link) throw new L.UserError(`Add a booking link for ${name}, or let guests pay through Peace on the Pond.`);
    out.push({
      id: l.id || slug(name),
      name,
      description: text(l.description, 400),
      location: text(l.location, 120),
      price: price > 0 ? Math.round(price * 100) / 100 : null,
      unit: ["night", "person", "stay"].includes(l.unit) ? l.unit : "night",
      link,
      payThroughUs,
    });
  }
  return out;
}

// ---------- Discovery calls ----------
function discSchema() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "discovery-schema.json"), "utf8"));
}
function discFields() {
  return discSchema().sections.flatMap((s) => s.fields);
}
// Keeps only known fields, trimmed to sensible lengths.
function cleanDiscFields(input, onlyPrep = false) {
  const out = {};
  for (const f of discFields()) {
    if (onlyPrep && !f.prep) continue;
    const v = input[f.key];
    if (v == null) continue;
    if (f.type === "checks") out[f.key] = (Array.isArray(v) ? v : []).map((x) => text(x, 80)).filter(Boolean).slice(0, 40);
    else if (f.type === "number") out[f.key] = v === "" ? "" : String(Math.max(0, Math.min(1000, Math.round(Number(v) || 0))));
    else if (f.type === "date") out[f.key] = parseDate(v) ? v : "";
    else out[f.key] = text(v, f.type === "textarea" ? 8000 : 300);
  }
  return out;
}

async function discList(res) {
  const recs = await L.listDiscoveries();
  recs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return L.send(res, 200, {
    dbEnabled: L.dbEnabled(),
    records: recs.map((r) => ({
      id: r.id, name: r.fields.name || "Untitled", organization: r.fields.organization || "",
      callDate: r.callDate || "", status: r.status, prepReceived: Boolean(r.prepSubmittedAt),
      proposalId: r.proposalId || "", updatedAt: r.updatedAt, bookedOnline: Boolean(r.bookedOnline), callTime: r.callTime || "",
    })),
  });
}

async function discGet(res, id) {
  const rec = await L.loadDiscovery(id);
  if (!rec) return L.send(res, 404, { error: "That discovery record no longer exists." });
  let proposal = null;
  if (rec.proposalId) {
    const p = (await L.allProposals()).find((x) => x.id === rec.proposalId);
    if (p) proposal = { id: p.id, code: p.accessCode, total: p.package.total, datesLabel: p.retreat.datesLabel, title: p.retreat.title, lodging: p.lodging || [], included: p.package.includedEnhancements || [] };
  }
  return L.send(res, 200, { record: rec, proposal });
}

async function discSave(res, input) {
  needDb();
  const existing = input.id ? await L.loadDiscovery(input.id) : null;
  const statuses = discSchema().statuses;
  const now = new Date().toISOString();
  const rec = existing || {
    id: `disc-${crypto.randomBytes(5).toString("hex")}`,
    prepToken: crypto.randomBytes(12).toString("hex"),
    createdAt: now, status: statuses[0], fields: {},
  };
  if (input.fields) rec.fields = { ...rec.fields, ...cleanDiscFields(input.fields) };
  if (input.status && statuses.includes(input.status)) rec.status = input.status;
  if ("callDate" in input) rec.callDate = parseDate(input.callDate) ? input.callDate : "";
  if ("callTime" in input) rec.callTime = text(input.callTime, 40);
  if ("aiNotes" in input) rec.aiNotes = text(input.aiNotes, 60000);
  if ("proposalId" in input) rec.proposalId = text(input.proposalId, 80);
  if (!rec.fields.name) rec.fields.name = "";
  rec.updatedAt = now;
  await L.saveDiscovery(rec);
  return L.send(res, 200, { ok: true, record: rec });
}

async function discDelete(res, id) {
  needDb();
  const rec = await L.loadDiscovery(id);
  if (!rec) return L.send(res, 404, { error: "That discovery record no longer exists." });
  await L.deleteDiscovery(rec);
  return L.send(res, 200, { ok: true });
}


// ---------- Calendar and tours ----------
async function calendarData(res) {
  const retreats = await L.bookedRetreats();
  const discs = await L.listDiscoveries();
  const tours = await L.listTours();
  return L.send(res, 200, {
    today: L.todayEastern(),
    retreats,
    calls: discs.filter((d) => d.callDate).map((d) => ({ id: d.id, date: d.callDate, time: d.callTime || "", name: d.fields.name || "Client", status: d.status })),
    tours: tours.sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
  });
}

async function tourSave(res, t) {
  needDb();
  const existing = t.id ? await L.loadTour(t.id) : null;
  const tour = existing || {
    id: `tour-${crypto.randomBytes(5).toString("hex")}`, createdAt: new Date().toISOString(),
    status: "Requested", times: [], duration: 60, proposalId: "", discoveryId: "",
  };
  for (const k of ["name", "email", "phone", "note"]) if (k in t) tour[k] = text(t[k], k === "note" ? 1000 : 160);
  if ("guests" in t) tour.guests = String(Math.max(1, Math.min(50, parseInt(t.guests, 10) || 1)));
  if (t.status && ["Requested", "Confirmed", "Declined", "Canceled", "Completed"].includes(t.status)) tour.status = t.status;
  if ("confirmedDate" in t) tour.confirmedDate = parseDate(t.confirmedDate) ? t.confirmedDate : "";
  if ("confirmedTime" in t) tour.confirmedTime = L.parseTime(t.confirmedTime);
  if (tour.status === "Confirmed") {
    if (!tour.confirmedDate || !tour.confirmedTime) throw new L.UserError("Choose the tour's date and time to confirm it.");
    const clash = (await L.bookedRetreats()).find((r) => r.booked && tour.confirmedDate >= r.start && tour.confirmedDate <= r.end);
    if (clash) throw new L.UserError(`That day is during ${clash.title}. Choose another day.`);
  }
  if (!tour.name) throw new L.UserError("Add the visitor's name.");
  tour.updatedAt = new Date().toISOString();
  await L.saveTour(tour);
  return L.send(res, 200, { ok: true, tour });
}

async function tourDelete(res, id) {
  needDb();
  const t = await L.loadTour(id);
  if (!t) return L.send(res, 404, { error: "That tour no longer exists." });
  await L.deleteTour(t);
  return L.send(res, 200, { ok: true });
}
