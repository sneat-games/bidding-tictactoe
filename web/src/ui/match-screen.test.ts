// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Mark, Outcome, parseBoard } from "../engine/btttplay";
import { createMatchScreen, matchOutcomeKind, renderMatchOver } from "./match-screen";

function screen() {
  const root = document.createElement("div");
  document.body.append(root);
  return createMatchScreen({ root, initialBudget: 100, xLabel: "You (X)", oLabel: "Bot (O)" });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("match screen layout", () => {
  it("lays out balances, bid panel, board and log in that order", () => {
    const s = screen();
    const regions = [...s.el.children].map((c) => c.className);
    expect(regions).toEqual(["match__balances", "match__bid", "match__board", "match__log"]);
  });

  it("puts the balances above the board and the bid panel above the log", () => {
    // Grid auto-placement fills row 1 then row 2 across two columns, so
    // source order is what pairs balances<->board and bid panel<->log.
    const s = screen();
    const [balances, bid, board, log] = [...s.el.children];
    expect(balances.querySelector("[data-balances]")).not.toBeNull();
    expect(bid.querySelector("[data-bid-panel]")).not.toBeNull();
    expect(board).toBe(s.boardArea);
    expect(log.querySelector("[data-game-log]")).not.toBeNull();
  });

  it("keeps the budget bars out of the game log", () => {
    const s = screen();
    const log = s.log.el;
    expect(log.querySelector("[data-balance]")).toBeNull();
    expect(s.balances.el.querySelectorAll("[data-balance]")).toHaveLength(2);
  });

  it("renders both balances against the initial budget", () => {
    const s = screen();
    const labels = [...s.balances.el.querySelectorAll(".balances__label")].map((e) => e.textContent);
    expect(labels).toEqual(["You (X): 100/100", "Bot (O): 100/100"]);
  });
});

describe("match screen bookkeeping", () => {
  const entry = {
    turn: 0,
    result: { winner: Mark.X, cell: 4, bid: 30, tieBreak: false, outcome: Outcome.Ongoing },
    xMove: { bid: 30, cell: 4 },
    oMove: { bid: 12, cell: 0 },
    budgetsBefore: [100, 100] as [number, number],
    budgetsAfter: [70, 130] as [number, number],
  };

  it("routes the post-turn budgets to the balances and the turn to the log", () => {
    const s = screen();
    s.appendTurn(entry);
    const labels = [...s.balances.el.querySelectorAll(".balances__label")].map((e) => e.textContent);
    expect(labels).toEqual(["You (X): 70/100", "Bot (O): 130/100"]);
    expect(s.log.el.querySelectorAll(".game-log__entry")).toHaveLength(1);
  });

  it("clamps a balance bar that has grown past the initial budget", () => {
    // The winner's bid is transferred to the loser, so a balance can exceed
    // the starting budget — the bar must fill, not overflow.
    const s = screen();
    s.appendTurn(entry);
    const fill = s.balances.el.querySelector<HTMLElement>(".bar-fill--o")!;
    expect(parseFloat(fill.style.width)).toBe(100);
  });

  it("resets balances, log and board for a rematch", () => {
    const s = screen();
    s.appendTurn(entry);
    s.renderBoard(parseBoard("X________"));
    s.reset();
    expect(s.log.el.querySelectorAll(".game-log__entry")).toHaveLength(0);
    expect(s.boardArea.querySelectorAll(".board")).toHaveLength(0);
    const labels = [...s.balances.el.querySelectorAll(".balances__label")].map((e) => e.textContent);
    expect(labels).toEqual(["You (X): 100/100", "Bot (O): 100/100"]);
  });
});

describe("the note under the board", () => {
  const note = (s: ReturnType<typeof screen>) =>
    s.boardArea.querySelector<HTMLElement>("[data-note]")!;

  it("starts hidden", () => {
    expect(note(screen()).hidden).toBe(true);
  });

  it("survives the next turn's board render", () => {
    // The turn result used to be wiped by the following turn's render, which
    // put it on screen for a single frame in every turn but the last.
    const s = screen();
    s.renderBoard(parseBoard("X________"));
    s.setNote("X won the turn, took cell 0, paid 30.");
    s.renderBoard(parseBoard("XO_______"));
    expect(note(s).hidden).toBe(false);
    expect(note(s).textContent).toBe("X won the turn, took cell 0, paid 30.");
  });

  it("replaces the previous note rather than appending", () => {
    const s = screen();
    s.setNote("first");
    s.setNote("second");
    expect(s.boardArea.querySelectorAll("[data-note]")).toHaveLength(1);
    expect(note(s).textContent).toBe("second");
  });

  it("switches styling between a result and an error", () => {
    const s = screen();
    s.setNote("X won the turn, took cell 0, paid 30.");
    expect(note(s).className).toBe("turn-result");
    s.setNote("Invalid move: bid exceeds remaining budget", "error");
    expect(note(s).className).toBe("error");
  });

  it("clears on a rematch", () => {
    const s = screen();
    s.setNote("X won the turn, took cell 0, paid 30.");
    s.reset();
    expect(note(s).hidden).toBe(true);
    expect(note(s).textContent).toBe("");
  });
});

describe("end-of-match controls", () => {
  it("keep to their own slot and clear on a rematch", () => {
    const s = screen();
    s.renderBoard(parseBoard("XOXOXOXOX"));
    s.controls.append(document.createElement("button"));
    expect(s.controls.children).toHaveLength(1);
    s.reset();
    expect(s.controls.children).toHaveLength(0);
  });
});

describe("board rendering", () => {
  it("disables occupied cells and leaves empty ones clickable", () => {
    const s = screen();
    s.renderBoard(parseBoard("XO_______"));
    const cells = [...s.boardArea.querySelectorAll<HTMLButtonElement>(".board__cell")];
    expect(cells).toHaveLength(9);
    expect(cells[0].disabled).toBe(true);
    expect(cells[1].disabled).toBe(true);
    expect(cells[2].disabled).toBe(false);
    expect(cells[0].textContent).toBe("X");
    expect(cells[2].textContent).toBe("");
  });

  it("replaces the previous board instead of stacking a second one", () => {
    const s = screen();
    s.renderBoard(parseBoard("X________"));
    s.renderBoard(parseBoard("XO_______"));
    expect(s.boardArea.querySelectorAll(".board")).toHaveLength(1);
  });
});

describe("layout stylesheet contract", () => {
  // jsdom applies no stylesheet, so the width guarantees in the ACs are
  // asserted against the CSS itself: the left column IS the board's width and
  // the right column is ONE width shared by the bid panel and the log.
  // `import.meta.url` is an http URL under jsdom, so resolve from the
  // workspace root vitest runs in instead.
  const css = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");

  it("derives the board width from the cell size and gap", () => {
    expect(css).toMatch(/--board-width:\s*calc\(3 \* var\(--cell-size\) \+ 2 \* var\(--cell-gap\)\)/);
  });

  it("sizes the match columns as board-width + one side width", () => {
    expect(css).toMatch(/\.match\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/grid-template-columns:\s*var\(--board-width\) var\(--side-width\)/);
  });

  it("collapses to a single column on narrow screens", () => {
    const wide = css.indexOf("@media (min-width: 720px)");
    expect(wide).toBeGreaterThan(-1);
    // The two-column rule is inside the media query, so the default is the
    // single-column stack.
    expect(css.indexOf("var(--board-width) var(--side-width)")).toBeGreaterThan(wide);
  });

  it("gives the board no horizontal auto-margin that would break the alignment", () => {
    const board = css.match(/\n\.board \{[^}]*\}/)![0];
    expect(board).not.toMatch(/margin:/);
  });
});

describe("end-of-match banner", () => {
  const opts = {
    you: Mark.X,
    budgets: [96, 104] as [number, number],
    youLabel: "You",
    themLabel: "Bot",
    initialBudget: 100,
  };

  it("names the result in the player's own terms, not the engine's", () => {
    // The engine calls this "OWins"; a player should never see that.
    const el = renderMatchOver({ ...opts, outcome: Outcome.OWins });
    const headline = el.querySelector("[data-headline]")!.textContent!;
    expect(headline).toBe("😔 Bot wins");
    expect(headline).not.toContain("OWins");
  });

  it("celebrates a win", () => {
    const el = renderMatchOver({ ...opts, outcome: Outcome.XWins });
    expect(el.querySelector("[data-headline]")!.textContent).toBe("🏆 You win!");
    expect(el.getAttribute("data-match-over")).toBe("win");
  });

  it("marks a draw", () => {
    const el = renderMatchOver({ ...opts, outcome: Outcome.Draw });
    expect(el.querySelector("[data-headline]")!.textContent).toBe("🤝 Draw");
    expect(el.getAttribute("data-match-over")).toBe("draw");
  });

  it("reads the outcome from the local player's side", () => {
    // Same board result, opposite seats.
    expect(matchOutcomeKind(Outcome.OWins, Mark.O)).toBe("win");
    expect(matchOutcomeKind(Outcome.OWins, Mark.X)).toBe("loss");
    expect(matchOutcomeKind(Outcome.XWins, Mark.X)).toBe("win");
    expect(matchOutcomeKind(Outcome.XWins, Mark.O)).toBe("loss");
    expect(matchOutcomeKind(Outcome.Draw, Mark.X)).toBe("draw");
  });

  it("shows each side's final balance under its own label", () => {
    const el = renderMatchOver({ ...opts, outcome: Outcome.OWins });
    const rows = [...el.querySelectorAll("[data-final-balance]")].map((r) => [
      r.querySelector(".match-over__balance-label")!.textContent,
      r.querySelector(".match-over__balance-value")!.textContent,
    ]);
    expect(rows).toEqual([["You", "96"], ["Bot", "104"]]);
  });

  it("puts the local player first regardless of seat", () => {
    const el = renderMatchOver({
      ...opts, you: Mark.O, budgets: [96, 104], themLabel: "Friend", outcome: Outcome.OWins,
    });
    const rows = [...el.querySelectorAll("[data-final-balance]")].map((r) => [
      r.querySelector(".match-over__balance-label")!.textContent,
      r.querySelector(".match-over__balance-value")!.textContent,
    ]);
    // As O, the local player's balance is budgets[1].
    expect(rows).toEqual([["You", "104"], ["Friend", "96"]]);
  });

  it("shows the movement from the starting budget with a real minus sign", () => {
    const el = renderMatchOver({ ...opts, outcome: Outcome.OWins });
    const deltas = [...el.querySelectorAll(".match-over__balance-delta")].map((d) => d.textContent);
    expect(deltas).toEqual(["−4", "+4"]);
  });

  it("omits the movement when a balance is unchanged", () => {
    const el = renderMatchOver({ ...opts, budgets: [100, 100], outcome: Outcome.Draw });
    expect(el.querySelectorAll(".match-over__balance-delta")).toHaveLength(0);
  });

  it("is announced to assistive tech", () => {
    const el = renderMatchOver({ ...opts, outcome: Outcome.XWins });
    expect(el.getAttribute("role")).toBe("status");
  });
});

describe("turn result line", () => {
  const s = () => screen();
  const win = { winner: Mark.X, cell: 4, bid: 26, tieBreak: false, outcome: Outcome.Ongoing };

  it("names the winner with a colour-coded mark chip", () => {
    const m = s();
    m.setTurnResult(win, Mark.X, "Bot");
    const chip = m.boardArea.querySelector("[data-note] .mark")!;
    expect(chip.textContent).toBe("X");
    expect(chip.classList.contains("mark--x")).toBe(true);
  });

  it("speaks from the local player's side", () => {
    const mine = s();
    mine.setTurnResult(win, Mark.X, "Bot");
    expect(mine.boardArea.querySelector("[data-note]")!.textContent).toContain("You took");

    const theirs = s();
    theirs.setTurnResult(win, Mark.O, "Bot");
    expect(theirs.boardArea.querySelector("[data-note]")!.textContent).toContain("Bot took");
  });

  it("names the square instead of printing an index", () => {
    const m = s();
    m.setTurnResult(win, Mark.X, "Bot");
    const text = m.boardArea.querySelector("[data-note]")!.textContent!;
    expect(text).toContain("the centre");
    expect(text).not.toContain("cell 4");
  });

  it("emphasises the square and the price", () => {
    const m = s();
    m.setTurnResult(win, Mark.X, "Bot");
    const strongs = [...m.boardArea.querySelectorAll("[data-note] strong")].map((e) => e.textContent);
    expect(strongs).toEqual(["the centre", "26"]);
  });

  it("badges a tie-break, and only then", () => {
    const plain = s();
    plain.setTurnResult(win, Mark.X, "Bot");
    expect(plain.boardArea.querySelector("[data-note] .badge--tie")).toBeNull();

    const tied = s();
    tied.setTurnResult({ ...win, tieBreak: true }, Mark.X, "Bot");
    expect(tied.boardArea.querySelector("[data-note] .badge--tie")!.textContent).toBe("tie-break");
  });

  it("replaces the previous turn's line rather than appending to it", () => {
    const m = s();
    m.setTurnResult(win, Mark.X, "Bot");
    m.setTurnResult({ ...win, winner: Mark.O, cell: 0, bid: 9 }, Mark.X, "Bot");
    expect(m.boardArea.querySelectorAll("[data-note] .mark")).toHaveLength(1);
    const text = m.boardArea.querySelector("[data-note]")!.textContent!;
    expect(text).toContain("Bot took");
    expect(text).toContain("top left");
  });
});

describe("board marks", () => {
  it("colour-codes X and O and leaves empties blank", () => {
    const m = screen();
    m.renderBoard(parseBoard("XO_______"));
    const cells = [...m.boardArea.querySelectorAll<HTMLButtonElement>(".board__cell")];
    expect(cells[0].dataset.mark).toBe("X");
    expect(cells[1].dataset.mark).toBe("O");
    // "_" is a debugging glyph, not a game piece.
    expect(cells[2].textContent).toBe("");
    expect(cells[2].dataset.mark).toBeUndefined();
  });

  it("rings the most recent move, and only it", () => {
    const m = screen();
    m.renderBoard(parseBoard("XO_______"), 1);
    const ringed = [...m.boardArea.querySelectorAll(".board__cell--last")];
    expect(ringed).toHaveLength(1);
    expect((ringed[0] as HTMLElement).dataset.cell).toBe("1");
  });

  it("rings nothing when no last move is given", () => {
    const m = screen();
    m.renderBoard(parseBoard("XO_______"));
    expect(m.boardArea.querySelectorAll(".board__cell--last")).toHaveLength(0);
  });

  it("labels every square for screen readers", () => {
    const m = screen();
    m.renderBoard(parseBoard("X________"));
    const cells = [...m.boardArea.querySelectorAll<HTMLButtonElement>(".board__cell")];
    expect(cells[0].getAttribute("aria-label")).toBe("X on top left");
    expect(cells[4].getAttribute("aria-label")).toBe("Play the centre");
  });
});

describe("player colours", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");

  it("gives each player one colour, green for X and red for O", () => {
    expect(css).toMatch(/--x-colour:\s*#22c55e/);
    expect(css).toMatch(/--o-colour:\s*#ef4444/);
  });

  it("uses that same colour on the board, the balance bar and in prose", () => {
    expect(css).toMatch(/\.board__cell\[data-mark="X"\]\s*\{\s*color:\s*var\(--x-colour\)/);
    expect(css).toMatch(/\.board__cell\[data-mark="O"\]\s*\{\s*color:\s*var\(--o-colour\)/);
    expect(css).toMatch(/\.bar-fill--x\s*\{\s*background:\s*var\(--x-colour\)/);
    expect(css).toMatch(/\.bar-fill--o\s*\{\s*background:\s*var\(--o-colour\)/);
    expect(css).toMatch(/\.mark--x\s*\{\s*color:\s*var\(--x-colour\)/);
    expect(css).toMatch(/\.mark--o\s*\{\s*color:\s*var\(--o-colour\)/);
  });

  it("never leaves colour carrying meaning on its own", () => {
    // Every coloured mark is also written out as the letter, so red/green
    // vision deficiency loses nothing.
    const s = screen();
    s.renderBoard(parseBoard("XO_______"));
    const cells = [...s.boardArea.querySelectorAll<HTMLButtonElement>(".board__cell")];
    expect(cells[0].textContent).toBe("X");
    expect(cells[1].textContent).toBe("O");
  });
});
