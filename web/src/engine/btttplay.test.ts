// Port of server-go/btttplay/btttplay_test.go — same cases, same assertions.
// Any rule change in the Go package must trip a corresponding failure here.
import { describe, it, expect } from "vitest";
import {
  Mark,
  Outcome,
  boardOutcome,
  parseBoard,
  boardString,
  emptyCells,
  newGame,
  resolveTurn,
  GameOverError,
  BidNegativeError,
  BidExceedsBudgetError,
  CellOutOfRangeError,
  CellOccupiedError,
  markString,
  outcomeString,
  ParseBoardError,
} from "./btttplay";

describe("Board.outcome", () => {
  const cases: Array<[string, string, Outcome]> = [
    ["empty", "_________", Outcome.Ongoing],
    ["x-top-row", "XXX______", Outcome.XWins],
    ["o-middle-row", "___OOO___", Outcome.OWins],
    ["x-left-col", "X__X__X__", Outcome.XWins],
    ["o-right-col", "__O__O__O", Outcome.OWins],
    ["x-main-diag", "X___X___X", Outcome.XWins],
    ["o-anti-diag", "__O_O_O__", Outcome.OWins],
    ["full-draw", "XOXXOOOXX", Outcome.Draw],
    ["early-draw-with-empty", "OXOX_OXOX", Outcome.Draw], // every line blocked, centre empty
    ["ongoing", "X_______O", Outcome.Ongoing],
  ];
  for (const [name, board, want] of cases) {
    it(name, () => {
      expect(boardOutcome(parseBoard(board))).toBe(want);
    });
  }
});

describe("Board string/parse round-trip", () => {
  for (const s of ["_________", "XOX__O__X", "XOXXOOOXX"]) {
    it(s, () => {
      expect(boardString(parseBoard(s))).toBe(s);
    });
  }
});

describe("parseBoard invalid", () => {
  it("rejects a short string", () => {
    expect(() => parseBoard("XOX")).toThrow(ParseBoardError);
  });
  it("rejects an invalid character", () => {
    expect(() => parseBoard("XOXXOOOX?")).toThrow(ParseBoardError);
  });
});

describe("Board.emptyCells", () => {
  it("returns indexes in order", () => {
    const b = parseBoard("X_O__X_O_");
    expect(emptyCells(b)).toEqual([1, 3, 4, 6, 8]);
  });
});

describe("resolveTurn higher-bid wins, places and transfers", () => {
  it("X wins the turn, pays the bid to O", () => {
    const g = newGame(10);
    const { game: next, result } = resolveTurn(g, { bid: 5, cell: 0 }, { bid: 3, cell: 4 });
    expect(result.winner).toBe(Mark.X);
    expect(result.cell).toBe(0);
    expect(result.bid).toBe(5);
    expect(result.tieBreak).toBe(false);
    expect(next.board[0]).toBe(Mark.X);
    expect(next.budget[0]).toBe(5); // paid the bid
    expect(next.budget[1]).toBe(15); // received 5 from X: 10 + 5
    expect(next.budget[0] + next.budget[1]).toBe(20); // total conserved
    expect(result.outcome).toBe(Outcome.Ongoing);
  });
});

describe("resolveTurn tie-break alternates", () => {
  it("first tie -> X (X transfers 5 to O), second tie -> O (O transfers 4 to X)", () => {
    let g = newGame(10); // tieToX = true
    let res;
    ({ game: g, result: res } = resolveTurn(g, { bid: 5, cell: 0 }, { bid: 5, cell: 1 }));
    expect(res.tieBreak).toBe(true);
    expect(res.winner).toBe(Mark.X);
    expect(g.tieToX).toBe(false);
    expect(g.budget).toEqual([5, 15]); // X transferred 5 to O

    ({ game: g, result: res } = resolveTurn(g, { bid: 4, cell: 2 }, { bid: 4, cell: 3 }));
    expect(res.tieBreak).toBe(true);
    expect(res.winner).toBe(Mark.O);
    expect(g.board[3]).toBe(Mark.O);
    expect(g.budget).toEqual([9, 11]); // O transferred 4 to X
    expect(g.tieToX).toBe(true);
    expect(g.budget[0] + g.budget[1]).toBe(20); // total conserved
  });
});

describe("resolveTurn errors", () => {
  it("rejects negative bid", () => {
    const g = newGame(10);
    expect(() => resolveTurn(g, { bid: -1, cell: 0 }, { bid: 1, cell: 0 })).toThrow(BidNegativeError);
  });
  it("rejects over-budget bid", () => {
    const g = newGame(10);
    expect(() => resolveTurn(g, { bid: 11, cell: 0 }, { bid: 1, cell: 1 })).toThrow(BidExceedsBudgetError);
  });
  it("rejects out-of-range cell", () => {
    const g = newGame(10);
    expect(() => resolveTurn(g, { bid: 5, cell: 9 }, { bid: 1, cell: 0 })).toThrow(CellOutOfRangeError);
  });
  it("rejects occupied cell", () => {
    let g = newGame(10);
    ({ game: g } = resolveTurn(g, { bid: 5, cell: 0 }, { bid: 1, cell: 4 }));
    expect(() => resolveTurn(g, { bid: 3, cell: 0 }, { bid: 1, cell: 5 })).toThrow(CellOccupiedError);
  });
});

describe("resolveTurn error leaves game unchanged", () => {
  it("invalid winner cell leaves board/budgets/tie parity intact", () => {
    let g = newGame(10);
    ({ game: g } = resolveTurn(g, { bid: 5, cell: 0 }, { bid: 5, cell: 1 })); // tie -> flips tieToX
    const before = { ...g, board: [...g.board], budget: [...g.budget] as [number, number] };
    expect(() => resolveTurn(g, { bid: 2, cell: 0 }, { bid: 1, cell: 3 })).toThrow(CellOccupiedError);
    // Game state passed in was never mutated by resolveTurn (it copies); the test
    // documents that an error path does not silently mutate the caller's game.
    expect(g.board).toEqual(before.board);
    expect(g.budget).toEqual(before.budget);
    expect(g.tieToX).toBe(before.tieToX);
  });
});

describe("resolveTurn game over", () => {
  it("X wins the top row over three turns; further turn errors", () => {
    let g = newGame(100);
    for (const cell of [0, 1, 2]) {
      ({ game: g } = resolveTurn(g, { bid: 5, cell }, { bid: 1, cell: 4 }));
    }
    expect(boardOutcome(g.board)).toBe(Outcome.XWins);
    expect(g.board).toBeDefined();
    expect(() => resolveTurn(g, { bid: 1, cell: 5 }, { bid: 1, cell: 6 })).toThrow(GameOverError);
  });
});

describe("resolveTurn budget runs out", () => {
  it("a player who transfers away everything can still bid 0 (only wins via tie-break)", () => {
    let g = newGame(5);
    ({ game: g } = resolveTurn(g, { bid: 5, cell: 0 }, { bid: 0, cell: 4 }));
    expect(g.budget[0]).toBe(0); // X paid 5 to O
    expect(g.budget[1]).toBe(10); // O received 5: 5 + 5
    let res;
    ({ game: g, result: res } = resolveTurn(g, { bid: 0, cell: 1 }, { bid: 1, cell: 4 }));
    expect(res.winner).toBe(Mark.O);
    expect(g.board[4]).toBe(Mark.O);
    // O transferred 1 to X: [0, 10] -> [1, 9]
    expect(g.budget).toEqual([1, 9]);
    // Bidding more than the (now 1) budget must error.
    expect(() => resolveTurn(g, { bid: 2, cell: 1 }, { bid: 0, cell: 2 })).toThrow(BidExceedsBudgetError);
  });
});

describe("Mark.String", () => {
  it("renders X / O / _", () => {
    expect(markString(Mark.X)).toBe("X");
    expect(markString(Mark.O)).toBe("O");
    expect(markString(Mark.Empty)).toBe("_");
  });
});

describe("Outcome.String", () => {
  it("renders all states", () => {
    expect(outcomeString(Outcome.Ongoing)).toBe("Ongoing");
    expect(outcomeString(Outcome.XWins)).toBe("XWins");
    expect(outcomeString(Outcome.OWins)).toBe("OWins");
    expect(outcomeString(Outcome.Draw)).toBe("Draw");
  });
});