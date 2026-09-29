// Shared helpers for the proposal API. Files starting with "_" are not
// exposed as endpoints by Vercel.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(process.cwd(), "data");

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadCatalog() {
  return readJSON(path.join(DATA_DIR, "catalog.json"));
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
}

function sameCode(a, b) {
  const x = Buffer.from(normalizeCode(a));
  const y = Buffer.from(normalizeCode(b));
  if (x.length === 0 || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// ---------- Database (Upstash Redis via Vercel Marketplace) ----------
function dbConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}
const dbEnabled = () => Boolean(dbConfig());

// Runs several Redis commands in one request. Returns their results in order.
async function db(...commands) {
  const cfg = dbConfig();
  if (!cfg) throw new Error("Database is not connected.");
  const r = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  const data = await r.json();
  if (!r.ok || !Array.isArray(data)) throw new Error("Database request failed.");
  return data.map((d) => {
    if (d.error) throw new Error(d.error);
    return d.result;
  });
}

function fileProposals() {
  const dir = path.join(DATA_DIR, "proposals");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    const p = readJSON(path.join(dir, f));
    p.source = "file";
    return p;
  });
}

async function dbProposals() {
  if (!dbEnabled()) return [];
  const [ids] = await db(["SMEMBERS", "proposals"]);
  if (!ids || !ids.length) return [];
  const [rows] = await db(["MGET", ...ids.map((id) => `proposal:${id}`)]);
  return rows.filter(Boolean).map((s) => ({ ...JSON.parse(s), source: "db" }));
}

// Every proposal. A saved (database) version replaces a file with the same id.
async function allProposals() {
  const saved = await dbProposals();
  const files = fileProposals();
  const fileIds = new Set(files.map((p) => p.id));
  saved.forEach((p) => {
    if (!fileIds.has(p.id)) return;
    p.source = "file";
    if (!p.guestCode) p.guestCode = (files.find((f) => f.id === p.id) || {}).guestCode;
  });
  const ids = new Set(saved.map((p) => p.id));
  return [...saved, ...files.filter((p) => !ids.has(p.id))];
}

// Which view a code opens: "organizer" (everything) or "guest" (no retainer or balance).
function roleFor(p, norm) {
  if (!p || p.active === false) return null;
  if (sameCode(p.accessCode, norm)) return "organizer";
  if (p.guestCode && isSplit(p) && sameCode(p.guestCode, norm)) return "guest";
  return null;
}

// Finds the active proposal a code opens. Returns { proposal, role } or null.
async function findProposalByCode(code) {
  const norm = normalizeCode(code);
  if (!norm) return null;
  let saved = new Set();
  if (dbEnabled()) {
    const [id, members] = await db(["GET", `code:${norm}`], ["SMEMBERS", "proposals"]);
    saved = new Set(members || []);
    if (id) {
      const [s] = await db(["GET", `proposal:${id}`]);
      const p = s ? JSON.parse(s) : null;
      const role = roleFor(p, norm);
      if (role) return { proposal: p, role };
    }
  }
  for (const f of fileProposals()) {
    let p = f;
    if (saved.has(f.id)) {
      const [s] = await db(["GET", `proposal:${f.id}`]);
      if (!s) continue;
      p = JSON.parse(s);
      if (!p.guestCode && f.guestCode) p.guestCode = f.guestCode;
    }
    const role = roleFor(p, norm);
    if (role) return { proposal: p, role };
  }
  return null;
}

// Slows down code guessing: 25 tries per 10 minutes per visitor (needs the database).
async function tooManyAttempts(req) {
  if (!dbEnabled()) return false;
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const key = `tries:${ip}`;
  try {
    const [n] = await db(["INCR", key], ["EXPIRE", key, 600]);
    return n > 25;
  } catch {
    return false; // never lock people out because of a database hiccup
  }
}

async function saveProposal(p, previous) {
  const cmds = [["SET", `proposal:${p.id}`, JSON.stringify(p)], ["SADD", "proposals", p.id], ["SET", `code:${normalizeCode(p.accessCode)}`, p.id]];
  if (p.guestCode) cmds.push(["SET", `code:${normalizeCode(p.guestCode)}`, p.id]);
  const keep = new Set([normalizeCode(p.accessCode), normalizeCode(p.guestCode || "")]);
  for (const old of [previous && previous.accessCode, previous && previous.guestCode]) {
    if (old && !keep.has(normalizeCode(old))) cmds.push(["DEL", `code:${normalizeCode(old)}`]);
  }
  await db(...cmds);
}

async function deleteProposal(p) {
  const cmds = [["DEL", `proposal:${p.id}`], ["SREM", "proposals", p.id], ["DEL", `code:${normalizeCode(p.accessCode)}`]];
  if (p.guestCode) cmds.push(["DEL", `code:${normalizeCode(p.guestCode)}`]);
  await db(...cmds);
}
// Totals paid for one proposal, from Stripe.
async function paidTotals(proposalId) {
  let retreatCents = 0, addonCents = 0, page;
  const payers = [];
  do {
    const params = { query: `status:'succeeded' AND metadata['proposal']:'${proposalId}'`, limit: "100" };
    if (page) params.page = page;
    const r = await stripe("GET", "payment_intents/search", params);
    for (const pi of r.data) {
      retreatCents += Number(pi.metadata.retreat_cents || 0);
      addonCents += Number(pi.metadata.addon_cents || 0);
      if (pi.metadata.payer) payers.push(pi.metadata.payer);
    }
    page = r.has_more ? r.next_page : null;
  } while (page);
  return { retreatPaid: retreatCents / 100, addonsPaid: addonCents / 100, payers };
}

// What the browser is allowed to see. Guests never receive retainer or balance details.
function publicProposal(p, role = "organizer") {
  const { accessCode, guestCode, source, admin, ...rest } = p;
  const out = JSON.parse(JSON.stringify(rest));
  out.role = role;
  if (out.client) delete out.client.email; // private, admin only
  delete out.discoveryId;
  if (role === "guest" && !out.recapGuests) delete out.recap;
  if (role === "guest") {
    const { retainer, retainerLabel, balanceDueDate, balanceLabel, ...pay } = out.payment;
    out.payment = pay;
  }
  return out;
}

const cents = (dollars) => Math.round(Number(dollars) * 100);

// "single": one payer covers the retreat. "split": several people share it.
// Proposals made before this option existed were split, so they stay split.
function isSplit(p) {
  return (p.payment && p.payment.mode) !== "single";
}

// Recomputes everything on the server so prices can't be edited in the browser.
function priceCart(proposal, catalog, body, role = "organizer") {
  const pay = proposal.payment;
  const split = isSplit(proposal);
  const groupSize = split ? Math.max(1, Number(pay.groupSize) || 1) : 1;
  const total = cents(proposal.package.total);
  const retainer = cents(pay.retainer);
  const shares = clampInt(body.shares, 1, groupSize, 1);

  const lines = [];
  const requests = [];
  let retreatCents = 0;

  const kind = body.paymentType;
  const allowed = !split
    ? ["retainer_full", "balance_full", "full_total", "custom", "addons_only"]
    : role === "guest"
      ? ["full_share", "custom", "addons_only"]
      : ["retainer_share", "full_share", "retainer_full", "balance_full", "custom", "addons_only"];
  if (!allowed.includes(kind)) throw new UserError("Choose what you'd like to pay.");
  if (kind === "retainer_share") {
    retreatCents = Math.ceil((retainer / groupSize) * shares);
    lines.push(line(`Retainer share (${shares} of ${groupSize})`, retreatCents));
  } else if (kind === "full_share") {
    retreatCents = Math.ceil((total / groupSize) * shares);
    lines.push(line(`Retreat share (${shares} of ${groupSize})`, retreatCents));
  } else if (kind === "retainer_full") {
    retreatCents = retainer;
    lines.push(line("Full retainer", retreatCents));
  } else if (kind === "full_total") {
    retreatCents = total;
    lines.push(line("Full retreat amount", retreatCents));
  } else if (kind === "balance_full") {
    retreatCents = total - retainer;
    lines.push(line("Remaining balance", retreatCents));
  } else if (kind === "custom") {
    retreatCents = cents(body.customAmount || 0);
    if (retreatCents < 100) throw new UserError("Enter an amount of at least $1.");
    if (retreatCents > total) throw new UserError("That amount is more than the retreat total.");
    const shareCap = Math.ceil((total / groupSize) * shares);
    if (split && role === "guest" && retreatCents > shareCap) {
      throw new UserError(`That's more than your share. Enter up to $${(shareCap / 100).toFixed(2)}.`);
    }
    lines.push(line("Payment toward retreat", retreatCents));
  } else if (kind !== "addons_only") {
    throw new UserError("Choose what you'd like to pay.");
  }

  const included = new Set(
    (proposal.package.includedEnhancements || []).map((e) => e.catalogId).filter(Boolean)
  );
  const byId = Object.fromEntries(catalog.items.map((i) => [i.id, i]));
  let addonCents = 0;

  for (const entry of Array.isArray(body.cart) ? body.cart : []) {
    const item = byId[entry.id];
    if (!item || included.has(item.id)) continue;
    if (item.price == null) {
      requests.push(item.name);
      continue;
    }
    const unit = cents(item.price);
    if (item.unit === "person" || item.unit === "hour") {
      const qty = clampInt(entry.qty, item.min || 1, 100, item.min || 1);
      const label = item.unit === "person" ? `${qty} guest${qty > 1 ? "s" : ""}` : `${qty} hours`;
      lines.push(line(`${item.name} (${label})`, unit, qty));
      addonCents += unit * qty;
    } else if (split && entry.mode === "share") {
      const amt = Math.ceil((unit / groupSize) * shares);
      lines.push(line(`${item.name} (share, ${shares} of ${groupSize})`, amt));
      addonCents += amt;
    } else {
      lines.push(line(item.name, unit));
      addonCents += unit;
    }
  }

  // Partner lodging paid through Peace on the Pond
  let lodgingCents = 0;
  const nights = Math.max(1, Number(proposal.package.nights) || 1);
  for (const entry of Array.isArray(body.lodging) ? body.lodging : []) {
    const opt = (proposal.lodging || []).find((l) => l.id === entry.id);
    if (!opt || !opt.payThroughUs || !(opt.price > 0)) continue;
    const qty = clampInt(entry.qty, 1, 50, 1);
    const unit = cents(opt.price);
    if (opt.unit === "night") {
      lines.push(line(`${opt.name} (${qty} room${qty > 1 ? "s" : ""}, ${nights} night${nights > 1 ? "s" : ""})`, unit * nights, qty));
      lodgingCents += unit * nights * qty;
    } else if (opt.unit === "person") {
      lines.push(line(`${opt.name} (${qty} guest${qty > 1 ? "s" : ""})`, unit, qty));
      lodgingCents += unit * qty;
    } else {
      lines.push(line(`${opt.name} (${qty} room${qty > 1 ? "s" : ""}, full stay)`, unit, qty));
      lodgingCents += unit * qty;
    }
  }

  if (retreatCents + addonCents + lodgingCents < 100) {
    throw new UserError("Add an enhancement or choose a retreat payment to continue.");
  }
  return { lines, requests, retreatCents, addonCents, lodgingCents, shares };
}

function line(name, unitAmount, quantity = 1) {
  return { name, unitAmount, quantity };
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

class UserError extends Error {}

function send(res, status, obj) {
  res.status(status).setHeader("Cache-Control", "no-store").json(obj);
}

function stripeKey() {
  return process.env.STRIPE_SECRET_KEY || "";
}

// Minimal Stripe REST client (no npm install needed).
async function stripe(method, endpoint, params) {
  const url = new URL(`https://api.stripe.com/v1/${endpoint}`);
  const init = {
    method,
    headers: { Authorization: `Bearer ${stripeKey()}` },
  };
  if (params && method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else if (params) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(flatten(params)).toString();
  }
  const r = await fetch(url, init);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ? data.error.message : "Stripe request failed");
  return data;
}

// Turns nested objects/arrays into Stripe's bracket form: a[b][0][c]=v
function flatten(obj, prefix, out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) continue;
    if (typeof v === "object") flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}


// ---------- Landing page events and site links ----------
function seedEvents() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "events.json"), "utf8"));
}
async function loadEventsData() {
  const seed = seedEvents();
  if (!dbEnabled()) return seed;
  const [ev, st] = await db(["GET", "site:events"], ["GET", "site:settings"]);
  return {
    events: ev ? JSON.parse(ev) : seed.events,
    settings: st ? { ...seed.settings, ...JSON.parse(st) } : seed.settings,
  };
}
async function saveEvents(events) { await db(["SET", "site:events", JSON.stringify(events)]); }
async function saveSettings(settings) { await db(["SET", "site:settings", JSON.stringify(settings)]); }

// Today's date in Georgia (Eastern time), as YYYY-MM-DD.
function todayEastern() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ---------- Discovery calls ----------
async function listDiscoveries() {
  if (!dbEnabled()) return [];
  const [ids] = await db(["SMEMBERS", "discs"]);
  if (!ids || !ids.length) return [];
  const [rows] = await db(["MGET", ...ids.map((id) => `disc:${id}`)]);
  return rows.filter(Boolean).map((s) => JSON.parse(s));
}
async function loadDiscovery(id) {
  if (!dbEnabled() || !id) return null;
  const [s] = await db(["GET", `disc:${id}`]);
  return s ? JSON.parse(s) : null;
}
async function saveDiscovery(rec) {
  await db(["SET", `disc:${rec.id}`, JSON.stringify(rec)], ["SADD", "discs", rec.id], ["SET", `prep:${rec.prepToken}`, rec.id]);
}
async function deleteDiscovery(rec) {
  await db(["DEL", `disc:${rec.id}`], ["SREM", "discs", rec.id], ["DEL", `prep:${rec.prepToken}`]);
}
async function findDiscoveryByToken(token) {
  const t = String(token || "").replace(/[^A-Za-z0-9]/g, "");
  if (!dbEnabled() || t.length < 12) return null;
  const [id] = await db(["GET", `prep:${t}`]);
  return id ? loadDiscovery(id) : null;
}

// ---------- Proposal activity: sent, viewed, accepted, questions, offline payments ----------
const emptyActivity = () => ({ sentAt: "", sentMethod: "", firstViewedAt: "", lastViewedAt: "", views: 0,
  guestFirstViewedAt: "", guestViews: 0, acceptedAt: "", acceptedBy: "", questions: [], offline: [] });
async function loadActivity(id) {
  if (!dbEnabled()) return emptyActivity();
  const [s] = await db(["GET", `act:${id}`]);
  return s ? { ...emptyActivity(), ...JSON.parse(s) } : emptyActivity();
}
async function loadActivities(ids) {
  if (!dbEnabled() || !ids.length) return {};
  const [rows] = await db(["MGET", ...ids.map((id) => `act:${id}`)]);
  const out = {};
  ids.forEach((id, i) => (out[id] = rows[i] ? { ...emptyActivity(), ...JSON.parse(rows[i]) } : emptyActivity()));
  return out;
}
async function saveActivity(id, act) {
  await db(["SET", `act:${id}`, JSON.stringify(act)]);
}
// Read, change, save. Small risk of two changes at the same instant; fine for this use.
async function updateActivity(id, fn) {
  if (!dbEnabled()) return null;
  const act = await loadActivity(id);
  fn(act);
  await saveActivity(id, act);
  return act;
}
const offlineTotal = (act) => (act.offline || []).reduce((s, o) => s + (Number(o.amount) || 0), 0);

// Where a proposal stands, from its activity and payments.
function proposalStatus(p, act, retreatPaid) {
  if (p.active === false) return "Closed";
  const total = Number(p.package.total) || 0, retainer = Number(p.payment.retainer) || 0;
  if (total && retreatPaid >= total - 0.5) return "Paid in full";
  if (retainer && retreatPaid >= retainer - 0.5) return "Retainer paid";
  if (act.acceptedAt) return "Accepted";
  if (act.views || act.guestViews) return "Viewed";
  if (act.sentAt) return "Sent";
  return "Draft";
}

// ---------- Calendar feed token ----------
async function getCalendarToken(regenerate = false) {
  if (!dbEnabled()) return "";
  let [t] = await db(["GET", "site:calToken"]);
  if (!t || regenerate) {
    t = crypto.randomBytes(18).toString("hex");
    await db(["SET", "site:calToken", t]);
  }
  return t;
}

// ---------- Private tours ----------
async function listTours() {
  if (!dbEnabled()) return [];
  const [ids] = await db(["SMEMBERS", "tours"]);
  if (!ids || !ids.length) return [];
  const [rows] = await db(["MGET", ...ids.map((id) => `tour:${id}`)]);
  return rows.filter(Boolean).map((s) => JSON.parse(s));
}
async function loadTour(id) {
  if (!dbEnabled() || !id) return null;
  const [s] = await db(["GET", `tour:${id}`]);
  return s ? JSON.parse(s) : null;
}
async function saveTour(t) { await db(["SET", `tour:${t.id}`, JSON.stringify(t)], ["SADD", "tours", t.id]); }
async function deleteTour(t) { await db(["DEL", `tour:${t.id}`], ["SREM", "tours", t.id]); }

// Booked retreat dates: proposals whose retainer is paid (online or offline).
// Stripe is checked only for proposals that aren't already covered offline.
async function bookedRetreats() {
  const all = (await allProposals()).filter((p) => p.active !== false);
  const acts = await loadActivities(all.map((p) => p.id));
  const out = [];
  for (let i = 0; i < all.length; i += 5) {
    await Promise.all(all.slice(i, i + 5).map(async (p) => {
      const act = acts[p.id] || {};
      let paid = offlineTotal(act);
      const retainer = Number(p.payment.retainer) || 0;
      if (paid < retainer - 0.5 && stripeKey()) { try { paid += (await paidTotals(p.id)).retreatPaid; } catch {} }
      const status = proposalStatus(p, act, paid);
      out.push({ id: p.id, title: p.retreat.title, client: p.client.name, start: p.retreat.startDate, end: p.retreat.endDate,
        status, booked: ["Retainer paid", "Paid in full"].includes(status) });
    }));
  }
  return out;
}

// Eastern time (Georgia) wall clock -> UTC Date, handling daylight saving.
function easternToUtc(dateIso, hhmm) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const asEastern = new Date(guess.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const asUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (asUtc - asEastern));
}
// "2:30 PM", "14:30", "2pm" -> "14:30", or "" if it can't be read.
function parseTime(s) {
  const m = String(s || "").trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/);
  if (!m) return "";
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if (m[3] && m[3].startsWith("p") && h < 12) h += 12;
  if (m[3] && m[3].startsWith("a") && h === 12) h = 0;
  if (h > 23 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// ---------- Availability for calls and tours ----------
function availability() {
  return readJSON(path.join(DATA_DIR, "availability.json"));
}
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const addDaysIso = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();

// Busy times on the calendar: scheduled discovery calls and confirmed tours.
async function busyTimes() {
  const av = availability();
  const busy = [];
  for (const d of await listDiscoveries()) {
    if (!d.callDate || ["Not moving forward"].includes(d.status)) continue;
    const t = parseTime(d.callTime);
    if (t) busy.push({ date: d.callDate, start: toMin(t), end: toMin(t) + (Number(d.callMinutes) || av.callMinutes) });
  }
  for (const t of await listTours()) {
    if (t.status !== "Confirmed" || !t.confirmedDate || !t.confirmedTime) continue;
    busy.push({ date: t.confirmedDate, start: toMin(t.confirmedTime), end: toMin(t.confirmedTime) + (t.duration || av.tourMinutes) });
  }
  return busy;
}

// Open start times for "call" or "tour": { "2026-10-06": ["11:00", "11:30", ...], ... }
async function openSlots(kind) {
  const av = availability();
  const windows = av[kind] || {};
  const length = kind === "tour" ? av.tourMinutes : av.callMinutes;
  const step = av.slotStepMinutes || 30;
  const busy = await busyTimes();
  const booked = kind === "tour" ? (await bookedRetreats()).filter((r) => r.booked) : [];
  // Earliest bookable moment, in Eastern time.
  const nowEast = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const earliest = new Date(nowEast.getTime() + (av.minNoticeHours || 0) * 3600000);
  const earliestIso = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, "0")}-${String(earliest.getDate()).padStart(2, "0")}`;
  const earliestMin = earliest.getHours() * 60 + earliest.getMinutes();
  const today = todayEastern();
  const out = {};
  for (let i = 0; i <= (av.daysAhead || 45); i++) {
    const date = addDaysIso(today, i);
    if (date < earliestIso) continue;
    const wins = windows[String(weekday(date))];
    if (!wins) continue;
    if (booked.some((r) => date >= r.start && date <= r.end)) continue;
    const times = [];
    for (const [ws, we] of wins) {
      for (let s = toMin(ws); s + length <= toMin(we); s += step) {
        if (date === earliestIso && s < earliestMin) continue;
        if (busy.some((b) => b.date === date && s < b.end && s + length > b.start)) continue;
        times.push(toHHMM(s));
      }
    }
    if (times.length) out[date] = times;
  }
  return out;
}

module.exports = {
  availability,
  openSlots,
  getCalendarToken,
  listTours,
  loadTour,
  saveTour,
  deleteTour,
  bookedRetreats,
  easternToUtc,
  parseTime,
  loadActivity,
  loadActivities,
  saveActivity,
  updateActivity,
  offlineTotal,
  proposalStatus,
  listDiscoveries,
  loadDiscovery,
  saveDiscovery,
  deleteDiscovery,
  findDiscoveryByToken,
  loadEventsData,
  saveEvents,
  saveSettings,
  todayEastern,
  loadCatalog,
  normalizeCode,
  findProposalByCode,
  tooManyAttempts,
  allProposals,
  saveProposal,
  deleteProposal,
  paidTotals,
  dbEnabled,
  publicProposal,
  priceCart,
  UserError,
  send,
  stripe,
  stripeKey,
};
