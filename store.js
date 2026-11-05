// Event store. One append-only table of events per session:
//   state     the instructor's full game state (latest one wins)
//   decision  a team's choices for a round (latest per team wins)
//   vote      a fund's votes on this round's proposals
// Supabase when config.js has keys; otherwise localStorage, which lets several
// tabs in one browser play together for testing.
(function (root) {
  "use strict";
  const cfg = root.ESG_CONFIG || {};
  const remote = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && root.supabase);

  function Store(session) {
    this.session = session;
    this.handlers = [];
    this.remote = remote;
    if (remote) {
      this.db = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      this.db.channel("esg-" + session)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "esg_events",
          filter: "session=eq." + session }, (msg) => this._emit(msg.new))
        .subscribe();
    } else {
      this.key = "esg:" + session;
      root.addEventListener("storage", (e) => {
        if (e.key !== this.key || !e.newValue) return;
        const all = JSON.parse(e.newValue);
        const old = e.oldValue ? JSON.parse(e.oldValue).length : 0;
        all.slice(old).forEach((ev) => this._emit(ev));
      });
    }
  }

  Store.prototype.on = function (fn) { this.handlers.push(fn); };
  Store.prototype._emit = function (ev) { this.handlers.forEach((h) => h(ev)); };

  Store.prototype._local = function () {
    try { return JSON.parse(localStorage.getItem(this.key) || "[]"); } catch (e) { return []; }
  };

  Store.prototype.put = async function (kind, team, round, payload) {
    const ev = { session: this.session, kind, team, round, payload, created_at: new Date().toISOString() };
    if (this.remote) {
      const { error } = await this.db.from("esg_events").insert(ev);
      if (error) throw error;
    } else {
      const all = this._local();
      ev.id = all.length + 1;
      all.push(ev);
      localStorage.setItem(this.key, JSON.stringify(all));
      this._emit(ev);
    }
  };

  // Latest state, or null.
  Store.prototype.latestState = async function () {
    if (this.remote) {
      const { data, error } = await this.db.from("esg_events").select("*")
        .eq("session", this.session).eq("kind", "state").order("id", { ascending: false }).limit(1);
      if (error) throw error;
      return data.length ? data[0].payload : null;
    }
    const st = this._local().filter((e) => e.kind === "state");
    return st.length ? st[st.length - 1].payload : null;
  };

  // All decisions and votes for a round, oldest first.
  Store.prototype.roundEvents = async function (round) {
    if (this.remote) {
      const { data, error } = await this.db.from("esg_events").select("*")
        .eq("session", this.session).in("kind", ["decision", "vote"]).eq("round", round)
        .order("id", { ascending: true });
      if (error) throw error;
      return data;
    }
    return this._local().filter((e) => (e.kind === "decision" || e.kind === "vote") && e.round === round);
  };

  root.ESGStore = Store;
})(this);
