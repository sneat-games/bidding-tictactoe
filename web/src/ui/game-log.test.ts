// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { Mark, Outcome } from "../engine/btttplay";
import { createGameLog, type LogEntry } from "./game-log";

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  turn: 0,
  result: { winner: Mark.X, cell: 4, bid: 30, tieBreak: false, outcome: Outcome.Ongoing },
  xMove: { bid: 30, cell: 4 },
  oMove: { bid: 12, cell: 0 },
  budgetsBefore: [100, 100],
  budgetsAfter: [70, 130],
  ...over,
});

function log() {
  const l = createGameLog();
  document.body.append(l.el);
  return l;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("game log entries", () => {
  it("colours each bid bar by player, not by who won", () => {
    // The bars share the board's colour scheme, so a bar means the same thing
    // as the mark above it.
    const l = log();
    l.append(entry());
    const fills = [...l.el.querySelectorAll(".bar-fill")].map((f) => f.className);
    expect(fills[0]).toContain("bar-fill--x");
    expect(fills[1]).toContain("bar-fill--o");
  });

  it("keeps the same player colours when the other side wins", () => {
    const l = log();
    l.append(entry({
      result: { winner: Mark.O, cell: 0, bid: 12, tieBreak: false, outcome: Outcome.Ongoing },
    }));
    const fills = [...l.el.querySelectorAll(".bar-fill")].map((f) => f.className);
    expect(fills[0]).toContain("bar-fill--x");
    expect(fills[1]).toContain("bar-fill--o");
  });

  it("marks the winning bid by weight rather than by hue", () => {
    const l = log();
    l.append(entry());
    const rows = [...l.el.querySelectorAll(".game-log__bid")].map((r) => r.className);
    expect(rows[0]).toContain("game-log__bid--won");
    expect(rows[1]).toContain("game-log__bid--lost");
    expect(l.el.querySelectorAll(".game-log__bid-won-marker")).toHaveLength(1);
  });

  it("names the square instead of printing an index", () => {
    const l = log();
    l.append(entry());
    const head = l.el.querySelector(".game-log__entry-head")!.textContent!;
    expect(head).toContain("the centre");
    expect(head).not.toContain("cell 4");
  });

  it("badges a tie-break", () => {
    const l = log();
    l.append(entry({
      result: { winner: Mark.X, cell: 4, bid: 30, tieBreak: true, outcome: Outcome.Ongoing },
    }));
    expect(l.el.querySelector(".game-log__tie")!.textContent).toBe("tie");
  });

  it("sizes each bar against that player's own budget at the start of the turn", () => {
    const l = log();
    l.append(entry({ xMove: { bid: 25, cell: 4 }, budgetsBefore: [50, 200] }));
    const fills = [...l.el.querySelectorAll<HTMLElement>(".bar-fill")];
    expect(parseFloat(fills[0].style.width)).toBeCloseTo(50, 1);
    expect(parseFloat(fills[1].style.width)).toBeCloseTo(6, 0);
  });

  it("shows newest first", () => {
    const l = log();
    l.append(entry({ turn: 0 }));
    l.append(entry({ turn: 1 }));
    const heads = [...l.el.querySelectorAll(".game-log__entry-head")].map((e) => e.textContent);
    expect(heads[0]).toContain("T2");
    expect(heads[1]).toContain("T1");
  });

  it("clears on a rematch", () => {
    const l = log();
    l.append(entry());
    l.clear();
    expect(l.el.querySelectorAll(".game-log__entry")).toHaveLength(0);
  });
});
