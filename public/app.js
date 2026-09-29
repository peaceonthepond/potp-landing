(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };

  const state = {
    code: null, proposal: null, catalog: null, paymentsEnabled: false,
    cart: {},              // id -> { qty, mode: "full" | "share" }
    requests: [],          // ids of "ask about" items
    lodging: {},           // partner lodging id -> quantity (rooms or guests)
    paymentType: "retainer_share",
    shares: 1,
    filter: "all",
  };

  const money = (v) => {
    const n = Number(v) || 0;
    return n.toLocaleString("en-US", { style: "currency", currency: "USD",
      minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  };
  const ceilCents = (dollars) => Math.ceil(Math.round(dollars * 1e6) / 1e4) / 100;
  const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // "View as client" from the admin page adds &preview=1 so it isn't counted as a client view.
  let isPreview = new URLSearchParams(location.search).has("preview");
  try { if (isPreview) sessionStorage.setItem("potp_preview", "1"); else isPreview = sessionStorage.getItem("potp_preview") === "1"; } catch {}

  // ---------- Gate ----------
  const gate = $("#gate");
  const gateForm = $("#gate-form");

  async function unlock(code, { silent } = {}) {
    const btn = $("#gate-btn");
    btn.disabled = true; btn.textContent = "Opening…";
    try {
      const r = await fetch("/api/unlock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, preview: isPreview }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "That code didn't work.");
      state.accepted = data.accepted || null;
      state.code = code;
      state.proposal = data.proposal;
      state.catalog = data.catalog;
      state.paymentsEnabled = data.paymentsEnabled;
      store.set("potp_code", code);
      restoreCart();
      render();
      open(silent);
    } catch (e) {
      store.del("potp_code");
      if (!silent) {
        $("#gate-error").textContent = e.message;
        gate.classList.remove("shake"); void gate.offsetWidth; gate.classList.add("shake");
      }
    } finally {
      btn.disabled = false; btn.textContent = "Open proposal";
    }
  }

  function open(instant) {
    $("#app").hidden = false;
    if (instant) { gate.remove(); return; }
    gate.classList.add("opening");
    setTimeout(() => gate.remove(), 1400);
  }

  gateForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#code").value.trim();
    if (!code) { $("#gate-error").textContent = "Enter your access code."; return; }
    $("#gate-error").textContent = "";
    unlock(code);
  });

  // ---------- Render ----------
  function bind(key, value) { $$(`[data-bind="${key}"]`).forEach((el) => (el.textContent = value)); }

  function render() {
    const p = state.proposal, pay = p.payment, pkg = p.package;
    const total = pkg.total, retainer = pay.retainer, g = pay.groupSize;
    document.title = `${p.retreat.title} | Peace on the Pond`;

    bind("preparedFor", `Prepared for ${p.client.name}${p.client.group ? ", " + p.client.group : ""}`);
    bind("title", p.retreat.title);
    bind("dates", p.retreat.datesLabel);
    bind("duration", p.retreat.duration);
    bind("capacity", p.retreat.capacity);
    bind("salutation", `Dear ${p.client.firstName},`);
    $("#letter-body").innerHTML = p.letter.map((t) => `<p>${esc(t)}</p>`).join("");
    const recap = Array.isArray(p.recap) ? p.recap : [];
    $("#recap").hidden = !recap.length;
    $("#recap-list").innerHTML = recap.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.text)}</dd></div>`).join("");

    bind("packageName", pkg.name);
    bind("packageSummary", pkg.summary);
    bind("total", money(total));
    bind("rate", `${money(pkg.nightlyRate)} per night for ${pkg.nights} nights, including ${pkg.lineItem.replace(/^.*with /, "")}.`);
    const guest = isGuest(), split = isSplit();
    document.body.classList.toggle("guest-view", guest);
    document.body.classList.toggle("single-payer", !split);
    $("#enhance-lede").textContent = split
      ? "Add the practices your group is drawn to. Group sessions can be paid in full by one person or shared, with each person covering their part."
      : "Add the practices your group is drawn to. Everything you choose is added to your payment.";
    if (!split) {
      $("#pay-lede").textContent = "Pay the retainer to hold your dates, the remaining balance, or the full amount at once.";
      const allowed = ["retainer_full", "balance_full", "full_total", "custom", "addons_only"];
      if (!allowed.includes(state.paymentType)) state.paymentType = "retainer_full";
      state.shares = 1;
    } else {
      $("#pay-lede").textContent = "Each person can pay their own share. Share this page and the access code with everyone splitting the cost.";
    }
    if (guest) {
      bind("splitNote", `Split ${g} ways, each share is ${money(ceilCents(total / g))}.`);
      $("#pay-lede").textContent = "Pay your share in full, or any amount toward it, whenever you're ready.";
      const allowed = ["full_share", "custom", "addons_only"];
      if (!allowed.includes(state.paymentType)) state.paymentType = "full_share";
    } else {
    bind("retainer", money(retainer));
    bind("retainerLabel", pay.retainerLabel);
    bind("balance", money(total - retainer));
    bind("balanceLabel", `${pay.balanceLabel} (by ${fmtDate(pay.balanceDueDate)})`);
    bind("splitNote", split ? `Split ${g} ways, each share is ${money(ceilCents(total / g))}, with ${money(ceilCents(retainer / g))} of that due now toward the retainer.` : "");
    }
    $("#inclusions").innerHTML = pkg.inclusions.map((t) => `<li>${esc(t)}</li>`).join("");
    $("#included-extras").innerHTML = pkg.includedEnhancements.map((e) => `<li>${esc(e.name)}</li>`).join("");
    $("#terms-list").innerHTML = p.terms.map((t) => `<li>${esc(t)}</li>`).join("");

    renderAccept();
    $("#tour-link").href = `/tour/?code=${encodeURIComponent(state.code)}`;
    renderFilters();
    renderMenu();
    renderPairings();
    renderLodging();
    renderChoices();
    renderSummary();
    if (!guest) loadStatus();
  }

  // ---------- Catalog ----------
  const included = () => new Set(state.proposal.package.includedEnhancements.map((e) => e.catalogId).filter(Boolean));
  const itemById = (id) => state.catalog.items.find((i) => i.id === id);

  function renderFilters() {
    const tabs = [{ id: "all", name: "All" }, ...state.catalog.intentions];
    $("#filters").innerHTML = tabs.map((t) =>
      `<button type="button" role="tab" data-filter="${t.id}" aria-selected="${t.id === state.filter}">${esc(t.name)}</button>`).join("");
    const intent = state.catalog.intentions.find((i) => i.id === state.filter);
    $("#filter-blurb").textContent = intent ? intent.blurb : "Every practice we offer, from restorative sessions to dining and photography.";
  }

  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]"); if (!b) return;
    state.filter = b.dataset.filter; renderFilters(); renderMenu();
  });

  function priceLabel(item) {
    if (item.price == null) return `<span class="price">${item.priceNote ? esc(item.priceNote) : "On request"}${item.priceNote ? "<small>quoted for your group</small>" : ""}</span>`;
    const unit = { person: "per guest", hour: `per hour, ${item.min || 1}-hour minimum`, session: "per group session" }[item.unit];
    return `<span class="price">${money(item.price)}<small>${unit}</small></span>`;
  }

  function controls(item) {
    if (included().has(item.id)) return `<span class="badge">Included in your package</span>`;
    if (item.price == null) {
      const on = state.requests.includes(item.id);
      return `<button type="button" class="add-btn" data-request="${item.id}" aria-pressed="${on}">${on ? "Added to questions" : "Ask about this"}</button>`;
    }
    const c = state.cart[item.id];
    if (!c) return `<button type="button" class="add-btn" data-add="${item.id}" aria-pressed="false">Add</button>`;
    if (item.unit === "person" || item.unit === "hour") {
      const label = item.unit === "person" ? "guests" : "hours";
      return `<div class="stepper" aria-label="${label}">
          <button type="button" data-qty="${item.id}" data-step="-1" aria-label="Fewer ${label}">−</button>
          <output>${c.qty}</output>
          <button type="button" data-qty="${item.id}" data-step="1" aria-label="More ${label}">+</button>
        </div><span class="small-note">${label}</span>
        <button type="button" class="add-btn" data-add="${item.id}" aria-pressed="true">Remove</button>`;
    }
    if (!isSplit()) return `<button type="button" class="add-btn" data-add="${item.id}" aria-pressed="true">Added. Remove</button>`;
    return `<div class="seg" role="group" aria-label="How to pay">
        <button type="button" data-mode="${item.id}" data-value="full" aria-pressed="${c.mode !== "share"}">Pay in full</button>
        <button type="button" data-mode="${item.id}" data-value="share" aria-pressed="${c.mode === "share"}">My share (${money(ceilCents(item.price / state.proposal.payment.groupSize * state.shares))})</button>
      </div>
      <button type="button" class="add-btn" data-add="${item.id}" aria-pressed="true">Remove</button>`;
  }

  function renderMenu() {
    const rec = new Set(state.proposal.recommended || []);
    const items = state.catalog.items.filter((i) => state.filter === "all" || i.intention === state.filter)
      .sort((a, b) => (rec.has(b.id) ? 1 : 0) - (rec.has(a.id) ? 1 : 0));
    $("#menu").innerHTML = items.map((i) => {
      const sel = state.cart[i.id] || state.requests.includes(i.id);
      const sug = (state.proposal.recommended || []).includes(i.id);
      return `<article class="item${sel ? " selected" : ""}" id="item-${i.id}">
        <h3>${sug ? '<span class="suggested">Suggested for you</span><br>' : ""}${esc(i.name)}</h3>${priceLabel(i)}
        <p>${esc(i.description)}</p>
        <div class="controls">${controls(i)}</div>
      </article>`;
    }).join("");
  }

  function toggleAdd(id) {
    const item = itemById(id);
    if (state.cart[id]) delete state.cart[id];
    else state.cart[id] = { qty: item.unit === "person" && isSplit() ? state.proposal.payment.groupSize : (item.min || 1), mode: "full" };
  }
  function toggleRequest(id) {
    state.requests = state.requests.includes(id) ? state.requests.filter((x) => x !== id) : [...state.requests, id];
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-add],[data-request],[data-qty],[data-mode],[data-pair],[data-remove],[data-lodge],[data-lqty]");
    if (!t) return;
    if (t.dataset.lodge) {
      const id = t.dataset.lodge;
      if (state.lodging[id]) delete state.lodging[id]; else state.lodging[id] = 1;
    }
    else if (t.dataset.lqty) state.lodging[t.dataset.lqty] = Math.max(1, Math.min(50, (state.lodging[t.dataset.lqty] || 1) + Number(t.dataset.step)));
    else if (t.dataset.add) toggleAdd(t.dataset.add);
    else if (t.dataset.request) toggleRequest(t.dataset.request);
    else if (t.dataset.qty) {
      const item = itemById(t.dataset.qty), c = state.cart[t.dataset.qty];
      c.qty = Math.max(item.min || 1, Math.min(100, c.qty + Number(t.dataset.step)));
    } else if (t.dataset.mode) state.cart[t.dataset.mode].mode = t.dataset.value;
    else if (t.dataset.pair) addPairing(Number(t.dataset.pair));
    else if (t.dataset.remove) {
      const id = t.dataset.remove;
      if (state.lodging[id]) delete state.lodging[id];
      else if (state.cart[id]) delete state.cart[id]; else toggleRequest(id);
    }
    changed();
  });

  // ---------- Pairings ----------
  function pairingTotal(p) {
    return p.items.map(itemById).filter((i) => i && i.price != null && !included().has(i.id)).reduce((s, i) => s + i.price, 0);
  }
  function pairingAdded(p) {
    return p.items.every((id) => state.cart[id] || state.requests.includes(id) || included().has(id));
  }
  function addPairing(idx) {
    const p = state.catalog.pairings[idx];
    const on = pairingAdded(p);
    p.items.forEach((id) => {
      const it = itemById(id);
      if (!it || included().has(id)) return;
      if (it.price == null) { if (on === state.requests.includes(id)) toggleRequest(id); }
      else if (on === Boolean(state.cart[id])) toggleAdd(id);
    });
  }
  function renderPairings() {
    $("#pair-list").innerHTML = state.catalog.pairings.map((p, idx) => {
      const tot = pairingTotal(p);
      const hasRequest = p.items.some((id) => (itemById(id) || {}).price == null);
      const on = pairingAdded(p);
      return `<div class="pair">
        <h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>
        <div class="pair-foot">
          <span class="pair-price">${tot ? money(tot) : ""}${hasRequest ? (tot ? " plus massage, priced on request" : "Priced on request") : ""}</span>
          <button type="button" class="add-btn" data-pair="${idx}" aria-pressed="${on}">${on ? "Added" : "Add this pairing"}</button>
        </div></div>`;
    }).join("");
  }

  // ---------- Partner lodging ----------
  const lodgingOpts = () => state.proposal.lodging || [];
  const lodgeUnit = (l) => ({ night: "per room, per night", person: "per guest, full stay", stay: "per room, full stay" }[l.unit] || "");
  const lodgeQtyLabel = (l, q) => l.unit === "person" ? `${q} guest${q > 1 ? "s" : ""}` : `${q} room${q > 1 ? "s" : ""}`;
  const lodgeAmount = (l, q) => l.unit === "night" ? l.price * (state.proposal.package.nights || 1) * q : l.price * q;

  function renderLodging() {
    const opts = lodgingOpts();
    $("#lodging").hidden = !opts.length;
    if (!opts.length) return;
    const many = opts.length > 1, anyPay = opts.some((o) => o.payThroughUs && o.price > 0), anyLink = opts.some((o) => o.link);
    const partner = many ? "our lodging partners" : "our lodging partner";
    $("#lodging-lede").textContent =
      anyPay && anyLink ? `Book directly with ${partner}, or add your room to your payment here and we'll take care of the reservation.`
      : anyPay ? "Add your room to your payment here and we'll take care of the reservation."
      : `Book your room directly with ${partner}.`;
    // Drop selections for options that no longer exist
    Object.keys(state.lodging).forEach((id) => { if (!opts.find((o) => o.id === id && o.payThroughUs)) delete state.lodging[id]; });
    $("#lodging-list").innerHTML = opts.map((l) => {
      const q = state.lodging[l.id];
      const pay = l.payThroughUs && l.price > 0;
      const payCtl = !pay ? "" : q
        ? `<div class="stepper" aria-label="How many">
             <button type="button" data-lqty="${esc(l.id)}" data-step="-1" aria-label="Fewer">−</button><output>${q}</output>
             <button type="button" data-lqty="${esc(l.id)}" data-step="1" aria-label="More">+</button></div>
           <span class="small-note">${l.unit === "person" ? "guests" : "rooms"}</span>
           <button type="button" class="add-btn" data-lodge="${esc(l.id)}" aria-pressed="true">Remove</button>`
        : `<button type="button" class="btn btn-primary" data-lodge="${esc(l.id)}">Pay through us</button>`;
      return `<article class="lodge-card${q ? " selected" : ""}">
        <h3>${esc(l.name)}</h3>
        ${l.location ? `<p class="where">${esc(l.location)}</p>` : ""}
        ${l.description ? `<p>${esc(l.description)}</p>` : ""}
        ${l.price > 0 ? `<div class="lodge-price">${money(l.price)}<small>${lodgeUnit(l)}</small></div>` : ""}
        <div class="lodge-actions">
          ${payCtl}
          ${l.link ? `<a class="btn btn-quiet-dark" href="${esc(l.link)}" target="_blank" rel="noopener">Book on their site</a>` : ""}
        </div>
      </article>`;
    }).join("");
  }

  // ---------- Payment choices ----------
  const isGuest = () => state.proposal && state.proposal.role === "guest";
  const isSplit = () => state.proposal && state.proposal.payment.mode !== "single";

  function choiceDefs() {
    const p = state.proposal, pay = p.payment, g = pay.groupSize, s = state.shares;
    if (!isSplit()) {
      return [
        { id: "retainer_full", title: "The retainer", note: "Holds your dates.", amt: pay.retainer },
        { id: "balance_full", title: "The remaining balance", note: `Due by ${fmtDate(pay.balanceDueDate)}.`, amt: p.package.total - pay.retainer },
        { id: "full_total", title: "The full amount", note: "Pay for the whole retreat at once.", amt: p.package.total },
        { id: "custom", title: "Another amount", note: "Any amount toward the retreat.", amt: null },
        { id: "addons_only", title: "Enhancements or lodging only", note: "Pay only for what you've added.", amt: 0 },
      ];
    }
    if (isGuest()) {
      const share = ceilCents(p.package.total / g * s);
      return [
        { id: "full_share", title: "My full share of the retreat", note: s > 1 ? `Covers ${s} shares of the stay.` : "Covers your part of the whole stay.", amt: share },
        { id: "custom", title: "Another amount", note: `Any amount up to your share of ${money(share)}.`, amt: null },
        { id: "addons_only", title: "Enhancements or lodging only", note: "Pay only for what you've added.", amt: 0 },
      ];
    }
    return [
      { id: "retainer_share", title: "My share of the retainer", note: `Helps hold the dates. The ${money(pay.retainer)} retainer split ${g} ways.`, amt: ceilCents(pay.retainer / g * s) },
      { id: "full_share", title: "My full share of the retreat", note: "Covers your part of the whole stay in one payment.", amt: ceilCents(p.package.total / g * s) },
      { id: "retainer_full", title: "The full retainer", note: "For the organizer securing the dates for everyone.", amt: pay.retainer },
      { id: "balance_full", title: "The remaining balance", note: `Due by ${fmtDate(pay.balanceDueDate)}.`, amt: p.package.total - pay.retainer },
      { id: "custom", title: "Another amount", note: "Any amount toward the retreat.", amt: null },
      { id: "addons_only", title: "Enhancements or lodging only", note: "Pay only for what you've added.", amt: 0 },
    ];
  }
  function renderChoices() {
    const fs = $("#choices");
    fs.innerHTML = "<legend>What would you like to pay?</legend>" + choiceDefs().map((c) => `
      <label class="choice"><input type="radio" name="ptype" value="${c.id}" ${state.paymentType === c.id ? "checked" : ""}>
        <span><b>${c.title}</b><small>${c.note}</small></span>
        <span class="amt">${c.amt == null ? "" : c.amt ? money(c.amt) : ""}</span></label>`).join("");
    const perGuest = isSplit() && (["retainer_share", "full_share"].includes(state.paymentType) || (isGuest() && state.paymentType === "custom"));
    $("#shares-row").hidden = !perGuest;
    $("#shares").textContent = state.shares;
    $("#custom-row").hidden = state.paymentType !== "custom";
  }
  $("#choices").addEventListener("change", (e) => {
    if (e.target.name === "ptype") { state.paymentType = e.target.value; changed(); }
  });
  $("#shares-row").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]"); if (!b) return;
    state.shares = Math.max(1, Math.min(state.proposal.payment.groupSize, state.shares + Number(b.dataset.step)));
    changed();
  });
  $("#custom-amount").addEventListener("input", () => { renderSummary(); save(); });

  // ---------- Summary ----------
  function computeLines() {
    const p = state.proposal, pay = p.payment, g = pay.groupSize, s = state.shares;
    const lines = [];
    const def = choiceDefs().find((c) => c.id === state.paymentType);
    if (state.paymentType === "custom") {
      const v = parseFloat($("#custom-amount").value);
      if (v > 0) lines.push({ name: "Payment toward retreat", amt: Math.round(v * 100) / 100 });
    } else if (def && def.amt) {
      const label = { retainer_share: `Retainer share${s > 1 ? ` (${s} shares)` : ""}`, full_share: `Retreat share${s > 1 ? ` (${s} shares)` : ""}`, full_total: "Full retreat amount", retainer_full: "Retainer" }[def.id] || def.title.replace(/^The /, "").replace(/^./, (c) => c.toUpperCase());
      lines.push({ name: label, amt: def.amt });
    }
    for (const [id, c] of Object.entries(state.cart)) {
      const i = itemById(id); if (!i || included().has(id)) continue;
      if (i.unit === "person") lines.push({ id, name: `${i.name}, ${c.qty} guest${c.qty > 1 ? "s" : ""}`, amt: i.price * c.qty });
      else if (i.unit === "hour") lines.push({ id, name: `${i.name}, ${c.qty} hours`, amt: i.price * c.qty });
      else if (c.mode === "share") lines.push({ id, name: `${i.name} (my share)`, amt: ceilCents(i.price / g * s) });
      else lines.push({ id, name: i.name, amt: i.price });
    }
    for (const [id, q] of Object.entries(state.lodging)) {
      const l = lodgingOpts().find((o) => o.id === id); if (!l) continue;
      lines.push({ id, name: `${l.name}, ${lodgeQtyLabel(l, q)}${l.unit === "night" ? `, ${state.proposal.package.nights} nights` : ""}`, amt: lodgeAmount(l, q) });
    }
    return lines;
  }

  function renderSummary() {
    const lines = computeLines();
    const total = lines.reduce((a, l) => a + l.amt, 0);
    $("#summary-lines").innerHTML = lines.length
      ? lines.map((l) => `<li><span>${esc(l.name)}${l.id ? ` <button type="button" data-remove="${l.id}">Remove</button>` : ""}</span><span>${money(l.amt)}</span></li>`).join("")
      : `<li class="empty">Choose a payment option or add an enhancement.</li>`;
    const reqs = state.requests.map(itemById).filter(Boolean);
    const rq = $("#summary-requests");
    rq.hidden = !reqs.length;
    $("ul", rq).innerHTML = reqs.map((i) => `<li>${esc(i.name)} <button type="button" data-remove="${i.id}">Remove</button></li>`).join("");
    $("#summary-total").textContent = money(total);

    const btn = $("#pay-btn");
    btn.disabled = !state.paymentsEnabled || total < 1;
    if (!state.paymentsEnabled) {
      $("#pay-fineprint").textContent = "Online payments open soon. To reserve now, call (424) 482-1765 or email info@peaceonthepond.com.";
    }
    const link = $("#request-link");
    link.hidden = !reqs.length;
    if (reqs.length) {
      const name = $("#payer-name").value.trim();
      const body = `Hello Peace on the Pond,\n\nI'd like to learn more about these for ${state.proposal.retreat.title} (${state.proposal.retreat.datesLabel}):\n\n${reqs.map((i) => "- " + i.name).join("\n")}\n\nThank you,\n${name}`;
      link.href = `mailto:info@peaceonthepond.com?subject=${encodeURIComponent("Questions about " + state.proposal.retreat.title)}&body=${encodeURIComponent(body)}`;
    }

    // Cart pill + dock
    const count = Object.keys(state.cart).length + state.requests.length + Object.keys(state.lodging).length;
    $("#cart-pill-count").textContent = count;
    $("#cart-pill").classList.toggle("has-items", count > 0);
    const addonTotal = lines.filter((l) => l.id).reduce((a, l) => a + l.amt, 0);
    $("#dock-text").textContent = `${count} selected${addonTotal ? ", " + money(addonTotal) : ""}`;
    $("#dock").hidden = count === 0 || dockSuppressed;
  }

  $("#payer-name").addEventListener("input", renderSummary);
  $("#cart-pill").addEventListener("click", () => $("#pay").scrollIntoView({ behavior: "smooth" }));

  // Hide the dock while the pay section is on screen.
  let dockSuppressed = false;
  new IntersectionObserver(([en]) => { dockSuppressed = en.isIntersecting; if (state.proposal) renderSummary(); }, { threshold: 0.15 })
    .observe($("#pay"));

  function changed() {
    renderMenu(); renderPairings(); renderLodging(); renderChoices(); renderSummary(); save();
  }

  // ---------- Persistence ----------
  function save() {
    store.set("potp_cart", {
      cart: state.cart, requests: state.requests, lodging: state.lodging, paymentType: state.paymentType, shares: state.shares,
      name: $("#payer-name").value, email: $("#payer-email").value, custom: $("#custom-amount").value,
    });
  }
  function restoreCart() {
    const s = store.get("potp_cart"); if (!s) return;
    Object.assign(state, { cart: s.cart || {}, requests: s.requests || [], lodging: s.lodging || {}, paymentType: s.paymentType || state.paymentType, shares: s.shares || 1 });
    $("#payer-name").value = s.name || ""; $("#payer-email").value = s.email || "";
    $("#ask-name").value = s.name || ""; $("#ask-email").value = s.email || ""; $("#custom-amount").value = s.custom || "";
  }
  $("#payer-email").addEventListener("input", save);

  // ---------- Checkout ----------
  $("#pay-btn").addEventListener("click", async () => {
    const err = $("#pay-error"); err.textContent = "";
    const name = $("#payer-name").value.trim(), email = $("#payer-email").value.trim();
    if (!name) { err.textContent = "Enter your name so we know who paid."; $("#payer-name").focus(); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = "Enter a valid email for your receipt."; $("#payer-email").focus(); return; }
    const btn = $("#pay-btn"); btn.disabled = true; btn.textContent = "Opening secure checkout…";
    try {
      const r = await fetch("/api/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: state.code, payer: { name, email }, paymentType: state.paymentType, shares: state.shares,
          customAmount: $("#custom-amount").value,
          lodging: Object.entries(state.lodging).map(([id, qty]) => ({ id, qty })),
          cart: [...Object.entries(state.cart).map(([id, c]) => ({ id, ...c })), ...state.requests.map((id) => ({ id }))],
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Checkout couldn't start.");
      save();
      window.location.href = data.url;
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false; btn.textContent = "Continue to secure payment";
    }
  });

  // ---------- Payment status ----------
  async function loadStatus() {
    try {
      const r = await fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code }) });
      const d = await r.json();
      if (!d.enabled || d.error) return;
      const total = state.proposal.package.total;
      const pct = Math.min(100, (d.retreatPaid / total) * 100);
      $("#tracker").hidden = false;
      $("#tracker-amount").textContent = `${money(d.retreatPaid)} of ${money(total)}`;
      const bar = $("#tracker-bar"); bar.setAttribute("aria-valuenow", Math.round(pct));
      requestAnimationFrame(() => ($("span", bar).style.width = pct + "%"));
      const retainerMet = d.retreatPaid >= state.proposal.payment.retainer;
      const names = d.payers && d.payers.length ? `Paid so far: ${d.payers.join(", ")}`.replace(/\.?$/, ".") : "";
      $("#tracker-names").textContent = [retainerMet ? "The retainer is covered, and your dates are held." : "", names].filter(Boolean).join(" ");
    } catch {}
  }

  // ---------- Accept ----------
  function renderAccept() {
    const a = state.accepted;
    $("#accept-form").hidden = Boolean(a);
    $("#accept-done").hidden = !a;
    if (a) $("#accept-done-text").textContent = `Accepted by ${a.by} on ${new Date(a.at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Thank you!`;
  }
  $("#accept-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#accept-error"); err.textContent = "";
    const name = $("#accept-name").value.trim(), agree = $("#accept-agree").checked;
    if (name.length < 2) { err.textContent = "Type your full name to accept."; $("#accept-name").focus(); return; }
    if (!agree) { err.textContent = "Please check the box to agree to the terms."; return; }
    const btn = $("button", e.target); btn.disabled = true;
    try {
      const r = await fetch("/api/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: state.code, name, agree }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Something went wrong.");
      state.accepted = d.accepted; renderAccept(); toast("Thank you! Your proposal is accepted.");
    } catch (x) { err.textContent = x.message; }
    finally { btn.disabled = false; }
  });

  // ---------- Questions ----------
  $("#ask-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#ask-error"); err.textContent = "";
    const body = { code: state.code, name: $("#ask-name").value.trim(), email: $("#ask-email").value.trim(), text: $("#ask-text").value.trim() };
    if (!body.name) { err.textContent = "Please add your name."; return; }
    if (!/^\S+@\S+\.\S+$/.test(body.email)) { err.textContent = "Please add an email so we can reply."; return; }
    if (body.text.length < 3) { err.textContent = "Please type your question."; return; }
    const btn = $("button", e.target); btn.disabled = true;
    try {
      const r = await fetch("/api/question", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Something went wrong.");
      $("#ask-text").value = ""; $("#ask-done").hidden = false;
    } catch (x) { err.textContent = x.message; }
    finally { btn.disabled = false; }
  });

  // ---------- Helpers ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    setTimeout(() => (t.hidden = true), 6000);
  }

  // ---------- Boot ----------
  const params = new URLSearchParams(location.search);
  if (params.has("paid") || params.has("canceled")) {
    const paid = params.has("paid");
    history.replaceState(null, "", location.pathname);
    if (paid) { store.del("potp_cart"); }
    setTimeout(() => toast(paid ? "Payment received. Your receipt is on its way by email." : "Checkout was canceled. Your selections are still here."), 900);
  }
  // A link like /?code=RISE42 opens the proposal directly.
  const linkCode = params.get("code");
  if (linkCode) {
    history.replaceState(null, "", location.pathname);
    if (linkCode !== store.get("potp_code")) store.del("potp_cart");
    unlock(linkCode);
  } else {
    const saved = store.get("potp_code");
    if (saved) unlock(saved, { silent: true });
  }
})();
