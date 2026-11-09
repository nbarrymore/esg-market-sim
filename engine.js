// ESG market simulation engine (version 3: E and S; governance stays fixed).
// Pure functions on a plain state object, shared by the instructor console, the
// tests (node) and the export.
//
// The instructor console holds the full game, including licensed company data
// (Refinitiv data points, Compustat profit and employees). It publishes only
// publicState(g): letter grades, price indexes, fund values and in-game actions.
//
// One round is one year, with one decision window:
//   CEO teams   cut emissions 0/10/20%, raise pay $0/1/2 an hour, run a safety
//               program, adopt E or S policy packages (cheap: they switch policy
//               data points to Yes and change nothing else), and answer any
//               campaign against them: accept, or fight.
//   Fund teams  grade all 100 companies with their class 23 sheet and hold their
//               20 best. Each year: how much policy data points count (full, half,
//               ignore), and optionally launch one campaign at a CEO company (E:
//               cut emissions 10%, or S: raise pay $1). A campaign raises the
//               fund's fee and makes news; the company answers next year.
//   Savers      every student splits personal savings across funds.
//   Controversies: hidden odds, hidden costs, hidden protection (insurance of
//               unknown value). At most two stories a year.
//
// Price of a CEO company: cap = V * (1 + premium) * market, where
//   V = M * expected yearly profit (after expected carbon tax and pay),
//   premium = lambda * (fund ownership / its neutral level - 1), capped,
//   market = the common market factor every company shares.
// Every other company's price follows the market factor plus its own noise.
(function (root) {
  "use strict";

  const DEFAULT_ROUNDS = [
    // Up to 10 rounds; the instructor ends the game whenever time runs short.
    { label: "Round 1", mandate: false },
    { label: "Round 2", mandate: false },
    { label: "Round 3", mandate: false },
    { label: "Round 4", mandate: false },
    { label: "Round 5", mandate: false },
    { label: "Round 6", mandate: false },
    { label: "Round 7", mandate: false },
    { label: "Round 8", mandate: false },
    { label: "Round 9", mandate: false },
    { label: "Round 10", mandate: false },
  ];

  const P = {
    M: 12,                 // value multiple on expected yearly profit
    // Carbon-heavy industries trade at lower multiples (higher yields): they earn
    // more each round unless a big carbon tax arrives. Excluding them has a cost.
    Msector: { Energy: 8.5, Transportation: 9.5 },
    taxSteps: [0, 5, 10, 50, 100],     // carbon tax, $ per tonne: each time it passes it steps up one level
    taxHazard: [0.25, 0.15, 0.08, 0.04], // chance each round of the next step, by current level
    taxHorizon: 5,         // rounds ahead the market looks when pricing the carbon tax
    studentShare: 0.3,     // ESG funds' share of the class companies' market value
    lambda: 0.06,          // price response to fund demand: -6% if no fund holds it, up to +6%
    demandCap: 2,          // fund demand counts up to 2x its neutral level
    budgetShare: 0.25,     // one-time spending cap, share of yearly profit
    maxCut: 0.8,           // emissions cannot fall below 20% of the start
    payStep: 1,            // $ per hour per raise step
    maxPay: 3,             // raise cap, $ per hour
    hoursPerYear: 1800,
    safetyPerEmp: 300,     // $ per employee for one safety program
    packageShare: 0.005,   // a policy package costs 0.5% of a year's profit
    baseFee: 0.002,        // every fund's yearly fee, share of money managed
    reweightMax: 10,       // a fund may move each pillar weight at most 10 points a round
    campaignFee: 0.003,    // extra fee in a year a fund launches or fights a campaign
    fightCost: 0.01,       // a proxy fight costs the company 1% of its value
    // Controversies: CSR as insurance of unknown value. Each CEO company gets,
    // secretly and at random, a yearly chance of a story in each pillar, a cost
    // if one breaks (share of market value), and how much each protection cuts
    // the chance. Nobody sees these until the game ends.
    riskLo: 0.05, riskHi: 0.2,   // yearly story chance, E and S, before protection
    severities: [0.03, 0.08, 0.15],
    effChoices: [0.1, 0.5, 0.9],
    maxStories: 2,         // controversy headlines per year, at most
    auditProb: 0.2,        // chance each CEO company is audited each round; some never are
    exposeHit: 0.02,       // an audit exposé costs 2% of market value
    marketMean: 0.06, marketSd: 0.03, idioSd: 0.05,  // a calm shared market, so decisions show
    fundSize: 20,
    letters: ["A", "B", "C", "D", "F"],
  };

  const E_PKG = ["E9", "E10", "E12", "E13", "E14", "E15", "E16"];
  const S_PKG = ["S8", "S11", "S12", "S13", "S14"];
  const LEVEL = { high: 3, medium: 2, low: 1, zero: 0 };

  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s += 0x6d2b79f5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(r) { return Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r()); }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const isNum = (v) => typeof v === "number" && isFinite(v);

  // ------------------------------------------------------------ scoring
  // Same steps as code/23-esg-rating/score.py, so grades match the class page.
  function percentile(vals, groups) {
    const out = new Array(vals.length).fill(null);
    const buckets = {};
    vals.forEach((v, i) => {
      if (!isNum(v)) return;
      const k = groups ? groups[i] : "_";
      (buckets[k] = buckets[k] || []).push(i);
    });
    Object.values(buckets).forEach((idx) => {
      const sorted = [...idx].sort((a, b) => vals[a] - vals[b]);
      const n = sorted.length;
      let j = 0;
      while (j < n) {
        let k = j;
        while (k + 1 < n && vals[sorted[k + 1]] === vals[sorted[j]]) k++;
        const rank = (j + k) / 2 + 1;  // average rank, 1-based
        for (let m = j; m <= k; m++) out[sorted[m]] = (rank - 0.5) / n;
        j = k + 1;
      }
    });
    return out;
  }

  function letterGrades(scores) {
    const idx = scores.map((s, i) => [s, i]).filter((p) => isNum(p[0]));
    idx.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const n = idx.length;
    const out = new Array(scores.length).fill("");
    idx.forEach(([, i], r) => { out[i] = P.letters[Math.min(Math.floor((r * 5) / n), 4)]; });
    return out;
  }

  function checkRule(v, op, value) {
    if (!isNum(v)) return false;
    const t = { yes: 1, no: 0 }[String(value).toLowerCase()];
    const w = t !== undefined ? t : +value;
    return { "==": v === w, ">": v > w, "<": v < w, ">=": v >= w, "<=": v <= w }[op] || false;
  }

  // spec: a class 23 rules file. adj: the fund team's in-game changes
  // {pillar_weights?, policyE, policyS}: credit (1, 0.5 or 0) for environmental
  // pledges and policies, and for social policies, set separately.
  // universe (optional): tickers a fund may hold, and how many it holds (n).
  // A fund's pillar weights as whole percents summing to 100 (in-game changes first).
  function pctWeights(fd) {
    const s = (fd.adj && fd.adj.pillar_weights) || fd.spec.pillar_weights || {};
    const v = { E: Math.max(0, +s.E || 0), S: Math.max(0, +s.S || 0), G: Math.max(0, +s.G || 0) };
    const t = v.E + v.S + v.G;
    if (t <= 0) return { E: 34, S: 33, G: 33 };
    const w = { E: Math.round((100 * v.E) / t), S: Math.round((100 * v.S) / t), G: Math.round((100 * v.G) / t) };
    const big = ["E", "S", "G"].reduce((a, b) => (w[b] > w[a] ? b : a));
    w[big] += 100 - (w.E + w.S + w.G);
    return w;
  }

  function scoreFund(g, spec, adj, universe) {
    adj = adj || {};
    const firms = g.firms;
    const groups = spec.compare === "industry" ? firms.map((f) => f.sector) : null;
    const missing = spec.missing || "average";
    const fill = { worst: 0, average: 0.5 }[missing];
    const scale = { E: adj.policyE === undefined ? 1 : adj.policyE, S: adj.policyS === undefined ? 1 : adj.policyS, G: 1 };
    const pillars = {};
    "ESG".split("").forEach((p) => {
      const num = new Array(firms.length).fill(0), den = new Array(firms.length).fill(0);
      g.fields.filter((fl) => fl.pillar === p).forEach((fl) => {
        let w = LEVEL[String((spec.weights || {})[fl.code] || "zero").toLowerCase()] || 0;
        if (fl.kind === "policy") w *= scale[p];
        if (!w) return;
        let vals = firms.map((f) => f.x[fl.code]);
        if ((fl.code === "S16" || fl.code === "S17") && spec.news_counts === "per_size")
          vals = vals.map((v, i) => (isNum(v) ? v / firms[i].sales : v));
        let pct = percentile(vals, groups);
        if (fl.better === "less") pct = pct.map((x) => (x === null ? null : 1 - x));
        pct = pct.map((x) => (x === null ? (fill === undefined ? null : fill) : x));
        pct.forEach((x, i) => { if (x !== null) { num[i] += w * x; den[i] += w; } });
      });
      pillars[p] = num.map((x, i) => (den[i] > 0 ? x / den[i] : null));
    });
    const pwSrc = adj.pillar_weights || spec.pillar_weights || {};
    let pw = { E: +pwSrc.E || 0, S: +pwSrc.S || 0, G: +pwSrc.G || 0 };
    if (pw.E + pw.S + pw.G <= 0) pw = { E: 1, S: 1, G: 1 };
    const overall = firms.map((f, i) => {
      let n = 0, d = 0;
      "ESG".split("").forEach((p) => { if (pillars[p][i] !== null) { n += pw[p] * pillars[p][i]; d += pw[p]; } });
      return d > 0 ? n / d : null;
    });
    const excluded = new Array(firms.length).fill(false);
    (spec.rules || []).forEach((rule) => {
      let hit;
      if (rule.sector) hit = firms.map((f) => f.sector === rule.sector);
      else if (rule.company) {
        const names = Array.isArray(rule.company) ? rule.company : [rule.company];
        hit = firms.map((f) => names.includes(f.name));
      } else if (rule.field) hit = firms.map((f) => checkRule(f.x[rule.field], rule.op, rule.value));
      else return;
      hit.forEach((h, i) => {
        if (!h) return;
        if (rule.action === "grade_F") overall[i] = -1;
        excluded[i] = true;
      });
    });
    const grade = letterGrades(overall);
    const pg = {};
    "ESG".split("").forEach((p) => { pg[p] = letterGrades(pillars[p]); });
    const pool = universe ? universe.tickers : null;
    const order = firms.map((f, i) => i).filter((i) => !excluded[i] && isNum(overall[i]) && (!pool || pool.has(firms[i].ticker)))
      .sort((a, b) => overall[b] - overall[a] || a - b).slice(0, universe ? universe.n : P.fundSize);
    return { overall, grade, pillarGrades: pg, held: order.map((i) => firms[i].ticker) };
  }

  // ------------------------------------------------------------ economics
  function payCost(f, dollars) { return (f.emp * 1000 * P.hoursPerYear * dollars) / 1e9; }  // $B a year
  function safetyCost(f) { return (f.emp * 1000 * P.safetyPerEmp) / 1e9; }
  function tonnes(f) { return isNum(f.T0) ? f.T0 * f.e : 0; }
  // Hidden draw for one CEO company.
  function drawHidden(r) {
    const pick = (a) => a[Math.floor(r() * a.length)];
    const h = { risk: {}, sev: {}, eff: {} };
    ["E", "S"].forEach((p) => {
      h.risk[p] = P.riskLo + (P.riskHi - P.riskLo) * r();
      h.sev[p] = pick(P.severities);
    });
    ["abate", "pay", "safety", "pkgE", "pkgS"].forEach((a) => { h.eff[a] = pick(P.effChoices); });
    return h;
  }

  // This year's chance of a story in pillar p, given what the company has done.
  function storyRisk(f, p) {
    const eff = f.hidden.eff;
    let k = f.hidden.risk[p];
    if (p === "E") {
      k *= 1 - eff.abate * Math.min(1, (1 - f.e) / 0.3);  // full protection from a 30% cut
      if (f.pkg.E) k *= 1 - eff.pkgE;
    }
    if (p === "S") {
      k *= 1 - eff.pay * Math.min(1, f.pay / 2);           // full protection from a $2 raise
      if (f.safety > 0) k *= 1 - eff.safety;
      if (f.pkg.S) k *= 1 - eff.pkgS;
    }
    return k;
  }

  // Expected carbon tax ($ per tonne) P.taxHorizon rounds ahead, given the current
  // level. Each round the tax steps up with chance h. Nobody knows when the game
  // ends, so the market always looks the same distance ahead.
  function expTax(rounds, from, level) {
    const steps = P.taxSteps, top = steps.length - 1;
    let v = steps.map((x) => x);  // value at the horizon, by level
    for (let i = 0; i < P.taxHorizon; i++) {
      v = v.map((x, L) => { const h = L < top ? P.taxHazard[L] : 0; return h * v[L + 1 > top ? top : L + 1] + (1 - h) * x; });
    }
    return v[level || 0];
  }

  function taxOutlook(rounds, from, taxOn) {
    if (taxOn) return 1;
    let none = 1;
    for (let i = 0; i < P.taxHorizon; i++) none *= 1 - P.taxHazard[0];
    return 1 - none;
  }

  // Expected yearly profit going forward, at chance of tax q. Controversy risk is
  // not in it: nobody, the market included, knows the odds.
  function expectedProfit(f, q) {
    return f.profit - (q * tonnes(f)) / 1e9 - payCost(f, f.pay) * (1 - f.recoup);  // q: expected tax, $ per tonne
  }
  const mult = (f) => P.Msector[f.sector] || P.M;
  function fundamental(f, q) { return mult(f) * Math.max(expectedProfit(f, q), 0.01 * f.profit); }

  // Cost of cutting emissions by pct% of the starting level, $B.
  function cutCost(f, pct) { return isNum(f.T0) ? ((pct / 100) * f.T0 * f.abateCost) / 1e9 : 0; }

  // Known value added per $1 spent. Safety and policy packages have no known
  // payoff: they are insurance against stories, worth an amount nobody knows.
  function valuePerDollar(f, q) {
    return { abate: (mult(f) * q) / f.abateCost - 1, pay: f.recoup - 1, safety: -1 };  // q: expected tax, $ per tonne
  }

  // Passive money backs a change that adds known value, or that is cheap
  // insurance (net cost under 1% of a year's profit).
  function passiveYes(f, kind, q) {
    if (kind === "E") return valuePerDollar(f, q).abate >= 0;
    return payCost(f, P.payStep) * (1 - f.recoup) <= 0.01 * f.profit;
  }

  // ------------------------------------------------------------ setup
  // params: {fields, firms: [{ticker,name,sector,sales,profit,emp,abateCost,recoup,ceo,x}], seed?, rounds?}
  function newGame(params) {
    const seed = params.seed || 20261112;
    const rounds = params.rounds || DEFAULT_ROUNDS;
    const q0 = expTax(rounds, 1, 0);
    const hr = rng(seed + 104729);
    const firms = params.firms.map((p) => {
      const f = Object.assign({}, p, { x: Object.assign({}, p.x), x0: Object.assign({}, p.x) });
      f.ceo = !!p.ceo;
      f.T0 = p.x.E1; f.e = 1; f.ePrev = 1;
      f.pay = 0; f.safety = 0; f.cumSpend = 0;
      f.pkg = { E: false, S: false };
      f.events = []; f.exposed = {};
      f.hidden = drawHidden(hr);
      f.V0 = fundamental(f, q0); f.V = f.V0;
      f.idx = 1; f.prem = 0; f.tsr = 0; f.ret = 0;
      return f;
    });
    return {
      version: 3, seed, round: 0, phase: "setup", rounds, taxOn: false, taxLevel: 0, taxRound: null, assign: {}, fundAssign: {}, P: Object.assign({}, P, params.P || {}),
      fields: params.fields, firms, funds: [], campaigns: [], headlines: [], savers: {},
      market: 1, marketRet: 0, totalCap0: sum(firms.map((f) => f.V0)), history: [],
    };
  }

  // spec: class 23 rules file; stickers: votes it won (sets starting money).
  function addFund(g, id, spec, stickers) {
    g.funds.push({ id, name: spec.fund_name || id, spec, adj: { policyE: 1, policyS: 1 }, stickers: Math.max(0, +stickers || 0),
      r: 0, gross: 0, fee: P.baseFee, tsr: 0, flow: 0, held: [], grades: {} });
    const any = sum(g.funds.map((f) => f.stickers)) > 0;
    const tot = any ? sum(g.funds.map((f) => f.stickers)) : g.funds.length;
    const pool = g.P.studentShare * sum(g.firms.filter((f) => f.ceo).map((f) => f.V0));
    g.funds.forEach((f) => { f.aum = (pool * (any ? f.stickers : 1)) / tot; f.aum0 = f.aum; });
    regrade(g);
  }

  // Funds hold the best third of the class companies (graded against all 100), equally weighted.
  function holdCount(g) { return Math.max(3, Math.round(g.firms.filter((f) => f.ceo).length / 3)); }
  function regrade(g) {
    const universe = { tickers: new Set(g.firms.filter((f) => f.ceo).map((f) => f.ticker)), n: holdCount(g) };
    g.funds.forEach((fd) => {
      const s = scoreFund(g, fd.spec, fd.adj, universe);
      fd.held = s.held;
      fd.grades = {};
      fd.pillarGrades = {};
      fd.scores = {};
      g.firms.forEach((f, i) => {
        fd.grades[f.ticker] = s.grade[i];
        // 0 to 100 score; -1 marks a company the fund's rules grade F.
        if (f.ceo) fd.scores[f.ticker] = isNum(s.overall[i]) ? (s.overall[i] < 0 ? -1 : Math.round(100 * s.overall[i])) : null;
        if (f.ceo) fd.pillarGrades[f.ticker] = { E: s.pillarGrades.E[i], S: s.pillarGrades.S[i], G: s.pillarGrades.G[i] };
      });
    });
  }

  function capOf(f) { return f.V0 * f.idx; }

  // Share of a company each fund owns: a fund holds its companies by market value.
  function fundStakes(g, f) {
    const out = {};
    g.funds.forEach((fd) => {
      if (!fd.held.includes(f.ticker)) { out[fd.id] = 0; return; }
      out[fd.id] = Math.min(fd.aum / fd.held.length / capOf(f), 0.5);  // equal weights
    });
    return out;
  }

  // Chance a fund wins a proxy fight.
  function fightOdds(g, c) {
    const f = g.firms.find((x) => x.ticker === c.ticker);
    const q = expTax(g.rounds, g.round, g.taxLevel || 0);
    const stake = fundStakes(g, f)[c.fund] || 0;
    return clamp(0.5 + (passiveYes(f, c.kind, q) ? 0.2 : -0.2) + Math.min(0.15, 0.5 * stake), 0.05, 0.95);
  }

  // ------------------------------------------------------------ actions
  // firm decision: {cut: 0|10|20, payRaise: 0|1|2, safety, pkgE, pkgS, responses: {CAMPAIGNID: "accept"|"fight"}}
  function cleanFirmDecision(g, f, d) {
    d = d || {};
    const room = Math.max(0, Math.round(100 * (f.e - (1 - P.maxCut))));  // % points of the start left to cut
    const out = {
      cut: Math.min([0, 10, 20].includes(+d.cut) ? +d.cut : 0, room),
      payRaise: clamp(Math.round(+d.payRaise || 0), 0, Math.min(2, P.maxPay - f.pay)),
      safety: d.safety && !f.safety ? 1 : 0,
      pkgE: !!d.pkgE && !f.pkg.E, pkgS: !!d.pkgS && !f.pkg.S,
      responses: d.responses || {},
    };
    const spend = () => cutCost(f, out.cut) + out.safety * safetyCost(f) + (out.pkgE + out.pkgS) * P.packageShare * f.profit;
    const budget = P.budgetShare * f.profit;
    while (spend() > budget + 1e-9 && out.cut > 0) out.cut -= 10;
    out.spend = spend();
    return out;
  }

  function cutEmissions(f, pct) {
    if (!pct || !isNum(f.T0) || f.T0 <= 0) return;
    f.e = Math.max(1 - P.maxCut, f.e - pct / 100);
  }

  // Data points follow the company's real state.
  function syncData(f) {
    const x = f.x, x0 = f.x0;
    if (isNum(x0.E1)) x.E1 = x0.E1 * f.e;
    if (isNum(x0.E2)) x.E2 = x0.E2 * f.e;
    x.E3 = f.ePrev > 0 ? 100 * (f.e / f.ePrev - 1) : x.E3;
    if (isNum(x0.E7)) x.E7 = x0.E7 * (0.5 + 0.5 * f.e);
    if (f.e <= 0.9) x.E11 = 1;
    if (f.pkg.E) {
      E_PKG.forEach((c) => { x[c] = 1; });
      x.E4 = Math.max(isNum(x.E4) ? x.E4 : 0, 50);
      x.E5 = isNum(x.E5) ? Math.min(x.E5, 2030) : 2030;
      x.E6 = 1;
    }
    if (f.safety) { x.S8 = 1; x.S9 = 1; x.S10 = 1; }
    if (f.pkg.S) S_PKG.forEach((c) => { x[c] = 1; });
  }

  const campaignText = (kind) => (kind === "E" ? "cut emissions 10%" : "raise hourly pay by $1");

  // ------------------------------------------------------------ resolve
  // decisions: {firm: {TICKER: decision}, fund: {ID: {policyE?, policyS?, campaign?: {ticker, kind}}},
  //             saver: {SAVERID: {alloc: {FUNDID: share}}}}
  function resolveRound(g, decisions) {
    decisions = decisions || {};
    const r = rng(g.seed + 7919 * (g.round + 1));
    const cfg = g.rounds[g.round];
    const heads = [];
    const say = (kind, text, short) => heads.push({ kind, text, short: short || text });
    // The carbon tax may pass this round; once it passes it stays.
    g.taxLevel = g.taxLevel || 0;
    if (g.taxLevel < P.taxSteps.length - 1 && r() < P.taxHazard[g.taxLevel]) {
      g.taxLevel += 1; g.taxOn = true; g.taxRound = g.round;
      const t = P.taxSteps[g.taxLevel];
      if (g.taxLevel === 1) say("tax", `A carbon tax of $${t} a tonne becomes law.`, `Congress Passes $${t}-a-Tonne Carbon Tax`);
      else say("tax", `The carbon tax rises to $${t} a tonne.`, `Carbon Tax Raised to $${t} a Tonne`);
    }
    const taxNow = P.taxSteps[g.taxLevel];
    const qPrev = g.qLast === undefined ? expTax(g.rounds, 1, 0) : g.qLast;
    const qNow = expTax(g.rounds, g.round + 1, g.taxLevel);  // expected tax from here, $ per tonne
    const credit = { 1: "full", 0.5: "half", 0: "none" };
    const ceos = g.firms.filter((f) => f.ceo);

    // 1. Savers move money (half follows this year's savers).
    Object.entries(decisions.saver || {}).forEach(([id, d]) => {
      const s = g.savers[id] || (g.savers[id] = { balance: 10000, prev: 10000, alloc: null });
      const alloc = {};
      let tot = 0;
      g.funds.forEach((fd) => { const v = Math.max(0, +(d.alloc || {})[fd.id] || 0); alloc[fd.id] = v; tot += v; });
      if (tot > 0) { g.funds.forEach((fd) => { alloc[fd.id] /= tot; }); s.alloc = alloc; }
    });
    const savers = Object.values(g.savers).filter((s) => s.alloc);
    g.funds.forEach((fd) => { fd.flow = 0; });
    if (savers.length) {
      const pool = sum(g.funds.map((fd) => fd.aum));
      const bal = sum(savers.map((s) => s.balance));
      g.funds.forEach((fd) => {
        const share = 0.5 * (fd.aum / pool) + 0.5 * (sum(savers.map((s) => s.balance * s.alloc[fd.id])) / bal);
        fd.flow = (pool * share) / fd.aum - 1;
        fd.aum = pool * share;
      });
    }

    // 2. Fund teams: rating lever, new campaigns (answered next year).
    const launches = [];
    g.funds.forEach((fd) => {
      fd.campaignsThisYear = 0;
      fd.moves = [];
      const d = (decisions.fund || {})[fd.id];
      if (!d) return;
      const before = { E: fd.adj.policyE, S: fd.adj.policyS };
      if (d.policyE !== undefined) fd.adj.policyE = clamp(+d.policyE, 0, 1);
      if (d.policyS !== undefined) fd.adj.policyS = clamp(+d.policyS, 0, 1);
      if (fd.adj.policyE !== before.E) fd.moves.push({ t: `E pledge credit: ${credit[fd.adj.policyE]}` });
      if (fd.adj.policyS !== before.S) fd.moves.push({ t: `S policy credit: ${credit[fd.adj.policyS]}` });
      // Re-weighting: whole percents summing to 100, each pillar at most P.reweightMax points from now.
      if (d.weights) {
        const cur = pctWeights(fd), w = { E: Math.round(+d.weights.E), S: Math.round(+d.weights.S), G: Math.round(+d.weights.G) };
        const ok = ["E", "S", "G"].every((p) => w[p] >= 0 && Math.abs(w[p] - cur[p]) <= P.reweightMax) && w.E + w.S + w.G === 100;
        if (ok && ["E", "S", "G"].some((p) => w[p] !== cur[p])) {
          fd.adj.pillar_weights = w;
          fd.moves.push({ t: `Weights: E ${w.E}% · S ${w.S}% · G ${w.G}%` });
        }
      }
      const c = d.campaign;
      if (c && (c.kind === "E" || c.kind === "S") && ceos.some((f) => f.ticker === c.ticker) && g.round + 1 < g.rounds.length) {
        launches.push({ id: `${g.round}-${fd.id}`, fund: fd.id, ticker: c.ticker, kind: c.kind, launched: g.round, status: "pending" });
        fd.campaignsThisYear += 1;
        const tf = ceos.find((f) => f.ticker === c.ticker);
        fd.moves.push({ t: `Campaign: ${tf.name}, ${c.kind === "E" ? "emissions" : "pay"}` });
      }
    });

    // 3. Market.
    const m = g.P.marketMean + g.P.marketSd * normal(r);
    const marketPrev = g.market;
    g.market *= 1 + m - g.P.marketMean;
    g.firms.forEach((f) => {
      f.events = [];
      f.capPrev = capOf(f);
      f.Vprev = f.V; f.premPrev = f.prem;
      if (f.ceo) return;
      // Background companies: the market, their own noise, and carbon tax risk
      // (value falls as the chance of a tax rises, in proportion to emissions).
      f.V = fundamental(f, qNow);
      const noise = g.P.idioSd * normal(r);
      const taxPaid = (taxNow * tonnes(f)) / 1e9 / f.capPrev;
      const ret = (1 + m - g.P.marketMean + noise) * (f.V / f.Vprev) * (1 + g.P.marketMean) - 1 - taxPaid;
      f.idx *= (1 + m - g.P.marketMean + noise) * (f.V / f.Vprev);  // price; the mean return arrives as payout
      f.ret = ret; f.tsr = (1 + f.tsr) * (1 + ret) - 1;
    });

    // 4. CEO companies: own decisions, campaign answers, profit, audits.
    ceos.forEach((f) => {
      const d = cleanFirmDecision(g, f, (decisions.firm || {})[f.ticker]);
      f.last = d;
      f.ePrev = f.e;
      const payBefore = f.pay;
      cutEmissions(f, d.cut);
      f.pay += d.payRaise;
      if (d.safety) f.safety = 1;
      if (d.pkgE) f.pkg.E = true;
      if (d.pkgS) f.pkg.S = true;
      let extra = 0;   // campaign costs: forced changes and fights
      g.campaigns.filter((c) => c.status === "pending" && c.ticker === f.ticker).forEach((c) => {
        const fd = g.funds.find((x) => x.id === c.fund);
        const fname = fd ? fd.name : c.fund;
        const ans = d.responses[c.id] === "accept" ? "accept" : "fight";
        let apply = false;
        if (ans === "accept") {
          c.status = "accepted"; apply = true;
          say("result", `${f.name} agrees to ${campaignText(c.kind)} after a campaign by ${fname}.`,
            `${f.name} Bows to ${fname}, Agrees to ${c.kind === "E" ? "Cut Emissions" : "Raise Pay"}`);
          if (fd) fd.moves.push({ t: `${f.name} accepted its demand` });
        } else {
          c.odds = fightOdds(g, c);
          extra += g.P.fightCost * f.capPrev;
          if (fd) fd.campaignsThisYear += 1;
          if (r() < c.odds) {
            c.status = "won"; apply = true;
            say("result", `${fname} wins its proxy fight: ${f.name} must ${campaignText(c.kind)}.`,
              `${fname} Beats ${f.name} in Proxy Fight`);
            if (fd) fd.moves.push({ t: `Won proxy fight vs ${f.name}` });
          } else {
            c.status = "lost";
            say("result", `${f.name} beats ${fname}'s campaign in a proxy fight.`,
              `${f.name} Fends Off ${fname} in Proxy Fight`);
            if (fd) fd.moves.push({ t: `Lost proxy fight vs ${f.name}`, bad: true });
          }
        }
        c.answered = g.round;
        if (apply && c.kind === "E" && f.e > 1 - P.maxCut + 1e-9) { extra += cutCost(f, 10); cutEmissions(f, 10); }
        if (apply && c.kind === "S" && f.pay < P.maxPay) f.pay += 1;
      });
      syncData(f);
      f.x.S15 = 0; f.x.E17 = 0;  // controversy data points reflect this year's news
      f.profitNormal = f.profit - payCost(f, f.pay) * (1 - f.recoup) - (taxNow * tonnes(f)) / 1e9;
      f.spendYear = d.spend + extra;
      f.hitYear = 0;
      f.impact = { cut: f.ePrev - f.e, payRaise: f.pay - payBefore, safety: !!d.safety, pkgE: d.pkgE, pkgS: d.pkgS };
      const audited = cfg.mandate || r() < P.auditProb;
      f.audited = audited;
      if (audited) {
        if (f.pkg.E && 1 - f.e < 0.1 && !f.exposed.E) {
          f.exposed.E = true; f.x.E17 = 1; f.hitYear += P.exposeHit * f.capPrev; f.events.push("exposeE");
          say("audit", `Audit: ${f.name}'s climate pledges are not matched by emissions cuts.`,
            `${f.name}'s Climate Pledges Ring Hollow, Audit Finds`);
        }
        if (f.pkg.S && f.pay === 0 && !f.safety && !f.exposed.S) {
          f.exposed.S = true; f.x.S15 = 1; f.hitYear += P.exposeHit * f.capPrev; f.events.push("exposeS");
          say("audit", `Audit: ${f.name}'s worker policies are not matched by pay or safety spending.`,
            `Audit: ${f.name}'s Worker Policies Exist Only on Paper`);
        }
      }
    });

    // 5. Controversies: at most maxStories, picked at random among the hits.
    const hits = [];
    ceos.forEach((f) => { ["E", "S"].forEach((p) => { if (r() < storyRisk(f, p)) hits.push([f, p, r()]); }); });
    hits.sort((a, b) => a[2] - b[2]).slice(0, P.maxStories).forEach(([f, p]) => {
      const sev = f.hidden.sev[p];
      f.hitYear += sev * f.capPrev;
      f.events.push("story" + p);
      if (p === "E") f.x.E17 = 1; else f.x.S15 = 1;
      const st = storyText(f.name, p, sev >= 0.15 ? "major" : sev >= 0.08 ? "serious" : "minor", r);
      say("story", st.text, st.short);
    });
    ceos.forEach((f) => { f.payout = f.profitNormal - f.spendYear - f.hitYear; f.cumSpend += f.spendYear; });

    // 6. New grades and holdings.
    regrade(g);

    // 7. Prices of CEO companies, and why they moved.
    ceos.forEach((f) => {
      f.V = fundamental(f, qNow);
      const own = sum(Object.values(fundStakes(g, f)));
      f.prem = g.P.lambda * (Math.min(own / g.P.studentShare, g.P.demandCap) - 1);
      const cap = f.V * (1 + f.prem) * g.market;
      f.idx = cap / f.V0;
      f.ret = (cap + f.payout) / f.capPrev - 1;
      f.tsr = (1 + f.tsr) * (1 + f.ret) - 1;
      // Split the change in long-run value into carbon tax news and the company's own changes.
      const valueChg = f.V / f.Vprev - 1;
      const taxPart = (-mult(f) * (qNow - qPrev) * (isNum(f.T0) ? f.T0 * f.ePrev : 0)) / 1e9 / f.Vprev;
      f.why = {  // adds up roughly to the return
        market: g.market / marketPrev - 1,
        tax: taxPart,
        own: valueChg - taxPart,
        outlook: valueChg,
        demand: (1 + f.prem) / (1 + f.premPrev) - 1,
        business: f.profitNormal / f.capPrev,
        spending: -f.spendYear / f.capPrev,
        news: -f.hitYear / f.capPrev,
      };
      const bad = f.events.length > 0;
      const good = f.impact.cut > 0 || f.impact.payRaise > 0 || f.impact.safety;
      f.impact.status = bad ? "bad" : good ? "good" : "none";
      f.impact.events = [...f.events];
    });

    // 8. Fund returns, after fees.
    const capTot = sum(g.firms.map((f) => f.capPrev));
    g.marketRet = sum(g.firms.map((f) => (f.capPrev / capTot) * f.ret));
    g.funds.forEach((fd) => {
      const held = fd.prevHeld && fd.prevHeld.length ? fd.prevHeld : fd.held;
      const firms = held.map((t) => g.firms.find((f) => f.ticker === t));
      fd.gross = firms.length ? sum(firms.map((f) => f.ret)) / firms.length : 0;  // equal weights
      fd.fee = P.baseFee + P.campaignFee * fd.campaignsThisYear;
      fd.r = fd.gross - fd.fee;
      fd.aum *= 1 + fd.r;
      fd.tsr = (1 + fd.tsr) * (1 + fd.r) - 1;
      fd.lastHeld = held.slice();
      fd.prevHeld = [...fd.held];
    });
    const ranked = [...g.funds].sort((a, b) => b.aum - a.aum);
    g.funds.forEach((fd) => { fd.rank = ranked.indexOf(fd) + 1; });
    Object.values(g.savers).forEach((s) => {
      s.prev = s.balance;
      if (s.alloc) s.balance *= 1 + sum(g.funds.map((fd) => s.alloc[fd.id] * fd.r));
    });

    // 9. This year's new campaigns: news now, answered next year.
    g.campaigns.filter((c) => c.status === "pending").forEach((c) => { c.status = "lapsed"; });
    launches.forEach((c) => {
      const f = g.firms.find((x) => x.ticker === c.ticker);
      const fd = g.funds.find((x) => x.id === c.fund);
      g.campaigns.push(c);
      say("launch", `${fd.name} launches a campaign: ${f.name} must ${campaignText(c.kind)}.`);
    });

    g.qLast = qNow;
    g.history.push({
      round: g.round, label: cfg.label, q: qNow, mandate: cfg.mandate, tax: taxNow, market: m, marketRet: g.marketRet,
      firms: ceos.map((f) => ({
        ticker: f.ticker, name: f.name, decision: f.last, e: f.e, pay: f.pay, safety: f.safety,
        pkg: Object.assign({}, f.pkg), events: [...f.events], audited: f.audited, idx: f.idx, ret: f.ret,
        tsr: f.tsr, prem: f.prem, V: f.V, payout: f.payout, why: Object.assign({}, f.why), impact: Object.assign({}, f.impact),
        grades: Object.fromEntries(g.funds.map((fd) => [fd.id, fd.grades[f.ticker]])),
        held: Object.fromEntries(g.funds.map((fd) => [fd.id, fd.held.includes(f.ticker)])),
      })),
      funds: g.funds.map((fd) => ({ id: fd.id, name: fd.name, aum: fd.aum, r: fd.r, gross: fd.gross, fee: fd.fee,
        tsr: fd.tsr, flow: fd.flow, rank: fd.rank, policyE: fd.adj.policyE, policyS: fd.adj.policyS, held: [...fd.held] })),
      campaigns: JSON.parse(JSON.stringify(g.campaigns)), savers: Object.keys(g.savers).length,
    });
    g.headlines = heads;
    g.round += 1;
    g.phase = g.round < g.rounds.length ? "decide" : "over";
    return g;
  }

  // The instructor ends the game before the last round: campaigns still waiting
  // for an answer lapse, and the hidden odds are revealed.
  function endGame(g) {
    g.campaigns.filter((c) => c.status === "pending").forEach((c) => { c.status = "lapsed"; });
    g.phase = "over";
    return g;
  }

  // [long form for team screens, newspaper headline]
  const STORIES = {
    E: [["a chemical leak near one of its sites", "Chemical Leak at {N} Site"],
      ["a pollution fine from state regulators", "Regulators Fine {N} Over Pollution"],
      ["a report that its suppliers clear protected forest", "{N} Suppliers Tied to Forest Clearing"],
      ["a spill that closes a river to fishing", "{N} Spill Closes River to Fishing"]],
    S: [["a worker injured on the job", "Worker Injured on the Job at {N}"],
      ["a federal citation for blocked fire exits", "{N} Cited for Blocked Fire Exits"],
      ["a viral video of workers' pay stubs", "{N} Pay Stubs Go Viral"],
      ["a lawsuit over unpaid overtime", "{N} Sued Over Unpaid Overtime"]],
  };
  function storyText(name, p, size, r) {
    const list = STORIES[p];
    const [what, head] = list[Math.floor(r() * list.length)];
    return { text: `${size === "major" ? "Major story" : size === "serious" ? "Serious story" : "In the news"}: ${name} faces ${what}.`,
      short: head.replace("{N}", name), size };
  }

  // ------------------------------------------------------------ public view
  // Everything students' browsers see. No raw data points, no profit or employee
  // figures: grades, indexes, in-game actions, and money in the game's own units.
  function publicState(g) {
    // Games saved before scores existed: grade once more (no randomness, same holdings).
    if (g.funds.some((fd) => !fd.scores)) regrade(g);
    const cfg = g.rounds[Math.min(g.round, g.rounds.length - 1)];
    const fundName = Object.fromEntries(g.funds.map((fd) => [fd.id, fd.name]));
    const camp = (c) => ({ id: c.id, fund: c.fund, fundName: fundName[c.fund], ticker: c.ticker,
      name: (g.firms.find((f) => f.ticker === c.ticker) || {}).name, kind: c.kind, text: campaignText(c.kind),
      launched: c.launched, answered: c.answered, status: c.status,
      odds: c.status === "pending" ? fightOdds(g, c) : c.odds });
    const ceo = g.firms.filter((f) => f.ceo).map((f) => {
      const room = Math.max(0, Math.round(100 * (f.e - (1 - P.maxCut))));
      return {
        ticker: f.ticker, name: f.name, sector: f.sector,
        idx: f.idx, ret: f.ret, tsr: f.tsr, prem: f.prem, why: f.why || null, impact: f.impact || null,
        budget: P.budgetShare * f.profit,
        costs: { cut10: room >= 10 ? cutCost(f, 10) : null, cut20: room >= 20 ? cutCost(f, 20) : null,
          pay: payCost(f, P.payStep), payBack: f.recoup, safety: safetyCost(f), pkg: P.packageShare * f.profit },
        cutValue: valuePerDollar(f, expTax(g.rounds, g.round, g.taxLevel || 0)).abate, payLeft: Math.min(2, P.maxPay - f.pay),
        progress: { emissionsCut: 1 - f.e, pay: f.pay, safety: f.safety, pkg: Object.assign({}, f.pkg), spent: f.cumSpend },
        events: [...f.events],
        campaigns: g.campaigns.filter((c) => c.ticker === f.ticker && c.status === "pending").map(camp),
        grades: Object.fromEntries(g.funds.map((fd) => [fd.id, fd.grades[f.ticker]])),
        pillarGrades: Object.fromEntries(g.funds.map((fd) => [fd.id, fd.pillarGrades[f.ticker]])),
        scores: Object.fromEntries(g.funds.map((fd) => [fd.id, (fd.scores || {})[f.ticker]])),
        held: Object.fromEntries(g.funds.map((fd) => [fd.id, fd.held.includes(f.ticker)])),
      };
    });
    const nameOf = Object.fromEntries(g.firms.map((f) => [f.ticker, f.name]));
    const ceoSet = new Set(g.firms.filter((f) => f.ceo).map((f) => f.ticker));
    const pw = pctWeights;
    const r4 = (x) => (typeof x === "number" ? Math.round(x * 1e4) / 1e4 : x);
    return {
      version: 3, public: true, round: g.round, phase: g.phase, rounds: g.rounds, headlines: g.headlines,
      assign: g.assign || {}, fundAssign: g.fundAssign || {}, taxOn: g.taxOn, taxRound: g.taxRound, taxNow: P.taxSteps[g.taxLevel || 0], taxNext: P.taxSteps[Math.min((g.taxLevel || 0) + 1, P.taxSteps.length - 1)],
      taxChance: (g.taxLevel || 0) < P.taxSteps.length - 1 ? P.taxHazard[g.taxLevel || 0] : 0, taxOutlook: taxOutlook(g.rounds, g.round, g.taxOn),
      marketRet: g.marketRet, ceo,
      campaigns: g.campaigns.map(camp),
      funds: g.funds.map((fd) => ({
        id: fd.id, name: fd.name, aum: fd.aum, aum0: fd.aum0, r: fd.r, gross: fd.gross, fee: fd.fee, tsr: fd.tsr,
        flow: fd.flow || 0, rank: fd.rank || null, moves: fd.moves || [], pillarWeights: pw(fd), policyE: fd.adj.policyE, policyS: fd.adj.policyS,
        holdings: fd.held.map((t) => ({ name: nameOf[t], grade: fd.grades[t], ceo: ceoSet.has(t) })),
        lastHeld: (fd.lastHeld || []).map((t) => ({ name: nameOf[t], ret: (g.firms.find((f) => f.ticker === t) || {}).ret })),
        compare: fd.spec.compare || "all", campaignsLaunched: g.campaigns.filter((c) => c.fund === fd.id).length,
      })),
      savers: Object.fromEntries(Object.entries(g.savers).map(([id, s]) => [id, { balance: r4(s.balance), prev: r4(s.prev), alloc: s.alloc }])),
      history: g.history.map((h) => ({
        round: h.round, label: h.label, q: h.q, marketRet: h.marketRet,
        firms: h.firms.map((f) => ({ ticker: f.ticker, name: f.name, emissionsCut: 1 - f.e, pay: f.pay, safety: f.safety,
          pkg: f.pkg, events: f.events, idx: f.idx, ret: f.ret, tsr: f.tsr, grades: f.grades, held: f.held })),
        funds: h.funds.map((f) => ({ id: f.id, name: f.name, aum: f.aum, r: f.r, fee: f.fee, tsr: f.tsr, flow: f.flow })),
      })),
      // The hidden odds, shown only once the game is over.
      reveal: g.phase === "over" ? g.firms.filter((f) => f.ceo).map((f) => ({ name: f.name, hidden: f.hidden })) : null,
    };
  }

  const api = { DEFAULT_ROUNDS, P, newGame, addFund, resolveRound, endGame, publicState, scoreFund, regrade, holdCount, valuePerDollar,
    fundamental, expectedProfit, taxOutlook, expTax, cleanFirmDecision, cutCost, fightOdds, percentile, letterGrades, campaignText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ESG = api;
})(this);
