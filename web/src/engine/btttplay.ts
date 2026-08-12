// Port of server-go/btttplay — the resolution engine for Bidding Tic-Tac-Toe,
// a two-player hidden-bid ("auction") variant of tic-tac-toe.
//
// This file is a faithful vanilla TypeScript mirror of the Go rule-of-record
// at ../../server-go/btttplay/btttplay.go. Any rule change in the Go package
// must trip a corresponding test on the TS side (see btttplay.test.ts, which
// mirrors btttplay_test.go fixture-for-fixture).
//
// # The rule
//
// Each turn both players secretly submit a Move: a Bid (staked from their
// per-match budget) and a target Cell. The HIGHER bid wins the turn — that
// player places their mark at their target cell. The winner PAYS their bid
// to the LOSER (the loser's budget grows by the winning bid); the loser
// keeps their own bid and their mark is not placed. The total budget across
// both players is therefore conserved across the whole match. Equal bids
// are decided by an ALTERNATING tie-break (the first tie goes to X, the
// next to O, and so on) so neither side keeps a permanent tie advantage.
// Three in a row wins; a board on which no line can still be completed
// (in particular a full board) is a draw.
//
// The engine is coin-agnostic: "budget" is a plain integer. Mapping coins
// onto a match (buy-in, pot, payout) is the session layer's job, exactly as
// greedplay stays separate from the coins wallet.

export const BOARD_CELLS = 9;

export const enum Mark {
  Empty = 0,
  X = 1,
  O = 2,
}

export function markString(m: Mark): string {
  switch (m) {
    case Mark.X:
      return "X";
    case Mark.O:
      return "O";
    default:
      return "_";
  }
}

export type Board = readonly Mark[]; // length 9, row-major

export function emptyBoard(): Board {
  return [Mark.Empty, Mark.Empty, Mark.Empty, Mark.Empty, Mark.Empty, Mark.Empty, Mark.Empty, Mark.Empty, Mark.Empty];
}

// LINES are the eight winning triples (rows, columns, diagonals). Exported
// read-only for the UI layer (see src/ui/win-line.ts), which highlights the
// winning triple at match end — it only ever reads this table, never
// re-derives or mutates the rule it encodes.
export const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6], // diagonals
];

export const enum Outcome {
  Ongoing = 0,
  XWins = 1,
  OWins = 2,
  Draw = 3,
}

export function outcomeString(o: Outcome): string {
  switch (o) {
    case Outcome.XWins:
      return "XWins";
    case Outcome.OWins:
      return "OWins";
    case Outcome.Draw:
      return "Draw";
    default:
      return "Ongoing";
  }
}

export function boardOutcome(b: Board): Outcome {
  for (const ln of LINES) {
    const a = b[ln[0]];
    if (a !== Mark.Empty && a === b[ln[1]] && a === b[ln[2]]) {
      if (a === Mark.X) return Outcome.XWins;
      return Outcome.OWins;
    }
  }
  // No winner yet: the game continues only while some line is still open to
  // a single player (contains no cell of the other player) AND the board
  // has room.
  let winnable = false;
  let full = true;
  for (const ln of LINES) {
    let hasX = false;
    let hasO = false;
    for (const i of ln) {
      if (b[i] === Mark.X) hasX = true;
      else if (b[i] === Mark.O) hasO = true;
    }
    if (!hasX || !hasO) winnable = true;
  }
  for (const c of b) {
    if (c === Mark.Empty) {
      full = false;
      break;
    }
  }
  if (!winnable || full) return Outcome.Draw;
  return Outcome.Ongoing;
}

export function boardString(b: Board): string {
  let out = "";
  for (const m of b) out += markString(m)[0];
  return out;
}

export function emptyCells(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < BOARD_CELLS; i++) {
    if (b[i] === Mark.Empty) out.push(i);
  }
  return out;
}

export class ParseBoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseBoardError";
  }
}

export function parseBoard(s: string): Board {
  if (s.length !== BOARD_CELLS) {
    throw new ParseBoardError("btttplay: board string must be 9 characters");
  }
  const b: Mark[] = emptyBoard().slice();
  for (let i = 0; i < BOARD_CELLS; i++) {
    switch (s.charCodeAt(i)) {
      case 88: // 'X'
        b[i] = Mark.X;
        break;
      case 79: // 'O'
        b[i] = Mark.O;
        break;
      case 95: // '_'
        b[i] = Mark.Empty;
        break;
      default:
        throw new ParseBoardError("btttplay: invalid board character");
    }
  }
  return b;
}

export interface Move {
  // Bid is the amount staked to win this turn (>= 0, must be <= the
  // player's remaining budget).
  bid: number;
  // Cell is the target cell 0..8. It is used only if the player wins the
  // turn, and must be Empty then.
  cell: number;
}

export interface Game {
  // Board is the current 3x3 position.
  board: Board;
  // Budget is the remaining auction budget for [X, O].
  budget: [number, number];
  // TieToX is which side the NEXT tied turn is awarded to. It flips every
  // time a tie-break is used, so the tie advantage alternates across the
  // match.
  tieToX: boolean;
}

export function newGame(budget: number): Game {
  return { board: emptyBoard(), budget: [budget, budget], tieToX: true };
}

export function isOver(g: Game): boolean {
  return boardOutcome(g.board) !== Outcome.Ongoing;
}

// Error classes mirror the Go sentinels (errors.Is semantics) so the TS code
// can use `instanceof` to discriminate.
export class GameOverError extends Error {
  constructor() {
    super("btttplay: game is already over");
    this.name = "GameOverError";
  }
}
export class BidNegativeError extends Error {
  constructor() {
    super("btttplay: bid must be >= 0");
    this.name = "BidNegativeError";
  }
}
export class BidExceedsBudgetError extends Error {
  constructor() {
    super("btttplay: bid exceeds remaining budget");
    this.name = "BidExceedsBudgetError";
  }
}
export class CellOutOfRangeError extends Error {
  constructor() {
    super("btttplay: target cell out of range");
    this.name = "CellOutOfRangeError";
  }
}
export class CellOccupiedError extends Error {
  constructor() {
    super("btttplay: target cell is occupied");
    this.name = "CellOccupiedError";
  }
}

export interface TurnResult {
  // Winner is the player who won the turn and placed a mark (X or O).
  winner: Mark;
  // Cell is the cell the winner took (0..8).
  cell: number;
  // Bid is what the winner paid — spent from their budget.
  bid: number;
  // TieBreak is true when the bids were equal and the alternating
  // tie-break decided the turn.
  tieBreak: boolean;
  // Outcome is the board outcome AFTER this turn.
  outcome: Outcome;
}

// resolveTurn resolves one turn from both players' hidden moves. It compares
// the bids (higher wins; equal bids use the alternating tie-break),
// validates the WINNER's move only (the loser's move is discarded — their
// mark is not placed and their own bid is returned to them), places the
// winning mark, TRANSFERS the winner's bid to the loser (so total budget
// is conserved across the match), and reports the resulting board
// outcome.
//
// Both bids must be non-negative and within the respective player's budget —
// a bid is a real commitment, so you cannot bid what you cannot afford. On
// any error the game is returned unchanged.
export function resolveTurn(
  g: Game,
  xMove: Move,
  oMove: Move,
): { game: Game; result: TurnResult } {
  if (isOver(g)) throw new GameOverError();
  if (xMove.bid < 0 || oMove.bid < 0) throw new BidNegativeError();
  if (xMove.bid > g.budget[0] || oMove.bid > g.budget[1]) {
    throw new BidExceedsBudgetError();
  }

  // Decide the winner without mutating state (so an invalid winner move
  // leaves the game — including the tie-break parity — unchanged).
  let winner: Mark;
  let tieBreak = false;
  if (xMove.bid > oMove.bid) {
    winner = Mark.X;
  } else if (oMove.bid > xMove.bid) {
    winner = Mark.O;
  } else {
    tieBreak = true;
    winner = g.tieToX ? Mark.X : Mark.O;
  }

  const win = winner === Mark.X ? xMove : oMove;
  const wi = winner === Mark.X ? 0 : 1;
  if (win.cell < 0 || win.cell >= BOARD_CELLS) throw new CellOutOfRangeError();
  if (g.board[win.cell] !== Mark.Empty) throw new CellOccupiedError();

  // Mutate a copy of the game.
  const board = g.board.slice();
  board[win.cell] = winner;
  const budget: [number, number] = [g.budget[0], g.budget[1]];
  // First-price-transfer: the winner pays their bid, and that bid is added
  // to the loser's budget. Total budget across both players is conserved
  // across the match.
  const li = wi === 0 ? 1 : 0;
  budget[wi] -= win.bid;
  budget[li] += win.bid;
  const tieToX = tieBreak ? !g.tieToX : g.tieToX;
  const next: Game = { board, budget, tieToX };
  const result: TurnResult = {
    winner,
    cell: win.cell,
    bid: win.bid,
    tieBreak,
    outcome: boardOutcome(board),
  };
  return { game: next, result };
}