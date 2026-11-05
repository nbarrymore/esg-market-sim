// Views for the ESG market simulation. One page, routed by URL parameters:
//   ?s=SESSION                      pick a role
//   ?s=SESSION&role=host            instructor console (holds the game state)
//   ?s=SESSION&role=board           projector
//   ?s=SESSION&role=firm&id=XOM     a CEO team
//   ?s=SESSION&role=fund&id=F1      a fund team
(function () {
  "use strict";
  const E = window.ESG;
  const qs = new URLSearchParams(location.search);
  const session = (qs.get("s") || "").trim();
  const role = qs.get("role") || "";
  const myId = qs.get("id") || "";
  const app = document.getElementById("app");

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const B = (x) => (Math.abs(x) >= 1000 ? `$${(x / 1000).toFixed(2)}T` : `$${x.toFixed(x < 10 ? 2 : 1)}B`);
  const pct = (x, d = 1) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(d)}%`;
  const n0 = (x) => Math.round(x).toString();
  const link = (params) => `${location.pathname}?${new URLSearchParams(Object.assign({ s: session }, params))}`;
  const roundCfg = (S) => S.rounds[Math.min(S.round, S.rounds.length - 1)];
  const taxLine = (S) => {
    const c = roundCfg(S);
    if (S.phase === "over") return "Game over";
    if (c.tax) return "A carbon tax is in force: firms pay $1 for every $1 of social cost.";
    return `Chance of a carbon tax: ${Math.round(100 * c.q)}%` + (c.mandate ? " · Audited impact accounts are now mandatory" : "");
  };
  const phaseName = { setup: "Setting up", decide: "Decisions open", vote: "Voting open", over: "Finished" };

  function header(S, title, sub) {
    const c = S ? roundCfg(S) : null;
    return `<header><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>
      ${S ? `<div class="round"><b>${S.phase === "over" ? "Final" : esc(c.label)}</b> · ${phaseName[S.phase] || S.phase}<br><span class="sub">${esc(taxLine(S))}</span></div>` : ""}
      </header>${store && !store.remote ? '<div class="banner">Local test mode: only tabs in this browser can see this game.</div>' : ""}`;
  }

  function headlines(S) {
    if (!S.headlines || !S.headlines.length) return "";
    return `<section class="news"><h2>News</h2><ul>${S.headlines.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></section>`;
  }

  function lastHist(S) { return S.history.length ? S.history[S.history.length - 1] : null; }

  if (!session) {
    app.innerHTML = `<header><div><h1>ESG Market</h1></div></header>
      <section><p>Enter the session code your instructor gives you.</p>
      <form id="join"><input name="s" placeholder="Session code" autocomplete="off"> <button>Join</button></form></section>`;
    document.getElementById("join").onsubmit = (e) => {
      e.preventDefault();
      const s = new FormData(e.target).get("s").trim();
      if (s) location.search = "?s=" + encodeURIComponent(s);
    };
    return;
  }

  const store = new window.ESGStore(session);
  let S = null;

  // ================================================================= picker
  async function picker() {
    S = await store.latestState();
    const draw = () => {
      if (!S) { app.innerHTML = header(null, "ESG Market", `Session ${esc(session)}`) + "<section><p>Waiting for the instructor to start the game.</p></section>"; return; }
      app.innerHTML = header(S, "ESG Market", `Session ${esc(session)}`) + `<section><h2>Choose your team</h2>
        <h3>Company CEOs</h3><div class="grid">${S.firms.filter((f) => f.student).map((f) =>
          `<a class="card" href="${link({ role: "firm", id: f.ticker })}">${esc(f.name)}</a>`).join("")}</div>
        <h3>Fund managers</h3><div class="grid">${S.funds.map((f) =>
          `<a class="card" href="${link({ role: "fund", id: f.id })}">${esc(f.name)}<span class="sub"> ${esc(f.label)}</span></a>`).join("")}</div>
        <p class="sub"><a href="${link({ role: "board" })}">Projector view</a></p></section>`;
    };
    draw();
    store.on((ev) => { if (ev.kind === "state") { S = ev.payload; draw(); } });
  }

  // ================================================================= firm
  async function firmView() {
    S = await store.latestState();
    const draft = { round: -1, abate: 0, policy: 0 };
    let sent = null;
    function draw() {
      if (!S) { app.innerHTML = header(null, "Waiting", "") + "<section><p>The game has not started.</p></section>"; return; }
      const f = S.firms.find((x) => x.ticker === myId);
      if (!f) { app.innerHTML = "<section><p>Unknown company.</p></section>"; return; }
      if (draft.round !== S.round) { draft.round = S.round; draft.abate = f.minAbate || 0; draft.policy = 0; sent = null; }
      const c = roundCfg(S);
      const budget = E.firmBudget(f);
      const npv = E.abatementNPV(f, c.q);
      const open = S.phase === "decide";
      const h = lastHist(S);
      const hf = h && h.firms.find((x) => x.ticker === f.ticker);
      app.innerHTML = header(S, f.name, `CEO team · ${esc(f.sector)}`) + headlines(S) + `
        ${f.values ? `<section class="card values"><b>Private board mandate.</b> Your board also scores you on how much you cut your company's social cost. Keep this to yourselves.</section>` : ""}
        <section><h2>Your company</h2><table class="kv">
          <tr><td>Stock price (start = 100)</td><td>${(100 * f.cap / f.cap0).toFixed(1)}</td></tr>
          <tr><td>Total shareholder return so far</td><td>${pct(f.tsr)}</td></tr>
          <tr><td>Market value</td><td>${B(f.cap)}</td></tr>
          <tr><td>Fundamental value</td><td>${B(f.V)}</td></tr>
          <tr><td>Social cost per year</td><td>${B(f.sc)} <span class="sub">(start ${B(f.sc0)})</span></td></tr>
          <tr><td>ESG rating (Rater A)</td><td>${n0(f.ratingA)} / 100</td></tr>
          <tr><td>Impact score (Rater B)</td><td>${n0(f.ratingB)} / 100</td></tr>
          ${hf ? `<tr><td>Last year's return</td><td>${pct(hf.ret)}</td></tr>` : ""}
        </table></section>
        <section><h2>This year's decision</h2>
          <p class="sub">Budget for both: ${B(budget)}. Every dollar comes out of this year's payout to shareholders.</p>
          ${f.minAbate > 0 ? `<p class="warn">Shareholders voted that you must spend at least ${B(f.minAbate)} on abatement.</p>` : ""}
          <label>Real abatement ($B)<input id="abate" type="number" min="${f.minAbate || 0}" step="0.1" value="${draft.abate}" ${open ? "" : "disabled"}></label>
          <p class="hint" id="abateHint"></p>
          <label>ESG policies and reporting ($B)<input id="policy" type="number" min="0" step="0.05" value="${draft.policy}" ${open ? "" : "disabled"}></label>
          <p class="hint" id="policyHint"></p>
          <button id="send" ${open ? "" : "disabled"}>${sent ? "Update decision" : "Submit decision"}</button>
          <p class="sub" id="status">${sent ? `Submitted ${sent}. You can change it until the round closes.` : open ? "" : "Decisions are closed."}</p>
        </section>
        <section class="sub"><h2>How it works</h2><ul>
          <li>Abatement cuts your social cost by ${B(f.eff)} a year for every $1B, for good. At today's chance of a carbon tax, each $1 of abatement adds about ${npv >= 0 ? "+" : "-"}$${Math.abs(npv).toFixed(2)} of value.</li>
          <li>Policies raise your Rater A score quickly and cut nothing. Auditors check a random third of companies each year.</li>
          <li>Rater B measures your social cost, with error, until audited accounts become mandatory.</li>
          <li>Funds see both ratings. Savers in ESG funds mostly look at Rater A.</li></ul></section>`;
      const a = document.getElementById("abate"), p = document.getElementById("policy");
      const hint = () => {
        draft.abate = +a.value || 0; draft.policy = +p.value || 0;
        const over = draft.abate + draft.policy > budget + 1e-9;
        document.getElementById("abateHint").textContent =
          `Cuts social cost by ${B(f.eff * draft.abate)} a year.` + (over ? " Over budget: both will be scaled down." : "");
        const fake = Object.assign({}, f, { cumPolicy: f.cumPolicy + draft.policy });
        document.getElementById("policyHint").textContent =
          `Rater A points from policies, before any audit: ${n0(E.policyPoints(fake))} (now ${n0(E.policyPoints(f))}).`;
      };
      a.oninput = hint; p.oninput = hint; hint();
      document.getElementById("send").onclick = async () => {
        try {
          await store.put("decision", f.ticker, S.round, { side: "firm", abate: Math.max(draft.abate, f.minAbate || 0), policy: draft.policy });
          sent = new Date().toLocaleTimeString();
          draw();
        } catch (e) { document.getElementById("status").textContent = "Could not send: " + e.message; }
      };
    }
    draw();
    store.on((ev) => { if (ev.kind === "state") { S = ev.payload; draw(); } });
  }

  // ================================================================= fund
  async function fundView() {
    S = await store.latestState();
    const draft = { round: -1, weights: {}, ticker: "", amount: 1, votes: {} };
    let sent = null, voted = null;
    function draw() {
      if (!S) { app.innerHTML = header(null, "Waiting", "") + "<section><p>The game has not started.</p></section>"; return; }
      const fd = S.funds.find((x) => x.id === myId);
      if (!fd) { app.innerHTML = "<section><p>Unknown fund.</p></section>"; return; }
      if (draft.round !== S.round) {
        draft.round = S.round; draft.weights = Object.assign({}, fd.weights); draft.votes = {}; sent = null; voted = null;
      }
      const mw = E.marketWeights(S);
      const h = lastHist(S);
      const rank = [...S.funds].sort((a, b) => b.aum / b.aum0 - a.aum / a.aum0).findIndex((x) => x.id === fd.id) + 1;
      const rows = S.firms.map((f) => {
        const hf = h && h.firms.find((x) => x.ticker === f.ticker);
        return `<tr class="${f.student ? "student" : ""}"><td>${esc(f.name)}</td><td>${hf ? pct(hf.ret, 0) : ""}</td>
          <td>${pct(f.cap / f.V - 1, 0)}</td><td>${n0(f.ratingA)}</td><td>${n0(f.ratingB)}</td><td>${B(f.sc)}</td>
          <td>${mw[f.ticker].toFixed(1)}</td>
          <td><input class="w" data-t="${f.ticker}" type="number" min="0" step="0.5" value="${(+draft.weights[f.ticker] || 0).toFixed(1)}" ${S.phase === "decide" ? "" : "disabled"}></td></tr>`;
      }).join("");
      const props = S.proposals || [];
      app.innerHTML = header(S, fd.name, `${esc(fd.label)} fund`) + headlines(S) + `
        <section><h2>Your fund</h2><table class="kv">
          <tr><td>Assets under management</td><td>${B(fd.aum)} <span class="sub">(start ${B(fd.aum0)})</span></td></tr>
          <tr><td>Growth so far</td><td>${pct(fd.aum / fd.aum0 - 1)} · rank ${rank} of ${S.funds.length}</td></tr>
          ${h ? `<tr><td>Last year</td><td>return ${pct(fd.r)}, savers ${fd.flow >= 0 ? "added" : "withdrew"} ${pct(Math.abs(fd.flow))}</td></tr>` : ""}
        </table></section>
        <section><h2>Portfolio</h2><div class="scroll"><table class="data">
          <tr><th>Company</th><th>Last return</th><th>Price vs value</th><th>Rater A</th><th>Rater B</th><th>Social cost</th><th>Market %</th><th>Your %</th></tr>
          ${rows}<tr class="total"><td>Total</td><td colspan="6"></td><td id="wsum"></td></tr></table></div>
          <button id="mkt" ${S.phase === "decide" ? "" : "disabled"}>Set to market weights</button>
          <h3>Engagement (optional)</h3>
          <p class="sub">Demand that one company spend at least an amount on abatement next year. Every fund votes; passive index money votes yes only if the abatement adds value.</p>
          <label>Company <select id="pt" ${S.phase === "decide" ? "" : "disabled"}><option value="">No proposal</option>${S.firms.filter((f) => f.student).map((f) =>
            `<option value="${f.ticker}" ${draft.ticker === f.ticker ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label>
          <label>Minimum abatement ($B) <input id="pa" type="number" min="0" step="0.5" value="${draft.amount}" ${S.phase === "decide" ? "" : "disabled"}></label>
          <button id="send" ${S.phase === "decide" ? "" : "disabled"}>${sent ? "Update portfolio" : "Submit portfolio"}</button>
          <p class="sub" id="status">${sent ? `Submitted ${sent}.` : ""}</p></section>
        ${S.phase === "vote" ? `<section><h2>Vote</h2>${props.length ? props.map((p) => {
          const f = S.firms.find((x) => x.ticker === p.ticker);
          const by = S.funds.find((x) => x.id === p.fund);
          const own = p.fund === fd.id;
          return `<div class="prop"><b>${esc(f.name)}</b>: spend at least ${B(p.amount)} on abatement next year
            <span class="sub">(filed by ${esc(by ? by.name : p.fund)})</span><br>
            ${own ? "<i>Your proposal: you vote yes.</i>" : `<label><input type="radio" name="v${p.id}" value="yes" ${draft.votes[p.id] === true ? "checked" : ""}> Yes</label>
            <label><input type="radio" name="v${p.id}" value="no" ${draft.votes[p.id] === false ? "checked" : ""}> No</label>`}</div>`;
        }).join("") + `<button id="vote">${voted ? "Update votes" : "Submit votes"}</button><p class="sub">${voted ? `Votes sent ${voted}.` : ""}</p>` : "<p>No proposals this year.</p>"}</section>` : ""}`;

      const sumW = () => {
        const t = Object.values(draft.weights).reduce((a, b) => a + (+b || 0), 0);
        document.getElementById("wsum").textContent = t.toFixed(1) + (Math.abs(t - 100) > 0.05 ? " (will be rescaled to 100)" : "");
      };
      document.querySelectorAll("input.w").forEach((inp) => {
        inp.oninput = () => { draft.weights[inp.dataset.t] = +inp.value || 0; sumW(); };
      });
      sumW();
      const mkt = document.getElementById("mkt");
      if (mkt) mkt.onclick = () => { draft.weights = Object.assign({}, mw); draw(); };
      document.getElementById("pt").onchange = (e) => { draft.ticker = e.target.value; };
      document.getElementById("pa").oninput = (e) => { draft.amount = +e.target.value || 0; };
      document.getElementById("send").onclick = async () => {
        try {
          await store.put("decision", fd.id, S.round, { side: "fund", weights: draft.weights,
            proposal: draft.ticker ? { ticker: draft.ticker, amount: draft.amount } : null });
          sent = new Date().toLocaleTimeString();
          draw();
        } catch (e) { document.getElementById("status").textContent = "Could not send: " + e.message; }
      };
      document.querySelectorAll(".prop input[type=radio]").forEach((r) => {
        r.onchange = () => { draft.votes[r.name.slice(1)] = r.value === "yes"; };
      });
      const vb = document.getElementById("vote");
      if (vb) vb.onclick = async () => {
        await store.put("vote", fd.id, S.round, { votes: draft.votes });
        voted = new Date().toLocaleTimeString();
        draw();
      };
    }
    draw();
    store.on((ev) => { if (ev.kind === "state") { S = ev.payload; draw(); } });
  }

  // ================================================================= board
  function chart(S) {
    // Student firms: total social cost (bars) and average Rater A (line), by year.
    const H = S.history.filter((h) => h.round > 0 || S.history.length === 1);
    if (!H.length) return "";
    const W = 640, Ht = 220, pad = 36;
    const tot = H.map((h) => h.firms.filter((f) => f.student).reduce((a, f) => a + f.sc, 0));
    const start = S.firms.filter((f) => f.student).reduce((a, f) => a + f.sc0, 0);
    const avgA = H.map((h) => { const st = h.firms.filter((f) => f.student); return st.reduce((a, f) => a + f.A, 0) / st.length; });
    const bw = (W - 2 * pad) / (H.length + 1);
    const y1 = (v) => Ht - pad - (v / start) * (Ht - 2 * pad);
    const y2 = (v) => Ht - pad - (v / 100) * (Ht - 2 * pad);
    const bars = [start, ...tot].map((v, i) => `<rect x="${pad + i * bw + 4}" y="${y1(v)}" width="${bw - 8}" height="${Ht - pad - y1(v)}" class="bar"/>
      <text x="${pad + i * bw + bw / 2}" y="${Ht - pad + 14}" text-anchor="middle">${i === 0 ? "Start" : esc(H[i - 1].label)}</text>
      <text x="${pad + i * bw + bw / 2}" y="${y1(v) - 4}" text-anchor="middle">${B(v)}</text>`).join("");
    const a0 = S.firms.filter((f) => f.student).reduce((a, f) => a + f.a0, 0) / S.firms.filter((f) => f.student).length;
    const pts = [a0, ...avgA].map((v, i) => `${pad + i * bw + bw / 2},${y2(v)}`).join(" ");
    return `<section><h2>Student companies: social cost and ESG rating</h2>
      <svg viewBox="0 0 ${W} ${Ht}" class="chart">${bars}<polyline points="${pts}" class="line"/>
      ${[a0, ...avgA].map((v, i) => `<circle cx="${pad + i * bw + bw / 2}" cy="${y2(v)}" r="4" class="dot"/>`).join("")}</svg>
      <p class="sub">Bars: total social cost per year. Line: average Rater A score (0 to 100).</p></section>`;
  }

  async function boardView() {
    S = await store.latestState();
    function draw() {
      if (!S) { app.innerHTML = header(null, "ESG Market", `Session ${esc(session)}`) + "<section><p>Waiting for the game to start.</p></section>"; return; }
      const h = lastHist(S);
      const firms = [...S.firms].sort((a, b) => b.student - a.student);
      const funds = [...S.funds].sort((a, b) => b.aum / b.aum0 - a.aum / a.aum0);
      app.innerHTML = header(S, "ESG Market", `Join at ${esc(location.host + location.pathname)} · session <b>${esc(session)}</b>`) + headlines(S) + `
        <div class="two"><section><h2>Companies</h2><div class="scroll"><table class="data">
          <tr><th>Company</th><th>Price</th><th>Last year</th><th>Price vs value</th><th>Rater A</th><th>Rater B</th><th>Social cost</th></tr>
          ${firms.map((f) => { const hf = h && h.firms.find((x) => x.ticker === f.ticker);
            return `<tr class="${f.student ? "student" : ""}${hf && hf.scandal ? " scandal" : ""}"><td>${esc(f.name)}</td><td>${(100 * f.cap / f.cap0).toFixed(0)}</td>
            <td>${hf ? pct(hf.ret, 0) : ""}</td><td>${pct(f.cap / f.V - 1, 0)}</td><td>${n0(f.ratingA)}</td><td>${n0(f.ratingB)}</td><td>${B(f.sc)}</td></tr>`; }).join("")}
        </table></div></section>
        <section><h2>Funds</h2><table class="data"><tr><th>Fund</th><th>Type</th><th>Growth</th><th>Last return</th><th>Savers</th></tr>
          ${funds.map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(f.label)}</td><td>${pct(f.aum / f.aum0 - 1, 0)}</td>
            <td>${h ? pct(f.r, 1) : ""}</td><td>${h ? pct(f.flow, 1) : ""}</td></tr>`).join("")}</table>
        ${S.firms.some((f) => f.student) ? `<h2>CEOs</h2><table class="data"><tr><th>Company</th><th>Shareholder return</th><th>Social cost cut</th></tr>
          ${S.firms.filter((f) => f.student).sort((a, b) => b.tsr - a.tsr).map((f) => `<tr><td>${esc(f.name)}</td><td>${pct(f.tsr, 0)}</td><td>${pct(1 - f.sc / f.sc0, 0)}</td></tr>`).join("")}</table>` : ""}
        </section></div>${chart(S)}`;
    }
    draw();
    store.on((ev) => { if (ev.kind === "state") { S = ev.payload; draw(); } });
  }

  // ================================================================= host
  async function hostView() {
    const saveKey = "esg-host:" + session;
    let G = null, params = null, snaps = [];
    let pending = { firm: {}, fund: {} }, votes = {};
    try {
      const saved = JSON.parse(localStorage.getItem(saveKey) || "null");
      if (saved) { G = saved.G; params = saved.params; snaps = saved.snaps || []; }
    } catch (e) { /* fresh start */ }
    if (!G) G = await store.latestState();

    const save = () => { try { localStorage.setItem(saveKey, JSON.stringify({ G, params, snaps: snaps.slice(-6) })); } catch (e) { /* storage full */ } };
    const publish = async () => { save(); await store.put("state", "host", G.round, G); };

    async function loadRound() {
      pending = { firm: {}, fund: {} }; votes = {};
      if (!G || G.phase === "setup") return;
      (await store.roundEvents(G.round)).forEach(take);
    }
    function take(ev) {
      if (!G || ev.round !== G.round) return;
      if (ev.kind === "decision" && ev.payload.side === "firm") pending.firm[ev.team] = ev.payload;
      if (ev.kind === "decision" && ev.payload.side === "fund") {
        pending.fund[ev.team] = ev.payload;
        const p = ev.payload.proposal;
        if (G.phase === "decide") {  // proposals are frozen once voting opens
          const before = JSON.stringify(G.proposals);
          G.proposals = G.proposals.filter((x) => x.fund !== ev.team);
          if (p && p.ticker) E.addProposal(G, ev.team, p.ticker, p.amount);
          if (JSON.stringify(G.proposals) !== before) publish();
        }
      }
      if (ev.kind === "vote") votes[ev.team] = ev.payload.votes;
    }

    function setup() {
      app.innerHTML = header(null, "Instructor console", `Session ${esc(session)}`) + `<section><h2>New game</h2>
        <p>1. Load <code>params.json</code> (built by make_params.py).</p><input type="file" id="pf" accept=".json">
        <div id="cfg"></div></section>`;
      document.getElementById("pf").onchange = async (e) => {
        params = JSON.parse(await e.target.files[0].text());
        drawCfg();
      };
      function drawCfg() {
        document.getElementById("cfg").innerHTML = `<p>2. Companies run by students, and secret values cards.</p>
          <table class="data"><tr><th>Company</th><th>Student team</th><th>Values card</th></tr>
          ${params.firms.map((f, i) => `<tr><td>${esc(f.name)}</td><td><input type="checkbox" class="st" data-i="${i}" ${f.student ? "checked" : ""}></td>
            <td><input type="checkbox" class="vc" data-i="${i}" ${f.values ? "checked" : ""}></td></tr>`).join("")}</table>
          <p>3. Funds (the four that won the vote). Names and type.</p>
          <div id="funds">${[1, 2, 3, 4].map((i) => fundRow(i)).join("")}</div><button id="addf">Add a fund</button>
          <p>4. Random seed <input id="seed" type="number" value="${20261110}"></p>
          <button id="start" class="primary">Start the game</button>`;
        let k = 4;
        document.getElementById("addf").onclick = () => { k += 1; document.getElementById("funds").insertAdjacentHTML("beforeend", fundRow(k)); };
        document.getElementById("start").onclick = start;
      }
      function fundRow(i) {
        return `<div class="frow"><input class="fn" value="Fund ${i}"> <select class="fl"><option>ESG</option><option>Conventional</option></select></div>`;
      }
      async function start() {
        document.querySelectorAll(".st").forEach((c) => { params.firms[c.dataset.i].student = c.checked; });
        document.querySelectorAll(".vc").forEach((c) => { params.firms[c.dataset.i].values = c.checked; });
        params.seed = +document.getElementById("seed").value || 20261110;
        G = E.newGame(params);
        const names = [...document.querySelectorAll(".fn")].map((x) => x.value.trim());
        const labels = [...document.querySelectorAll(".fl")].map((x) => x.value);
        names.forEach((n, i) => { if (n) E.addFund(G, "F" + (i + 1), n, labels[i]); });
        G.phase = "decide";
        snaps = [];
        await publish();
        await loadRound();
        console_();
      }
    }

    function console_() {
      const firms = G.firms.filter((f) => f.student);
      const status = (ok) => (ok ? '<span class="ok">✓</span>' : '<span class="no">·</span>');
      app.innerHTML = header(G, "Instructor console", `Session ${esc(session)}`) + `
        <section><h2>Links</h2><p>Students: <code>${esc(location.origin + location.pathname)}</code>, session <b>${esc(session)}</b>.
          <a href="${link({ role: "board" })}" target="_blank">Projector view</a></p></section>
        <section><h2>Submissions</h2><table class="data"><tr><th>Team</th><th>Decision</th>${G.phase === "vote" ? "<th>Votes</th>" : ""}</tr>
          ${firms.map((f) => `<tr><td>${esc(f.name)}</td><td>${status(pending.firm[f.ticker])}</td>${G.phase === "vote" ? "<td></td>" : ""}</tr>`).join("")}
          ${G.funds.map((f) => `<tr><td>${esc(f.name)}</td><td>${status(pending.fund[f.id])}</td>${G.phase === "vote" ? `<td>${status(votes[f.id])}</td>` : ""}</tr>`).join("")}
        </table><p class="sub">Proposals filed: ${G.proposals.length}. Teams that do not submit keep last year's portfolio, or spend nothing.</p></section>
        <section><h2>Control</h2>
          ${G.phase === "decide" ? `<button id="vote" class="primary">Close decisions, open voting</button> <button id="resolveNow">Resolve without a vote</button>` : ""}
          ${G.phase === "vote" ? `<button id="resolve" class="primary">Close voting and resolve ${esc(roundCfg(G).label)}</button>` : ""}
          ${G.phase === "over" ? "<p>The game is over.</p>" : ""}
          <p><button id="undo" ${snaps.length ? "" : "disabled"}>Undo last resolve</button>
          ${G.history.length && G.history[0].round === 0 && G.round === 1 ? '<button id="restart">Start Year 1 fresh (keep portfolios)</button>' : ""}
          <button id="csv" ${G.history.length ? "" : "disabled"}>Download results (CSV)</button>
          <button id="json">Download game file</button>
          <button id="reset">New game</button></p></section>
        <section><h2>Rounds</h2><table class="data"><tr><th>Round</th><th>Chance of tax</th><th>Audited accounts</th><th>Tax in force</th></tr>
          ${G.rounds.map((r, i) => `<tr class="${i === G.round ? "student" : ""}"><td>${esc(r.label)}</td><td>${Math.round(100 * r.q)}%</td><td>${r.mandate ? "yes" : ""}</td><td>${r.tax ? "yes" : ""}</td></tr>`).join("")}</table></section>
        ${headlines(G)}`;
      const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
      on("vote", async () => { G.phase = "vote"; await publish(); console_(); });
      const resolve = async () => {
        snaps.push(JSON.stringify(G));
        E.resolveRound(G, pending, votes);
        await publish();
        await loadRound();
        console_();
      };
      on("resolve", resolve);
      on("resolveNow", () => { if (confirm("Resolve this round now? Proposals will not be voted on.")) { G.proposals = []; resolve(); } });
      on("undo", async () => { G = JSON.parse(snaps.pop()); await publish(); await loadRound(); console_(); });
      on("restart", async () => {
        const keep = G.funds.map((f) => ({ id: f.id, name: f.name, label: f.label, weights: f.weights }));
        G = E.newGame(params);
        keep.forEach((f) => { E.addFund(G, f.id, f.name, f.label); G.funds[G.funds.length - 1].weights = f.weights; });
        G.round = 1; G.phase = "decide"; snaps = [];
        await publish(); await loadRound(); console_();
      });
      on("csv", () => download(`esg-${session}.csv`, toCSV(G), "text/csv"));
      on("json", () => download(`esg-${session}.json`, JSON.stringify(G), "application/json"));
      on("reset", () => { if (confirm("Start a new game? The current one stays in the database but this console forgets it.")) { localStorage.removeItem(saveKey); G = null; setup(); } });
    }

    function toCSV(g) {
      const rows = [["round", "label", "q", "mandate", "tax", "kind", "id", "student", "abate", "policy", "tax_paid",
        "social_cost", "social_cost_start", "rater_a", "rater_b", "fund_value", "market_value", "premium", "return",
        "tsr", "scandal", "aum", "flow", "esg_score"]];
      g.history.forEach((h) => {
        h.firms.forEach((f) => rows.push([h.round, h.label, h.q, h.mandate, h.tax, "firm", f.ticker, f.student, f.abate, f.policy,
          f.tax, f.sc, f.sc0, f.A, f.B, f.V, f.cap, f.premium, f.ret, f.tsr, f.scandal, "", "", ""]));
        h.funds.forEach((f) => rows.push([h.round, h.label, h.q, h.mandate, h.tax, "fund", f.name, "", "", "", "", "", "", "", "",
          "", "", "", f.r, "", "", f.aum, f.flow, f.esgScore]));
      });
      return rows.map((r) => r.map((x) => (typeof x === "number" ? +x.toFixed(4) : x)).join(",")).join("\n");
    }
    function download(name, text, type) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = name; a.click();
    }

    store.on((ev) => { if (ev.kind !== "state") { take(ev); if (G && G.phase !== "setup") console_(); } });
    if (!G || !params) setup();
    else { await loadRound(); console_(); }
  }

  ({ host: hostView, board: boardView, firm: firmView, fund: fundView }[role] || picker)();
})();
