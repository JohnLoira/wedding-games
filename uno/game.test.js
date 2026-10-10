const { test, expect } = require("bun:test");
const U = require("./game.js");

let clock = 0;
const ev = (t, pid, extra = {}) => ({ id: String(++clock).padStart(6, "0"), time: clock, t, pid, ...extra });
function lobby(...pids) { return pids.map((p, i) => ev("hello", p, { name: p.toUpperCase() })); }
function started(pids, seed = 7) { const log = lobby(...pids); log.push(ev("start", pids[0], { g: 0, seed })); return log; }
function cur(s) { return s.players[s.current]; }
function playable(s, pid) { return s.hands[pid].filter(c => U.canPlay(s, pid, c)); }

test("deck has 108 cards in the right mix", () => {
  expect(U.CARDS.length).toBe(108);
  const count = (f) => U.CARDS.filter(f).length;
  expect(count(c => c.color === "w")).toBe(8);
  expect(count(c => c.value === "wd4")).toBe(4);
  expect(count(c => c.color === "r")).toBe(25);
  expect(count(c => c.color === "r" && c.value === "0")).toBe(1);
  expect(count(c => c.color === "r" && c.value === "7")).toBe(2);
  expect(count(c => c.value === "skip")).toBe(8);
});

test("seats the first six hellos as players, the rest spectate, host is the first", () => {
  const s = U.replay(lobby("a", "b", "c", "d", "e", "f", "g"));
  expect(s.seats).toEqual(["a", "b", "c", "d", "e", "f"]);
  expect(s.host).toBe("a");
  expect(s.names.g).toBe("G");
  expect(s.round).toBe(-1);
});

test("start needs the host and at least two players; deals 7 each and flips a discard", () => {
  let s = U.replay([...lobby("a"), ev("start", "a", { g: 0, seed: 1 })]);
  expect(s.round).toBe(-1);
  s = U.replay([...lobby("a", "b", "c"), ev("start", "b", { g: 0, seed: 1 })]);
  expect(s.round).toBe(-1);
  s = U.replay(started(["a", "b", "c"]));
  expect(s.round).toBe(0);
  expect(s.players).toEqual(["a", "b", "c"]);
  for (const p of s.players) expect(s.hands[p].length).toBe(7);
  expect(s.discard.length).toBe(1);
  expect(U.CARDS[s.discard[0]].value).not.toBe("wd4");
  expect(s.deck.length + s.discard.length + 21).toBe(108);
  expect(s.over).toBe(false);
});

test("same seed deals the same cards on every device", () => {
  const a = U.replay(started(["a", "b"], 99)), b = U.replay(started(["a", "b"], 99)), c = U.replay(started(["a", "b"], 100));
  expect(a.hands).toEqual(b.hands);
  expect(a.hands).not.toEqual(c.hands);
});

test("a legal play matches color or value or is wild; illegal plays are ignored", () => {
  // find a seed where the current player has both a playable and an unplayable card
  for (let seed = 1; seed < 200; seed++) {
    const log = started(["a", "b", "c"], seed);
    const s = U.replay(log);
    const me = cur(s);
    const ok = playable(s, me), bad = s.hands[me].filter(c => !U.canPlay(s, me, c));
    if (!ok.length || !bad.length || U.CARDS[ok[0]].color === "w") continue;
    const badState = U.replay([...log, ev("play", me, { g: 0, n: s.moves, card: bad[0] })]);
    expect(badState.moves).toBe(s.moves);
    const wrongPlayer = U.replay([...log, ev("play", s.players[(s.current + 1) % 3], { g: 0, n: s.moves, card: s.hands[s.players[(s.current + 1) % 3]][0] })]);
    expect(wrongPlayer.moves).toBe(s.moves);
    const good = U.replay([...log, ev("play", me, { g: 0, n: s.moves, card: ok[0] })]);
    expect(good.moves).toBe(s.moves + 1);
    expect(good.hands[me].length).toBe(6);
    expect(good.discard[good.discard.length - 1]).toBe(ok[0]);
    expect(good.color).toBe(U.CARDS[ok[0]].color);
    return;
  }
  throw new Error("no suitable seed");
});

test("drawing gives one card; the drawn card may be played or the turn passed", () => {
  for (let seed = 1; seed < 300; seed++) {
    const log = started(["a", "b"], seed);
    const s = U.replay(log);
    const me = cur(s);
    log.push(ev("draw", me, { g: 0, n: s.moves }));
    const d = U.replay(log);
    expect(d.hands[me].length).toBe(8);
    expect(cur(d)).toBe(me);
    expect(d.drew).toBe(true);
    const drawn = d.hands[me][7];
    if (U.canPlay(d, me, drawn)) {
      // may not play a different card after drawing
      const other = d.hands[me].find(c => c !== drawn && U.canPlay({ ...d, drew: false }, me, c));
      if (other !== undefined) {
        const bad = U.replay([...log, ev("play", me, { g: 0, n: d.moves, card: other })]);
        expect(bad.moves).toBe(d.moves);
      }
      const p = U.replay([...log, ev("play", me, { g: 0, n: d.moves, card: drawn, color: "r" })]);
      expect(p.moves).toBe(d.moves + 1);
      expect(p.hands[me].length).toBe(7);
    } else {
      const bad = U.replay([...log, ev("play", me, { g: 0, n: d.moves, card: drawn })]);
      expect(bad.moves).toBe(d.moves);
    }
    const passed = U.replay([...log, ev("pass", me, { g: 0, n: d.moves })]);
    expect(passed.moves).toBe(d.moves + 1);
    expect(cur(passed)).not.toBe(me);
    expect(passed.drew).toBe(false);
    return;
  }
});

function forceHand(s, pid, cards) { s.hands[pid] = cards.slice(); return s; }
function cardId(color, value, nth = 0) { let k = 0; for (let i = 0; i < 108; i++) { const c = U.CARDS[i]; if (c.color === color && c.value === value) { if (k === nth) return i; k++; } } throw new Error("no card " + color + value); }

test("skip, reverse, draw two, wild and wild draw four do what they say", () => {
  const base = started(["a", "b", "c"], 5);
  let s = U.replay(base);
  // Put known cards into the current player's hand by injecting a test-only 'cheat' is not supported,
  // so instead search seeds for each action card among playable cards.
  const seen = {};
  for (let seed = 1; seed < 2000 && Object.keys(seen).length < 5; seed++) {
    const log = started(["a", "b", "c"], seed);
    const st = U.replay(log);
    const me = cur(st), nextIdx = (st.current + st.dir + 3) % 3, next = st.players[nextIdx];
    for (const c of playable(st, me)) {
      const v = U.CARDS[c].value;
      if (!["skip", "rev", "d2", "wild", "wd4"].includes(v) || seen[v]) continue;
      seen[v] = true;
      const after = U.replay([...log, ev("play", me, { g: 0, n: st.moves, card: c, color: "g" })]);
      if (v === "skip") { expect(cur(after)).toBe(st.players[(nextIdx + st.dir + 3) % 3]); }
      if (v === "rev") { expect(after.dir).toBe(-st.dir); expect(cur(after)).toBe(st.players[(st.current - st.dir + 3) % 3]); }
      if (v === "d2") { expect(after.hands[next].length).toBe(st.hands[next].length + 2); expect(cur(after)).toBe(st.players[(nextIdx + st.dir + 3) % 3]); }
      if (v === "wild") { expect(after.color).toBe("g"); expect(cur(after)).toBe(next); }
      if (v === "wd4") { expect(after.color).toBe("g"); expect(after.hands[next].length).toBe(st.hands[next].length + 4); expect(cur(after)).toBe(st.players[(nextIdx + st.dir + 3) % 3]); }
    }
  }
  expect(Object.keys(seen).sort()).toEqual(["d2", "rev", "skip", "wd4", "wild"]);
});

test("reverse with two players acts like skip", () => {
  for (let seed = 1; seed < 3000; seed++) {
    const log = started(["a", "b"], seed);
    const st = U.replay(log);
    const me = cur(st);
    const rev = playable(st, me).find(c => U.CARDS[c].value === "rev");
    if (rev === undefined) continue;
    const after = U.replay([...log, ev("play", me, { g: 0, n: st.moves, card: rev })]);
    expect(cur(after)).toBe(me);
    return;
  }
  throw new Error("no seed");
});

test("the draw pile reshuffles the discard pile when it runs out", () => {
  const log = started(["a", "b"], 3);
  let s = U.replay(log);
  // draw and pass repeatedly: 2 players, each draw takes one card; 94 cards in the deck
  let n = s.moves;
  for (let i = 0; i < 120; i++) {
    const me = cur(s);
    log.push(ev("draw", me, { g: 0, n: n++ }));
    log.push(ev("pass", me, { g: 0, n: n++ }));
    s = U.replay(log);
    if (s.over) break;
  }
  expect(s.reshuffles).toBeGreaterThanOrEqual(1);
  expect(s.deck.length + s.discard.length + s.hands.a.length + s.hands.b.length).toBe(108);
});

test("round ends when a hand empties; winner scores the others' cards; host starts the next round", () => {
  for (let seed = 1; seed < 500; seed++) {
    const log = started(["a", "b"], seed);
    let s = U.replay(log);
    // play greedily until someone wins
    let guard = 0;
    while (!s.over && guard++ < 400) {
      const me = cur(s);
      const ok = playable(s, me);
      if (ok.length) log.push(ev("play", me, { g: 0, n: s.moves, card: ok[0], color: "b" }));
      else if (!s.drew) log.push(ev("draw", me, { g: 0, n: s.moves }));
      else log.push(ev("pass", me, { g: 0, n: s.moves }));
      s = U.replay(log);
    }
    if (!s.over) continue;
    expect(s.hands[s.winner].length).toBe(0);
    const loser = s.players.find(p => p !== s.winner);
    const pts = s.hands[loser].reduce((a, c) => a + U.points(U.CARDS[c]), 0);
    expect(s.scores[s.winner]).toBe(pts);
    const frozen = U.replay([...log, ev("play", loser, { g: 0, n: s.moves, card: s.hands[loser][0] })]);
    expect(frozen.moves).toBe(s.moves);
    const next = U.replay([...log, ev("start", "a", { g: 1, seed: 11 })]);
    expect(next.round).toBe(1);
    expect(next.over).toBe(false);
    expect(next.hands.a.length).toBe(7);
    expect(next.scores[s.winner]).toBe(pts);
    const flip = U.CARDS[next.discard[0]];
    if (!["skip", "rev", "d2"].includes(flip.value)) expect(next.players[next.current]).toBe("b");   // first player rotates each round
    return;
  }
  throw new Error("no finished game found");
});

test("uno calls and catches", () => {
  for (let seed = 1; seed < 500; seed++) {
    const log = started(["a", "b"], seed);
    let s = U.replay(log);
    let guard = 0;
    while (!s.over && guard++ < 400) {
      const me = cur(s);
      if (s.hands[me].length === 2) {
        const ok = playable(s, me);
        if (ok.length) {
          const silent = U.replay([...log, ev("play", me, { g: 0, n: s.moves, card: ok[0], color: "r" })]);
          if (silent.over) break;
          expect(silent.hands[me].length).toBe(1);
          expect(silent.unoSafe[me]).toBe(false);
          const other = silent.players.find(p => p !== me);
          const caught = U.replay([...log, ev("play", me, { g: 0, n: s.moves, card: ok[0], color: "r" }), ev("catch", other, { g: 0, n: silent.moves, target: me })]);
          expect(caught.hands[me].length).toBe(3);
          expect(caught.unoSafe[me]).toBe(true);
          const called = U.replay([...log, ev("play", me, { g: 0, n: s.moves, card: ok[0], color: "r" }), ev("uno", me, { g: 0, n: silent.moves }), ev("catch", other, { g: 0, n: silent.moves, target: me })]);
          expect(called.hands[me].length).toBe(1);
          const early = U.replay([...log, ev("uno", me, { g: 0, n: s.moves }), ev("play", me, { g: 0, n: s.moves, card: ok[0], color: "r" }), ev("catch", other, { g: 0, n: silent.moves, target: me })]);
          expect(early.hands[me].length).toBe(1);
          return;
        }
      }
      const ok = playable(s, me);
      if (ok.length) log.push(ev("play", me, { g: 0, n: s.moves, card: ok[0], color: "b" }));
      else if (!s.drew) log.push(ev("draw", me, { g: 0, n: s.moves }));
      else log.push(ev("pass", me, { g: 0, n: s.moves }));
      s = U.replay(log);
    }
  }
  throw new Error("never reached a two-card hand with a playable card");
});

test("replay is independent of arrival order", () => {
  const log = started(["a", "b", "c"], 21);
  let s = U.replay(log);
  for (let i = 0; i < 12; i++) {
    const me = cur(s); const ok = playable(s, me);
    if (ok.length) log.push(ev("play", me, { g: 0, n: s.moves, card: ok[0], color: "y" }));
    else if (!s.drew) log.push(ev("draw", me, { g: 0, n: s.moves }));
    else log.push(ev("pass", me, { g: 0, n: s.moves }));
    s = U.replay(log);
  }
  const shuffled = U.replay(log.slice().reverse());
  expect(shuffled.hands).toEqual(s.hands);
  expect(shuffled.discard).toEqual(s.discard);
  expect(shuffled.moves).toBe(s.moves);
});
