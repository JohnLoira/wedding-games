/* Connect Four engine. Pure functions; the page derives all state by
   replaying an ordered event log so every device converges on the
   same board. Works in the browser (window.C4) and in Bun tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.C4 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const ROWS = 6, COLS = 7;

  function emptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function drop(board, col, color) {
    if (col < 0 || col >= COLS) return null;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r][col] === null) {
        const next = board.map(row => row.slice());
        next[r][col] = color;
        return { board: next, row: r };
      }
    }
    return null;
  }

  function winner(board, row, col) {
    const color = board[row] && board[row][col];
    if (!color) return null;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      const cells = [[row, col]];
      for (const sign of [1, -1]) {
        let r = row + dr * sign, c = col + dc * sign;
        while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === color) {
          cells.push([r, c]);
          r += dr * sign; c += dc * sign;
        }
      }
      if (cells.length >= 4) return { color, cells };
    }
    return null;
  }

  function isFull(board) {
    return board[0].every(x => x !== null);
  }

  function freshGame(gameIndex) {
    return {
      board: emptyBoard(),
      turn: gameIndex % 2 === 0 ? "R" : "Y",
      moves: 0,
      winner: null,
      winCells: [],
      over: false,
      lastMove: null,
      gameIndex,
    };
  }

  function seatOf(state, pid) {
    if (state.seats.R === pid) return "R";
    if (state.seats.Y === pid) return "Y";
    return null;
  }

  /* events arrive in no reliable order (a relay may deliver a fresh message
     before cached history), so replay sorts them deterministically:
       hello  {id, time, pid, name?}            ordered by (time, id)
       move   {id, pid, g, n, c}                ordered by (g, n, id)
       reset  {id, pid, g}                      ordered after game g's moves
     g = game index the sender saw, n = move count the sender saw. Every
     device sorting the same set reaches the same board. */
  function cmpId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
  function num(x, d) { return typeof x === "number" && isFinite(x) ? x : d; }

  function replay(events) {
    const state = Object.assign(
      { seats: { R: null, Y: null }, names: {}, score: { R: 0, Y: 0 }, draws: 0 },
      freshGame(0)
    );
    const hellos = [], plays = [];
    for (const e of events) {
      if (!e || typeof e.pid !== "string" || typeof e.id !== "string") continue;
      if (e.t === "hello") hellos.push(e);
      else if (e.t === "move" || e.t === "reset") plays.push(e);
    }
    hellos.sort((a, b) => (num(a.time, 0) - num(b.time, 0)) || cmpId(a, b));
    for (const e of hellos) {
      if (typeof e.name === "string" && e.name.trim()) state.names[e.pid] = e.name.trim().slice(0, 18);
      if (!seatOf(state, e.pid)) {
        if (!state.seats.R) state.seats.R = e.pid;
        else if (!state.seats.Y) state.seats.Y = e.pid;
      }
    }
    const key = e => e.t === "reset" ? Number.MAX_SAFE_INTEGER : num(e.n, 0);
    plays.sort((a, b) => (num(a.g, 0) - num(b.g, 0)) || (key(a) - key(b)) || cmpId(a, b));
    for (const e of plays) {
      if (num(e.g, 0) !== state.gameIndex) continue;
      const seat = seatOf(state, e.pid);
      if (!seat) continue;
      if (e.t === "move") {
        if (num(e.n, -1) !== state.moves || seat !== state.turn || state.over) continue;
        const res = drop(state.board, e.c | 0, seat);
        if (!res) continue;
        state.board = res.board;
        state.moves += 1;
        state.lastMove = { row: res.row, col: e.c | 0, color: seat };
        const w = winner(state.board, res.row, e.c | 0);
        if (w) {
          state.winner = seat; state.winCells = w.cells; state.over = true;
          state.score[seat] += 1;
        } else if (isFull(state.board)) {
          state.over = true; state.draws += 1;
        } else {
          state.turn = seat === "R" ? "Y" : "R";
        }
      } else {
        Object.assign(state, freshGame(state.gameIndex + 1));
      }
    }
    return state;
  }

  return { ROWS, COLS, emptyBoard, drop, winner, isFull, replay, seatOf };
});
