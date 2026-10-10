const { test, expect } = require("bun:test");
const C4 = require("./game.js");

let clock = 0;
const ev = (t, pid, extra = {}) => ({ id: String(++clock).padStart(6, "0"), time: clock, t, pid, ...extra });
// Build a legal-looking log the way the page does: each sender stamps the game index and move count it saw.
function game(...steps) {
  const log = [];
  let g = 0, n = 0;
  for (const [t, pid, c] of steps) {
    if (t === "hello") log.push(ev("hello", pid, typeof c === "string" ? { name: c } : {}));
    else if (t === "move") { log.push(ev("move", pid, { g, n, c })); n++; }
    else if (t === "badmove") log.push(ev("move", pid, { g, n, c }));   // wrong player, same n: must be ignored, n unchanged
    else if (t === "reset") { log.push(ev("reset", pid, { g })); g++; n = 0; }
  }
  return log;
}

test("empty board is 6 rows by 7 columns of null", () => {
  const b = C4.emptyBoard();
  expect(b.length).toBe(6);
  expect(b.every(r => r.length === 7 && r.every(x => x === null))).toBe(true);
});

test("drop lands on the lowest empty row and does not mutate", () => {
  const b = C4.emptyBoard();
  const r1 = C4.drop(b, 3, "R");
  expect(r1.row).toBe(5);
  expect(r1.board[5][3]).toBe("R");
  expect(b[5][3]).toBe(null);
  const r2 = C4.drop(r1.board, 3, "Y");
  expect(r2.row).toBe(4);
});

test("drop into a full column returns null", () => {
  let b = C4.emptyBoard();
  for (let i = 0; i < 6; i++) b = C4.drop(b, 0, i % 2 ? "R" : "Y").board;
  expect(C4.drop(b, 0, "R")).toBe(null);
});

test("detects horizontal, vertical and both diagonal wins", () => {
  let b = C4.emptyBoard();
  for (const c of [0, 1, 2, 3]) b = C4.drop(b, c, "R").board;
  expect(C4.winner(b, 5, 3).color).toBe("R");
  expect(C4.winner(b, 5, 3).cells.length).toBe(4);

  b = C4.emptyBoard();
  for (let i = 0; i < 4; i++) b = C4.drop(b, 6, "Y").board;
  expect(C4.winner(b, 2, 6).color).toBe("Y");

  // rising diagonal: R at (5,0) (4,1) (3,2) (2,3)
  b = C4.emptyBoard();
  const fill = (col, stack) => { for (const s of stack) b = C4.drop(b, col, s).board; };
  fill(0, ["R"]); fill(1, ["Y", "R"]); fill(2, ["Y", "Y", "R"]); fill(3, ["Y", "Y", "Y", "R"]);
  expect(C4.winner(b, 2, 3).color).toBe("R");

  // falling diagonal: R at (2,0) (3,1) (4,2) (5,3)
  b = C4.emptyBoard();
  fill(3, ["R"]); fill(2, ["Y", "R"]); fill(1, ["Y", "Y", "R"]); fill(0, ["Y", "Y", "Y", "R"]);
  expect(C4.winner(b, 2, 0).color).toBe("R");
});

test("no winner on an ordinary position", () => {
  let b = C4.emptyBoard();
  b = C4.drop(b, 0, "R").board; b = C4.drop(b, 1, "Y").board; b = C4.drop(b, 2, "R").board;
  expect(C4.winner(b, 5, 2)).toBe(null);
});

test("replay seats the first two distinct pids as R then Y, later ones spectate", () => {
  const s = C4.replay(game(["hello", "a", "Ann"], ["hello", "b"], ["hello", "a"], ["hello", "c"]));
  expect(s.seats).toEqual({ R: "a", Y: "b" });
  expect(s.names.a).toBe("Ann");
  expect(C4.seatOf(s, "c")).toBe(null);
});

test("replay applies legal moves in turn order and ignores illegal ones", () => {
  const s = C4.replay(game(
    ["hello", "a"], ["hello", "b"],
    ["badmove", "b", 0],   // not Y's turn: ignored
    ["move", "a", 0],      // R
    ["badmove", "a", 1],   // R again: ignored
    ["badmove", "c", 1],   // spectator: ignored
    ["move", "b", 1],      // Y
  ));
  expect(s.board[5][0]).toBe("R");
  expect(s.board[5][1]).toBe("Y");
  expect(s.moves).toBe(2);
  expect(s.turn).toBe("R");
});

test("replay detects a win, stops further moves, and reset alternates the starter", () => {
  const steps = [["hello", "a"], ["hello", "b"]];
  for (let i = 0; i < 3; i++) { steps.push(["move", "a", i]); steps.push(["move", "b", i]); }
  steps.push(["move", "a", 3]);
  let s = C4.replay(game(...steps));
  expect(s.winner).toBe("R");
  expect(s.over).toBe(true);
  expect(s.winCells.length).toBe(4);
  steps.push(["badmove", "b", 3]);
  s = C4.replay(game(...steps));
  expect(s.moves).toBe(7);
  const spectatorReset = game(...steps, ["reset", "c"]);   // spectator cannot reset
  expect(C4.replay(spectatorReset).over).toBe(true);
  steps.push(["reset", "b"]);
  s = C4.replay(game(...steps));
  expect(s.over).toBe(false);
  expect(s.moves).toBe(0);
  expect(s.gameIndex).toBe(1);
  expect(s.turn).toBe("Y");
  expect(s.score).toEqual({ R: 1, Y: 0 });
});

test("replay calls a full board a draw", () => {
  // Find a legal game that ends in a draw by random playout, then replay it.
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let drawMoves = null;
  for (let attempt = 0; attempt < 20000 && !drawMoves; attempt++) {
    let b = C4.emptyBoard(), turn = "R", moves = [], won = false;
    while (!C4.isFull(b)) {
      const open = [];
      for (let c = 0; c < 7; c++) if (b[0][c] === null) open.push(c);
      const c = open[Math.floor(rnd() * open.length)];
      const res = C4.drop(b, c, turn);
      b = res.board; moves.push(c);
      if (C4.winner(b, res.row, c)) { won = true; break; }
      turn = turn === "R" ? "Y" : "R";
    }
    if (!won) drawMoves = moves;
  }
  expect(drawMoves).not.toBe(null);
  expect(drawMoves.length).toBe(42);
  const steps = [["hello", "a"], ["hello", "b"]];
  drawMoves.forEach((c, i) => steps.push(["move", i % 2 === 0 ? "a" : "b", c]));
  const s = C4.replay(game(...steps));
  expect(s.moves).toBe(42);
  expect(s.over).toBe(true);
  expect(s.winner).toBe(null);
  expect(s.draws).toBe(1);
});

test("replay is independent of arrival order", () => {
  const steps = [["hello", "a", "Ann"], ["hello", "b", "Bob"], ["move", "a", 3], ["move", "b", 3], ["move", "a", 2], ["reset", "b"], ["move", "b", 0]];
  const log = game(...steps);
  const ordered = C4.replay(log);
  const shuffled = log.slice().reverse();
  const s = C4.replay(shuffled);
  expect(s.seats).toEqual(ordered.seats);
  expect(s.board).toEqual(ordered.board);
  expect(s.gameIndex).toBe(1);
  expect(s.moves).toBe(1);
  expect(s.board[5][0]).toBe("Y");
  // own hello arriving before cached history still seats by server time
  const late = [log[1], log[0], ...log.slice(2)];
  expect(C4.replay(late).seats).toEqual({ R: "a", Y: "b" });
});
