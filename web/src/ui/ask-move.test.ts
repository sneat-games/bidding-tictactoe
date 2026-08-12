// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { Mark, emptyBoard, parseBoard } from "../engine/btttplay";
import { askMove } from "./ask-move";
import type { BidPanel } from "./bid-panel";
import { createMatchScreen } from "./match-screen";
import { LATE_BID_MS, STALL_MS, stallBid } from "./turn-clock";

function setup(board = emptyBoard()) {
  const root = document.createElement("div");
  document.body.append(root);
  const screen = createMatchScreen({
    root, initialBudget: 100, xLabel: "You (X)", oLabel: "Bot (O)",
  });
  screen.renderBoard(board);
  return { boardArea: screen.boardArea, bidPanel: screen.bidPanel, board };
}

function clickCell(boardArea: HTMLElement, cell: number) {
  boardArea.querySelector<HTMLButtonElement>(`.board__cell[data-cell="${cell}"]`)!.click();
}

function clockText(bidPanel: BidPanel): string {
  return bidPanel.el.querySelector("[data-auto-bid]")!.textContent ?? "";
}

function clockVisible(bidPanel: BidPanel): boolean {
  return !bidPanel.el.querySelector<HTMLElement>("[data-clock]")!.hidden;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("askMove — committing by hand", () => {
  it("resolves with the dialled-in bid and the clicked cell", async () => {
    const { boardArea, bidPanel, board } = setup();
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 100, opponentBalance: 100, opponentBidIn: true,
    });
    // beginTurn seeds the input at half the balance.
    expect(bidPanel.value()).toBe(50);
    clickCell(boardArea, 7);
    await expect(p).resolves.toEqual({ bid: 50, cell: 7 });
  });

  it("stops the clock once the player has committed", async () => {
    const { boardArea, bidPanel, board } = setup();
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 100, opponentBalance: 100, opponentBidIn: true,
    });
    expect(clockVisible(bidPanel)).toBe(true);
    clickCell(boardArea, 0);
    await p;
    expect(clockVisible(bidPanel)).toBe(false);
  });

  it("ignores clicks on occupied cells", async () => {
    // Cell 0 is taken; clicking it must not resolve the turn.
    const { boardArea, bidPanel, board } = setup(parseBoard("X________"));
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.O,
      ownBalance: 40, opponentBalance: 40, opponentBidIn: true,
    });
    clickCell(boardArea, 0);
    clickCell(boardArea, 3);
    await expect(p).resolves.toMatchObject({ cell: 3 });
  });
});

describe("askMove — the 10s answer clock", () => {
  it("defaults to a bid of 0 when the opponent's bid is already in", async () => {
    vi.useFakeTimers();
    const { boardArea, bidPanel, board } = setup();
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 100, opponentBalance: 100, opponentBidIn: true,
    });
    expect(clockText(bidPanel)).toContain("auto-bid 0");
    vi.advanceTimersByTime(LATE_BID_MS + 100);
    const move = await p;
    expect(move.bid).toBe(0);
    // The defaulted cell must still be a legal, empty square.
    expect(board[move.cell]).toBe(Mark.Empty);
  });

  it("holds until the clock actually expires", async () => {
    vi.useFakeTimers();
    const { boardArea, bidPanel, board } = setup();
    let settled = false;
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 100, opponentBalance: 100, opponentBidIn: true,
    }).then((m) => { settled = true; return m; });
    vi.advanceTimersByTime(LATE_BID_MS - 500);
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1_000);
    await p;
    expect(settled).toBe(true);
  });

  it("keeps the hand-made move when the player beats the clock", async () => {
    vi.useFakeTimers();
    const { boardArea, bidPanel, board } = setup();
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 100, opponentBalance: 100, opponentBidIn: true,
    });
    vi.advanceTimersByTime(LATE_BID_MS - 1_000);
    clickCell(boardArea, 4);
    vi.advanceTimersByTime(LATE_BID_MS * 3);
    await expect(p).resolves.toEqual({ bid: 50, cell: 4 });
  });
});

describe("askMove — the 30s stall cap", () => {
  it("waits the full stall window when neither side has bid", async () => {
    vi.useFakeTimers();
    const { boardArea, bidPanel, board } = setup();
    let settled = false;
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 100, opponentBalance: 100, opponentBidIn: false,
    }).then((m) => { settled = true; return m; });
    expect(clockText(bidPanel)).toContain(`auto-bid ${stallBid(100, 100)}`);
    vi.advanceTimersByTime(LATE_BID_MS + 1_000);
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(STALL_MS);
    const move = await p;
    expect(move.bid).toBe(stallBid(100, 100));
    expect(settled).toBe(true);
  });

  it("outbids by one when the silent player is richer", async () => {
    vi.useFakeTimers();
    const { boardArea, bidPanel, board } = setup();
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 160, opponentBalance: 40, opponentBidIn: false,
    });
    expect(clockText(bidPanel)).toContain("auto-bid 41");
    vi.advanceTimersByTime(STALL_MS + 100);
    await expect(p).resolves.toMatchObject({ bid: 41 });
  });
});

describe("askMove — the opponent bidding mid-turn", () => {
  it("replaces the stall cap with a fresh 10s answer clock", async () => {
    vi.useFakeTimers();
    const { boardArea, bidPanel, board } = setup();
    let opponentBid: (() => void) | undefined;
    let settled = false;
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 100, opponentBalance: 100, opponentBidIn: false,
      onOpponentBid: (fn) => { opponentBid = fn; return () => { opponentBid = undefined; }; },
    }).then((m) => { settled = true; return m; });

    // 25s in, still on the stall cap; then their bid lands.
    vi.advanceTimersByTime(25_000);
    expect(clockText(bidPanel)).toContain(`auto-bid ${stallBid(100, 100)}`);
    opponentBid!();
    expect(clockText(bidPanel)).toContain("auto-bid 0");

    // The original 30s deadline passes without firing — it was replaced.
    vi.advanceTimersByTime(6_000);
    await Promise.resolve();
    expect(settled).toBe(false);

    // The full 10s runs from when their bid landed.
    vi.advanceTimersByTime(LATE_BID_MS);
    await expect(p).resolves.toMatchObject({ bid: 0 });
  });

  it("unsubscribes once the turn is settled", async () => {
    const { boardArea, bidPanel, board } = setup();
    const unsubscribe = vi.fn();
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 100, opponentBalance: 100, opponentBidIn: false,
      onOpponentBid: () => unsubscribe,
    });
    clickCell(boardArea, 2);
    await p;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("starts on the answer clock when their bid arrived before the turn was rendered", async () => {
    vi.useFakeTimers();
    const { boardArea, bidPanel, board } = setup();
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 100, opponentBalance: 100, opponentBidIn: true,
    });
    vi.advanceTimersByTime(LATE_BID_MS + 100);
    await expect(p).resolves.toMatchObject({ bid: 0 });
  });
});

describe("askMove — bids stay inside the balance", () => {
  it("caps the dialled-in bid at the player's balance", async () => {
    const { boardArea, bidPanel, board } = setup();
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 7, opponentBalance: 100, opponentBidIn: true,
    });
    const number = bidPanel.el.querySelector<HTMLInputElement>(".bid-input__number")!;
    number.value = "999";
    number.dispatchEvent(new Event("input"));
    clickCell(boardArea, 1);
    await expect(p).resolves.toEqual({ bid: 7, cell: 1 });
  });

  it("defaults to 0 for a broke player rather than a negative bid", async () => {
    vi.useFakeTimers();
    const { boardArea, bidPanel, board } = setup();
    const p = askMove({
      boardArea, bidPanel, board, me: Mark.X,
      ownBalance: 0, opponentBalance: 100, opponentBidIn: false,
    });
    vi.advanceTimersByTime(STALL_MS + 100);
    await expect(p).resolves.toMatchObject({ bid: 0 });
  });
});
