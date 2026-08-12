// The match screen both modes render into: one 2x2 grid.
//
//   ┌──────────────┬──────────────┐
//   │ balances     │ bid panel    │
//   ├──────────────┼──────────────┤
//   │ board        │ game log     │
//   └──────────────┴──────────────┘
//
// The left column is exactly the board's width, so the balances card and the
// board line up; the right column is one fixed width, so the bid panel and
// the game log line up. Below 720px the grid collapses to a single column in
// this same source order (see .match in global.css).
//
// The left column keeps three stable slots — the board, a note line, and the
// end-of-match controls. Only the board is rebuilt per turn: a note wiped by
// the next turn's render would be on screen for a single frame, which is how
// the turn result used to go unread in every turn but the last.

import { Board, Mark, TurnResult, markString } from "../engine/btttplay";
import { createBalances, type Balances } from "./balances";
import { createBidPanel, type BidPanel } from "./bid-panel";
import { createGameLog, type GameLog, type LogEntry } from "./game-log";

export interface MatchScreen {
  el: HTMLElement;
  balances: Balances;
  bidPanel: BidPanel;
  log: GameLog;
  /** Holds the board — what `askMove` queries for clickable cells. */
  boardArea: HTMLElement;
  /** Where the end-of-match banner and buttons go. */
  controls: HTMLElement;
  /** Draw the board, replacing the previous one and nothing else. */
  renderBoard(board: Board): void;
  /** Set the line under the board. It survives until the next call. */
  setNote(text: string, kind?: "result" | "error"): void;
  /** Record a resolved turn: updates the balances and prepends to the log. */
  appendTurn(entry: LogEntry): void;
  /** Reset for a rematch. */
  reset(): void;
}

export function createMatchScreen(opts: {
  root: HTMLElement;
  initialBudget: number;
  xLabel: string;
  oLabel: string;
}): MatchScreen {
  const el = document.createElement("div");
  el.className = "match";

  const balances = createBalances({
    initialBudget: opts.initialBudget,
    xLabel: opts.xLabel,
    oLabel: opts.oLabel,
  });
  const bidPanel = createBidPanel();
  const log = createGameLog();

  const boardArea = document.createElement("div");
  boardArea.className = "match__board";

  const boardSlot = document.createElement("div");
  boardSlot.className = "match__board-slot";

  const note = document.createElement("p");
  note.className = "turn-result";
  note.setAttribute("data-note", "");
  note.hidden = true;

  const controls = document.createElement("div");
  controls.className = "match__controls";

  boardArea.append(boardSlot, note, controls);

  // Source order is the mobile stacking order.
  el.append(
    wrap("match__balances", balances.el),
    wrap("match__bid", bidPanel.el),
    boardArea,
    wrap("match__log", log.el),
  );

  opts.root.innerHTML = "";
  opts.root.append(el);

  function setNote(text: string, kind: "result" | "error" = "result") {
    note.hidden = false;
    note.className = kind === "error" ? "error" : "turn-result";
    note.textContent = text;
  }

  return {
    el,
    balances,
    bidPanel,
    log,
    boardArea,
    controls,
    renderBoard: (board) => renderInto(boardSlot, board),
    setNote,
    appendTurn(entry) {
      balances.update(entry.budgetsAfter);
      log.append(entry);
    },
    reset() {
      balances.update([opts.initialBudget, opts.initialBudget]);
      log.clear();
      boardSlot.innerHTML = "";
      controls.innerHTML = "";
      note.hidden = true;
      note.textContent = "";
    },
  };
}

function wrap(className: string, child: HTMLElement): HTMLElement {
  const div = document.createElement("div");
  div.className = className;
  div.append(child);
  return div;
}

/**
 * Draw the 3x3 board. Occupied cells are disabled, so `askMove` only ever
 * wires up the legal ones.
 */
function renderInto(slot: HTMLElement, board: Board): void {
  slot.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "board";
  grid.setAttribute("role", "grid");
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "board__cell";
    cell.setAttribute("data-cell", String(i));
    cell.textContent = markString(board[i]);
    if (board[i] !== Mark.Empty) cell.disabled = true;
    grid.appendChild(cell);
  }
  slot.append(grid);
}

/** The one-line summary shown under the board after a turn resolves. */
export function turnResultText(result: TurnResult): string {
  const tieNote = result.tieBreak ? " (tie-break)" : "";
  return `${markString(result.winner)} won the turn, took cell ${result.cell}, paid ${result.bid}${tieNote}.`;
}
