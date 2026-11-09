// Views for the ESG market simulation (version 3). One page, routed by URL:
//   ?s=SESSION                      pick a role
//   ?s=SESSION&role=host            instructor console (holds the full game)
//   ?s=SESSION&role=board           projector
//   ?s=SESSION&role=firm&id=COST    a CEO team
//   ?s=SESSION&role=fund&id=F1      a fund team
//   ?s=SESSION&role=saver           every student, on their own computer
//   ?s=SESSION&role=lab&local=1     test lab: every role in one window, nothing sent
// Students' pages only ever see E.publicState(): grades, indexes, actions.
(function () {
  "use strict";
  const E = window.ESG;
  const qs = new URLSearchParams(location.search);
  const session = (qs.get("s") || "").trim();
  const role = qs.get("role") || "";
  const myId = qs.get("id") || "";
  const local = qs.get("local") === "1";
  const app = document.getElementById("app");

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const B = (x) => (Math.abs(x) >= 1000 ? `$${(x / 1000).toFixed(1)}T` : Math.abs(x) >= 1 ? `$${x.toFixed(1)}B` : `$${Math.round(x * 1000)}M`);
  const usd = (x) => "$" + Math.round(x).toLocaleString();
  const pct = (x, d = 0) => { const v = Math.abs(100 * x).toFixed(d); return +v === 0 ? `${(0).toFixed(d)}%` : `${x >= 0 ? "+" : "−"}${v}%`; };
  const link = (params) => `${location.pathname}?${new URLSearchParams(Object.assign({ s: session }, local ? { local: "1" } : {}, params))}`;
  const roundCfg = (S) => S.rounds[Math.min(S.round, S.rounds.length - 1)];
  const lastLabel = (S) => (S.round > 0 ? S.rounds[S.round - 1].label : "");
  const gr = (l) => (l ? `<span class="gr g${l}">${l}</span>` : "");
  const phaseName = { setup: "Setting up", decide: "Decisions open", over: "Finished" };
  const POLICY = [[1, "Full credit"], [0.5, "Half"], [0, "No credit"]];

  // A big result triangle. dir: "up" | "down" | "flat".
  function tri(dir, big, label, lines) {
    const glyph = { up: "▲", down: "▼", flat: "■" }[dir];
    return `<div class="tri ${dir}"><div class="glyph">${glyph}</div><div><div class="big">${big}</div><div class="tlabel">${label}</div>
      ${lines && lines.length ? `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}</div></div>`;
  }
  const dirOf = (x) => (x > 0.0005 ? "up" : x < -0.0005 ? "down" : "flat");

  function climateLine(S) {
    const c = roundCfg(S);
    if (S.phase === "over") return "Game over";
    const audit = c.mandate ? " · Every company is audited this round" : "";
    if (!S.taxOn) return `Chance a $${S.taxNext || 5} carbon tax passes this round: ${Math.round(100 * (S.taxChance || 0))}%` + audit;
    return `Carbon tax $${S.taxNow} a tonne` + (S.taxChance ? ` · chance it rises to $${S.taxNext} this round: ${Math.round(100 * S.taxChance)}%` : "") + audit;
  }

  function header(S, title, sub) {
    const c = S ? roundCfg(S) : null;
    return `<header><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>
      ${S ? `<div class="round"><b>${S.phase === "over" ? "Final" : esc(c.label)}</b> · ${phaseName[S.phase] || S.phase}<br><span class="sub">${esc(climateLine(S))}</span></div>` : ""}
      </header>${store && !store.remote ? `<div class="banner">${local ? "Test lab: nothing leaves this browser." : "Local test mode: only tabs in this browser can see this game."}</div>` : ""}`;
  }

  function headlines(S) {
    if (!S.headlines || !S.headlines.length) return "";
    return `<section class="news"><h2>News${S.round > 0 ? " from " + esc(lastLabel(S)) : ""}</h2><ul>${S.headlines.map((h) => `<li>${esc(typeof h === "string" ? h : h.text)}</li>`).join("")}</ul></section>`;
  }

  function progressText(p) {
    const bits = [];
    if (p.emissionsCut > 0.005) bits.push(`emissions ${pct(-p.emissionsCut)}`);
    if (p.pay) bits.push(`pay +$${p.pay}/hr`);
    if (p.safety) bits.push("safety program");
    const pk = ["E", "S"].filter((k) => p.pkg[k]);
    if (pk.length) bits.push(`${pk.join(" and ")} policies`);
    return bits.join(" · ") || "nothing yet";
  }

  function seg(name, options, current, disabled) {
    return `<div class="seg" data-name="${name}">${options.map(([v, t, off]) =>
      `<button type="button" data-v="${v}" class="${String(v) === String(current) ? "on" : ""}" ${disabled || off ? "disabled" : ""}>${t}</button>`).join("")}</div>`;
  }
  function wireSeg(root, onPick) {
    root.querySelectorAll(".seg").forEach((g) => g.querySelectorAll("button").forEach((b) => {
      b.onclick = () => onPick(g.dataset.name, b.dataset.v);
    }));
  }

  function waiting(title) {
    app.innerHTML = header(null, title, `Session ${esc(session)}`) + "<section><p>Waiting for the instructor to start the game.</p></section>";
  }

  if (!session) {
    app.innerHTML = `<header><div><h1>ESG Market</h1></div></header>
      <section><p>Enter the session code your instructor gives you.</p>
      <form id="join"><input name="s" placeholder="Session code" autocomplete="off"> <button>Join</button></form>
      <p class="sub"><a href="?s=lab&role=lab&local=1">Instructor test lab</a></p></section>`;
    document.getElementById("join").onsubmit = (e) => {
      e.preventDefault();
      const s = new FormData(e.target).get("s").trim();
      if (s) location.search = "?s=" + encodeURIComponent(s);
    };
    return;
  }

  if (role === "lab") return lab();

  const store = new window.ESGStore(session);
  let S = null;
  const follow = (draw) => store.on((ev) => { if (ev.kind === "state") { S = ev.payload; draw(); } });

  // ================================================================= lab
  // Every role in one window. Frames stay loaded, so the console keeps
  // collecting decisions while you play other roles.
  function lab() {
    const demo = qs.get("demo") === "1" ? { demo: "1" } : {};
    const views = [["host", "Instructor console", Object.assign({ role: "host" }, demo)], ["board", "Projector", { role: "board" }]];
    let st = null;
    try { const ev = JSON.parse(localStorage.getItem("esg:" + session) || "[]").filter((e) => e.kind === "state").pop(); st = ev ? ev.payload : null; } catch (e) { /* none */ }
    if (st) {
      st.ceo.forEach((f) => views.push(["firm-" + f.ticker, "CEO: " + f.name, { role: "firm", id: f.ticker }]));
      st.funds.forEach((f) => views.push(["fund-" + f.id, "ESG fund: " + f.name, { role: "fund", id: f.id }]));
      views.push(["saver-1", "Investor 1", { role: "saver", id: "lab1" }], ["saver-2", "Investor 2", { role: "saver", id: "lab2" }]);
    }
    document.body.classList.add("labbody");
    app.outerHTML = `<div class="lab"><nav>${views.map(([k, t]) => `<button data-k="${k}">${esc(t)}</button>`).join("")}
      <button id="labreload" title="After starting a game, reload to get a tab for every team">Reload tabs</button>
      <button id="labclear">Clear test game</button></nav>
      <div class="frames">${views.map(([k, , p]) => `<iframe data-k="${k}" src="${link(Object.assign({ local: "1" }, p))}"></iframe>`).join("")}</div></div>`;
    const show = (k) => {
      document.querySelectorAll(".lab nav button[data-k]").forEach((b) => b.classList.toggle("on", b.dataset.k === k));
      document.querySelectorAll(".lab iframe").forEach((f) => { f.style.display = f.dataset.k === k ? "block" : "none"; });
      try { sessionStorage.setItem("lab-tab", k); } catch (e) { /* ok */ }
    };
    document.querySelectorAll(".lab nav button[data-k]").forEach((b) => { b.onclick = () => show(b.dataset.k); });
    document.getElementById("labreload").onclick = () => location.reload();
    document.getElementById("labclear").onclick = () => {
      if (!confirm("Delete the test game in this browser?")) return;
      localStorage.removeItem("esg:" + session); localStorage.removeItem("esg3-host:" + session); location.reload();
    };
    let k0 = "host";
    try { k0 = sessionStorage.getItem("lab-tab") || "host"; } catch (e) { /* ok */ }
    show(views.some((v) => v[0] === k0) ? k0 : "host");
  }

  // ================================================================= student screens
  // Every student screen fits one laptop screen with no scrolling; anything
  // optional opens in a pop-up.

  // One id per browser, and the role it chose, remembered per session.
  let device = null;
  try { device = localStorage.getItem("esg-device"); } catch (e) { /* private window */ }
  if (!device) { device = Math.random().toString(36).slice(2, 10); try { localStorage.setItem("esg-device", device); } catch (e) { /* ok */ } }
  const roleKey = "esg-role:" + session;
  function myRole() { try { return JSON.parse(localStorage.getItem(roleKey) || "null"); } catch (e) { return null; } }
  function setRole(r) { try { if (r) localStorage.setItem(roleKey, JSON.stringify(r)); else localStorage.removeItem(roleKey); } catch (e) { /* ok */ } }
  function myTeam() { const r = myRole(); return r && (r.role === "firm" || r.role === "fund") ? r : null; }
  function teamLink(t) { return link({ role: t.role, id: t.id }); }
  function wrongRole() { return `<button type="button" class="link small" id="wrongrole">Wrong role?</button>`; }
  function wireWrongRole() {
    const b = document.getElementById("wrongrole");
    if (b) b.onclick = () => { if (confirm("Start over and pick a different role? Tell your instructor if you had a company or fund.")) { setRole(null); location.href = link({}); } };
  }

  // Compact header for student screens.
  function sheader(S, title, sub) {
    const c = roundCfg(S);
    return `<header class="sh"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>
      <div class="round"><b>${S.phase === "over" ? "Final" : esc(c.label)}</b> · ${phaseName[S.phase] || S.phase}<br><span class="sub">${esc(climateLine(S))}</span></div></header>
      ${store && !store.remote ? `<div class="banner slim">${local ? "Test lab: nothing leaves this browser." : "Local test mode."}</div>` : ""}`;
  }
  function stepBar(step, here) {
    const t = here || myTeam();
    if (!t) return "";
    const who = t.role === "firm" ? `CEO of ${esc(t.name)}` : `Fund manager, ${esc(t.name)}`;
    return `<div class="steps"><span class="${step === 1 ? "on" : ""}">Step 1 of 2 · ${who}</span><span class="${step === 2 ? "on" : ""}">Step 2 of 2 · Your investments</span></div>`;
  }

  // Pop-ups: a button that opens a dialog.
  function popup(id, title, body) {
    return `<dialog id="${id}" class="pop"><div class="pophead"><b>${esc(title)}</b><button type="button" class="link" data-close="${id}">Close</button></div><div class="popbody">${body}</div></dialog>`;
  }
  const opener = (id, label) => `<button type="button" class="popbtn" data-open="${id}">${label}</button>`;
  function wirePopups() {
    document.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => document.getElementById(b.dataset.open).showModal(); });
    document.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => document.getElementById(b.dataset.close).close(); });
  }
  function newsPopup(S) {
    const hs = (S.headlines || []).map((h) => (typeof h === "string" ? h : h.text));
    return popup("pnews", S.round > 0 ? `News from ${lastLabel(S)}` : "News", hs.length ? `<ul>${hs.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : "<p>No news yet.</p>");
  }

  // ---------------------------------------------------------------- join page
  async function picker() {
    S = await store.latestState();
    const r = myRole();
    if (r && r.role === "investor") { location.href = link({ role: "saver" }); return; }
    if (r && r.role === "firm") { location.href = link({ role: "firm", id: r.id }); return; }
    if (r && r.role === "fund") { location.href = link({ role: "fund", id: r.id }); return; }
    let want = null;  // "firm" | fund id, while waiting for the console
    const draw = () => {
      if (!S) return waiting("ESG Market");
      const company = (S.assign || {})[device];
      if (company) { const f = S.ceo.find((x) => x.ticker === company); setRole({ role: "firm", id: company, name: f ? f.name : company }); location.href = link({ role: "firm", id: company }); return; }
      const myFund = Object.keys(S.fundAssign || {}).find((k) => S.fundAssign[k] === device);
      if (myFund) { const fd = S.funds.find((x) => x.id === myFund); setRole({ role: "fund", id: myFund, name: fd ? fd.name : myFund }); location.href = link({ role: "fund", id: myFund }); return; }
      const freeCo = S.ceo.length - Object.keys(S.assign || {}).length;
      const takenFund = (id) => !!(S.fundAssign || {})[id];
      app.innerHTML = sheader(S, "ESG Market", `Session ${esc(session)}`) + `<section class="join">
        <p>Pick your role. <b>One person per team</b> picks CEO or fund manager; their teammate picks <b>Investor only</b>.</p>
        <div class="joingrid">
          <button type="button" class="jcard" id="jceo" ${freeCo > 0 ? "" : "disabled"}><b>CEO + investor</b><span>Run a company (you get one at random), then invest your own money</span><span class="sub">${freeCo} companies left</span></button>
          <div class="jcard"><b>Fund manager + investor</b><span>Run your group's ESG fund from Tuesday, then invest your own money</span>
            ${S.funds.map((fd) => `<button type="button" class="jfund" data-f="${fd.id}" ${takenFund(fd.id) ? "disabled" : ""}>${esc(fd.name)}${takenFund(fd.id) ? " · taken" : ""}</button>`).join("")}</div>
          <button type="button" class="jcard" id="jinv"><b>Investor only</b><span>Invest your own money. Your teammate has your team's screen.</span></button>
        </div><p class="sub" id="jst">${want ? "Getting your seat from the instructor's console..." : ""}</p></section>`;
      document.getElementById("jinv").onclick = () => { setRole({ role: "investor" }); location.href = link({ role: "saver" }); };
      document.getElementById("jceo").onclick = async () => {
        want = "firm"; document.getElementById("jst").textContent = "Getting you a company...";
        try { await store.put("decision", "claim:" + device, S.round, { side: "claim", device }); }
        catch (e) { document.getElementById("jst").textContent = "Could not reach the game: " + e.message; }
      };
      document.querySelectorAll(".jfund").forEach((b) => { b.onclick = async () => {
        want = b.dataset.f; document.getElementById("jst").textContent = "Checking that fund is free...";
        try { await store.put("decision", "claimfund:" + device, S.round, { side: "claimfund", device, fund: b.dataset.f }); }
        catch (e) { document.getElementById("jst").textContent = "Could not reach the game: " + e.message; }
      }; });
    };
    draw(); follow(draw);
  }

  // ---------------------------------------------------------------- CEO
  function firmResult(S, f) {
    if (S.round === 0 || !f.why) return `<div class="result muted">Results appear here after each round.</div>`;
    const w = f.why;
    const reasons = [["Carbon tax news", w.tax], ["Your pay and emissions changes", w.own], ["Bad press", w.news],
      ["ESG spending", w.spending], ["ESG fund demand", w.demand], ["Market", w.market]]
      .filter(([, v]) => Math.abs(v || 0) >= 0.005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3)
      .map(([t, v]) => `<span class="${t === "Bad press" ? "bad" : ""}">${t} ${pct(v, 1)}</span>`).join(" · ");
    const d = dirOf(f.ret);
    return `<div class="result"><span class="arr ${d}">${{ up: "▲", down: "▼", flat: "■" }[d]}</span>
      <b>${pct(f.ret, 1)}</b> in ${esc(lastLabel(S))}${reasons ? `<span class="why">${reasons}</span>` : ""}<span class="tot">Total so far ${pct(f.tsr, 1)}</span></div>`;
  }

  async function firmView() {
    S = await store.latestState();
    const draft = { round: -1 };
    function draw() {
      if (!S) return waiting("CEO");
      const f = S.ceo.find((x) => x.ticker === myId);
      if (!f) { app.innerHTML = "<section><p>Unknown company.</p></section>"; return; }
      if (!myTeam()) setRole({ role: "firm", id: f.ticker, name: f.name });
      if (draft.round !== S.round) {
        Object.assign(draft, { round: S.round, cut: 0, pay: 0, safety: false, pkgE: false, pkgS: false, responses: {} });
        f.campaigns.forEach((c) => { draft.responses[c.id] = "fight"; });
      }
      const open = S.phase === "decide";
      const c = f.costs, p = f.progress;
      const spend = (d) => (d.cut === 10 ? c.cut10 : d.cut === 20 ? c.cut20 : 0) + (d.safety ? c.safety : 0) + ((d.pkgE ? 1 : 0) + (d.pkgS ? 1 : 0)) * c.pkg;
      const fits = (cut) => spend(Object.assign({}, draft, { cut })) <= f.budget + 1e-9;
      const camp = f.campaigns.map((cp) => `<div class="camprow"><span><b>${esc(cp.fundName)}</b> demands you <b>${esc(cp.text)}</b>.
          If you fight, it costs about 1% of your value and the fund wins ${Math.round(100 * cp.odds)}% of the time.</span>
          ${seg("resp:" + cp.id, [["accept", "Accept"], ["fight", "Fight"]], draft.responses[cp.id], !open)}</div>`).join("");
      const grades = S.funds.map((fd) => `<tr><td>${esc(fd.name)}</td><td>${gr(f.grades[fd.id])}</td><td class="sub">${f.held[fd.id] ? "holds you" : ""}</td></tr>`).join("");
      const how = `<ul>
        <li><b>Budget.</b> One-time spending this round can't exceed ${B(f.budget)}. It comes out of this round's payout to shareholders. Pay raises cost money every round after.</li>
        <li><b>Emissions cuts</b> are for good. They save money only if there is a carbon tax; the tax is $${S.taxNow || 0} a tonne now and could rise.</li>
        <li><b>Pay raises</b> cost ${B(c.pay)} a year per $1 an hour; ${Math.round(100 * c.payBack)}% comes back in lower turnover.</li>
        <li><b>Pledges and policies</b> are cheap. They switch Yes/No data points that ESG funds grade, and change nothing else. Audits check them against what you actually did.</li>
        <li><b>ESG funds</b> each hold the best-graded third of the class's companies. Being held lifts your stock price a little; being dropped lowers it.</li>
        <li><b>Damaging stories</b> about the environment or workers can hit any company, at odds nobody knows. Real changes and policies may lower the odds, by an amount nobody knows.</li></ul>`;
      app.innerHTML = sheader(S, f.name, `CEO · ${esc(f.sector)}`) + stepBar(1, { role: "firm", name: f.name }) + firmResult(S, f) + `
        <div class="screen2"><div class="decide">
          ${camp}
          <div class="drow"><span>Cut emissions</span>${seg("cut", [[0, "0%"], [10, c.cut10 !== null ? `10% · ${B(c.cut10)}` : "10%", c.cut10 === null || !fits(10)],
            [20, c.cut20 !== null ? `20% · ${B(c.cut20)}` : "20%", c.cut20 === null || !fits(20)]], draft.cut, !open)}
            <em>$1 spent is worth $${Math.max(0, 1 + f.cutValue).toFixed(2)} at today's expected tax</em></div>
          <div class="drow"><span>Raise pay</span>${seg("pay", [[0, "No"], [1, "+$1/hr", f.payLeft < 1], [2, "+$2/hr", f.payLeft < 2]], draft.pay, !open)}
            <em>$1/hr costs ${B(c.pay)} a year; ${Math.round(100 * c.payBack)}% comes back</em></div>
          <div class="drow"><span>Safety program</span>${p.safety ? '<i>done</i>' : seg("safety", [[0, "No"], [1, `Run it · ${B(c.safety)}`]], draft.safety ? 1 : 0, !open)}<em></em></div>
          <div class="drow"><span>Environmental pledges</span>${p.pkg.E ? '<i>adopted</i>' : seg("pkgE", [[0, "No"], [1, `Adopt · ${B(c.pkg)}`]], draft.pkgE ? 1 : 0, !open)}<em></em></div>
          <div class="drow"><span>Worker policies</span>${p.pkg.S ? '<i>adopted</i>' : seg("pkgS", [[0, "No"], [1, `Adopt · ${B(c.pkg)}`]], draft.pkgS ? 1 : 0, !open)}<em></em></div>
          <div class="submitrow"><span>Spending ${B(spend(draft))} of ${B(f.budget)}${draft.pay ? ` · +${B(draft.pay * c.pay)} a year in pay` : ""}</span>
            <button id="send" ${open ? "" : "disabled"}>Submit and go to step 2</button></div>
          <p class="sub" id="status">${open ? "No submission means no changes this round." : "Decisions are closed."}</p>
        </div><div class="side">
          <h3>How ESG funds grade you</h3><table class="data gtable">${grades}</table>
          <h3>Done so far</h3><p class="sub">${esc(progressText(p))}</p>
          <div class="pops">${opener("pnews", "News")}${opener("phow", "How this works")}</div>
        </div></div>
        <div class="foot">${wrongRole()}</div>
        ${newsPopup(S)}${popup("phow", "How this works", how)}`;
      wireSeg(app, (name, v) => {
        if (name.startsWith("resp:")) draft.responses[name.slice(5)] = v;
        else if (name === "cut" || name === "pay") draft[name] = +v;
        else draft[name] = v === "1";
        draw();
      });
      wirePopups(); wireWrongRole();
      document.getElementById("send").onclick = async () => {
        try {
          await store.put("decision", f.ticker, S.round, { side: "firm", cut: draft.cut, payRaise: draft.pay, safety: draft.safety ? 1 : 0,
            pkgE: draft.pkgE, pkgS: draft.pkgS, responses: draft.responses });
          location.href = link({ role: "saver" });
        } catch (e) { document.getElementById("status").textContent = "Could not send: " + e.message; }
      };
    }
    draw(); follow(draw);
  }

  // ---------------------------------------------------------------- fund manager
  const MAXW = 10;  // matches engine P.reweightMax
  async function fundView() {
    S = await store.latestState();
    const draft = { round: -1 };
    function draw() {
      if (!S) return waiting("Fund manager");
      const fd = S.funds.find((x) => x.id === myId);
      if (!fd) { app.innerHTML = "<section><p>Unknown fund.</p></section>"; return; }
      if (!myTeam()) setRole({ role: "fund", id: fd.id, name: fd.name });
      if (draft.round !== S.round) Object.assign(draft, { round: S.round, policyE: fd.policyE, policyS: fd.policyS, ticker: "", kind: "", w: Object.assign({}, fd.pillarWeights) });
      const open = S.phase === "decide";
      const canLaunch = open && S.round < S.rounds.length - 1;
      const played = S.round > 0;
      const mine = S.campaigns.filter((c) => c.fund === fd.id);
      const st = { pending: "waiting for their answer", accepted: "accepted", won: "won the proxy fight", lost: "lost the proxy fight", lapsed: "ended with the game" };
      const chosen = draft.ticker ? S.ceo.find((x) => x.ticker === draft.ticker) : null;
      const pick = `<p>Pick one company and one change. It adds 0.3% to your fee this round (and again if they fight), and it makes the news. The company answers next round: accept, or fight.</p>
        <table class="data pickt"><tr><th>Company</th><th>Your grade</th><th>You hold it</th><th>Ask it to</th></tr>
        ${S.ceo.map((f) => `<tr><td>${esc(f.name)}</td><td>${gr(f.grades[fd.id])}</td><td>${f.held[fd.id] ? "yes" : ""}</td>
          <td><button type="button" class="cpick" data-t="${f.ticker}" data-k="E">Cut emissions 10%</button> <button type="button" class="cpick" data-t="${f.ticker}" data-k="S">Raise pay $1</button></td></tr>`).join("")}</table>`;
      const how = `<ul>
        <li><b>Your grades</b> use your group's rating sheet from Tuesday, applied to all 100 companies. You hold the best-graded third of the class's companies, in equal amounts.</li>
        <li><b>E, S, G weights</b> start from your sheet. You may shift each by up to ${MAXW} points a round.</li>
        <li><b>Credit for pledges and policies</b> sets how much companies' Yes/No policies and promises count in your grades. Results (emissions, workforce numbers, news stories) always count.</li>
        <li><b>Investors</b> are your classmates. Each round they move money toward the funds they like. Your AUM grows with returns and with investors.</li>
        <li><b>Campaigns</b> cost fees and make the news. The company answers next round.</li></ul>`;
      const wText = (w) => `E ${w.E}% · S ${w.S}% · G ${w.G}%`;
      const wChanged = ["E", "S", "G"].some((p) => draft.w[p] !== fd.pillarWeights[p]);
      const wpop = `<p>Shift up to ${MAXW} points into or out of each pillar this round, in steps of 5. The three must add to 100%. Your new grades and holdings take effect when the round is played.</p>
        <table class="data wtab">${["E", "S", "G"].map((p) => `<tr><td>${{ E: "Environmental", S: "Social", G: "Governance" }[p]}</td>
          <td><button type="button" class="wstep" data-p="${p}" data-d="-5">−</button></td><td class="wval" id="wv${p}">${draft.w[p]}%</td>
          <td><button type="button" class="wstep" data-p="${p}" data-d="5">+</button></td></tr>`).join("")}
          <tr><td>Total</td><td></td><td class="wval" id="wtot">100%</td><td></td></tr></table>
        <div class="submitrow"><span class="sub" id="wmsg"></span><button type="button" id="wdone">Use these weights</button></div>`;
      const scoreOf = (f) => (f.scores || {})[fd.id];
      const scoreTxt = (v) => (v === -1 ? "ruled out" : v === null || v === undefined ? "" : String(v));
      const gtab = (rows) => `<table class="data gscore"><tr><th>Company</th><th>Letter</th><th>Score</th></tr>
        ${rows.sort((a, b) => (scoreOf(b) ?? -2) - (scoreOf(a) ?? -2)).map((f) => `<tr><td>${esc(f.name)}</td><td>${gr(f.grades[fd.id])}</td><td>${scoreTxt(scoreOf(f))}</td></tr>`).join("")}</table>`;
      const gradeTables = `<h3>Fund Companies</h3>${gtab(S.ceo.filter((f) => f.held[fd.id]))}
        <h3>Excluded Companies</h3>${gtab(S.ceo.filter((f) => !f.held[fd.id]))}
        <p class="sub">Scores run from 0 to 100 and compare each company with ${fd.compare === "industry" ? "its own industry" : "all 100 companies"}.</p>`;
      const holdings = fd.holdings.map((h) => `<tr><td>${esc(h.name)}</td><td>${gr(h.grade)}</td></tr>`).join("");
      app.innerHTML = sheader(S, fd.name, "ESG investment fund") + stepBar(1, { role: "fund", name: fd.name }) + `
        <div class="result">${played ? `<span class="arr ${dirOf(fd.flow)}">${{ up: "▲", down: "▼", flat: "■" }[dirOf(fd.flow)]}</span>
          <b>Investors ${fd.flow >= 0 ? "added" : "pulled out"} ${Math.abs(100 * fd.flow).toFixed(0)}%</b> in ${esc(lastLabel(S))}
          <span class="why">Return ${pct(fd.r, 1)} · Fees ${(100 * fd.fee).toFixed(1)}%</span>` : `<span class="muted">Results appear here after each round.</span>`}
          <span class="tot">AUM ${B(fd.aum)} · #${fd.rank || "-"} of ${S.funds.length}</span></div>
        <div class="screen2"><div class="decide">
          <div class="drow"><span>Credit for environmental pledges</span>${seg("pE", POLICY, draft.policyE, !open)}<em></em></div>
          <div class="drow"><span>Credit for worker policies</span>${seg("pS", POLICY, draft.policyS, !open)}<em></em></div>
          <div class="drow"><span>E, S, G weights (optional)</span>
            <span>${wChanged ? `<b class="chosen">${wText(draft.w)}</b> <button type="button" class="link" id="nowts">undo</button>` : wText(fd.pillarWeights)}</span>
            ${open ? opener("pwts", "Re-weight...") : "<em></em>"}</div>
          <div class="drow"><span>Campaign (optional)</span>
            ${chosen ? `<b class="chosen">${esc(chosen.name)}: ${draft.kind === "E" ? "cut emissions 10%" : "raise pay $1"}</b> <button type="button" class="link" id="nocamp">remove</button>`
              : canLaunch ? opener("ppick", "Launch a campaign...") : `<i>${open ? "Closed in the final round: no time left for companies to respond" : ""}</i>`}<em></em></div>
          ${mine.length ? `<p class="sub">Your campaigns: ${mine.map((c) => `${esc(c.name)} (${st[c.status]})`).join("; ")}</p>` : ""}
          <div class="submitrow"><span></span><button id="send" ${open ? "" : "disabled"}>Submit and go to step 2</button></div>
          <p class="sub" id="status">${open ? "No submission keeps your settings and launches no campaign." : "Decisions are closed."}</p>
        </div><div class="side">
          <h3>You hold</h3><table class="data gtable">${holdings}</table>
          <div class="pops">${opener("pnews", "News")}${opener("pgrades", "All your grades")}${opener("phow", "How this works")}</div>
        </div></div>
        <div class="foot">${wrongRole()}</div>
        ${newsPopup(S)}${popup("phow", "How this works", how)}${popup("ppick", "Launch a campaign", pick)}${popup("pwts", "Re-weight E, S and G", wpop)}
        ${popup("pgrades", `${esc(fd.name)} ESG Grades`, gradeTables)}`;
      wireSeg(app, (name, v) => { if (name === "pE") draft.policyE = +v; if (name === "pS") draft.policyS = +v; draw(); });
      wirePopups(); wireWrongRole();
      app.querySelectorAll(".cpick").forEach((b) => { b.onclick = () => { draft.ticker = b.dataset.t; draft.kind = b.dataset.k; document.getElementById("ppick").close(); draw(); }; });
      // Re-weight pop-up: edit a working copy in place, commit on "Use these weights".
      const wd = document.getElementById("pwts");
      if (wd) {
        const work = Object.assign({}, draft.w);
        const show = () => {
          const tot = work.E + work.S + work.G;
          ["E", "S", "G"].forEach((p) => { document.getElementById("wv" + p).textContent = work[p] + "%"; });
          document.getElementById("wtot").textContent = tot + "%";
          document.getElementById("wtot").className = "wval" + (tot === 100 ? "" : " bad");
          document.getElementById("wmsg").textContent = tot === 100 ? "" : `Add to 100% first (now ${tot}%).`;
          document.getElementById("wdone").disabled = tot !== 100;
          wd.querySelectorAll(".wstep").forEach((b) => {
            const v = work[b.dataset.p] + +b.dataset.d;
            b.disabled = v < 0 || Math.abs(v - fd.pillarWeights[b.dataset.p]) > MAXW;
          });
        };
        wd.querySelectorAll(".wstep").forEach((b) => { b.onclick = () => { work[b.dataset.p] += +b.dataset.d; show(); }; });
        document.getElementById("wdone").onclick = () => { draft.w = Object.assign({}, work); wd.close(); draw(); };
        show();
      }
      const nw = document.getElementById("nowts");
      if (nw) nw.onclick = () => { draft.w = Object.assign({}, fd.pillarWeights); draw(); };
      const nc = document.getElementById("nocamp");
      if (nc) nc.onclick = () => { draft.ticker = ""; draft.kind = ""; draw(); };
      document.getElementById("send").onclick = async () => {
        try {
          await store.put("decision", fd.id, S.round, { side: "fund", policyE: draft.policyE, policyS: draft.policyS,
            weights: wChanged ? draft.w : null,
            campaign: draft.ticker && draft.kind ? { ticker: draft.ticker, kind: draft.kind } : null });
          location.href = link({ role: "saver" });
        } catch (e) { document.getElementById("status").textContent = "Could not send: " + e.message; }
      };
    }
    draw(); follow(draw);
  }

  // ---------------------------------------------------------------- investor
  async function saverView() {
    S = await store.latestState();
    let me = myId;
    if (!me) {
      try { me = localStorage.getItem("esg-saver"); } catch (e) { /* private window */ }
      if (!me) { me = Math.random().toString(36).slice(2, 10); try { localStorage.setItem("esg-saver", me); } catch (e) { /* ok */ } }
    }
    if (!myId && !myRole()) setRole({ role: "investor" });
    const draft = { round: -1, alloc: {} };
    let seenRound = null;
    const doneKey = () => `esg-done:${session}:${S.round}`;
    function draw() {
      if (!S) return waiting("Investor");
      const team = myId ? null : myTeam();  // lab investor tabs have a fixed id and no team
      if (seenRound !== null && S.round !== seenRound && team && S.phase !== "over") { location.href = teamLink(team); return; }
      seenRound = S.round;
      let done = false;
      try { done = sessionStorage.getItem(doneKey()) === "1"; } catch (e) { /* ok */ }
      const mine = (S.savers || {})[me];
      const bal = mine ? mine.balance : 10000;
      if (done && S.phase !== "over") {
        app.innerHTML = sheader(S, "Your investments", "Investor") + (team ? stepBar(2) : "") + `<section class="done">
          <h2>You're done for ${esc(roundCfg(S).label.toLowerCase())}.</h2><p>Watch the projector. When the round is played, this screen moves on by itself.</p>
          <p class="sub"><button type="button" class="link" id="redo">Change my investments</button>${team ? ` · <a href="${teamLink(team)}">Change my ${team.role === "firm" ? "company" : "fund"} decision</a>` : ""}</p></section>`;
        document.getElementById("redo").onclick = () => { try { sessionStorage.removeItem(doneKey()); } catch (e) { /* ok */ } draw(); };
        return;
      }
      if (draft.round !== S.round) {
        draft.round = S.round; draft.alloc = {};
        S.funds.forEach((fd) => { draft.alloc[fd.id] = mine && mine.alloc ? Math.round(100 * mine.alloc[fd.id]) : Math.round(100 / S.funds.length); });
      }
      const change = mine && S.round > 0 ? mine.balance - mine.prev : null;
      const cr = { 1: "full", 0.5: "half", 0: "none" };
      const camps = (fd) => S.campaigns.filter((c) => c.fund === fd.id && ["pending", "accepted", "won"].includes(c.status));
      const inNews = (fd) => fd.holdings.filter((h) => h.ceo && (S.ceo.find((x) => x.name === h.name) || {}).events && S.ceo.find((x) => x.name === h.name).events.length).map((h) => h.name);
      app.innerHTML = sheader(S, "Your investments", "Investor") + (team ? stepBar(2) : "") + `
        <div class="result">${change !== null ? `<span class="arr ${dirOf(change)}">${{ up: "▲", down: "▼", flat: "■" }[dirOf(change)]}</span>
          <b>${change >= 0 ? "+" : "−"}${usd(Math.abs(change))}</b> in ${esc(lastLabel(S))}` : ""}
          <span class="${change !== null ? "tot" : ""}">You have <b>${usd(bal)}</b>. Split it across the ESG funds: your own money, your own choice.</span></div>
        <div class="fgrid">${S.funds.map((fd) => `<div class="fcard"><div class="fhead"><b>${esc(fd.name)}</b>
            <label class="alloc"><input class="al" data-f="${fd.id}" type="number" min="0" max="100" value="${draft.alloc[fd.id]}" ${S.phase === "over" ? "disabled" : ""}> %</label></div>
          <div class="sub">Last round ${S.round > 0 ? pct(fd.r, 1) : "n/a"} · so far ${pct(fd.tsr, 1)} · fee ${(100 * (fd.fee || 0.002)).toFixed(1)}%</div>
          <div class="sub">E ${fd.pillarWeights.E}% · S ${fd.pillarWeights.S}% · G ${fd.pillarWeights.G}% · pledge credit ${cr[fd.policyE]} · policy credit ${cr[fd.policyS]}</div>
          <div class="sub">Holds ${fd.holdings.map((h) => esc(h.name)).join(", ")}</div>
          ${camps(fd).length ? `<div class="campline">Campaign: ${camps(fd).map((c) => `${esc(c.name)}, ${esc(c.text)}`).join("; ")}</div>` : ""}
          ${inNews(fd).length ? `<div class="warnline">In the news: ${inNews(fd).map(esc).join(", ")}</div>` : ""}</div>`).join("")}</div>
        <div class="submitrow"><span id="tot"></span><span>${opener("pnews", "News")}
          ${team && S.phase === "decide" ? `<a class="back" href="${teamLink(team)}">Back to step 1</a>` : ""}
          <button id="send" ${S.phase === "over" ? "disabled" : ""}>Save and finish this round</button></span></div>
        <p class="sub" id="status"></p>
        <div class="foot">${wrongRole()}</div>${newsPopup(S)}`;
      const tot = () => {
        document.querySelectorAll(".al").forEach((i) => { draft.alloc[i.dataset.f] = Math.max(0, +i.value || 0); });
        const t = Object.values(draft.alloc).reduce((a, b) => a + b, 0);
        document.getElementById("tot").textContent = `Total ${t}%` + (t !== 100 ? " (will be rescaled to 100%)" : "");
      };
      document.querySelectorAll(".al").forEach((i) => { i.oninput = tot; });
      tot(); wirePopups(); wireWrongRole();
      document.getElementById("send").onclick = async () => {
        tot();
        try {
          await store.put("decision", "saver:" + me, S.round, { side: "saver", alloc: draft.alloc });
          try { sessionStorage.setItem(doneKey(), "1"); } catch (e) { /* ok */ }
          draw();
        } catch (e) { document.getElementById("status").textContent = "Could not send: " + e.message; }
      };
    }
    draw(); follow(draw);
  }

  // ================================================================= board
  // One projector screen: a running header, up to three newspapers (what
  // happened), a ticker (the market, then campaigns under way), and calm boxes.
  // The grades table appears on demand (button or the G key) and grays out the rest.
  const PAPERS = ["The Daily Ledger", "Market Herald", "The Evening Post"];
  const roundName = (S, i) => `Round ${i + 1}`;
  const ARR = { up: "▲", down: "▼", flat: "■" };

  function shorthand(S, f) {
    const im = f.impact || {}, out = [];
    const good = (t) => out.push({ t, bad: false }), bad = (t) => out.push({ t, bad: true });
    (im.events || []).forEach((e) => bad({ storyE: "Bad press: environment", storyS: "Bad press: workers",
      exposeE: "Audit: empty pledges", exposeS: "Audit: empty policies" }[e] || e));
    S.campaigns.filter((c) => c.ticker === f.ticker && c.answered === S.round - 1).forEach((c) => {
      if (c.status === "won") bad("Lost proxy fight"); else if (c.status === "lost") good("Won proxy fight");
      else if (c.status === "accepted") good("Accepted campaign");
    });
    if (im.cut > 0.0005) good(`Emissions ${pct(-im.cut)}`);
    if (im.payRaise) good(`Pay +$${im.payRaise}`);
    if (im.safety) good("Safety");
    if (im.pkgE) good("E pledges");
    if (im.pkgS) good("Worker policies");
    return out;
  }
  const items = (list, none) => (list.length ? list.map((x) => `<span class="${x.bad ? "bad" : ""}">${esc(x.t)}</span>`).join('<span class="sep"> · </span>') : `<span class="none">${none}</span>`);


  // ---- hover explanations on the projector (flags only where ESG moved a return)
  const WHY = [["tax", "Carbon tax news", true], ["own", "Its emissions cuts and pay changes (long-run value)", true],
    ["news", "Bad news and audits", true], ["spending", "ESG spending this round", true], ["demand", "ESG fund demand", true],
    ["market", "Market", false], ["business", "Normal profits", false]];
  // ESG share of a company's move this round; the projector flags only the biggest few.
  const esgSize = (f) => (f.why ? Math.abs(WHY.filter((w) => w[2]).reduce((a, [k]) => a + (f.why[k] || 0), 0)) : 0);
  let flagged = new Set();
  const esgDriven = (f) => flagged.has(f.ticker);
  function pickFlags(S) {
    flagged = new Set([...S.ceo].filter((f) => esgSize(f) >= 0.03).sort((a, b) => esgSize(b) - esgSize(a)).slice(0, 4).map((f) => f.ticker));
  }
  function whyBox(S, f) {
    const rows = WHY.filter(([k]) => Math.abs(f.why[k] || 0) >= 0.005)
      .map(([k, t, esg]) => `<tr class="${esg ? "esg" : "plain"}"><td>${t}</td><td>${pct(f.why[k], 1)}</td></tr>`).join("");
    const extra = [];
    if (Math.abs(f.why.tax || 0) >= 0.005) extra.push(S.taxOn ? `Carbon tax now $${S.taxNow} a tonne; its emissions make that costly.` : "The chance of a carbon tax changed.");
    return `<span class="tipbox"><b>Why ${esc(f.name)} moved ${pct(f.ret, 1)}</b><table>${rows}</table>${extra.map((x) => `<div class="tipnote">${esc(x)}</div>`).join("")}</span>`;
  }
  const flag = (inner, right) => `<span class="tip ${right ? "tipr" : ""}"><span class="flag">⚑</span>${inner}</span>`;
  // ESG reasons behind a fund's return: each holding's ESG pieces, in points of
  // the fund's return (a fund holds equal amounts, so a piece counts 1/n).
  function fundReasons(S, fd) {
    const held = fd.lastHeld || [];
    const n = held.length || 1, out = [];
    held.forEach((h) => {
      const f = S.ceo.find((x) => x.name === h.name);
      if (!f || !f.why) return;
      const w = f.why, ev = (f.impact && f.impact.events) || [], nm = f.name;
      const add = (v, text) => { if (Math.abs(v / n) >= 0.002) out.push({ pts: v / n, text }); };
      add(w.tax || 0, `Carbon tax news at ${nm}`);
      add(w.news || 0, ev.some((e) => e.startsWith("expose")) ? `Audit and bad press at ${nm}` : `Bad press at ${nm}`);
      add(w.own || 0, `Pay and emissions changes at ${nm}`);
      add(w.spending || 0, `ESG spending at ${nm}`);
      add(w.demand || 0, (w.demand || 0) >= 0 ? `${nm} picked up by more ESG funds` : `${nm} dropped by ESG funds`);
    });
    return out.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  }
  const fundFlagged = (S, fd) => fundReasons(S, fd).some((x) => Math.abs(x.pts) >= 0.01);
  function fundWhy(S, fd) {
    const rows = fundReasons(S, fd).slice(0, 3)
      .map((x) => `<tr class="esg"><td>${esc(x.text)}</td><td>${x.pts >= 0 ? "+" : "−"}${Math.abs(100 * x.pts).toFixed(1)} points</td></tr>`).join("");
    return `<span class="tipbox"><b>ESG news behind ${esc(fd.name)}'s return</b><table>${rows}</table></span>`;
  }
  function fundAbout(fd) {
    const w = fd.pillarWeights, cr = { 1: "full", 0.5: "half", 0: "none" };
    return `<span class="tipbox"><b>${esc(fd.name)}</b><table>
      <tr><td>Weights</td><td>E ${w.E}% · S ${w.S}% · G ${w.G}%</td></tr>
      <tr><td>Within-industry comparisons?</td><td>${fd.compare === "industry" ? "Yes" : "No"}</td></tr>
      <tr><td>Credit for E pledges</td><td>${cr[fd.policyE]}</td></tr><tr><td>Credit for S policies</td><td>${cr[fd.policyS]}</td></tr>
      <tr><td>Campaigns launched</td><td>${fd.campaignsLaunched || 0}</td></tr>
      <tr><td>Holds now</td><td>${fd.holdings.map((h) => esc(h.name)).join(", ")}</td></tr></table></span>`;
  }
  let tickTimer = null;
  let showGrades = false;
  async function boardView() {
    S = await store.latestState();
    document.body.classList.add("boardbody");
    document.addEventListener("keydown", (e) => { if (e.key === "g" || e.key === "G") { showGrades = !showGrades; draw(); } });
    // Instructor controls: only in the browser that runs the console (see hostView).
    const isHost = (() => { try { return !!localStorage.getItem("esg3-host:" + session); } catch (e) { return false; } })();
    const chan = isHost && "BroadcastChannel" in window ? new BroadcastChannel("esg-host:" + session) : null;
    let hs = null, heard = false;
    function drawHostbar() {
      const el = document.getElementById("hostbar");
      if (!el || !chan) return;
      if (!heard) { el.innerHTML = '<span class="hbquiet">Open the console to play rounds.</span>'; return; }
      if (!hs || hs.phase !== "decide") { el.innerHTML = ""; return; }
      const miss = [...hs.missingFirms, ...hs.missingFunds];
      el.innerHTML = `<span class="tip tipr hbcounts">Submitted: Companies ${hs.firmsIn}/${hs.firmsN} · Funds ${hs.fundsIn}/${hs.fundsN} · Investors ${hs.investorsIn}/${hs.investorsN}
          <span class="tipbox"><b>${miss.length ? "Still to submit" : "Every team has submitted"}</b>${miss.length ? `<div class="tipnote">${miss.map(esc).join(", ")}</div>` : ""}</span></span>
        <button id="hbplay" class="hbplay">Play ${esc(hs.label)}</button>${hs.round > 0 ? ' <button id="hbend" class="hbplay">End game</button>' : ""}`;
      const endb = document.getElementById("hbend");
      if (endb) endb.onclick = () => {
        if (!confirm(`End the game now, before ${hs.label}? The projector shows the final results and the hidden odds.`)) return;
        endb.disabled = true;
        chan.postMessage({ type: "end", round: hs.round });
      };
      document.getElementById("hbplay").onclick = () => {
        const left = [hs.firmsN - hs.firmsIn ? `${hs.firmsN - hs.firmsIn} ${hs.firmsN - hs.firmsIn === 1 ? "company hasn't" : "companies haven't"} submitted. They'll make no changes.` : "",
          hs.fundsN - hs.fundsIn ? `${hs.fundsN - hs.fundsIn} ${hs.fundsN - hs.fundsIn === 1 ? "fund hasn't" : "funds haven't"} submitted. They'll keep their settings.` : ""].filter(Boolean);
        if (!confirm(`${left.length ? left.join("\n") + "\n\n" : ""}Play ${hs.label}?`)) return;
        document.getElementById("hbplay").disabled = true;
        chan.postMessage({ type: "play", round: hs.round });
      };
    }
    if (chan) {
      chan.onmessage = (m) => { const d = m.data || {}; if (d.type === "status") { hs = d.status; heard = true; drawHostbar(); } };
      chan.postMessage({ type: "ping" });
    }
    function draw() {
      if (!S) return waiting("ESG Market");
      const played = S.round > 0;
      pickFlags(S);
      const heads = (S.headlines || []).map((h) => (typeof h === "string" ? { kind: "story", text: h, short: h } : h));
      const order = { tax: -1, story: 0, audit: 1, result: 2 };
      const news = heads.filter((h) => h.kind in order).sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 3);
      const lines = (news.length ? news : [{ short: played ? "A Quiet Round on the ESG Front" : "Markets Open" }])
        .map((h) => `<div class="hl">${esc((h.short || h.text).replace(/[.]$/, ""))}</div>`).join("");
      const papers = `<div class="front"><div class="masthead"><div class="tax">${S.phase === "over" ? "Final edition" : S.taxOn ? `Carbon tax $${S.taxNow} a tonne` : `Carbon tax odds this round ${Math.round(100 * (S.taxChance || 0))}%`}</div><div class="mast">${PAPERS[0]}</div><div class="date">${played ? esc(roundName(S, S.round - 1)) : "Opening"} edition</div></div>
        <div class="cols n${Math.max(1, news.length)}">${lines}</div></div>`;

      const mk = S.marketRet || 0;
      const market = played ? `<span class="mkt ${dirOf(mk)}">MARKET ${mk >= 0 ? "UP" : "DOWN"} ${Math.abs(100 * mk).toFixed(1)}%</span><span class="brk">┃</span>` : "";
      const camp = S.campaigns.filter((c) => c.status === "pending").map((c) =>
        `CAMPAIGN ▸ ${c.fundName} wants ${c.name} to ${c.text}. ${c.name} will decide to fight or accept this round.`);
      const ticker = `<div class="ticker"><span class="tlabel">ALERT</span>${market}<div class="tmove"><div class="tone" id="tone">${camp.length ? esc(camp[0]) : '<span class="tquiet">No campaigns under way</span>'}</div></div><span class="tjoin">session <b>${esc(session)}</b></span></div>`;
      clearInterval(tickTimer);
      if (camp.length > 1) {
        let k = 0;
        tickTimer = setInterval(() => {
          const el = document.getElementById("tone");
          if (!el) return;
          k = (k + 1) % camp.length;
          el.classList.remove("in"); void el.offsetWidth;
          el.textContent = camp[k]; el.classList.add("in");
        }, 5000);
      }

      const cfg = roundCfg(S);
      const now = S.phase === "over" ? "Game over"
        : `Now deciding: ${roundName(S, S.round)} · ${cfg.tax ? "carbon tax in force" : `carbon tax chance ${Math.round(100 * cfg.q)}%`}${cfg.mandate ? " · every company audited" : ""}`;
      const arrow = (d) => `<span class="arr ${d}">${ARR[d]}</span>`;
      // Companies as two side-by-side tables (half the companies each), one row per company.
      const row = (f, right) => `<tr><td class="cn">${esc(f.name)}</td>
          <td class="cr">${played ? `${arrow(dirOf(f.ret))} ${pct(f.ret, 1)}${esgDriven(f) ? flag(whyBox(S, f), right) : ""}` : ""}</td>
          <td class="ch">${(() => { const n = Object.values(f.held || {}).filter(Boolean).length; return n ? n : '<span class="none">0</span>'; })()}</td>
          <td class="ce">${played ? items(shorthand(S, f), "No ESG news") : ""}</td></tr>`;
      const half = Math.ceil(S.ceo.length / 2);
      const ctab = (list, right) => `<table class="ctab"><tr class="chead"><th>Company</th><th>Return</th><th>ESG funds</th><th>ESG news this round</th></tr>${list.map((f) => row(f, right)).join("")}</table>`;
      const companies = S.ceo.length > 4
        ? `<div class="ctabs">${ctab(S.ceo.slice(0, half), false)}${ctab(S.ceo.slice(half), true)}</div>`
        : `<div class="ctabs one">${ctab(S.ceo)}</div>`;
      const funds = S.funds.map((f) => {
        const id = played ? dirOf(f.flow) : "flat";
        const right = S.funds.indexOf(f) >= S.funds.length / 2;
        return `<div class="fbox"><div class="fname"><span class="tip about ${right ? "tipr" : ""}">${esc(f.name)}${fundAbout(f)}</span></div>
          <div class="fret">${played ? `Investors ${arrow(id)} ${f.flow >= 0 ? "+" : "−"}${Math.abs(100 * f.flow).toFixed(0)}%` : "&nbsp;"}</div>
          <div class="finv">${played ? `Return ${pct(f.r, 1)}${fundFlagged(S, f) ? flag(fundWhy(S, f), right) : ""} &nbsp;·&nbsp; Fees ${(100 * f.fee).toFixed(1)}%` : "&nbsp;"}</div>
          <div class="finv">AUM: ${B(f.aum)}</div>
          <div class="cesg">${played ? items(f.moves || [], "No changes") : ""}</div></div>`;
      }).join("");
      const table = `<table class="data compact"><tr><th>Company</th><th>Price</th><th>Total return</th>${S.funds.map((fd) => `<th class="fcol">${esc(fd.name)}</th>`).join("")}<th class="left acts">ESG actions so far</th></tr>
          ${S.ceo.map((f) => `<tr><td>${esc(f.name)}</td><td>${(100 * f.idx).toFixed(0)}</td><td>${pct(f.tsr)}</td>
            ${S.funds.map((fd) => `<td class="${f.held[fd.id] ? "held" : "nothold"}">${gr(f.grades[fd.id])}</td>`).join("")}
            <td class="left">${esc(progressText(f.progress))}</td></tr>`).join("")}</table>`;

      app.innerHTML = `${store && !store.remote ? `<div class="banner">${local ? "Test lab: nothing leaves this browser." : "Local test mode."}</div>` : ""}
        <div class="dimmable ${showGrades ? "dim" : ""}">
          ${papers}
          ${companies}
          <div class="label">ESG Investment Fund Performance</div><div class="fboxes" style="--n:${S.funds.length}">${funds}</div>
          ${ticker}
          ${S.reveal ? reveal(S) : ""}
        </div>
        ${showGrades ? `<div class="gradespanel"><h2 class="bh">Financial and ESG Performance</h2>${table}<p class="gnote">Solid grades: the fund holds the company. Faded: it does not.</p></div>` : ""}
        <div class="hostbar" id="hostbar"></div>
        <button id="gbtn" class="gbtn">${showGrades ? "Hide grades" : "Grades"}</button>`;
      document.getElementById("gbtn").onclick = () => { showGrades = !showGrades; draw(); };
      drawHostbar();
    }
    draw(); follow(draw);
  }

  function reveal(S) {
    const eff = (x) => (x >= 0.9 ? "strong" : x >= 0.5 ? "some" : "almost none");
    return `<section><h2>What nobody knew</h2><div class="scroll"><table class="data">
      <tr><th>Company</th><th>Yearly story risk E / S</th><th>Cost of a story E / S</th><th class="left">Protection each action gave</th></tr>
      ${S.reveal.map((r) => { const h = r.hidden; return `<tr><td>${esc(r.name)}</td>
        <td>${["E", "S"].map((p) => Math.round(100 * h.risk[p]) + "%").join(" / ")}</td>
        <td>${["E", "S"].map((p) => Math.round(100 * h.sev[p]) + "%").join(" / ")}</td>
        <td class="left">emissions cuts: ${eff(h.eff.abate)} · pay: ${eff(h.eff.pay)} · safety: ${eff(h.eff.safety)}
          · E pledges: ${eff(h.eff.pkgE)} · worker policies: ${eff(h.eff.pkgS)}</td></tr>`; }).join("")}
      </table></div></section>`;
  }

  // ================================================================= host
  async function hostView() {
    const saveKey = "esg3-host:" + session;
    let G = null, params = null, snaps = [];
    let pending = { firm: {}, fund: {}, saver: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(saveKey) || "null");
      if (saved) { G = saved.G; params = saved.params; snaps = saved.snaps || []; }
    } catch (e) { /* fresh start */ }

    const save = () => { try { localStorage.setItem(saveKey, JSON.stringify({ G, params, snaps: snaps.slice(-3) })); } catch (e) { /* storage full */ } };
    const publish = async () => { save(); await store.put("state", "host", G.round, E.publicState(G)); };
    // The projector tab in this same browser shows submission counts and can play
    // the round. BroadcastChannel never leaves this browser, so a student who opens
    // the projector link elsewhere gets neither.
    const chan = "BroadcastChannel" in window ? new BroadcastChannel("esg-host:" + session) : null;
    function status_() {
      if (!G || G.phase === "setup") return null;
      const firms = G.firms.filter((f) => f.ceo);
      const known = new Set([...Object.keys(G.savers || {}), ...Object.keys(pending.saver)]);
      return { round: G.round, label: roundCfg(G).label, phase: G.phase,
        firmsIn: firms.filter((f) => pending.firm[f.ticker]).length, firmsN: firms.length,
        missingFirms: firms.filter((f) => !pending.firm[f.ticker]).map((f) => f.name),
        fundsIn: G.funds.filter((f) => pending.fund[f.id]).length, fundsN: G.funds.length,
        missingFunds: G.funds.filter((f) => !pending.fund[f.id]).map((f) => f.name),
        investorsIn: Object.keys(pending.saver).length, investorsN: known.size };
    }
    const broadcast = () => { if (chan) chan.postMessage({ type: "status", status: status_() }); };
    let playing = false;
    async function playRound() {
      if (playing || !G || G.phase !== "decide") return;
      playing = true;
      try {
        snaps.push(JSON.stringify(G));
        E.resolveRound(G, pending);
        await publish();
        await loadRound();
        console_();
      } finally { playing = false; }
    }
    async function endNow() {
      if (!G || G.phase !== "decide") return;
      snaps.push(JSON.stringify(G));
      E.endGame(G);
      await publish();
      console_();
    }
    if (chan) chan.onmessage = (m) => {
      const d = m.data || {};
      if (d.type === "ping") broadcast();
      if (d.type === "play" && G && d.round === G.round) playRound();
      if (d.type === "end" && G && d.round === G.round) endNow();
    };

    // A game saved before fund scores existed: republish once so students see them.
    if (G && G.funds && G.funds.some((fd) => !fd.scores)) publish();

    async function loadRound() {
      pending = { firm: {}, fund: {}, saver: {} };
      if (!G || G.phase === "setup") return;
      (await store.roundEvents(G.round)).forEach(take);
    }
    function take(ev) {
      const p0 = (ev && ev.payload) || {};
      if (G && G.phase !== "setup" && ev.kind === "decision" && p0.side === "claim") return claim(p0.device);
      if (G && G.phase !== "setup" && ev.kind === "decision" && p0.side === "claimfund") return claimFund(p0.device, p0.fund);
      if (!G || ev.round !== G.round || ev.kind !== "decision") return;
      const p = ev.payload || {};
      if (p.side === "firm") pending.firm[ev.team] = p;
      if (p.side === "fund") pending.fund[ev.team] = p;
      if (p.side === "saver") pending.saver[String(ev.team).replace(/^saver:/, "")] = p;
    }

    // A fund seat goes to the first computer that asks for it.
    function claimFund(dev, fund) {
      G.fundAssign = G.fundAssign || {};
      if (!dev || !G.funds.some((f) => f.id === fund)) return;
      if (G.fundAssign[fund] && G.fundAssign[fund] !== dev) { publish(); return; }
      if (Object.values(G.fundAssign).includes(dev) || Object.values(G.assign || {}).length && (G.assign || {})[dev]) return;
      G.fundAssign[fund] = dev;
      publish();
    }

    // Give a CEO team a random company nobody has yet.
    function claim(dev) {
      G.assign = G.assign || {};
      if (!dev || G.assign[dev]) return;
      const taken = new Set(Object.values(G.assign));
      const free = G.firms.filter((f) => f.ceo && !taken.has(f.ticker));
      if (!free.length) return;
      G.assign[dev] = free[Math.floor(Math.random() * free.length)].ticker;
      publish();
    }

    function setup() {
      let specs = [];
      app.innerHTML = header(null, "Instructor console", `Session ${esc(session)}`) + `<section><h2>New game</h2>
        ${local ? `<p><button id="demo" class="primary">Populate a random test game</button> <span class="sub">16 companies, 4 test funds, 2 rounds already played with random decisions</span></p><p class="sub" id="demost"></p><p class="sub">Or set up a real game:</p>` : ""}
        <p>1. Load <code>code/23-esg-simulation/output/params.json</code>. It stays on this laptop.</p><input type="file" id="pf" accept=".json">
        <p>2. Load this section's rating sheets: every fund <code>.json</code> in <code>code/23-esg-rating/sheets/&lt;section&gt;/</code> (for a test, use <code>sheets/test/</code>).</p>
        <input type="file" id="rf" accept=".json" multiple>
        <div id="cfg"></div></section>`;
      const el = (id) => document.getElementById(id);
      if (el("demo")) el("demo").onclick = async () => {
        el("demost").textContent = "Building the test game...";
        try { await demo(); } catch (e) {
          // This address cannot see the local data files: jump to the test server that can, and run the demo there.
          const there = "http://127.0.0.1:8766/23-esg-simulation/site/?s=lab&role=lab&local=1&demo=1";
          el("demost").textContent = "Opening the full test server...";
          try { window.top.location.href = there; } catch (err) { location.href = there; }
        }
      };
      el("pf").onchange = async (e) => { params = JSON.parse(await e.target.files[0].text()); drawCfg(); };
      el("rf").onchange = async (e) => {
        specs = [];
        for (const file of e.target.files) {
          try { const j = JSON.parse(await file.text()); if (j.weights) specs.push(j); } catch (err) { /* not a rules file */ }
        }
        drawCfg();
      };
      function drawCfg() {
        if (!params || !specs.length) { el("cfg").innerHTML = `<p class="sub">${params ? "" : "Company file not loaded. "}${specs.length ? "" : "No rating sheets loaded."}</p>`; return; }
        el("cfg").innerHTML = `<p>3. ESG investment funds: tick the ones that won the sticker vote and enter their sticker counts (they set starting money).</p>
          <table class="data"><tr><th>Fund</th><th>In the game</th><th>Stickers</th></tr>
          ${specs.map((s, i) => `<tr><td>${esc(s.fund_name || "Group " + (i + 1))}</td><td><input type="checkbox" class="fin" data-i="${i}" ${i < 4 ? "checked" : ""}></td>
            <td><input type="number" class="fst" data-i="${i}" min="0" value="0"></td></tr>`).join("")}</table>
          <p>4. Companies run by CEO teams.</p>
          <div class="scroll" style="max-height:260px"><table class="data"><tr><th>Company</th><th>Industry</th><th>CEO team</th></tr>
          ${params.firms.map((f, i) => `<tr><td>${esc(f.name)}</td><td>${esc(f.sector)}</td><td><input type="checkbox" class="ceo" data-i="${i}" ${f.ceo ? "checked" : ""}></td></tr>`).join("")}</table></div>
          <p>5. Random seed (sets the hidden controversy odds) <input id="seed" type="number" value="${Math.floor(Math.random() * 1e6)}"></p>
          <button id="start" class="primary">Start the game</button>`;
        el("start").onclick = start;
      }
      async function start() {
        document.querySelectorAll(".ceo").forEach((c) => { params.firms[c.dataset.i].ceo = c.checked; });
        params.seed = +el("seed").value || 20261112;
        G = E.newGame(params);
        const use = [...document.querySelectorAll(".fin")].filter((c) => c.checked).map((c) => +c.dataset.i);
        use.forEach((i, k) => {
          const st = +document.querySelector(`.fst[data-i="${i}"]`).value || 0;
          E.addFund(G, "F" + (k + 1), specs[i], st);
        });
        G.phase = "decide";
        snaps = [];
        await publish();
        await loadRound();
        console_();
        try { if (local && window.parent !== window) window.parent.location.reload(); } catch (e) { /* lab: use Reload tabs */ }  // lab: add a tab per team
      }
    }

    // Test helper: random decisions for every team that has not submitted, plus bot savers.
    async function fillRandom() {
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      const pub = E.publicState(G);
      for (const f of pub.ceo) {
        if (pending.firm[f.ticker]) continue;
        const resp = {};
        f.campaigns.forEach((c) => { resp[c.id] = pick(["accept", "fight"]); });
        await store.put("decision", f.ticker, G.round, { side: "firm", cut: pick([0, 0, 10, 20]), payRaise: pick([0, 0, 1]),
          safety: pick([0, 1]), pkgE: pick([false, true]), pkgS: pick([false, true]), responses: resp });
      }
      for (const fd of pub.funds) {
        if (pending.fund[fd.id]) continue;
        const camp = Math.random() < 0.4 ? { ticker: pick(pub.ceo).ticker, kind: pick(["E", "S"]) } : null;
        await store.put("decision", fd.id, G.round, { side: "fund", policyE: pick([1, 1, 0.5, 0]), policyS: pick([1, 1, 0.5, 0]), campaign: camp });
      }
      for (let k = 0; k < 12; k++) {
        const a = {}; pub.funds.forEach((fd) => { a[fd.id] = Math.round(100 * Math.random()); });
        await store.put("decision", "saver:bot" + k, G.round, { side: "saver", alloc: a });
      }
      await loadRound();
      console_();
    }

    function console_() {
      const status = (ok) => (ok ? '<span class="ok">✓</span>' : '<span class="no">·</span>');
      const pub = E.publicState(G);
      app.innerHTML = header(G, "Instructor console", `Session ${esc(session)}`) + `
        <section><h2>Links</h2><p>Students: <code>${esc(location.origin + location.pathname)}</code>, session <b>${esc(session)}</b>.
          <a href="${link({ role: "board" })}" target="_blank">Projector view</a></p></section>
        <section><h2>Who has joined</h2><p class="counts">Companies ${Object.keys(G.assign || {}).length} of ${G.firms.filter((f) => f.ceo).length}
          · Funds ${Object.keys(G.fundAssign || {}).length} of ${G.funds.length}
          · Investors ${new Set([...Object.keys(G.savers || {}), ...Object.keys(pending.saver)]).size}</p>
          <p>${G.funds.map((f) => { const has = !!(G.fundAssign || {})[f.id];
            return `<span class="pill ${has ? "on" : ""}">${esc(f.name)}${has ? ` <button class="link relf" data-f="${f.id}" title="Free this fund for a new manager">release</button>` : ""}</span>`; }).join(" ")}</p></section>
        <section><h2>Companies handed out</h2><p>${G.firms.filter((f) => f.ceo).map((f) => {
            const has = Object.values(G.assign || {}).includes(f.ticker);
            return `<span class="pill ${has ? "on" : ""}">${esc(f.name)}${has ? ` <button class="link rel" data-t="${f.ticker}" title="Free this company for a new team">release</button>` : ""}</span>`;
          }).join(" ")}</p><p class="sub">${Object.keys(G.assign || {}).length} of ${G.firms.filter((f) => f.ceo).length} taken. Release a company if a team's computer dies; they rejoin and get a company at random.</p></section>
        <section><h2>Submissions for ${esc(roundCfg(G).label)}</h2><table class="data"><tr><th>Team</th><th>Submitted</th></tr>
          ${G.firms.filter((f) => f.ceo).map((f) => `<tr><td>CEO: ${esc(f.name)}</td><td>${status(pending.firm[f.ticker])}</td></tr>`).join("")}
          ${G.funds.map((f) => `<tr><td>ESG fund: ${esc(f.name)}</td><td>${status(pending.fund[f.id])}</td></tr>`).join("")}
          <tr><td>Investors this year</td><td>${Object.keys(pending.saver).length}</td></tr>
        </table><p class="sub">Teams that do not submit change nothing (and CEOs fight any campaign). Investors who do not submit keep their split.</p>
        ${pub.campaigns.filter((c) => c.status === "pending").length ? `<p>Campaigns to answer this year: ${pub.campaigns.filter((c) => c.status === "pending").map((c) => `${esc(c.fundName)} → ${esc(c.name)} (${esc(c.text)})`).join("; ")}</p>` : ""}</section>
        <section><h2>Control</h2>
          ${G.phase === "decide" ? `<button id="resolve" class="primary">Play ${esc(roundCfg(G).label)}</button>` : "<p>The game is over. The projector now shows the hidden odds.</p>"}
          <p><button id="undo" ${snaps.length ? "" : "disabled"}>Undo last round</button>
          ${G.phase === "decide" && G.round > 0 ? '<button id="endgame">End the game now</button>' : ""}
          <button id="csv" ${G.history.length ? "" : "disabled"}>Download results (CSV)</button>
          <button id="json">Download game file</button>
          <button id="reset">New game</button></p>
          ${G.phase === "decide" ? `<p><button id="fill">Test: fill in random decisions for teams that have not submitted</button></p>` : ""}</section>
        ${G.phase === "over" && G.history.length ? `<section><h2>Debrief charts</h2>
          <p><button id="mkcharts" class="primary">Make debrief charts</button> <span class="sub">16:9 pictures for your slides, from this game's history. They stay on this laptop until you download them.</span></p>
          <div id="charts" class="chartgrid"></div></section>` : ""}
        <section><h2>Rounds</h2><table class="data"><tr><th>Round</th><th>Tax in force</th></tr>
          ${G.rounds.map((r, i) => `<tr class="${i === G.round ? "student" : ""}"><td>${esc(r.label)}</td><td>${(G.history.find((h) => h.round === i) || {}).tax ? "$" + (G.history.find((h) => h.round === i) || {}).tax : ""}</td></tr>`).join("")}</table></section>
        ${headlines(G)}`;
      const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
      on("resolve", playRound);
      on("endgame", () => { if (confirm("End the game now? The projector shows the final results and the hidden odds.")) endNow(); });
      broadcast();
      on("fill", fillRandom);
      document.querySelectorAll("button.relf").forEach((b) => { b.onclick = async () => {
        if (!confirm("Free this fund? Its manager will need to rejoin.")) return;
        delete G.fundAssign[b.dataset.f];
        await publish(); console_();
      }; });
      document.querySelectorAll("button.rel").forEach((b) => { b.onclick = async () => {
        if (!confirm("Free this company? The team that had it will need to rejoin.")) return;
        Object.keys(G.assign).forEach((k) => { if (G.assign[k] === b.dataset.t) delete G.assign[k]; });
        await publish(); console_();
      }; });
      on("undo", async () => { G = JSON.parse(snaps.pop()); await publish(); await loadRound(); console_(); });
      on("restart", async () => {
        const keep = G.funds.map((f) => ({ id: f.id, spec: f.spec, stickers: f.stickers }));
        const ceo = new Set(G.firms.filter((f) => f.ceo).map((f) => f.ticker));
        params.firms.forEach((f) => { f.ceo = ceo.has(f.ticker); });
        params.seed = G.seed;
        const assign = G.assign, fundAssign = G.fundAssign;
        G = E.newGame(params);
        G.assign = assign || {}; G.fundAssign = fundAssign || {};
        keep.forEach((f) => E.addFund(G, f.id, f.spec, f.stickers));
        G.round = 1; G.phase = "decide"; snaps = [];
        await publish(); await loadRound(); console_();
      });
      on("mkcharts", () => {
        const list = window.ESGCharts ? window.ESGCharts.make(G) : [];
        const box = document.getElementById("charts");
        box.innerHTML = list.length ? list.map((c) => `<figure><img src="${c.url}" alt="${esc(c.title)}"><figcaption><b>${esc(c.title)}</b><br>${esc(c.note)}<br>
          <a href="${c.url}" download="esg-${esc(session)}-${c.name}.png">Download</a></figcaption></figure>`).join("")
          + `<p><button id="dlall">Download all</button></p>` : "<p>No rounds played.</p>";
        const all = document.getElementById("dlall");
        if (all) all.onclick = () => box.querySelectorAll("a[download]").forEach((a, i) => setTimeout(() => a.click(), 400 * i));
      });
      on("csv", () => download(`esg-${session}.csv`, toCSV(G), "text/csv"));
      on("json", () => download(`esg-${session}.json`, JSON.stringify(G), "application/json"));
      on("reset", () => { if (confirm("Start a new game? The current one stays in the database but this console forgets it.")) { localStorage.removeItem(saveKey); G = null; setup(); } });
    }

    function toCSV(g) {
      const rows = [["round", "label", "q", "kind", "id", "name", "cut", "pay_raise", "safety", "pkgE", "pkgS",
        "emissions_cut_total", "pay_total", "events", "impact", "price_index", "return", "tsr", "premium", "aum", "flow", "fee", "rank", "policy_E", "policy_S", "grades", "held_by"]];
      g.history.forEach((h) => {
        h.firms.forEach((f) => {
          const d = f.decision || {};
          rows.push([h.round, h.label, h.q, "firm", f.ticker, f.name, d.cut || 0, d.payRaise || 0, d.safety || 0, !!d.pkgE, !!d.pkgS,
            1 - f.e, f.pay, f.events.join(" "), (f.impact || {}).status || "", f.idx, f.ret, f.tsr, f.prem, "", "", "", "", "", "",
            Object.values(f.grades).join(" "), Object.entries(f.held).filter(([, v]) => v).map(([k]) => k).join(" ")]);
        });
        h.funds.forEach((f) => rows.push([h.round, h.label, h.q, "fund", f.id, f.name, "", "", "", "", "", "", "", "", "", "", f.r, f.tsr, "",
          f.aum, f.flow, f.fee, f.rank, f.policyE, f.policyS, "", ""]));
      });
      return rows.map((r) => r.map((x) => (typeof x === "number" ? +x.toFixed(4) : `"${String(x).replace(/"/g, '""')}"`)).join(",")).join("\n");
    }
    function download(name, text, type) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = name; a.click();
    }

    // Demo (test lab only): load the local company file and test funds, start a
    // 16-company game, and play two rounds of random decisions.
    async function demo() {
      const base = "../../";
      params = await (await fetch("../output/params.json")).json();
      const names = ["green_machine", "people_fund", "policy_fans"];
      const specs = [];
      for (const n of names) specs.push(await (await fetch(base + "23-esg-rating/sheets/test/" + n + ".json")).json());
      specs.push(Object.assign({}, specs[0], { fund_name: "Governance First", pillar_weights: { E: 10, S: 10, G: 80 } }));
      params.seed = 20261112;
      G = E.newGame(params);
      specs.forEach((sp, i) => E.addFund(G, "F" + (i + 1), sp, [8, 6, 4, 3][i]));
      G.phase = "decide"; snaps = [];
      await publish();
      for (let k = 0; k < 2; k++) { await loadRound(); await fillRandom(); E.resolveRound(G, pending); await publish(); }
      await loadRound();
      console_();
      try { if (window.parent !== window) window.parent.location.reload(); } catch (e) { /* use Reload tabs */ }
    }

    store.on((ev) => { if (ev.kind !== "state") { take(ev); if (G && G.phase !== "setup") console_(); } });
    if ((!G || !params) && local && qs.get("demo") === "1") { try { await demo(); } catch (e) { app.innerHTML = "<p>Demo needs the local test server (see README): " + esc(e.message) + "</p>"; } }
    else if (!G || !params) setup();
    else { await loadRound(); console_(); }
  }

  ({ host: hostView, board: boardView, firm: firmView, fund: fundView, saver: saverView }[role] || picker)();
})();
