(() => {
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let setup = null;        // { defaults, catalog, dbEnabled }
let rows = [];           // proposal list
let editingId = null;    // id when editing an existing proposal
let codeTouched = false, firstTouched = false, termsTouched = false;

// ---------- API ----------
async function api(action, params = {}) {
  const r = await fetch("/api/admin", {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
    body: JSON.stringify({ action, ...params }),
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401 && action !== "login") { showLogin(); throw new Error(data.error || "Please sign in."); }
  if (!r.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

// ---------- Session ----------
function showLogin() { $("#shell").hidden = true; $("#login").hidden = false; $("#pw").focus(); }
async function start() {
  try {
    await api("session");
    setup = await api("setup");
    $("#login").hidden = true; $("#shell").hidden = false;
    $("#db-banner").hidden = setup.dbEnabled;
    showHome();
  } catch (e) {
    showLogin();
    if (!/sign in/i.test(e.message)) $("#login-error").textContent = e.message;
  }
}
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  try { await api("login", { password: $("#pw").value }); $("#pw").value = ""; start(); }
  catch (err) { $("#login-error").textContent = err.message; }
});
$("#logout").addEventListener("click", async () => { try { await api("logout"); } catch {} showLogin(); });

// ---------- Nav ----------
document.addEventListener("click", (e) => {
  const n = e.target.closest("[data-nav]"); if (!n) return;
  if (n.dataset.nav === "new") openEditor();
  else if (n.dataset.nav === "events") showEvents();
  else if (n.dataset.nav === "disc") showDiscList();
  else if (n.dataset.nav === "home") showHome();
  else if (n.dataset.nav === "cal") showCalendar();
  else showList();
});
function setNav(which) { $$(".side [data-nav]").forEach((b) => b.setAttribute("aria-current", b.dataset.nav === which ? "page" : "false")); }

// ---------- List ----------
function showOnly(id) { ["#view-cal", "#view-home", "#view-list", "#view-edit", "#view-events", "#view-disc-list", "#view-disc"].forEach((v) => ($(v).hidden = v !== id)); window.scrollTo(0, 0); }
async function showList() {
  showOnly("#view-list"); setNav("list");
  $("#rows").innerHTML = `<tr><td colspan="6" class="empty">Loading proposals…</td></tr>`;
  try {
    const data = await api("list");
    rows = data.proposals;
    renderRows(data.paymentsEnabled);
  } catch (e) {
    $("#rows").innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`;
  }
}
function renderRows(paymentsEnabled) {
  if (!rows.length) { $("#rows").innerHTML = `<tr><td colspan="6" class="empty">No proposals yet. Choose New proposal to create your first.</td></tr>`; return; }
  $("#rows").innerHTML = rows.map((p) => {
    const pct = p.paid != null ? Math.min(100, (p.paid / p.total) * 100) : 0;
    const paid = p.paid != null
      ? `${money(p.paid)} <small style="display:inline">of ${money(p.total)}</small><div class="minibar"><span style="width:${pct}%"></span></div>`
      : `<small>${paymentsEnabled ? "Unavailable" : "Stripe not connected"}</small><small>Total ${money(p.total)}</small>`;
    return `<tr>
      <td><span class="client">${esc(p.client)}</span><small>${esc(p.group || "Private group")}</small></td>
      <td>${esc(p.datesLabel)}</td>
      <td><span class="code">${esc(p.code)}</span>${p.guestCode ? `<small style="margin-top:6px">Guests: <span class="code" style="font-size:12px">${esc(p.guestCode)}</span></small>` : ""}</td>
      <td>${paid}</td>
      <td>${statusPill(p.status)}${statusDetail(p)}</td>
      <td><div class="row-actions">
        <a href="/?code=${encodeURIComponent(p.code)}&preview=1" target="_blank" rel="noopener">View</a>
        <a data-sent="${esc(p.id)}" href="${esc(mailto(p.email, emailBody({ first: p.firstName || p.client.split(" ")[0], title: p.title, dates: p.datesLabel, code: p.code, guestCode: p.mode === "split" ? p.guestCode : "" })))}">Email</a>
        <button data-edit="${esc(p.id)}">Edit</button>
        <button data-dup="${esc(p.id)}">Duplicate</button>
        <button data-toggle="${esc(p.id)}">${p.active ? "Close" : "Reopen"}</button>
        ${p.source === "db" ? `<button class="danger" data-del="${esc(p.id)}">Delete</button>` : ""}
      </div></td></tr>`;
  }).join("");
}
$("#rows").addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  const row = rows.find((r) => r.id === (t.dataset.edit || t.dataset.dup || t.dataset.toggle || t.dataset.del));
  if (!row) return;
  try {
    if (t.dataset.edit || t.dataset.dup) {
      t.disabled = true;
      const { proposal } = await api("get", { id: row.id });
      openEditor(proposal, Boolean(t.dataset.dup));
    } else if (t.dataset.toggle) {
      await api("setActive", { id: row.id, active: !row.active });
      toast(row.active ? `${row.code} closed. The code no longer opens the proposal.` : `${row.code} is live again.`);
      showList();
    } else if (t.dataset.del) {
      if (!confirm(`Delete the proposal for ${row.client}? This can't be undone. Payments stay in Stripe.`)) return;
      await api("delete", { id: row.id });
      toast("Proposal deleted."); showList();
    }
  } catch (err) { toast(err.message); t.disabled = false; }
});

// ---------- Editor ----------
const form = $("#form");
const D = () => setup.defaults;

let editingDiscoveryId = "", lastPublishedId = "";
function openEditor(p = null, duplicate = false, fromDisc = null) {
  editingId = p && !duplicate ? p.id : null;
  $("#edit-title").textContent = editingId ? `Edit ${p.client.name}'s proposal` : duplicate ? "New proposal (copied)" : "New proposal";
  $("#publish").textContent = editingId ? "Save changes" : "Publish proposal";
  form.reset(); $("#warn").textContent = "";
  const d = D();
  const pay = p ? p.payment : null, pkg = p ? p.package : null, adm = (p && p.admin) || {};

  const v = {
    clientName: p && !duplicate ? p.client.name : "",
    clientEmail: p && !duplicate ? p.client.email || "" : "",
    firstName: p && !duplicate ? p.client.firstName : "",
    group: p && !duplicate ? p.client.group : "",
    title: p && !duplicate ? p.retreat.title : "",
    capacity: p ? p.retreat.capacity : d.capacity,
    startDate: p && !duplicate ? p.retreat.startDate : "",
    endDate: p && !duplicate ? p.retreat.endDate : "",
    letter: (p ? p.letter : d.letter).join("\n\n"),
    packageName: pkg ? pkg.name : d.packageName,
    nightlyRate: pkg ? pkg.nightlyRate : d.nightlyRate,
    paymentMode: pay ? (pay.mode || "split") : "single",
    groupSize: pay && pay.groupSize > 1 ? pay.groupSize : d.groupSize,
    lineItem: pkg ? pkg.lineItem.replace(/^.*?(venue)/i, "$1") : d.lineItem,
    totalOverride: adm.totalOverride || (pkg && Math.abs(pkg.total - pkg.nightlyRate * pkg.nights) > 0.5 ? pkg.total : ""),
    retainerPct: adm.retainerPct ?? (pay ? Math.round((pay.retainer / pkg.total) * 100) : d.retainerPct),
    retainerOverride: adm.retainerOverride || "",
    dueDays: adm.dueDays ?? (p ? daysBetween(p.payment.balanceDueDate, p.retreat.startDate) : d.dueDays),
    terms: p && !duplicate ? p.terms.join("\n\n") : d.terms.join("\n\n"),
    accessCode: p && !duplicate ? p.accessCode : "",
    guestCode: p && !duplicate ? (p.guestCode || "") : "",
  };
  // Keep an exact retainer when it doesn't match the percentage (e.g. rounded by hand).
  if (pay && !adm.retainerPct && Math.abs(pay.retainer - Math.round(pkg.total * v.retainerPct / 100)) > 0) v.retainerOverride = pay.retainer;
  Object.entries(v).forEach(([k, val]) => { if (form[k]) form[k].value = val ?? ""; });
  form.showPayerNames.checked = p ? p.showPayerNames !== false : true;
  form.active.checked = p && !duplicate ? p.active !== false : true;

  renderInclusions(pkg ? pkg.inclusions : d.inclusions);
  const includedNames = pkg ? pkg.includedEnhancements.map((e) => e.name) : d.included;
  renderIncluded(includedNames);
  renderLodging(p ? p.lodging || [] : []);
  renderRecap(p && !duplicate ? p.recap || [] : []);
  form.recapGuests.checked = Boolean(p && !duplicate && p.recapGuests);
  renderRecommended(p && !duplicate ? p.recommended || [] : []);
  editingDiscoveryId = p && !duplicate ? p.discoveryId || "" : "";
  if (fromDisc) applyDiscovery(fromDisc);
  loadActivityPanel(editingId ? p : null);
  calData = null; $("#overlap").textContent = ""; checkOverlap();

  codeTouched = Boolean(editingId); firstTouched = Boolean(editingId); termsTouched = Boolean(editingId);
  guestTouched = Boolean(editingId && p.guestCode);
  $$("details.more", form).forEach((dt) => (dt.open = Boolean(dt.querySelector("input").value)));
  showTab("form");
  showOnly("#view-edit"); setNav(editingId ? "list" : "new");
  update();
  window.scrollTo(0, 0);
  form.clientName.focus();
}
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

function renderInclusions(list) {
  $("#inclusions").innerHTML = list.map((t) => `<div class="li"><input type="text" value="${esc(t)}" aria-label="Included item"><button type="button" aria-label="Remove line">✕</button></div>`).join("");
}
$("#inclusions").addEventListener("click", (e) => { if (e.target.closest("button")) { e.target.closest(".li").remove(); } });
$("#add-inclusion").addEventListener("click", () => {
  const div = document.createElement("div"); div.className = "li";
  div.innerHTML = '<input type="text" placeholder="Something else included" aria-label="Included item"><button type="button" aria-label="Remove line">✕</button>';
  $("#inclusions").append(div); $("input", div).focus();
});

function renderIncluded(checked) {
  const names = [...new Set([...setup.catalog.items.filter((i) => i.price != null).map((i) => i.name), ...(D().extraEnhancements || []), ...checked])];
  const on = new Set(checked.map((n) => n.toLowerCase()));
  $("#included").innerHTML = names.map((n) => `<label class="check"><input type="checkbox" value="${esc(n)}" ${on.has(n.toLowerCase()) ? "checked" : ""}> ${esc(n)}</label>`).join("");
}
$("#add-enh").addEventListener("click", () => {
  const n = $("#custom-enh").value.trim(); if (!n) return;
  const checked = $$("#included input:checked").map((i) => i.value);
  renderIncluded([...checked, n]); $("#custom-enh").value = "";
});

// ---------- Partner lodging ----------
function lodgingBlock(l = {}) {
  const div = document.createElement("div");
  div.className = "lodge";
  div.dataset.id = l.id || "";
  div.innerHTML = `
    <div class="lodge-head"><b>Lodging option</b><button type="button" data-remove-lodge>Remove</button></div>
    <div class="grid2">
      <label>Partner name<input type="text" data-k="name" value="${esc(l.name || "")}" placeholder="e.g. The Inn at Sweetwater"></label>
      <label>Location or distance<input type="text" data-k="location" value="${esc(l.location || "")}" placeholder="e.g. 8 minutes from Peace on the Pond"></label>
    </div>
    <label>Short description<textarea data-k="description" placeholder="Room type, what's included, anything guests should know">${esc(l.description || "")}</textarea></label>
    <div class="grid3">
      <label>Price<span class="money"><input type="number" data-k="price" min="0" step="1" value="${l.price ?? ""}"></span></label>
      <label>Price is<select data-k="unit">
        <option value="night"${(l.unit || "night") === "night" ? " selected" : ""}>Per room, per night</option>
        <option value="person"${l.unit === "person" ? " selected" : ""}>Per guest, full stay</option>
        <option value="stay"${l.unit === "stay" ? " selected" : ""}>Per room, full stay</option>
      </select></label>
      <label>Partner booking link<input type="text" data-k="link" value="${esc(l.link || "")}" placeholder="https://"></label>
    </div>
    <label class="toggle"><input type="checkbox" data-k="payThroughUs" ${l.payThroughUs ? "checked" : ""} style="accent-color:var(--forest)"> Guests can also pay for this through Peace on the Pond</label>`;
  return div;
}
function renderLodging(list) {
  const box = $("#lodging"); box.innerHTML = "";
  (list || []).forEach((l) => box.append(lodgingBlock(l)));
}
$("#add-lodging").addEventListener("click", () => { const b = lodgingBlock(); $("#lodging").append(b); $("input", b).focus(); });
$("#lodging").addEventListener("click", (e) => { if (e.target.closest("[data-remove-lodge]")) e.target.closest(".lodge").remove(); });
function collectLodging() {
  return $$("#lodging .lodge").map((b) => {
    const o = { id: b.dataset.id || undefined };
    $$("[data-k]", b).forEach((el) => (o[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value));
    return o;
  });
}

// Access code
function codeBase() {
  const src = form.group.value.trim() || form.clientName.value.trim().split(/\s+/).slice(-1)[0] || "";
  const words = src.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  return ((words.find((x) => x.length >= 3) || words[0] || "RETREAT").slice(0, 12)).replace(/\d+$/, "") || "RETREAT";
}
const rand = (n) => Array.from({ length: n }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");
const makeCode = () => codeBase() + rand(4);
const makeGuestCode = () => codeBase() + "-" + rand(3);
let guestTouched = false;
$("#regen").addEventListener("click", () => { form.accessCode.value = makeCode(); codeTouched = true; });
$("#regen-guest").addEventListener("click", () => { form.guestCode.value = makeGuestCode(); guestTouched = true; });

// Calculations (the server repeats these when saving)
function calc() {
  const f = form;
  const s = f.startDate.value, e = f.endDate.value;
  const n = s && e ? daysBetween(s, e) : 0;
  const split = f.paymentMode.value === "split";
  const rate = +f.nightlyRate.value || 0, g = split ? Math.max(2, +f.groupSize.value || 2) : 1;
  const total = +f.totalOverride.value > 0 ? +f.totalOverride.value : rate * Math.max(n, 0);
  const retainer = +f.retainerOverride.value > 0 ? Math.min(+f.retainerOverride.value, total) : Math.round(total * (+f.retainerPct.value || 0) / 100);
  let due = null;
  if (s) { due = new Date(s + "T12:00:00"); due.setDate(due.getDate() - (+f.dueDays.value || 0)); }
  return { split, n, rate, g, total, retainer, balance: total - retainer, due, share: Math.ceil((total / g) * 100) / 100 };
}
function rangeLabel(a, b) {
  if (!a || !b) return "";
  const A = new Date(a + "T12:00:00"), B = new Date(b + "T12:00:00"), m = (x) => x.toLocaleDateString("en-US", { month: "long" });
  if (A.getFullYear() !== B.getFullYear()) return `${m(A)} ${A.getDate()}, ${A.getFullYear()}–${m(B)} ${B.getDate()}, ${B.getFullYear()}`;
  if (A.getMonth() === B.getMonth()) return `${m(A)} ${A.getDate()}–${B.getDate()}, ${A.getFullYear()}`;
  return `${m(A)} ${A.getDate()}–${m(B)} ${B.getDate()}, ${A.getFullYear()}`;
}
const longDate = (dt) => dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function update() {
  const f = form, c = calc();
  if (!codeTouched && (f.group.value || f.clientName.value) && !f.accessCode.value.startsWith(codeBase())) f.accessCode.value = makeCode();
  if (f.paymentMode.value === "split" && !guestTouched && (f.group.value || f.clientName.value) && !f.guestCode.value.startsWith(codeBase() + "-")) f.guestCode.value = makeGuestCode();
  if (!firstTouched) f.firstName.value = f.clientName.value.trim().split(/\s+/)[0] || "";
  $("#s-total").textContent = money(c.total);
  $("#s-rate").textContent = +f.totalOverride.value > 0 ? "Custom package price" : c.n > 0 ? `${money(c.rate)} per night, ${c.n} night${c.n > 1 ? "s" : ""}` : "Add dates to calculate";
  $("#s-dates").textContent = c.n > 0 ? rangeLabel(f.startDate.value, f.endDate.value) : "Choose dates";
  $("#s-ret").textContent = money(c.retainer);
  $("#s-bal").textContent = money(c.balance);
  $("#s-due").textContent = c.due ? longDate(c.due) : "";
  $("#s-share").textContent = `${money(c.share)} (${c.g} ways)`;
  $("#s-share-row").hidden = !c.split;
  $("#split-row").hidden = !c.split;
  $("#guest-code-row").hidden = !c.split;
  $("#mode-hint").textContent = c.split
    ? "Everyone pays their own share. The guest code lets people see the retreat and pay their share without seeing the retainer or balance."
    : "The organizer pays the retainer, the balance, or the full amount. No shares or guest code.";
  if (!$("#preview").hidden) renderPreview();
}
form.addEventListener("change", (e) => { if (e.target.name === "startDate" || e.target.name === "endDate") checkOverlap(); });
form.addEventListener("input", (e) => {
  if (e.target.name === "firstName") firstTouched = true;
  if (e.target.name === "accessCode") codeTouched = true;
  if (e.target.name === "guestCode") guestTouched = true;
  if (e.target.name === "terms") termsTouched = true;
  update();
});

// Preview tab
function showTab(t) {
  $("#tab-form").setAttribute("aria-pressed", t === "form"); $("#tab-preview").setAttribute("aria-pressed", t === "preview");
  form.hidden = t !== "form"; $("#preview").hidden = t !== "preview";
  if (t === "preview") renderPreview();
}
$("#tab-form").addEventListener("click", () => showTab("form"));
$("#tab-preview").addEventListener("click", () => showTab("preview"));
function renderPreview() {
  const f = form, c = calc(), title = f.title.value || (f.group.value ? `The ${f.group.value} Retreat` : "Your Retreat");
  $("#preview").innerHTML = `<div class="pv">
    <div class="pv-hero"><p>Prepared for ${esc(f.clientName.value || "your client")}${f.group.value ? ", " + esc(f.group.value) : ""}</p>
      <h2>${esc(title)}</h2><div>${esc(rangeLabel(f.startDate.value, f.endDate.value) || "Dates to come")}${c.n > 0 ? `, ${c.n} nights` : ""}</div></div>
    <div class="pv-body">
      <div class="letter"><h3>Dear ${esc(f.firstName.value || "Friend")},</h3>${f.letter.value.split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      <div class="pv-inv"><small style="color:var(--gold-ink);font-weight:600">Your investment</small><div class="t" style="border:0;padding:4px 0 10px">${money(c.total)}</div>
        <div><span>Retainer</span><b>${money(c.retainer)}</b></div><div><span>Balance</span><b>${money(c.balance)}</b></div>
        ${c.split ? `<div><span>Each share</span><b>${money(c.share)}</b></div>` : ""}</div>
    </div></div>
    <p style="color:var(--muted);font-size:13.5px;margin-top:10px">The full page also shows the grounds, enhancements menu, pairings, and payment options. After publishing, use View as client to see it exactly as your client will.</p>`;
}

// Save / publish
function collect() {
  const f = form;
  return {
    clientName: f.clientName.value, clientEmail: f.clientEmail.value, firstName: f.firstName.value, group: f.group.value,
    title: f.title.value, capacity: f.capacity.value, startDate: f.startDate.value, endDate: f.endDate.value,
    letter: f.letter.value, packageName: f.packageName.value, nightlyRate: f.nightlyRate.value,
    paymentMode: f.paymentMode.value, groupSize: f.groupSize.value, lineItem: f.lineItem.value, totalOverride: f.totalOverride.value,
    retainerPct: f.retainerPct.value, retainerOverride: f.retainerOverride.value, dueDays: f.dueDays.value,
    terms: f.terms.value, accessCode: f.accessCode.value, guestCode: f.guestCode.value, active: f.active.checked, showPayerNames: f.showPayerNames.checked,
    inclusions: $$("#inclusions input").map((i) => i.value),
    included: $$("#included input:checked").map((i) => i.value),
    lodging: collectLodging(),
    recap: $$("#recap .recap-row").map((r) => ({ label: $("input", r).value, text: $("textarea", r).value })),
    recapGuests: form.recapGuests.checked,
    recommended: $$("#recommended input:checked").map((i) => i.value),
    discoveryId: editingDiscoveryId,
  };
}
$("#publish").addEventListener("click", async () => {
  const w = $("#warn"); w.textContent = "";
  const btn = $("#publish"); const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const fields = collect();
    const r = await api("save", { id: editingId, fields });
    if (editingId) { toast("Changes saved. The client page is updated."); showList(); }
    else { lastPublishedId = r.id; showDone(r.code, r.guestCode, fields); }
  } catch (e) { w.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = label; }
});

const EMAIL_SUBJECT = "Your retreat proposal from Peace on the Pond";
function emailBody({ first, title, dates, code, guestCode }) {
  const site = `https://${location.host}`;
  const guestPart = guestCode ? `

For your guests: please share this link and code with them instead.
${site}/?code=${encodeURIComponent(guestCode)}
Guest code: ${guestCode}
Their version shows the retreat and lets each person pay their share, without the retainer and balance details.` : "";
  return `Hi ${first},

Thank you for considering Peace on the Pond for ${title}, ${dates}. We are honored by the opportunity to help create a restorative space for you and your group.

Your personalized proposal is ready. You can view it here:
${site}/?code=${encodeURIComponent(code)}
Access code: ${code}

Inside, you'll find your package details, the wellness enhancements you can add, and secure online payment. A retainer holds your dates, and flexible payment options are available at checkout.${guestPart}

We'd love to walk through it with you. Reply to this email or call us at (424) 482-1765 anytime.

With care,
Peace on the Pond
(424) 482-1765
info@peaceonthepond.com`;
}
const mailto = (to, body) => `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(EMAIL_SUBJECT)}&body=${encodeURIComponent(body)}`;

function showDone(code, guestCode, f) {
  $("#done-code").textContent = code;
  $("#done-guest").textContent = guestCode || "";
  $("#done-guest").parentElement.hidden = !guestCode;
  $("#done-view").href = `/?code=${encodeURIComponent(code)}&preview=1`;
  const first = f.firstName || f.clientName.split(" ")[0];
  const title = f.title || (f.group ? `The ${f.group} Retreat` : "your retreat");
  const body = emailBody({ first, title, dates: rangeLabel(f.startDate, f.endDate), code, guestCode });
  $("#done-msg").value = body;
  $("#done-email").href = mailto(f.clientEmail, body);
  $("#done").hidden = false;
  $("#done").dataset.id = lastPublishedId;
}
$("#done-msg").addEventListener("input", () => { $("#done-email").href = $("#done-email").href.replace(/body=.*$/, "body=" + encodeURIComponent($("#done-msg").value)); });
$("#done-close").addEventListener("click", () => { $("#done").hidden = true; showList(); });
$("#done-email").addEventListener("click", () => markSent($("#done").dataset.id, "email"));
$("#done-copy").addEventListener("click", async () => {
  markSent($("#done").dataset.id, "copied");
  try { await navigator.clipboard.writeText($("#done-msg").value); toast("Message copied"); }
  catch { $("#done-msg").select(); toast("Select the message and copy it"); }
});

// ---------- Landing page events ----------
let events = [], today = "";
const evDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

async function showEvents() {
  showOnly("#view-events"); setNav("events");
  $("#ev-form-card").hidden = true;
  try {
    const d = await api("events");
    events = d.events; today = d.today;
    renderEvents();
    $("#st-form").phone.value = d.settings.phone || "";
    $("#st-form").bookingUrl.value = d.settings.bookingUrl || "";
  } catch (e) { $("#ev-rows").innerHTML = `<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`; }
}
function renderEvents() {
  if (!events.length) { $("#ev-rows").innerHTML = `<tr><td colspan="5" class="empty">No events yet. Choose Add event to create one.</td></tr>`; return; }
  $("#ev-rows").innerHTML = events.map((e) => {
    const past = (e.endDate || e.date) < today;
    const when = evDate(e.date) + (e.endDate && e.endDate !== e.date ? ` to ${evDate(e.endDate)}` : "");
    return `<tr style="${past ? "opacity:.55" : ""}">
      <td>${esc(when)}${e.time ? `<small>${esc(e.time)}</small>` : ""}</td>
      <td><span class="client">${esc(e.title)}</span>${e.description ? `<small>${esc(e.description)}</small>` : ""}</td>
      <td>${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.linkLabel || "Learn more")}</a>` : "<small>No link</small>"}</td>
      <td><span class="status ${past ? "" : "live"}">${past ? "Past (hidden)" : "Showing"}</span></td>
      <td><div class="row-actions"><button data-ev-edit="${esc(e.id)}">Edit</button><button class="danger" data-ev-del="${esc(e.id)}">Delete</button></div></td>
    </tr>`;
  }).join("");
}
function openEventForm(e = null) {
  const f = $("#ev-form"); f.reset(); $("#ev-warn").textContent = "";
  f.dataset.id = e ? e.id : "";
  $("#ev-form-title").textContent = e ? "Edit event" : "Add event";
  if (e) ["date", "endDate", "time", "title", "description", "link", "linkLabel"].forEach((k) => (f[k].value = e[k] || ""));
  $("#ev-form-card").hidden = false; f.date.focus();
  $("#ev-form-card").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#ev-new").addEventListener("click", () => openEventForm());
$("#ev-cancel").addEventListener("click", () => ($("#ev-form-card").hidden = true));
$("#ev-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target, btn = $("button[type=submit]", f);
  const event = { id: f.dataset.id || undefined };
  ["date", "endDate", "time", "title", "description", "link", "linkLabel"].forEach((k) => (event[k] = f[k].value));
  btn.disabled = true;
  try {
    const d = await api("saveEvent", { event });
    events = d.events; renderEvents(); $("#ev-form-card").hidden = true;
    toast("Event saved. It shows on the landing page within a minute.");
  } catch (e) { $("#ev-warn").textContent = e.message; }
  finally { btn.disabled = false; }
});
$("#ev-rows").addEventListener("click", async (ev) => {
  const t = ev.target.closest("button"); if (!t) return;
  const e = events.find((x) => x.id === (t.dataset.evEdit || t.dataset.evDel)); if (!e) return;
  if (t.dataset.evEdit) return openEventForm(e);
  if (!confirm(`Delete "${e.title}"?`)) return;
  try { const d = await api("deleteEvent", { id: e.id }); events = d.events; renderEvents(); toast("Event deleted."); }
  catch (err) { toast(err.message); }
});
$("#st-use-call").addEventListener("click", () => { $("#st-form").bookingUrl.value = `https://${location.host}/call/`; toast("Now click Save contact links."); });
$("#st-form").addEventListener("submit", async (ev) => {
  ev.preventDefault(); $("#st-warn").textContent = "";
  const f = ev.target;
  try { await api("saveSettings", { settings: { phone: f.phone.value, bookingUrl: f.bookingUrl.value } }); toast("Contact links saved."); }
  catch (e) { $("#st-warn").textContent = e.message; }
});

// ---------- Proposal: recap and suggestions ----------
function recapRow(r = {}) {
  const d = document.createElement("div"); d.className = "recap-row";
  d.innerHTML = `<input type="text" value="${esc(r.label || "")}" placeholder="e.g. Your intention" aria-label="Recap label">
    <textarea aria-label="Recap text" placeholder="What you heard">${esc(r.text || "")}</textarea>
    <button type="button" aria-label="Remove line">✕</button>`;
  return d;
}
function renderRecap(list) { const box = $("#recap"); box.innerHTML = ""; list.forEach((r) => box.append(recapRow(r))); }
$("#add-recap").addEventListener("click", () => { const r = recapRow(); $("#recap").append(r); $("input", r).focus(); });
$("#recap").addEventListener("click", (e) => { if (e.target.closest("button")) e.target.closest(".recap-row").remove(); });
function renderRecommended(ids) {
  const on = new Set(ids);
  $("#recommended").innerHTML = setup.catalog.items.map((i) => `<label class="check"><input type="checkbox" value="${esc(i.id)}" ${on.has(i.id) ? "checked" : ""}> ${esc(i.name)}</label>`).join("");
}

// Fill a new proposal from a discovery call.
function applyDiscovery(rec) {
  const f = rec.fields || {}, set = (k, v) => { if (v && form[k]) form[k].value = v; };
  editingDiscoveryId = rec.id;
  set("clientName", f.name); set("clientEmail", f.email); set("group", f.organization);
  set("startDate", f.startDate); set("endDate", f.endDate);
  if (/split|partnership/i.test(f.payment || "")) {
    form.paymentMode.value = "split";
    if (+f.guests > 1) form.groupSize.value = f.guests;
  }
  const recap = [
    ["Your intention", f.purpose], ["How guests should feel", f.feel], ["Celebrating", f.celebration],
    ["Food you love", f.foodInterests], ["Dietary needs", f.dietary], ["Colors and decor", [f.colors, f.theme].filter(Boolean).join(". ")],
  ].filter(([, t]) => t && String(t).trim()).map(([label, text]) => ({ label, text }));
  renderRecap(recap);
  const byName = Object.fromEntries(setup.catalog.items.map((i) => [i.name.toLowerCase(), i.id]));
  renderRecommended((f.interests || []).map((n) => byName[String(n).toLowerCase()]).filter(Boolean));
  firstTouched = false;
  $("#edit-title").textContent = `New proposal for ${f.name || "your client"}`;
  update();
}

// ---------- Discovery calls ----------
let disc = null, discTimer = null, discSaving = Promise.resolve();
const discFields = () => setup.discovery.sections.flatMap((s) => s.fields);

async function showDiscList() {
  showOnly("#view-disc-list"); setNav("disc");
  $("#disc-rows").innerHTML = `<tr><td colspan="5" class="empty">Loading…</td></tr>`;
  try {
    const d = await api("discList");
    $("#disc-rows").innerHTML = d.records.length ? d.records.map((r) => `<tr>
      <td><span class="client">${esc(r.name)}</span><small>${esc(r.organization || "")}${r.bookedOnline ? " (booked online)" : ""}</small></td>
      <td>${r.callDate ? esc(new Date(r.callDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })) + (r.callTime ? `<small>${esc(r.callTime)}</small>` : "") : "<small>Not set</small>"}</td>
      <td><span class="status ${r.status === "Booked" ? "live" : ""}">${esc(r.status)}</span></td>
      <td>${r.prepReceived ? '<span class="status live">Received</span>' : "<small>Not yet</small>"}</td>
      <td><div class="row-actions"><button data-disc-open="${esc(r.id)}">Open</button>
        <a href="/admin/sheet.html?id=${encodeURIComponent(r.id)}" target="_blank" rel="noopener">Sheet</a></div></td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">No discovery calls yet. Choose New discovery call before your next call.</td></tr>`;
  } catch (e) { $("#disc-rows").innerHTML = `<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`; }
}
$("#disc-rows").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-disc-open]"); if (!b) return;
  try { const d = await api("discGet", { id: b.dataset.discOpen }); openDisc(d.record, d.proposal); } catch (err) { toast(err.message); }
});
$("#disc-new").addEventListener("click", () => openDisc(null));

function discInput(f, value) {
  const v = value ?? "";
  const cls = `${f.important ? "important " : ""}${f.type === "textarea" || f.type === "checks" ? "wide" : ""}`;
  if (f.type === "textarea") return `<label class="${cls}">${esc(f.label)}<textarea name="${f.key}" class="${f.big ? "big" : ""}">${esc(v)}</textarea></label>`;
  if (f.type === "select") return `<label class="${cls}">${esc(f.label)}<select name="${f.key}">${f.options.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  if (f.type === "checks") {
    const on = new Set(Array.isArray(v) ? v : []);
    return `<div class="${cls}"><div style="font-weight:500;font-size:13.5px;margin-bottom:6px">${esc(f.label)}</div><div class="checks" data-checks="${f.key}">${
      setup.catalog.items.map((i) => `<label class="check"><input type="checkbox" value="${esc(i.name)}" ${on.has(i.name) ? "checked" : ""}> ${esc(i.name)}</label>`).join("")}</div></div>`;
  }
  return `<label class="${cls}">${esc(f.label)}<input type="${f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}" name="${f.key}" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}"></label>`;
}

function openDisc(rec, proposal = null) {
  disc = rec || { id: null, fields: {}, status: setup.discovery.statuses[0], callDate: "", callTime: "", aiNotes: "" };
  showOnly("#view-disc"); setNav("disc");
  $("#disc-form").innerHTML = setup.discovery.sections.map((s) => `<div class="card disc-sec"><h2>${esc(s.title)}</h2>
    <div class="disc-grid">${s.fields.map((f) => discInput(f, disc.fields[f.key])).join("")}</div></div>`).join("");
  $("#disc-status").innerHTML = setup.discovery.statuses.map((s) => `<option ${s === disc.status ? "selected" : ""}>${esc(s)}</option>`).join("");
  $("#disc-date").value = disc.callDate || ""; $("#disc-time").value = disc.callTime || "";
  $("#disc-ai").value = disc.aiNotes || "";
  $("#disc-saved").textContent = disc.id ? "Changes save automatically." : "Start typing. This record saves automatically.";
  renderDiscHeader(proposal);
}

function renderDiscHeader(proposal) {
  $("#disc-title").textContent = disc.fields.name ? `Discovery call: ${disc.fields.name}` : "New discovery call";
  const has = Boolean(disc.id);
  ["#disc-prep-copy", "#disc-prep-email", "#disc-tour", "#disc-sheet", "#disc-proposal", "#disc-delete"].forEach((s) => ($(s).style.display = has ? "" : "none"));
  if (has) {
    $("#disc-sheet").href = `/admin/sheet.html?id=${encodeURIComponent(disc.id)}`;
    $("#disc-tour").href = tourInviteMailto();
    $("#disc-prep-email").href = `mailto:${encodeURIComponent(disc.fields.email || "")}?subject=${encodeURIComponent("Before our call: a few quick questions")}&body=${encodeURIComponent(prepEmail())}`;
    $("#disc-proposal").textContent = disc.proposalId ? "Open proposal" : "Create proposal";
    $("#disc-proposal").dataset.proposal = disc.proposalId || "";
  }
  const b = $("#disc-prep-banner");
  if (disc.prepSubmittedAt && disc.prep) {
    const qs = discFields().filter((f) => f.prep && disc.prep[f.key]);
    b.innerHTML = `<b>The client filled in the prep form on ${esc(new Date(disc.prepSubmittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }))}.</b>
      Their answers are already in the fields below wherever they were blank. Here's what they wrote:
      <dl class="prep-answers">${qs.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(disc.prep[f.key])}</dd>`).join("")}</dl>`;
    b.hidden = false;
  } else b.hidden = true;
}

const prepLink = () => `https://${location.host}/prep/?t=${disc.prepToken}`;
function prepEmail() {
  const first = String(disc.fields.name || "").split(/\s+/)[0] || "there";
  return `Hi ${first},

We're looking forward to our call! To make the most of our time together, please take a few minutes to share some details about your retreat here:

${prepLink()}

It covers the basics, like your dates, group size, food preferences, and the feel you're hoping for, so we can spend our call on your vision.

With care,
Peace on the Pond
(424) 482-1765
info@peaceonthepond.com`;
}
$("#disc-prep-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(prepLink()); toast("Prep form link copied"); } catch { prompt("Copy this link:", prepLink()); }
});

function collectDisc() {
  const fields = {};
  for (const f of discFields()) {
    if (f.type === "checks") fields[f.key] = $$(`[data-checks="${f.key}"] input:checked`).map((i) => i.value);
    else { const el = $("#disc-form").elements[f.key]; if (el) fields[f.key] = el.value; }
  }
  return { id: disc.id, fields, status: $("#disc-status").value, callDate: $("#disc-date").value, callTime: $("#disc-time").value, aiNotes: $("#disc-ai").value };
}
function queueDiscSave() {
  $("#disc-saved").textContent = "Saving…";
  clearTimeout(discTimer);
  discTimer = setTimeout(saveDiscNow, 900);
}
async function saveDiscNow() {
  clearTimeout(discTimer);
  const run = async () => {
    try {
      const d = await api("discSave", { record: collectDisc() });
      const wasNew = !disc.id;
      disc = { ...disc, ...d.record };
      $("#disc-saved").textContent = `Saved at ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
      if (wasNew || !$("#disc-title").textContent.includes(disc.fields.name || "\u0000")) renderDiscHeader();
    } catch (e) { $("#disc-saved").textContent = "Not saved: " + e.message; }
  };
  discSaving = discSaving.then(run);
  return discSaving;
}
["#disc-form", "#disc-status", "#disc-date", "#disc-time", "#disc-ai"].forEach((s) => {
  $(s).addEventListener("input", queueDiscSave);
  $(s).addEventListener("change", queueDiscSave);
});
window.addEventListener("beforeunload", (e) => { if ($("#disc-saved").textContent === "Saving…") { e.preventDefault(); e.returnValue = ""; } });

$("#disc-proposal").addEventListener("click", async (e) => {
  const pid = e.currentTarget.dataset.proposal;
  await saveDiscNow();
  if (pid) {
    try { const { proposal } = await api("get", { id: pid }); openEditor(proposal); } catch (err) { toast(err.message); }
  } else openEditor(null, false, disc);
});
$("#disc-delete").addEventListener("click", async () => {
  if (!disc.id || !confirm(`Delete the discovery record for ${disc.fields.name || "this client"}? This can't be undone.`)) return;
  try { await api("discDelete", { id: disc.id }); toast("Record deleted."); showDiscList(); } catch (e) { toast(e.message); }
});

// ---------- Status helpers ----------
const shortDate = (iso) => iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
function statusPill(s) {
  const cls = ["Paid in full", "Retainer paid", "Accepted"].includes(s) ? "good" : s === "Closed" ? "" : s === "Draft" ? "warn" : "";
  return `<span class="pill ${cls}">${esc(s)}</span>`;
}
function statusDetail(p) {
  const bits = [];
  if (p.acceptedAt) bits.push(`Accepted ${shortDate(p.acceptedAt)} by ${esc(p.acceptedBy)}`);
  if (p.views) bits.push(`Viewed ${p.views} time${p.views > 1 ? "s" : ""}, last ${shortDate(p.lastViewedAt)}`);
  if (p.guestViews) bits.push(`Guests viewed ${p.guestViews} time${p.guestViews > 1 ? "s" : ""}`);
  if (!p.views && p.sentAt) bits.push(`Sent ${shortDate(p.sentAt)}, not opened yet`);
  if (p.openQuestions) bits.push(`<b style="color:#9b2c1f">${p.openQuestions} new question${p.openQuestions > 1 ? "s" : ""}</b>`);
  return bits.length ? `<small style="margin-top:6px">${bits.join("<br>")}</small>` : "";
}
function markSent(id, method = "email") { api("markSent", { id, method }).catch(() => {}); }
document.addEventListener("click", (e) => { const a = e.target.closest("[data-sent]"); if (a) markSent(a.dataset.sent); });

// Balance reminder email
function reminderMailto(r) {
  const site = `https://${location.host}`;
  const remaining = Math.max(0, r.total - (r.paid || 0));
  const guestPart = r.mode === "split" && r.guestCode ? `\n\nGuests can pay their shares with this link and code:\n${site}/?code=${encodeURIComponent(r.guestCode)}\nGuest code: ${r.guestCode}` : "";
  const body = `Hi ${r.firstName || r.client.split(" ")[0]},

We're looking forward to hosting ${r.title}, ${r.datesLabel}!

This is a friendly reminder that the remaining balance of ${money(remaining)} is due by ${new Date(r.balanceDueDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. You can pay securely here:
${site}/?code=${encodeURIComponent(r.code)}
Access code: ${r.code}${guestPart}

If you have any questions, reply to this email or call us at (424) 482-1765.

With care,
Peace on the Pond
(424) 482-1765
info@peaceonthepond.com`;
  return `mailto:${encodeURIComponent(r.email || "")}?subject=${encodeURIComponent("A friendly reminder: your Peace on the Pond balance")}&body=${encodeURIComponent(body)}`;
}

// ---------- Home ----------
let homeTours = [];
async function showHome() {
  showOnly("#view-home"); setNav("home");
  const h = new Date().getHours();
  $("#home-hello").textContent = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  $("#home-body").innerHTML = `<p class="empty">Loading…</p>`;
  try {
    const d = await api("dashboard");
    const card = (title, count, rowsHtml, empty, wide) => `<div class="home-card${wide ? " wide" : ""}"><h2>${title}${count ? `<small>${count}</small>` : ""}</h2>${rowsHtml || `<p class="home-empty">${empty}</p>`}</div>`;
    const qs = d.questions.map((q) => `<div class="home-row"><div><b>${esc(q.name)}</b> <small style="display:inline">about ${esc(q.title)}, ${shortDate(q.at)}${q.role === "guest" ? " (guest)" : ""}</small><p class="q-text">${esc(q.text)}</p></div>
      <div class="row-actions"><a href="mailto:${encodeURIComponent(q.email)}?subject=${encodeURIComponent("Re: your question about " + q.title)}">Reply</a><button data-answered="${esc(q.proposalId)}|${esc(q.id)}">Mark answered</button></div></div>`).join("");
    const calls = d.calls.map((c) => `<div class="home-row"><div><b>${esc(c.name)}</b><small>${esc([shortDate(c.callDate), c.callTime, c.organization].filter(Boolean).join(", "))}</small></div>
      <div class="row-actions">${c.prepReceived ? '<span class="pill good">Prep received</span>' : '<span class="pill">No prep yet</span>'}<button data-home-disc="${esc(c.id)}">Open</button></div></div>`).join("");
    const waiting = d.waiting.map((r) => `<div class="home-row"><div><b>${esc(r.client)}</b><small>${esc(r.datesLabel)}</small>${statusDetail(r)}</div>
      <div class="row-actions">${statusPill(r.status)}<button data-home-edit="${esc(r.id)}">Open</button></div></div>`).join("");
    const bal = d.balances.map((r) => `<div class="home-row"><div><b>${esc(r.client)}</b><small>${money(r.remaining)} due ${shortDate(r.balanceDueDate)}</small></div>
      <div class="row-actions">${r.overdue ? '<span class="pill warn">Overdue</span>' : ""}<a href="${esc(reminderMailto(r))}">Send reminder</a></div></div>`).join("");
    const up = d.upcoming.map((r) => `<div class="home-row"><div><b>${esc(r.title)}</b><small>${esc(r.datesLabel)}, ${esc(r.client)}</small></div>
      <div class="row-actions">${statusPill(r.status)}${r.discoveryId ? `<a href="/admin/sheet.html?id=${encodeURIComponent(r.discoveryId)}" target="_blank" rel="noopener">Sheet</a>` : ""}</div></div>`).join("");
    const treq = (d.tourRequests || []).map((t) => `<div class="home-row"><div><b>${esc(t.name)}</b><small>${(t.times || []).map((x) => `${shortDate(x.date)} ${time12(x.time)}`).join(", ")}</small></div>
      <div class="row-actions"><button data-home-tour="${esc(t.id)}">Review</button></div></div>`).join("");
    const tsoon = (d.toursSoon || []).map((t) => `<div class="home-row"><div><b>Tour: ${esc(t.name)}</b><small>${esc(shortDate(t.confirmedDate))}, ${esc(time12(t.confirmedTime))}, ${esc(t.guests)} guest${t.guests === "1" ? "" : "s"}</small></div>
      <div class="row-actions"><button data-home-tour="${esc(t.id)}">Open</button></div></div>`).join("");
    homeTours = [...(d.tourRequests || []), ...(d.toursSoon || [])];
    $("#home-body").innerHTML = `<div class="home-grid">
      ${d.questions.length ? card("Questions from clients", d.questions.length, qs, "", true) : ""}
      ${(d.tourRequests || []).length ? card("Tour requests", d.tourRequests.length, treq, "", true) : ""}
      ${card("Calls and tours this week", d.calls.length + (d.toursSoon || []).length, calls + tsoon, "No calls or tours in the next 7 days.")}
      ${card("Balances due soon", d.balances.length, bal, "No balances due in the next 30 days.")}
      ${card("Waiting on a response", d.waiting.length, waiting, "Every proposal has an answer. Nice work.", true)}
      ${card("Upcoming retreats", d.upcoming.length, up, "No confirmed retreats yet.", true)}
    </div>`;
  } catch (e) { $("#home-body").innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}
$("#home-body").addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  try {
    if (t.dataset.answered) { const [id, qid] = t.dataset.answered.split("|"); await api("answerQuestion", { id, qid, answered: true }); toast("Marked as answered."); showHome(); }
    else if (t.dataset.homeDisc) { const d = await api("discGet", { id: t.dataset.homeDisc }); openDisc(d.record, d.proposal); }
    else if (t.dataset.homeTour) openTour(homeTours.find((x) => x.id === t.dataset.homeTour));
    else if (t.dataset.homeEdit) { const { proposal } = await api("get", { id: t.dataset.homeEdit }); openEditor(proposal); }
  } catch (err) { toast(err.message); }
});

// ---------- Activity panel (inside the proposal editor) ----------
async function loadActivityPanel(p) {
  const box = $("#activity");
  if (!p) { box.hidden = true; return; }
  box.hidden = false; box.innerHTML = `<p class="mini">Loading activity…</p>`;
  try {
    const d = await api("activity", { id: p.id });
    const a = d.activity, when = (iso) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    const row = { ...p, client: p.client.name, firstName: p.client.firstName, email: p.client.email || "", title: p.retreat.title, datesLabel: p.retreat.datesLabel,
      code: p.accessCode, guestCode: p.guestCode || "", mode: p.payment.mode || "split", total: p.package.total, balanceDueDate: p.payment.balanceDueDate, paid: d.paid };
    const remaining = Math.max(0, p.package.total - d.paid);
    box.innerHTML = `
      <h3>Activity</h3>
      <div class="line"><span>Status</span>${statusPill(d.status)}</div>
      <div class="line"><span>Sent</span><span>${a.sentAt ? when(a.sentAt) : `<button class="linkish" id="act-sent">Mark as sent</button>`}</span></div>
      <div class="line"><span>Viewed</span><span>${a.views ? `${a.views} time${a.views > 1 ? "s" : ""}, last ${when(a.lastViewedAt)}` : "Not yet"}</span></div>
      ${a.guestViews ? `<div class="line"><span>Guest views</span><span>${a.guestViews}</span></div>` : ""}
      <div class="line"><span>Accepted</span><span>${a.acceptedAt ? `${esc(a.acceptedBy)}, ${when(a.acceptedAt)}` : "Not yet"}</span></div>

      <h4>Payments</h4>
      <div class="line"><span>Online (Stripe)</span><span>${d.stripe ? money(d.stripe.retreatPaid) : "Not connected"}</span></div>
      ${(a.offline || []).map((o) => `<div class="line"><span>${esc(o.method)}${o.payer ? `, ${esc(o.payer)}` : ""}<br><span class="mini">${shortDate(o.date)}${o.note ? `, ${esc(o.note)}` : ""}</span></span>
        <span>${money(o.amount)} <button class="linkish" data-rm-offline="${esc(o.id)}">Remove</button></span></div>`).join("")}
      <div class="line"><b>Total paid</b><b>${money(d.paid)} of ${money(p.package.total)}</b></div>
      ${remaining > 0 && p.payment.balanceDueDate ? `<p class="mini" style="margin:6px 0 0">${money(remaining)} remaining. <a href="${esc(reminderMailto(row))}">Send balance reminder</a></p>` : ""}
      <form id="offline-form">
        <b style="font-size:13px;margin-top:8px">Record a payment received outside Stripe</b>
        <div class="grid2"><input type="date" name="date" aria-label="Date received" value="${new Date().toLocaleDateString("en-CA")}"><span class="money"><input type="number" name="amount" min="0" step="0.01" placeholder="Amount" aria-label="Amount"></span></div>
        <div class="grid2"><select name="method" aria-label="Method"><option>Check</option><option>Zelle</option><option>Cash</option><option>Bank transfer</option><option>Other</option></select><input type="text" name="payer" placeholder="Paid by" aria-label="Paid by"></div>
        <input type="text" name="note" placeholder="Note (optional)" aria-label="Note">
        <button class="btn btn-quiet" type="submit">Add payment</button>
      </form>

      ${(a.questions || []).length ? `<h4>Questions</h4>${a.questions.slice().reverse().map((q) => `<div class="line" style="display:block">
        <b>${esc(q.name)}</b> <span class="mini">${when(q.at)}${q.role === "guest" ? ", guest" : ""}</span><p class="q-text">${esc(q.text)}</p>
        <span class="mini"><a href="mailto:${encodeURIComponent(q.email)}?subject=${encodeURIComponent("Re: your question about " + p.retreat.title)}">Reply</a> &nbsp;
        <button class="linkish" data-q="${esc(q.id)}" data-ans="${q.answered ? "0" : "1"}">${q.answered ? "Mark unanswered" : "Mark answered"}</button>${q.answered ? " &nbsp;Answered" : ""}</span></div>`).join("")}` : ""}
      ${a.acceptedAt && a.acceptedTerms ? `<h4>Accepted terms</h4><p class="mini">Accepted by ${esc(a.acceptedBy)} on ${when(a.acceptedAt)} for ${money(a.acceptedTotal)}.</p>` : ""}`;
    const sent = $("#act-sent"); if (sent) sent.onclick = async () => { await api("markSent", { id: p.id, method: "manual" }); loadActivityPanel(p); };
    $("#offline-form").onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { await api("addOffline", { id: p.id, entry: { date: f.date.value, amount: f.amount.value, method: f.method.value, payer: f.payer.value, note: f.note.value } }); toast("Payment recorded."); loadActivityPanel(p); }
      catch (err) { toast(err.message); }
    };
    box.querySelectorAll("[data-rm-offline]").forEach((b) => b.onclick = async () => {
      if (!confirm("Remove this payment record?")) return;
      await api("removeOffline", { id: p.id, offlineId: b.dataset.rmOffline }); loadActivityPanel(p);
    });
    box.querySelectorAll("[data-q]").forEach((b) => b.onclick = async () => { await api("answerQuestion", { id: p.id, qid: b.dataset.q, answered: b.dataset.ans === "1" }); loadActivityPanel(p); });
  } catch (e) { box.innerHTML = `<p class="mini">${esc(e.message)}</p>`; }
}

// ---------- Calendar ----------
let calMonth = null, calData = null;
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const time12 = (hhmm) => { if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return hhmm || ""; let [h, m] = hhmm.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; };
const longDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

async function loadCalendarData() { calData = await api("calendar"); return calData; }
async function showCalendar() {
  showOnly("#view-cal"); setNav("cal");
  if (!calMonth) { const t = new Date(); calMonth = new Date(t.getFullYear(), t.getMonth(), 1); }
  $("#cal").innerHTML = `<p class="empty" style="grid-column:1/-1">Loading…</p>`;
  try { await loadCalendarData(); renderCalendar(); renderTourRequests(); }
  catch (e) { $("#cal").innerHTML = `<p class="empty" style="grid-column:1/-1">${esc(e.message)}</p>`; }
}
function eventsOn(iso) {
  const out = [];
  for (const r of calData.retreats) if (iso >= r.start && iso <= r.end && (r.booked || r.status !== "Closed"))
    out.push({ cls: r.booked ? "retreat" : "pending", label: r.title, kind: "retreat", id: r.id, sort: 0 });
  for (const c of calData.calls) if (c.date === iso && c.status !== "Not moving forward")
    out.push({ cls: "call", label: `${c.time ? c.time + " " : ""}Call: ${c.name}`, kind: "call", id: c.id, sort: 1 });
  for (const t of calData.tours) {
    if (t.status === "Confirmed" && t.confirmedDate === iso) out.push({ cls: "tour", label: `${time12(t.confirmedTime)} Tour: ${t.name}`, kind: "tour", id: t.id, sort: 2 });
    if (t.status === "Requested" && (t.times || []).some((x) => x.date === iso)) out.push({ cls: "request", label: `Tour request: ${t.name}`, kind: "tour", id: t.id, sort: 3 });
  }
  return out.sort((a, b) => a.sort - b.sort);
}
function renderCalendar() {
  $("#cal-title").textContent = calMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const start = new Date(calMonth); start.setDate(1 - start.getDay());
  const today = calData.today;
  let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = isoOf(d), out = d.getMonth() !== calMonth.getMonth();
    if (i >= 35 && out) break;
    html += `<div class="day${out ? " out" : ""}${iso === today ? " today" : ""}"><span class="num">${d.getDate()}</span>${
      eventsOn(iso).map((e) => `<button class="ev ${e.cls}" data-kind="${e.kind}" data-id="${esc(e.id)}" title="${esc(e.label)}">${esc(e.label)}</button>`).join("")}</div>`;
  }
  $("#cal").innerHTML = html;
}
$("#cal-prev").addEventListener("click", () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); });
$("#cal-next").addEventListener("click", () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); });
$("#cal-today").addEventListener("click", () => { const t = new Date(); calMonth = new Date(t.getFullYear(), t.getMonth(), 1); renderCalendar(); });
$("#cal").addEventListener("click", async (e) => {
  const b = e.target.closest(".ev"); if (!b) return;
  try {
    if (b.dataset.kind === "retreat") { const { proposal } = await api("get", { id: b.dataset.id }); openEditor(proposal); }
    else if (b.dataset.kind === "call") { const d = await api("discGet", { id: b.dataset.id }); openDisc(d.record, d.proposal); }
    else openTour(calData.tours.find((t) => t.id === b.dataset.id));
  } catch (err) { toast(err.message); }
});
function renderTourRequests() {
  const reqs = calData.tours.filter((t) => t.status === "Requested");
  $("#tour-requests-card").innerHTML = `<h2>Tour requests${reqs.length ? `<small>${reqs.length}</small>` : ""}</h2>` + (reqs.length
    ? reqs.map((t) => `<div class="home-row"><div><b>${esc(t.name)}</b><small>${(t.times || []).map((x) => `${shortDate(x.date)} ${time12(x.time)}`).join(", ")}</small></div>
        <div class="row-actions"><button data-tour="${esc(t.id)}">Review</button></div></div>`).join("")
    : `<p class="home-empty">No tour requests waiting.</p>`);
}
$("#tour-requests-card").addEventListener("click", (e) => { const b = e.target.closest("[data-tour]"); if (b) openTour(calData.tours.find((t) => t.id === b.dataset.tour)); });

// Calendar link for Outlook
async function calendarUrl(regenerate = false) {
  const { token } = await api("calLink", { regenerate });
  return `https://${location.host}/api/calendar?t=${token}`;
}
$("#cal-copy").addEventListener("click", async () => {
  try { const url = await calendarUrl(); try { await navigator.clipboard.writeText(url); toast("Calendar link copied. Paste it into Outlook."); } catch { prompt("Copy this link:", url); } }
  catch (e) { toast(e.message); }
});
$("#cal-regen").addEventListener("click", async () => {
  if (!confirm("Make a new calendar link? The old link will stop working, and you'll need to subscribe again in Outlook.")) return;
  try { const url = await calendarUrl(true); try { await navigator.clipboard.writeText(url); } catch {} toast("New link made and copied."); } catch (e) { toast(e.message); }
});

// ---------- Tours ----------
let tourEditing = null;
function openTour(t) {
  tourEditing = t || null;
  const f = $("#tour-form"); f.reset(); $("#tour-warn").textContent = "";
  const v = t || { name: "", email: "", phone: "", guests: "1", note: "", status: "Confirmed", times: [] };
  ["name", "email", "phone", "guests", "note", "status", "confirmedDate", "confirmedTime"].forEach((k) => { if (f[k]) f[k].value = v[k] || (k === "guests" ? "1" : ""); });
  if (!t) f.status.value = "Confirmed";
  $("#tour-h").textContent = t ? `Private tour: ${t.name}` : "Add a private tour";
  $("#tour-times").innerHTML = t && (t.times || []).length
    ? `<div style="font-weight:500;font-size:13.5px;margin-bottom:6px">Times they suggested (pick one)</div>` + t.times.map((x, i) =>
        `<label class="tour-opt"><input type="radio" name="pick" value="${i}" ${t.confirmedDate === x.date && t.confirmedTime === x.time ? "checked" : ""}> ${esc(longDay(x.date))} at ${esc(time12(x.time))}</label>`).join("")
      + `<p class="hint" style="margin:4px 0 0">Or set a different date and time below.</p>`
    : "";
  $("#tour-delete").style.display = t ? "" : "none";
  $("#tour-decline").style.display = t && t.status === "Requested" ? "" : "none";
  $("#tour-confirm").textContent = t && t.status === "Confirmed" ? "Save" : "Confirm tour";
  $("#tour-modal").hidden = false;
}
$("#tour-times").addEventListener("change", (e) => {
  if (e.target.name !== "pick") return;
  const x = tourEditing.times[+e.target.value], f = $("#tour-form");
  f.confirmedDate.value = x.date; f.confirmedTime.value = x.time;
});
$("#tour-close").addEventListener("click", () => ($("#tour-modal").hidden = true));
$("#tour-add").addEventListener("click", () => openTour(null));

function tourMail(t, kind) {
  const first = String(t.name || "").split(/\s+/)[0] || "there";
  const body = kind === "confirm"
    ? `Hi ${first},

Your private tour of Peace on the Pond is confirmed for ${longDay(t.confirmedDate)} at ${time12(t.confirmedTime)} (Eastern). Tours last about an hour, and we'll share directions and arrival details before your visit.

If anything changes, just reply to this email or call us at (424) 482-1765.

We can't wait to show you around.

With care,
Peace on the Pond
(424) 482-1765
info@peaceonthepond.com`
    : `Hi ${first},

Thank you so much for your interest in touring Peace on the Pond. Unfortunately, the times you suggested aren't available. Could you share a few other days and times that work for you? You can reply here or call us at (424) 482-1765.

With care,
Peace on the Pond`;
  const subject = kind === "confirm" ? "Your private tour of Peace on the Pond is confirmed" : "Your Peace on the Pond tour request";
  return `mailto:${encodeURIComponent(t.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
async function saveTour(extra = {}) {
  const f = $("#tour-form");
  const tour = { id: tourEditing ? tourEditing.id : undefined, name: f.name.value, email: f.email.value, phone: f.phone.value, guests: f.guests.value,
    note: f.note.value, status: f.status.value, confirmedDate: f.confirmedDate.value, confirmedTime: f.confirmedTime.value, ...extra };
  const d = await api("tourSave", { tour });
  return d.tour;
}
$("#tour-form").addEventListener("submit", async (e) => {
  e.preventDefault(); $("#tour-warn").textContent = "";
  const f = $("#tour-form");
  const wasConfirmed = tourEditing && tourEditing.status === "Confirmed";
  const status = f.status.value === "Requested" ? "Confirmed" : f.status.value;
  try {
    const t = await saveTour({ status });
    $("#tour-modal").hidden = true;
    toast(status === "Confirmed" ? "Tour confirmed. Your confirmation email is opening." : "Tour saved.");
    if (status === "Confirmed" && (!wasConfirmed || tourEditing.confirmedDate !== t.confirmedDate || tourEditing.confirmedTime !== t.confirmedTime) && t.email) location.href = tourMail(t, "confirm");
    refreshAfterTour();
  } catch (err) { $("#tour-warn").textContent = err.message; }
});
$("#tour-decline").addEventListener("click", async () => {
  try { const t = await saveTour({ status: "Declined" }); $("#tour-modal").hidden = true; if (t.email) location.href = tourMail(t, "decline"); refreshAfterTour(); }
  catch (err) { $("#tour-warn").textContent = err.message; }
});
$("#tour-delete").addEventListener("click", async () => {
  if (!tourEditing || !confirm(`Delete the tour for ${tourEditing.name}?`)) return;
  try { await api("tourDelete", { id: tourEditing.id }); $("#tour-modal").hidden = true; toast("Tour deleted."); refreshAfterTour(); } catch (err) { toast(err.message); }
});
function refreshAfterTour() {
  if (!$("#view-cal").hidden) showCalendar();
  else if (!$("#view-home").hidden) showHome();
}

// Tour invite from a discovery record
function tourInviteMailto() {
  const first = String(disc.fields.name || "").split(/\s+/)[0] || "there";
  const link = `https://${location.host}/tour/?d=${disc.prepToken}`;
  const body = `Hi ${first},

It was wonderful talking with you! If you'd like to see Peace on the Pond in person, we'd love to give you a private tour. Just suggest a few days and times that work for you here:

${link}

Tours last about an hour. We'll confirm a time with you by email.

With care,
Peace on the Pond
(424) 482-1765
info@peaceonthepond.com`;
  return `mailto:${encodeURIComponent(disc.fields.email || "")}?subject=${encodeURIComponent("Come see Peace on the Pond: book a private tour")}&body=${encodeURIComponent(body)}`;
}

// Warn about overlapping booked retreats while editing a proposal
async function checkOverlap() {
  const s = form.startDate.value, e = form.endDate.value, el = $("#overlap");
  el.textContent = "";
  if (!s || !e) return;
  try {
    if (!calData) await loadCalendarData();
    const clash = calData.retreats.find((r) => r.booked && r.id !== editingId && s <= r.end && e >= r.start);
    if (clash) el.textContent = `Heads up: these dates overlap ${clash.title} (${clash.client}), which is already booked.`;
  } catch {}
}

let tt;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 4000); }

start();
})();
