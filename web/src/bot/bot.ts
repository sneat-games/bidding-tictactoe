// Bot strategy for Bidding Tic-Tac-Toe vs-bot mode.
//
// Baseline heuristic, intentionally simple. Under the first-price-TRANSFER
// rule (winner pays their bid to the loser; total budget is conserved),
// bidding the whole budget to win a single cell would gift that budget to
// the opponent — so the bid sizing is deliberately restrained:
//   - Bid: ~1/3 of remaining budget when bot has a winning cell, ~1/4 when
//     blocking the opponent's win, and a small jittered slice otherwise.
//     Zero budget -> bid 0 (rely on tie-break).
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

  // Under the first-price-TRANSFER rule, the winning bid is paid to the
  // loser. Bidding the whole budget to win a single cell gifts it to the
  // opponent — a losing strategy. So we bid enough to be likely to win the
  // auction without vaporising our bankroll:
  //   - Winning move available: bid ~1/3 of remaining (we want this cell).
  //   - Block opponent's win: bid ~1/4 of remaining (important but not
  //     as decisive as our own win).
  //   - Mid/early game: bid a small slice with jitter to keep play alive.
  if (myWin !== undefined) {
    return Math.max(1, Math.floor(budgetRemaining / 3));
  }
  if (oppWin !== undefined) {
    return Math.max(1, Math.floor(budgetRemaining / 4));
  }
  const base = Math.max(1, Math.floor(budgetRemaining / 6));
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