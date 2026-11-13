/* =========================================================
   Critical path and Gantt chart – works out the plan and draws it
   ---------------------------------------------------------
   Used by the Team hub (home page) and the stand-alone chart.
   Each task: { code, name, stream, days, after: [codes],
                fixed: "YYYY-MM-DD" | null, note, done, order }
     days   how long it takes (0 = a milestone)
     after  tasks that must finish first
     fixed  a date that can't move (crop, show week, cutoffs)

   Gantt.compute(tasks, { start, show }) works out, for every task:
     es/ef  earliest start/finish if everything runs as soon as it can
     ls/lf  latest start/finish without moving the show
     slack  ls − es (days); the critical path has the least slack
     kind   "crit" | "near" (within 4 weeks of it) | "norm" | "fixed"
   Gantt.render(el, plan, options) draws it as an SVG you can tap.
   ========================================================= */
(function (root) {
  const DAY = 864e5;
  const toDay = (iso) => { const p = iso.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / DAY; };
  const toDate = (d) => new Date(d * DAY);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const fmt = (d) => { const x = toDate(d); return x.getUTCDate() + " " + MONTHS[x.getUTCMonth()] + " " + x.getUTCFullYear(); };
  const todayDay = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function compute(taskList, opts) {
    const start = toDay(opts.start || "2026-11-09"), show = toDay(opts.show || "2027-09-11");
    const tasks = taskList.map((t) => ({ ...t, after: (t.after || []).filter(Boolean), days: Math.max(0, Number(t.days) || 0) }));
    const by = Object.fromEntries(tasks.map((t) => [t.code, t]));
    const problems = [];
    tasks.forEach((t) => t.after = t.after.filter((c) => by[c] ? true : (problems.push(t.code + " is after " + c + ", which isn't in the plan"), false)));

    // Order so every task comes after the ones it waits for
    const seq = [], state = {};
    const visit = (t, path) => {
      if (state[t.code] === 2) return;
      if (state[t.code] === 1) { problems.push("Loop: " + path.concat(t.code).join(" → ")); return; }
      state[t.code] = 1;
      t.after.forEach((c) => visit(by[c], path.concat(t.code)));
      state[t.code] = 2; seq.push(t);
    };
    tasks.forEach((t) => visit(t, []));

    // Forward: earliest dates
    seq.forEach((t) => {
      t.es = t.fixed ? toDay(t.fixed) : Math.max(start, ...t.after.map((c) => by[c].ef ?? start));
      t.ef = t.es + t.days;
    });
    // Backward: latest dates
    const next = Object.fromEntries(tasks.map((t) => [t.code, []]));
    tasks.forEach((t) => t.after.forEach((c) => next[c].push(t)));
    seq.slice().reverse().forEach((t) => {
      if (t.fixed) { t.ls = t.es; t.lf = t.ef; return; }
      const succ = next[t.code];
      t.lf = succ.length ? Math.min(...succ.map((s) => s.ls)) : show;
      t.ls = t.lf - t.days;
    });
    tasks.forEach((t) => { t.slack = t.fixed ? 0 : t.ls - t.es; });
    const floats = tasks.filter((t) => !t.fixed).map((t) => t.slack);
    const minSlack = floats.length ? Math.min(...floats) : 0;
    tasks.forEach((t) => {
      t.kind = t.fixed ? "fixed" : t.slack === minSlack ? "crit" : t.slack - minSlack <= 28 ? "near" : "norm";
      if (t.ef < t.es) t.ef = t.es;
      if (!t.fixed && t.ls < t.es) problems.push(t.code + " can't fit before its latest date");
    });
    const streams = [];
    tasks.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((t) => { if (!streams.includes(t.stream)) streams.push(t.stream); });
    const today = todayDay();
    return {
      tasks, by, streams, start, show, today, minSlack, problems,
      critical: tasks.filter((t) => t.kind === "crit").sort((a, b) => a.es - b.es),
      overdue: tasks.filter((t) => !t.done && !t.fixed && t.lf < today).sort((a, b) => a.lf - b.lf),
      // Not done yet, by latest start – the dates that matter next
      upcoming: tasks.filter((t) => !t.done && !t.fixed && t.lf >= today).sort((a, b) => a.ls - b.ls)
    };
  }

  const KIND = { crit: "Critical path", near: "Near-critical (within 4 weeks)", norm: "Has slack", fixed: "Fixed date" };

  /* Draw the chart.
     options.filter(task) → show this row?   options.selected → code
     options.onSelect(code)                  options.counts → { code: open actions } */
  function render(el, plan, options) {
    options = options || {};
    // Fit the box it's in; on a phone the chart scrolls sideways and the names stay short
    const avail = el.clientWidth || 1000;
    const narrow = avail < 640;
    const LABEL = narrow ? 170 : Math.min(330, Math.round(avail * 0.3));
    const CHART = Math.max(narrow ? 640 : 520, avail - LABEL - 24), W = LABEL + CHART + 20, ROW = 26, HEAD = 40;
    const end = plan.show + 6;
    const x = (d) => LABEL + (d - plan.start) / (end - plan.start) * CHART;
    const rows = [];
    plan.streams.forEach((s) => {
      const list = plan.tasks.filter((t) => t.stream === s && (!options.filter || options.filter(t))).sort((a, b) => (a.order || 0) - (b.order || 0));
      if (list.length) rows.push({ stream: s }, ...list.map((t) => ({ t })));
    });
    let y = HEAD, body = "";
    rows.forEach((r) => {
      if (r.stream) { y += 8; body += '<text x="8" y="' + (y + 16) + '" class="g-stream">' + esc(r.stream) + '</text><line x1="0" x2="' + W + '" y1="' + (y + 22) + '" y2="' + (y + 22) + '" class="g-rule"/>'; y += 26; return; }
      const t = r.t, cy = y + ROW / 2, sel = options.selected === t.code;
      const overdue = !t.done && !t.fixed && t.lf < plan.today;
      const maxChars = narrow ? 18 : Math.max(20, Math.floor((LABEL - 60) / 6.6));
      const name = t.name.length > maxChars ? t.name.slice(0, maxChars - 1) + "…" : t.name;
      const n = options.counts && options.counts[t.code];
      body += '<g class="g-row' + (sel ? " sel" : "") + (t.done ? " done" : "") + '" data-code="' + esc(t.code) + '" tabindex="0" role="button" aria-label="' + esc(t.code + " " + t.name + (t.done ? ", done" : "")) + '">' +
        '<rect x="0" y="' + y + '" width="' + W + '" height="' + ROW + '" class="g-hit"/>' +
        '<text x="14" y="' + (cy + 4) + '" class="g-lbl"><tspan class="g-id">' + esc(t.code) + '</tspan> ' + (t.done ? "✓ " : overdue ? "⚠ " : "") + esc(name) + (n ? '<tspan class="g-n"> · ' + n + '</tspan>' : '') + '</text>';
      if (t.days === 0) {
        const mx = x(t.es);
        body += '<path d="M' + mx + ' ' + (cy - 7) + ' l7 7 l-7 7 l-7 -7 z" class="g-mk k-' + t.kind + '"/>';
      } else {
        body += '<rect x="' + x(t.es) + '" y="' + (cy - 6) + '" width="' + Math.max(3, x(t.ef) - x(t.es)) + '" height="12" rx="4" class="g-mk k-' + t.kind + '"/>';
      }
      if (!t.fixed && t.slack > 0 && !t.done) {
        body += '<line x1="' + (x(t.ef) + 2) + '" x2="' + x(t.lf) + '" y1="' + cy + '" y2="' + cy + '" class="g-slack"/><line x1="' + x(t.lf) + '" x2="' + x(t.lf) + '" y1="' + (cy - 5) + '" y2="' + (cy + 5) + '" class="g-slack"/>';
      }
      body += '</g>';
      y += ROW;
    });
    const H = y + 24;
    let grid = "";
    const s = toDate(plan.start);
    for (let m = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1)); m.getTime() / DAY <= end; m.setUTCMonth(m.getUTCMonth() + 1)) {
      const d = m.getTime() / DAY; if (d < plan.start) continue;
      grid += '<line x1="' + x(d) + '" x2="' + x(d) + '" y1="' + (HEAD - 6) + '" y2="' + H + '" class="g-grid"/><text x="' + (x(d) + 4) + '" y="' + (HEAD - 12) + '" class="g-axis">' + MONTHS[m.getUTCMonth()] + " " + String(m.getUTCFullYear()).slice(2) + '</text>';
    }
    if (plan.today >= plan.start && plan.today <= end) grid += '<line x1="' + x(plan.today) + '" x2="' + x(plan.today) + '" y1="' + (HEAD - 6) + '" y2="' + H + '" class="g-today"/><text x="' + (x(plan.today) + 4) + '" y="' + (H - 6) + '" class="g-axis">Today</text>';
    grid += '<line x1="' + x(plan.show) + '" x2="' + x(plan.show) + '" y1="' + (HEAD - 6) + '" y2="' + H + '" class="g-showl"/><text x="' + (x(plan.show) - 4) + '" y="' + (H - 6) + '" class="g-axis" text-anchor="end">Show</text>';
    el.innerHTML = '<svg class="gantt-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="group" aria-label="Gantt chart">' +
      '<rect x="0" y="0" width="' + LABEL + '" height="' + H + '" class="g-labelbg"/>' + grid + body + '</svg>';
    el.querySelectorAll(".g-row").forEach((g) => {
      const pick = () => options.onSelect && options.onSelect(g.dataset.code);
      g.addEventListener("click", pick);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
  }

  root.Gantt = { compute, render, fmt, toDay, KIND, esc };
})(typeof window !== "undefined" ? window : globalThis);
