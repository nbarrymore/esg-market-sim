// Debrief charts drawn from the game's history, as 16:9 PNGs for slides.
// window.ESGCharts.make(G) -> [{name, title, note, url}]. Runs only in the
// instructor console (it needs G.history, which never leaves that browser).
(function (root) {
  "use strict";

  const W = 1600, H = 900;
  const INK = "#0b0b0b", INK2 = "#52514e", GRID = "#e4e3df", SURFACE = "#ffffff";
  const FONT = '"Segoe UI", system-ui, sans-serif';
  // Ordinal levels (none, some, a lot): one blue hue, light to dark.
  const LEVELS = ["#86b6ef", "#2a78d6", "#104281"];
  // Funds: categorical slots in fixed order.
  const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

  // Signed percent; anything that rounds to zero prints as plain 0.
  const pct = (x, d = 0) => { const t = Math.abs(100 * x).toFixed(d); return +t === 0 ? `${(0).toFixed(d)}%` : `${x > 0 ? "+" : "−"}${t}%`; };

  function canvas() {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = SURFACE; g.fillRect(0, 0, W, H);
    g.textBaseline = "middle";
    return [c, g];
  }

  function niceStep(span, target) {
    const raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  }

  function roundRect(g, x, y, w, h, r, left) {
    // Rounded only at the data end (away from the zero line).
    r = Math.min(r, Math.abs(w) / 2, h / 2);
    g.beginPath();
    if (!left) {
      g.moveTo(x, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x, y + h);
    } else {
      g.moveTo(x + w, y); g.lineTo(x + r, y); g.quadraticCurveTo(x, y, x, y + r);
      g.lineTo(x, y + h - r); g.quadraticCurveTo(x, y + h, x + r, y + h); g.lineTo(x + w, y + h);
    }
    g.closePath(); g.fill();
  }

  function legend(g, items, y) {
    g.font = `26px ${FONT}`;
    let x = 60;
    items.forEach((it) => {
      g.fillStyle = it.color; g.fillRect(x, y - 11, 22, 22);
      g.fillStyle = INK2; g.textAlign = "left"; g.fillText(it.label, x + 32, y);
      x += 32 + g.measureText(it.label).width + 44;
    });
  }

  function caption(g, text) {
    g.font = `600 30px ${FONT}`; g.fillStyle = INK; g.textAlign = "left";
    g.fillText(text, 60, 46);
  }

  // Horizontal bars, one row per item; values are returns (fractions).
  function hbar(rows, opts) {
    const [c, g] = canvas();
    caption(g, opts.caption);
    if (opts.legend) legend(g, opts.legend, 100);
    const top = opts.legend ? 140 : 100, bottom = H - 70;
    g.font = `26px ${FONT}`;
    const labelW = Math.max(...rows.map((r) => g.measureText(r.label).width)) + 30;
    const x0 = 60 + labelW, x1 = W - 150;
    let lo = Math.min(0, ...rows.map((r) => r.value)), hi = Math.max(0, ...rows.map((r) => r.value));
    const pad = 0.14 * (hi - lo || 0.01);  // room for the value labels at the bar ends
    if (lo < 0) lo -= pad;
    if (hi > 0) hi += pad;
    const step = niceStep(hi - lo || 0.01, 5);
    const dec = step < 0.01 ? 1 : 0;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step || step;
    const X = (v) => x0 + ((v - a) / (b - a)) * (x1 - x0);
    // grid and axis labels
    g.strokeStyle = GRID; g.lineWidth = 1; g.fillStyle = INK2; g.textAlign = "center";
    for (let v = a; v <= b + 1e-9; v += step) {
      g.beginPath(); g.moveTo(X(v), top - 6); g.lineTo(X(v), bottom); g.stroke();
      g.fillText(pct(v, dec), X(v), bottom + 30);
    }
    g.strokeStyle = INK2; g.lineWidth = 2;
    g.beginPath(); g.moveTo(X(0), top - 6); g.lineTo(X(0), bottom); g.stroke();
    const rowH = (bottom - top) / rows.length, barH = Math.min(44, rowH - 8);
    rows.forEach((r, i) => {
      const y = top + i * rowH + (rowH - barH) / 2;
      g.fillStyle = INK; g.textAlign = "right"; g.font = `26px ${FONT}`;
      g.fillText(r.label, x0 - 16, y + barH / 2);
      g.fillStyle = r.color;
      const w = X(r.value) - X(0);
      if (Math.abs(w) >= 1) roundRect(g, X(0), y, w, barH, 4, w < 0);
      g.fillStyle = INK2; g.font = `24px ${FONT}`;
      g.textAlign = w < 0 ? "right" : "left";
      g.fillText(pct(r.value, 1), X(r.value) + (w < 0 ? -10 : 10), y + barH / 2);
    });
    return c;
  }

  // Lines over rounds, direct-labeled at the right end.
  function lines(series, xLabels, opts) {
    const [c, g] = canvas();
    caption(g, opts.caption);
    legend(g, series.map((s) => ({ label: s.label, color: s.color })), 100);
    g.font = `26px ${FONT}`;
    const endW = Math.max(...series.map((s) => g.measureText(`${s.label} ${opts.fmt(s.values[s.values.length - 1])}`).width));
    const top = 150, bottom = H - 80, x0 = 140, x1 = W - endW - 60;
    const all = series.flatMap((s) => s.values);
    const lo = Math.min(...all), hi = Math.max(...all);
    const step = niceStep(hi - lo || 1, 5);
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const X = (i) => x0 + (i / Math.max(1, xLabels.length - 1)) * (x1 - x0);
    const Y = (v) => bottom - ((v - a) / (b - a || 1)) * (bottom - top);
    g.font = `24px ${FONT}`;
    g.strokeStyle = GRID; g.lineWidth = 1; g.fillStyle = INK2;
    for (let v = a; v <= b + 1e-9; v += step) {
      g.beginPath(); g.moveTo(x0, Y(v)); g.lineTo(x1, Y(v)); g.stroke();
      g.textAlign = "right"; g.fillText(opts.fmt(v), x0 - 14, Y(v));
    }
    g.textAlign = "center";
    xLabels.forEach((l, i) => g.fillText(l, X(i), bottom + 32));
    const ends = [];
    series.forEach((s) => {
      g.strokeStyle = s.color; g.lineWidth = 4; g.lineJoin = "round";
      g.beginPath(); s.values.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke();
      s.values.forEach((v, i) => { g.fillStyle = s.color; g.beginPath(); g.arc(X(i), Y(v), 6, 0, 2 * Math.PI); g.fill(); });
      ends.push({ y: Y(s.values[s.values.length - 1]), s });
    });
    // direct labels, nudged apart
    ends.sort((p, q) => p.y - q.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 30) ends[i].y = ends[i - 1].y + 30;
    g.font = `26px ${FONT}`; g.textAlign = "left";
    ends.forEach((e) => { g.fillStyle = INK; g.fillText(`${e.s.label} ${opts.fmt(e.s.values[e.s.values.length - 1])}`, x1 + 20, e.y); });
    return c;
  }

  // How much real ESG a company did by the end: 0 nothing, 1 a little, 2 a lot.
  function esgLevel(f) {
    const pts = (1 - f.e) / 0.1 + f.pay + (f.safety ? 1 : 0) + (f.pkg.E ? 0.5 : 0) + (f.pkg.S ? 0.5 : 0);
    return pts === 0 ? 0 : pts <= 2 ? 1 : 2;
  }

  function make(G) {
    const H_ = G.history || [];
    if (!H_.length) return [];
    const last = H_[H_.length - 1];
    const out = [];
    const add = (name, title, note, c) => out.push({ name, title, note, url: c.toDataURL("image/png") });

    // 1. Total return by company, colored by how much ESG it did.
    const rows = last.firms.map((f) => ({ label: f.name, value: f.tsr, color: LEVELS[esgLevel(f)] }))
      .sort((p, q) => q.value - p.value);
    add("01_total_return", "Total return by company",
      "Color: how much real ESG the company did by the end (cuts, pay, safety, pledges).",
      hbar(rows, { caption: `Total return over ${H_.length} rounds`,
        legend: [{ label: "No ESG", color: LEVELS[0] }, { label: "A little", color: LEVELS[1] }, { label: "A lot", color: LEVELS[2] }] }));

    // 2. Each round the carbon tax started or rose: how the news moved each stock.
    H_.forEach((h, i) => {
      const before = i ? H_[i - 1].tax || 0 : 0;
      if ((h.tax || 0) <= before) return;
      const prevF = Object.fromEntries((i ? H_[i - 1].firms : h.firms).map((f) => [f.ticker, f]));
      const cutLevel = (f) => { const cut = 1 - (prevF[f.ticker] || f).e; return cut <= 1e-9 ? 0 : cut < 0.15 ? 1 : 2; };
      const r = h.firms.map((f) => ({ label: f.name, value: (f.why && f.why.tax) || 0, color: LEVELS[cutLevel(f)] }))
        .sort((p, q) => q.value - p.value);
      add(`02_carbon_tax_${h.label.replace(/\s+/g, "_").toLowerCase()}`, `Carbon tax news, ${h.label}`,
        "Bars: the part of each stock's move that came from the carbon tax news. Color: emissions already cut.",
        hbar(r, { caption: `${h.label}: carbon tax ${before ? `rises from $${before} to` : "starts at"} $${h.tax} a tonne`,
          legend: [{ label: "No cuts", color: LEVELS[0] }, { label: "Cut 10%", color: LEVELS[1] }, { label: "Cut 20% or more", color: LEVELS[2] }] }));
    });

    // 3. Damaging stories and audits: the hit, by what the company had done in that area.
    const hits = [];
    H_.forEach((h) => h.firms.forEach((f) => {
      const ev = (f.events || []).filter((e) => e.startsWith("story") || e.startsWith("expose"));
      if (!ev.length) return;
      const area = ev[0].slice(-1);
      const real = area === "E" ? 1 - f.e > 1e-9 : f.pay > 0 || f.safety;
      const pledge = area === "E" ? f.pkg.E : f.pkg.S;
      const kind = ev.some((e) => e.startsWith("story")) ? (area === "E" ? "environment story" : "worker story") : "audit";
      hits.push({ label: `${f.name}, ${h.label} (${kind})`, value: (f.why && f.why.news) || 0, color: LEVELS[real ? 2 : pledge ? 1 : 0] });
    }));
    if (hits.length) {
      hits.sort((p, q) => q.value - p.value);
      add("03_bad_news", "Damaging stories and audits",
        "Bars: the stock hit from the story or audit. Color: what the company had done in that area. Stories that never happened are the other half of the insurance story.",
        hbar(hits.slice(0, 14), { caption: "Damaging stories and audits",
          legend: [{ label: "Nothing", color: LEVELS[0] }, { label: "Pledges only", color: LEVELS[1] }, { label: "Real action", color: LEVELS[2] }] }));
    }

    // 4. Money in each ESG fund, round by round.
    const funds = last.funds.map((fd, k) => ({ label: fd.name, color: SERIES[k % SERIES.length],
      values: H_.map((h) => (h.funds.find((x) => x.id === fd.id) || {}).aum || 0) }));
    // AUM is in billions of dollars.
    const tril = Math.max(...funds.flatMap((s) => s.values)) >= 1000;
    add("04_fund_money", "Money in each ESG fund",
      "Assets under management after each round: returns plus investors moving money.",
      lines(funds, H_.map((h) => h.label.replace("Round ", "R")), {
        caption: "Money in each ESG fund (AUM)", fmt: (v) => (tril ? `$${(v / 1000).toFixed(2)}T` : `$${v.toFixed(0)}B`) }));

    return out;
  }

  root.ESGCharts = { make };
})(typeof window !== "undefined" ? window : globalThis);
