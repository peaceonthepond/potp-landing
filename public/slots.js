// Shared date and time picker for the call and tour pages.
// makePicker(el, slots, { max, onChange }) -> { selected() }
function makePicker(el, slots, opts) {
  const max = opts.max || 1;
  const chosen = [];
  const dates = Object.keys(slots).sort();
  const fmtDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (hhmm) => { let [h, m] = hhmm.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${ap}`; };
  let current = dates[0];
  function render() {
    if (!dates.length) { el.innerHTML = `<p class="picker-empty">There are no open times right now. Please call us at (424) 482-1765.</p>`; return; }
    el.innerHTML = `
      <div class="pk-days" role="listbox" aria-label="Choose a day">${dates.map((d) =>
        `<button type="button" class="pk-day${d === current ? " on" : ""}${chosen.some((c) => c.date === d) ? " has" : ""}" data-day="${d}" aria-selected="${d === current}">${fmtDay(d)}</button>`).join("")}</div>
      <div class="pk-times" aria-label="Choose a time">${(slots[current] || []).map((t) => {
        const on = chosen.some((c) => c.date === current && c.time === t);
        return `<button type="button" class="pk-time${on ? " on" : ""}" data-time="${t}" aria-pressed="${on}">${fmtTime(t)}</button>`;
      }).join("")}</div>
      <div class="pk-chosen">${chosen.length
        ? (max > 1 ? `<b>Your choices:</b> ` : `<b>Selected:</b> `) + chosen.map((c, i) => `<span>${fmtDay(c.date)} at ${fmtTime(c.time)}${max > 1 ? ` <button type="button" data-rm="${i}" aria-label="Remove">✕</button>` : ""}</span>`).join("")
        : `<span class="muted">${max > 1 ? `Choose up to ${max} times that work for you.` : "Choose a day, then a time."}</span>`}</div>`;
  }
  el.addEventListener("click", (e) => {
    const d = e.target.closest("[data-day]"), t = e.target.closest("[data-time]"), rm = e.target.closest("[data-rm]");
    if (d) current = d.dataset.day;
    else if (t) {
      const i = chosen.findIndex((c) => c.date === current && c.time === t.dataset.time);
      if (i >= 0) chosen.splice(i, 1);
      else if (max === 1) chosen.splice(0, 1, { date: current, time: t.dataset.time });
      else if (chosen.length < max) chosen.push({ date: current, time: t.dataset.time });
    } else if (rm) chosen.splice(+rm.dataset.rm, 1);
    else return;
    render(); opts.onChange && opts.onChange(chosen.slice());
  });
  render();
  return { selected: () => chosen.slice(), fmtDay, fmtTime };
}
