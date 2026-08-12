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
  it("bids about a third of remaining budget to win when a winning cell is available (first-price-transfer)", () => {
    const board = parseBoard("XX_______");
    const move = botMove({ board, budgetRemaining: 9, me: Mark.X });
    expect(move.cell).toBe(2);
    // 9 / 3 = 3 — bidding all-in would gift the budget to O.
    expect(move.bid).toBe(3);
  });
  it("bids about a quarter of remaining budget when blocking an opponent's win", () => {
    const board = parseBoard("OO_______");
    const move = botMove({ board, budgetRemaining: 8, me: Mark.X });
    expect(move.cell).toBe(2);
    expect(move.bid).toBe(2); // 8 / 4 = 2
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
describe("buying a match-deciding turn", () => {
  const { pickBid } = __test;

  it("outbids by exactly one to block a loss when richer", () => {
    // X threatens 0,1,2 — O must take cell 2 or lose the match.
    const board = parseBoard("XX_______");
    expect(pickBid(160, board, Mark.O, 40)).toBe(41);
  });

  it("outbids by exactly one to take the win when richer", () => {
    // O threatens 0,1,2 and can finish it now.
    const board = parseBoard("OO_______");
    expect(pickBid(160, board, Mark.O, 40)).toBe(41);
  });

  it("cannot be outbid by anything the opponent can afford", () => {
    const board = parseBoard("XX_______");
    for (let opp = 0; opp <= 60; opp++) {
      const bid = pickBid(opp + 5, board, Mark.O, opp);
      expect(bid).toBeGreaterThan(opp);
      expect(bid).toBeLessThanOrEqual(opp + 5);
    }
  });

  it("falls back to a fraction when it cannot outbid outright", () => {
    // Level balances: opponent+1 is unaffordable, so block proportionally.
    const board = parseBoard("XX_______");
    expect(pickBid(100, board, Mark.O, 100)).toBe(25);
    // Poorer still.
    expect(pickBid(40, board, Mark.O, 160)).toBe(10);
  });

  it("does not splurge on an ordinary midgame turn", () => {
    // Nobody is one move from winning, so the outbid rule must not fire.
    const board = parseBoard("X________");
    const bid = pickBid(160, board, Mark.O, 40);
    expect(bid).toBeLessThanOrEqual(Math.floor(160 / 6) + 1);
  });

  it("still bids nothing when broke", () => {
    const board = parseBoard("XX_______");
    expect(pickBid(0, board, Mark.O, 40)).toBe(0);
  });

  it("keeps the old shape when the opponent's budget is unknown", () => {
    const board = parseBoard("XX_______");
    expect(pickBid(160, board, Mark.O, Infinity)).toBe(40);
  });
});

describe("botMove wiring", () => {
  it("passes the opponent budget through to the bid", () => {
    const move = botMove({
      board: parseBoard("XX_______"),
      budgetRemaining: 160,
      me: Mark.O,
      opponentBudget: 40,
    });
    expect(move).toEqual({ bid: 41, cell: 2 });
  });
});
