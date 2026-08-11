// Bot strategy for Bidding Tic-Tac-Toe vs-bot mode.
//
// Baseline heuristic, intentionally simple:
//   - Bid: try to win a line if bot can complete one this turn (bid scales
//     with how close the line is); otherwise bid a small fraction of the
//     remaining budget to save it for later. If the budget is zero, bid 0
//     and rely on the tie-break.
//   - Cell: if there is a winning cell for the bot, take it. Else if there
//     is a winning cell for the opponent, block it. Else take the centre,
//     then a corner, then any open cell.
//
// Not deterministic by design; randomness is added across equivalent cells
// (see OPEN_QUESTION in the Feature spec: seeded determinism is deferred).

import { Mark, Board, Move, emptyCells } from "../engine/btttplay";

const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function findWinningCell(board: Board, me: Mark): number | undefined {
  for (const [a, b, c] of LINES) {
    const cells = [board[a], board[b], board[c]];
    const mine = cells.filter((x) => x === me).length;
    const emptyIdx = [a, b, c].find((i) => board[i] === (Mark.Empty as number));
    if (mine === 2 && emptyIdx !== undefined) return emptyIdx;
  }
  return undefined;
}

function pickCell(board: Board, me: Mark): number {
  const opponent: Mark = me === Mark.X ? Mark.O : Mark.X;
  const win = findWinningCell(board, me);
  if (win !== undefined) return win;
  const block = findWinningCell(board, opponent);
  if (block !== undefined) return block;
  const empties = emptyCells(board);
  if (empties.includes(4)) return 4; // centre first
  const corners = empties.filter((i) => i === 0 || i === 2 || i === 6 || i === 8);
  if (corners.length > 0) return corners[Math.floor(Math.random() * corners.length)];
  return empties[Math.floor(Math.random() * empties.length)];
}

function pickBid(budgetRemaining: number, board: Board, me: Mark): number {
  if (budgetRemaining <= 0) return 0;
  const opponent: Mark = me === Mark.X ? Mark.O : Mark.X;
  const myWin = findWinningCell(board, me);
  const oppWin = findWinningCell(board, opponent);
  if (myWin !== undefined) {
    // Win this turn: bid the whole budget if opponent blocks, otherwise
    // bid just enough that a reasonable opponent can't easily outbid. For the
    // baseline bot, bid the full remaining budget when a win is available.
    return budgetRemaining;
  }
  if (oppWin !== undefined) {
    // Must block — bid aggressively but leave 1 for future if possible.
    return Math.max(1, budgetRemaining - 1);
  }
  // Early/mid game: bid roughly half of remaining, with a little randomness
  // so play feels alive.
  const base = Math.floor(budgetRemaining / 2);
  const jitter = Math.floor(Math.random() * 3) - 1; // -1..+1
  return Math.max(0, Math.min(budgetRemaining, base + jitter));
}

export function botMove(state: {
  board: Board;
  budgetRemaining: number;
  me: Mark;
}): Move {
  const cell = pickCell(state.board, state.me);
  const bid = pickBid(state.budgetRemaining, state.board, state.me);
  return { bid, cell };
}

// Quick sanity test exports (run via vitest).
export const __test = { findWinningCell, pickCell, pickBid, LINES };