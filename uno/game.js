/* Uno engine. Pure functions; every device replays the same sorted event log
   so all phones agree on hands, piles and turns. Browser: window.UNO. Bun: require. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UNO = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const COLORS = ["r", "g", "b", "y"];
  const MAX_PLAYERS = 6;
  const CARDS = [];
  for (const color of COLORS) {
    CARDS.push({ color, value: "0" });
    for (let rep = 0; rep < 2; rep++) {
      for (let v = 1; v <= 9; v++) CARDS.push({ color, value: String(v) });
      for (const value of ["skip", "rev", "d2"]) CARDS.push({ color, value });
    }
  }
  for (let i = 0; i < 4; i++) CARDS.push({ color: "w", value: "wild" });
  for (let i = 0; i < 4; i++) CARDS.push({ color: "w", value: "wd4" });
  CARDS.forEach((c, id) => { c.id = id; });

  function points(card) {
    if (card.value === "wild" || card.value === "wd4") return 50;
    if (card.value === "skip" || card.value === "rev" || card.value === "d2") return 20;
    return Number(card.value);
  }
  function isAction(card) { return ["skip", "rev", "d2", "wild", "wd4"].includes(card.value); }

  // ---------- deterministic randomness ----------
  function rand(state) {
    let a = (state | 0) + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
  }
  function shuffle(arr, rngState) {
    const a = arr.slice(); let r;
    for (let i = a.length - 1; i > 0; i--) {
      [r, rngState] = rand(rngState);
      const j = Math.floor(r * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return { arr: a, rng: rngState };
  }

  const cmpId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const num = (x, d) => (typeof x === "number" && isFinite(x) ? x : d);

  // ---------- state helpers ----------
  function fresh() {
    return {
      seats: [], host: null, names: {}, scores: {},
      round: -1, players: [], hands: {}, deck: [], discard: [], current: 0, dir: 1, color: null,
      drew: false, drawnCard: null, moves: 0, over: false, winner: null, unoSafe: {}, reshuffles: 0, rng: 1,
      feed: [],
    };
  }
  function note(state, entry) { state.feed.push(entry); if (state.feed.length > 8) state.feed.shift(); }
  function np(state) { return state.players.length; }
  function idx(state, k) { const n = np(state); return (((state.current + state.dir * k) % n) + n) % n; }
  function nextPlayer(state) { return state.players[idx(state, 1)]; }
  function topCard(state) { return CARDS[state.discard[state.discard.length - 1]]; }
  function fixSafe(state, pid) { state.unoSafe[pid] = !!(state.unoSafe[pid] && state.hands[pid].length <= 2); }

  function drawCards(state, pid, count) {
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      if (!state.deck.length) {
        state.reshuffles++;
        if (state.discard.length > 1) {
          const top = state.discard.pop();
          const res = shuffle(state.discard, state.rng);
          state.deck = res.arr; state.rng = res.rng; state.discard = [top];
        }
        if (!state.deck.length) break;
      }
      state.hands[pid].push(state.deck.pop()); drawn++;
    }
    fixSafe(state, pid);
    return drawn;
  }

  function startRound(state, g, seed) {
    state.round = g;
    state.players = state.seats.slice();
    state.rng = (num(seed, 1) | 0) || 1;
    const res = shuffle(CARDS.map(c => c.id), state.rng);
    state.deck = res.arr; state.rng = res.rng;
    state.hands = {}; state.unoSafe = {};
    for (const p of state.players) { state.hands[p] = []; state.unoSafe[p] = false; }
    for (let i = 0; i < 7; i++) for (const p of state.players) state.hands[p].push(state.deck.pop());
    let top = state.deck.pop();
    while (CARDS[top].value === "wd4") { state.deck.unshift(top); top = state.deck.pop(); }
    state.discard = [top];
    state.moves = 0; state.over = false; state.winner = null; state.drew = false; state.drawnCard = null; state.reshuffles = 0;
    state.dir = 1; state.current = g % np(state);
    const first = CARDS[top];
    state.color = first.color === "w" ? null : first.color;
    state.feed = [{ type: "start", round: g, card: top }];
    if (first.value === "skip") { note(state, { type: "skip", target: state.players[state.current] }); state.current = idx(state, 1); }
    else if (first.value === "rev") { state.dir = -1; state.current = idx(state, 1); note(state, { type: "reverse" }); }
    else if (first.value === "d2") { const t = state.players[state.current]; drawCards(state, t, 2); note(state, { type: "draw2", target: t }); state.current = idx(state, 1); }
  }

  function canPlay(state, pid, card) {
    if (state.round < 0 || state.over) return false;
    const hand = state.hands[pid];
    if (!hand || !hand.includes(card)) return false;
    if (state.drew && state.players[state.current] === pid && card !== state.drawnCard) return false;
    const c = CARDS[card];
    if (c.color === "w") return true;
    if (state.color === null) return true;
    return c.color === state.color || c.value === topCard(state).value;
  }

  function play(state, pid, card, chosenColor) {
    const hand = state.hands[pid];
    hand.splice(hand.indexOf(card), 1);
    state.discard.push(card);
    const c = CARDS[card];
    state.color = c.color === "w" ? (COLORS.includes(chosenColor) ? chosenColor : "r") : c.color;
    state.drew = false; state.drawnCard = null;
    fixSafe(state, pid);
    const entry = { type: "play", pid, card, color: state.color };
    let advanceBy = 1;
    if (c.value === "skip") { entry.skipped = nextPlayer(state); advanceBy = 2; }
    else if (c.value === "rev") { state.dir = -state.dir; entry.reversed = true; if (np(state) === 2) { entry.skipped = nextPlayer(state); advanceBy = 2; } }
    else if (c.value === "d2") { const t = nextPlayer(state); drawCards(state, t, 2); entry.target = t; entry.drawn = 2; advanceBy = 2; }
    else if (c.value === "wd4") { const t = nextPlayer(state); drawCards(state, t, 4); entry.target = t; entry.drawn = 4; advanceBy = 2; }
    note(state, entry);
    if (!hand.length) {
      state.over = true; state.winner = pid;
      let pts = 0; for (const p of state.players) if (p !== pid) for (const id of state.hands[p]) pts += points(CARDS[id]);
      state.scores[pid] = (state.scores[pid] || 0) + pts;
      note(state, { type: "win", pid, points: pts });
      return;
    }
    if (hand.length === 1) note(state, { type: "one", pid });
    state.current = idx(state, advanceBy);
  }

  function replay(events) {
    const state = fresh();
    const hellos = [], plays = [];
    for (const e of events) {
      if (!e || typeof e.pid !== "string" || typeof e.id !== "string") continue;
      if (e.t === "hello") hellos.push(e);
      else if (["start", "play", "draw", "pass", "uno", "catch"].includes(e.t)) plays.push(e);
    }
    hellos.sort((a, b) => (num(a.time, 0) - num(b.time, 0)) || cmpId(a, b));
    for (const e of hellos) {
      if (typeof e.name === "string" && e.name.trim()) state.names[e.pid] = e.name.trim().slice(0, 18);
      if (!state.seats.includes(e.pid) && state.seats.length < MAX_PLAYERS) state.seats.push(e.pid);
    }
    state.host = state.seats[0] || null;
    for (const p of state.seats) state.scores[p] = 0;

    const key = e => (e.t === "start" ? -1 : num(e.n, 0));
    plays.sort((a, b) => (num(a.g, 0) - num(b.g, 0)) || (key(a) - key(b)) || cmpId(a, b));
    for (const e of plays) {
      const g = num(e.g, 0);
      if (e.t === "start") {
        if (e.pid !== state.host || g !== state.round + 1 || (state.round >= 0 && !state.over) || state.seats.length < 2) continue;
        startRound(state, g, e.seed);
        continue;
      }
      if (state.round < 0 || g !== state.round || state.over) continue;
      if (!state.players.includes(e.pid)) continue;
      if (e.t === "uno") { if (state.hands[e.pid].length <= 2) { state.unoSafe[e.pid] = true; note(state, { type: "uno", pid: e.pid }); } continue; }
      if (e.t === "catch") {
        const t = e.target;
        if (typeof t !== "string" || t === e.pid || !state.hands[t] || state.hands[t].length !== 1 || state.unoSafe[t]) continue;
        drawCards(state, t, 2); state.unoSafe[t] = true;
        note(state, { type: "caught", pid: e.pid, target: t });
        continue;
      }
      if (num(e.n, -1) !== state.moves) continue;
      const me = state.players[state.current];
      if (e.pid !== me) continue;
      if (e.t === "draw") {
        if (state.drew) continue;
        const before = state.hands[me].length;
        drawCards(state, me, 1);
        state.drew = true; state.drawnCard = state.hands[me].length > before ? state.hands[me][state.hands[me].length - 1] : null;
        note(state, { type: "draw", pid: me });
        state.moves++;
      } else if (e.t === "pass") {
        if (!state.drew) continue;
        state.drew = false; state.drawnCard = null;
        note(state, { type: "pass", pid: me });
        state.current = idx(state, 1);
        state.moves++;
      } else if (e.t === "play") {
        const card = e.card | 0;
        if (!canPlay(state, me, card)) continue;
        play(state, me, card, e.color);
        state.moves++;
      }
    }
    return state;
  }

  return { CARDS, COLORS, MAX_PLAYERS, points, isAction, replay, canPlay, topCard };
});
