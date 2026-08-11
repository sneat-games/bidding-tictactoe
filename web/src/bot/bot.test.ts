import { describe, it, expect } from "vitest";
import { botMove, __test } from "./bot";
import { Mark, parseBoard, boardOutcome, Outcome, newGame, resolveTurn } from "../engine/btttplay";

const { findWinningCell, pickCell } = __test;

describe("bot.findWinningCell", () => {
  it("finds the winning cell for X with two in a row", () => {
    const b = parseBoard("XX_______");
    expect(findWinningCell(b, Mark.X)).toBe(2);
  });
  it("returns undefined when the line is already complete (no empty cell)", () => {
    const b = parseBoard("O__O__O__");
    expect(findWinningCell(b, Mark.O)).toBeUndefined();
  });
  it("finds the winning cell for O on the anti-diagonal", () => {
    const b = parseBoard("__O_O____");
    expect(findWinningCell(b, Mark.O)).toBe(6);
  });
  it("returns undefined on an empty board", () => {
    const b = parseBoard("_________");
    expect(findWinningCell(b, Mark.X)).toBeUndefined();
  });
});

describe("bot.pickCell", () => {
  it("prefers the centre on an empty board", () => {
    const b = parseBoard("_________");
    expect(pickCell(b, Mark.X)).toBe(4);
  });
  it("takes a winning cell instead of the centre", () => {
    const b = parseBoard("XX_______");
    expect(pickCell(b, Mark.X)).toBe(2);
  });
  it("blocks the opponent's winning cell", () => {
    const b = parseBoard("OO_______");
    expect(pickCell(b, Mark.X)).toBe(2);
  });
});

describe("botMove produces legal moves", () => {
  it("returns a move within the empty cells and within budget", () => {
    const board = parseBoard("_________");
    const move = botMove({ board, budgetRemaining: 10, me: Mark.X });
    expect(move.bid).toBeGreaterThanOrEqual(0);
    expect(move.bid).toBeLessThanOrEqual(10);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8]).toContain(move.cell);
    expect(board[move.cell]).toBe(Mark.Empty);
  });
  it("bids the whole budget to win when a winning cell is available", () => {
    const board = parseBoard("XX_______");
    const move = botMove({ board, budgetRemaining: 5, me: Mark.X });
    expect(move.cell).toBe(2);
    expect(move.bid).toBe(5);
  });
  it("bids at least 1 when blocking an opponent's win", () => {
    const board = parseBoard("OO_______");
    const move = botMove({ board, budgetRemaining: 4, me: Mark.X });
    expect(move.cell).toBe(2);
    expect(move.bid).toBeGreaterThanOrEqual(1);
  });
  it("bids 0 when budget has run out", () => {
    const board = parseBoard("_________");
    const move = botMove({ board, budgetRemaining: 0, me: Mark.X });
    expect(move.bid).toBe(0);
  });
});

describe("vs-bot match loop ends in a terminal outcome", () => {
  it("X-bot vs O-bot reaches win/draw via real resolveTurn", () => {
    let g = newGame(50);
    let safety = 30;
    while (boardOutcome(g.board) === Outcome.Ongoing && safety-- > 0) {
      const xMove = botMove({ board: g.board, budgetRemaining: g.budget[0], me: Mark.X });
      const oMove = botMove({ board: g.board, budgetRemaining: g.budget[1], me: Mark.O });
      ({ game: g } = resolveTurn(g, xMove, oMove));
    }
    const final = boardOutcome(g.board);
    expect([Outcome.XWins, Outcome.OWins, Outcome.Draw]).toContain(final);
  });
});