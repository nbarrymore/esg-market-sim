// ESG market simulation engine. Pure functions on a plain state object, so the
// instructor console, the tests (node), and the debrief export share one model.
//
// One round is one year:
//   1. Student firms choose real abatement ($B, cuts social cost for good) and
//      ESG policies ($B, raise the policy rater's score, cut nothing).
//   2. Funds choose portfolio weights and may file one engagement proposal.
//   3. Funds vote on proposals; Big Three passive money votes yes only if the
//      demanded abatement creates value at today's chance of a carbon tax.
//   4. resolveRound(): ratings, audits, prices, returns, saver flows.
//
// Price of firm i:
//   cap_i = V_i * (1 + lambda * (min(D_i / N_i, 4) - 1))
// where V_i = multiple_i * (EBITDA_i - q * socialCost_i) is fundamental value,
// D_i is student fund demand for the firm, and N_i = S * V_i / sum V is what
// that demand would be at market weights. Conventional money absorbs most of a
// tilt: with lambda = 0.15, no student demand at all prices a firm 15% below
// fundamental, and double demand prices it 15% above.
(function (root) {
  "use strict";

  const DEFAULT_ROUNDS = [
    { label: "Practice", q: 0.05, mandate: false, tax: false },
    { label: "Year 1", q: 0.05, mandate: false, tax: false },
    { label: "Year 2", q: 0.15, mandate: false, tax: false },
    { label: "Year 3", q: 0.25, mandate: false, tax: false },
    { label: "Year 4", q: 0.35, mandate: true, tax: false },
    { label: "Year 5", q: 1.0, mandate: true, tax: true },
  ];

  const P = {
    studentShare: 0.4,     // student funds' share of market value at the start
    auditProb: 0.3,        // chance each student firm is audited, before the mandate
    noiseB: 0.15,          // outcome rater's measurement noise, before the mandate
    cashYield: 0.06,       // normal annual cash to shareholders, share of starting value
    policyHalfLife: 0.4,   // $B of cumulative policy spending for ~63% of max boost
    policyMax: 25,         // max points policies add to the policy rater
    budgetShare: 0.5,      // abatement + policy cannot exceed this share of EBITDA
    scFloor: 0.2,          // social cost cannot fall below 20% of its start
    flowReturn: 1.0,       // savers move 1% of AUM per 1 point of excess return
    flowRating: 0.004,     // ESG-labeled funds: flow per rating point above market
    flowScandal: 0.5,      // ESG-labeled funds: flow lost per unit weight in a scandal
    flowCap: 0.25,
    big3Share: 0.5,        // share of passive money that votes on value
    lambda: 0.15,          // price response to student demand (see header)
  };

  // Deterministic RNG so a session can be replayed from its seed.
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

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  function ratingB(f, noise, r) {
    const x = (f.sc / f.ebitda) * (1 + noise * (2 * r() - 1));
    return clamp(100 - 250 * x, 0, 100);
  }

  function policyPoints(f) {
    return P.policyMax * (1 - Math.exp(-f.cumPolicy / P.policyHalfLife));
  }

  function ratingA(f, mandate) {
    const pol = policyPoints(f) * (mandate ? 0.5 : 1);
    return clamp(f.a0 + pol + 0.3 * (f.ratingB - f.b0) * (mandate ? 2 : 1), 0, 100);
  }

  // Value created per $1 of abatement at chance-of-tax q (shown to CEOs).
  function abatementNPV(f, q) {
    return f.mult * q * f.eff - 1;
  }

  function fundamental(f, q) {
    return f.mult * (f.ebitda - q * f.sc);
  }

  // params: {firms: [{ticker,name,sector,ebitda,sc0,cap0,a0,eff,student}], rounds?, seed?}
  function newGame(params) {
    const rounds = params.rounds || DEFAULT_ROUNDS;
    const q0 = rounds[0].q;
    const r = rng(params.seed || 20261110);
    const firms = params.firms.map((p) => {
      const f = {
        ticker: p.ticker, name: p.name, sector: p.sector, student: !!p.student,
        ebitda: p.ebitda, sc0: p.sc0, sc: p.sc0, eff: p.eff || 0, a0: p.a0,
        cumPolicy: 0, cumAbate: 0, minAbate: 0, scandal: false, scandalEver: false,
        values: !!p.values, payoutCum: 0, tsr: 0,
        cash: p.cash || P.cashYield * p.cap0,
      };
      f.cap0 = p.cap0;
      f.mult = p.cap0 / (p.ebitda - q0 * p.sc0);
      f.V = p.cap0;
      f.cap = p.cap0;
      f.ratingB = ratingB(f, 0, r);
      f.b0 = f.ratingB;
      f.ratingA = ratingA(f, false);
      return f;
    });
    const totalCap = sum(firms.map((f) => f.cap));
    return {
      version: 1, seed: params.seed || 20261110, rngCalls: 0,
      round: 0, phase: "setup", rounds, P: Object.assign({}, P, params.P || {}),
      firms, funds: [], proposals: [], headlines: [],
      totalCap0: totalCap, history: [], decisions: {}, votes: {},
    };
  }

  // Student money is split equally across however many funds launch.
  function addFund(g, id, name, label) {
    g.funds.push({ id, name, label, weights: marketWeights(g), r: 0, flow: 0 });
    const per = (g.P.studentShare * g.totalCap0) / g.funds.length;
    g.funds.forEach((f) => { f.aum = per; f.aum0 = per; });
  }

  function marketWeights(g) {
    const tot = sum(g.firms.map((f) => f.cap));
    const w = {};
    g.firms.forEach((f) => { w[f.ticker] = (100 * f.cap) / tot; });
    return w;
  }

  function normWeights(w, g) {
    const out = {};
    let tot = 0;
    g.firms.forEach((f) => { const x = Math.max(0, +w[f.ticker] || 0); out[f.ticker] = x; tot += x; });
    if (tot <= 0) return marketWeights(g);
    g.firms.forEach((f) => { out[f.ticker] = (100 * out[f.ticker]) / tot; });
    return out;
  }

  function firmBudget(f) { return Math.max(0, P.budgetShare * f.ebitda); }

  // decisions: {firm: {TICKER: {abate, policy}}, fund: {ID: {weights, proposal}}}
  // votes: {FUNDID: {PROPOSALID: true|false}}
  function resolveRound(g, decisions, votes) {
    const r = rng(g.seed + 7919 * (g.round + 1));
    const cfg = g.rounds[g.round];
    const next = g.rounds[Math.min(g.round + 1, g.rounds.length - 1)];
    const qNext = g.round + 1 < g.rounds.length ? next.q : cfg.q;
    const S = sum(g.funds.map((f) => f.aum));
    const heads = [];

    // 1. Fund weights for this round (stakes for votes and demand for prices).
    g.funds.forEach((fd) => {
      const d = (decisions.fund || {})[fd.id];
      if (d && d.weights) fd.weights = normWeights(d.weights, g);
    });

    // 2. Engagement votes on this round's proposals (bind next round).
    const results = [];
    g.proposals.forEach((p) => {
      const f = g.firms.find((x) => x.ticker === p.ticker);
      let yes = 0;
      g.funds.forEach((fd) => {
        const v = (votes[fd.id] || {})[p.id];
        const stake = (fd.weights[f.ticker] / 100) * fd.aum;
        if (v === true || fd.id === p.fund) yes += stake;
      });
      const passive = Math.max(0, f.cap - sum(g.funds.map((fd) => (fd.weights[f.ticker] / 100) * fd.aum)));
      const big3Yes = abatementNPV(f, cfg.q) >= 0 ? g.P.big3Share * passive : 0;
      const share = (yes + big3Yes) / f.cap;
      const pass = share >= 0.5;
      results.push({ id: p.id, ticker: p.ticker, fund: p.fund, amount: p.amount, share, big3: big3Yes > 0, pass });
      if (pass) heads.push(`Shareholders force ${f.name} to spend at least $${p.amount.toFixed(1)}B on abatement next year (${Math.round(100 * share)}% yes).`);
      else heads.push(`Proposal at ${f.name} fails with ${Math.round(100 * share)}% yes.`);
    });

    // 3. Firm decisions, social cost, tax, payouts.
    g.firms.forEach((f) => {
      let abate = 0, policy = 0;
      if (f.student) {
        const d = (decisions.firm || {})[f.ticker] || {};
        abate = Math.max(+d.abate || 0, f.minAbate);
        policy = Math.max(0, +d.policy || 0);
        const b = firmBudget(f);
        if (abate + policy > b) { const k = b / (abate + policy); abate *= k; policy *= k; }
      }
      f.lastAbate = abate; f.lastPolicy = policy;
      f.cumAbate += abate; f.cumPolicy += policy;
      f.sc = Math.max(g.P.scFloor * f.sc0, f.sc - f.eff * abate);
      const tax = cfg.tax ? f.sc : 0;
      f.lastTax = tax;
      f.payout = f.cash * (1 + 0.1 * (2 * r() - 1)) - abate - policy - tax;
      f.minAbate = 0;
    });
    results.filter((x) => x.pass).forEach((x) => {
      const f = g.firms.find((y) => y.ticker === x.ticker);
      f.minAbate = Math.max(f.minAbate, x.amount);
    });

    // 4. Ratings and audits.
    g.firms.forEach((f) => {
      f.scandal = false;
      f.ratingB = ratingB(f, cfg.mandate ? 0 : g.P.noiseB, r);
      const audited = cfg.mandate || (f.student && r() < g.P.auditProb);
      f.audited = f.student && audited;
      const pol = policyPoints(f);
      if (f.student && audited && !cfg.mandate && pol > 10 && (f.sc0 - f.sc) / f.sc0 < 0.05) {
        f.scandal = true; f.scandalEver = true;
        heads.push(`Audit finds ${f.name}'s ESG claims are not matched by results. Policy rating cut.`);
        f.cumPolicy = 0;
      }
      f.ratingA = ratingA(f, cfg.mandate);
    });

    // 5. Prices.
    g.firms.forEach((f) => { f.Vprev = f.V; f.capPrev = f.cap; f.V = fundamental(f, cfg.tax ? 1 : qNext); });
    const sumV = sum(g.firms.map((f) => f.V));
    g.firms.forEach((f) => {
      const demand = sum(g.funds.map((fd) => (fd.weights[f.ticker] / 100) * fd.aum));
      const neutral = (S * f.V) / sumV;
      f.demandRatio = neutral > 0 ? Math.min(demand / neutral, 4) : 1;
      f.cap = f.V * (1 + g.P.lambda * (f.demandRatio - 1));
      f.ret = (f.cap + f.payout) / f.capPrev - 1;
      f.payoutCum += f.payout;
      f.tsr = (1 + f.tsr) * (1 + f.ret) - 1;
      f.premium = f.cap / f.V - 1;
    });

    // 6. Fund returns and saver flows.
    const capTot = sum(g.firms.map((f) => f.capPrev));
    const rm = sum(g.firms.map((f) => (f.capPrev / capTot) * f.ret));
    const mktA = sum(g.firms.map((f) => (f.capPrev / capTot) * f.ratingA));
    g.funds.forEach((fd) => {
      fd.r = sum(g.firms.map((f) => (fd.weights[f.ticker] / 100) * f.ret));
      const esgScore = sum(g.firms.map((f) => (fd.weights[f.ticker] / 100) * f.ratingA));
      const scandalExp = sum(g.firms.map((f) => (f.scandal ? fd.weights[f.ticker] / 100 : 0)));
      let flow = g.P.flowReturn * (fd.r - rm);
      if (fd.label === "ESG") flow += g.P.flowRating * (esgScore - mktA) - g.P.flowScandal * scandalExp;
      fd.flow = clamp(flow, -g.P.flowCap, g.P.flowCap);
      fd.esgScore = esgScore;
      fd.aum = fd.aum * (1 + fd.r) * (1 + fd.flow);
    });

    g.history.push({
      round: g.round, label: cfg.label, q: cfg.q, mandate: cfg.mandate, tax: cfg.tax, rm,
      firms: g.firms.map((f) => ({
        ticker: f.ticker, student: f.student, abate: f.lastAbate, policy: f.lastPolicy, tax: f.lastTax,
        sc: f.sc, sc0: f.sc0, A: f.ratingA, B: f.ratingB, V: f.V, cap: f.cap, premium: f.premium,
        ret: f.ret, tsr: f.tsr, scandal: f.scandal, audited: !!f.audited,
      })),
      funds: g.funds.map((fd) => ({ id: fd.id, name: fd.name, label: fd.label, aum: fd.aum, r: fd.r,
        flow: fd.flow, esgScore: fd.esgScore, weights: Object.assign({}, fd.weights) })),
      proposals: results,
    });
    g.headlines = heads;
    g.proposals = [];
    g.round += 1;
    g.phase = g.round < g.rounds.length ? "decide" : "over";
    return g;
  }

  function addProposal(g, fundId, ticker, amount) {
    const id = `${g.round}-${fundId}-${ticker}`;
    g.proposals = g.proposals.filter((p) => p.fund !== fundId);
    g.proposals.push({ id, fund: fundId, ticker, amount: Math.max(0, +amount || 0) });
    return id;
  }

  const api = { DEFAULT_ROUNDS, P, newGame, addFund, addProposal, resolveRound, marketWeights,
    normWeights, abatementNPV, fundamental, firmBudget, policyPoints };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ESG = api;
})(this);
