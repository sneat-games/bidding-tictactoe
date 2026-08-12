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

import { Board, Mark, Outcome, TurnResult, markString } from "../engine/btttplay";
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
  /** Persistent in-match actions (e.g. New game). Survives renderBoard, and
   *  is hidden while the end-of-match controls are up. */
  actions: HTMLElement;
  /** Draw the board, replacing the previous one and nothing else.
   *  `lastCell` rings the mark placed on the most recent turn. */
  renderBoard(board: Board, lastCell?: number): void;
  /** Set the line under the board. It survives until the next call. */
  setNote(text: string, kind?: "result" | "error"): void;
  /** Set the line under the board to a rendered turn result. */
  setTurnResult(result: TurnResult, you: Mark, themLabel: string): void;
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

  const actions = document.createElement("div");
  actions.className = "match__actions";
  actions.setAttribute("data-actions", "");

  boardArea.append(boardSlot, note, controls, actions);

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
    actions,
    renderBoard: (board, lastCell) => renderInto(boardSlot, board, lastCell),
    setNote,
    setTurnResult(result, you, themLabel) {
      note.hidden = false;
      note.className = "turn-result";
      note.replaceChildren(...turnResultNodes(result, you, themLabel));
    },
    appendTurn(entry) {
      balances.update(entry.budgetsAfter);
      log.append(entry);
    },
    reset() {
      balances.update([opts.initialBudget, opts.initialBudget]);
      log.clear();
      boardSlot.innerHTML = "";
      controls.innerHTML = "";
      actions.hidden = false;
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
function renderInto(slot: HTMLElement, board: Board, lastCell?: number): void {
  slot.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "board";
  grid.setAttribute("role", "grid");
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "board__cell";
    cell.setAttribute("data-cell", String(i));
    const mark = board[i];
    if (mark === Mark.Empty) {
      // An empty square shows nothing. `markString` renders "_", which is a
      // debugging representation, not a game piece.
      cell.textContent = "";
      cell.setAttribute("aria-label", `Play ${CELL_NAMES[i]}`);
    } else {
      cell.textContent = markString(mark);
      cell.dataset.mark = markString(mark);
      cell.disabled = true;
      cell.setAttribute("aria-label", `${markString(mark)} on ${CELL_NAMES[i]}`);
      if (i === lastCell) cell.classList.add("board__cell--last");
    }
    grid.appendChild(cell);
  }
  slot.append(grid);
}

/** Board positions in words. "cell 4" means nothing to a player. */
export const CELL_NAMES: readonly string[] = [
  "top left", "top", "top right",
  "left", "the centre", "right",
  "bottom left", "bottom", "bottom right",
];

/** A bold, colour-coded X or O chip. */
function markChip(mark: Mark): HTMLElement {
  const el = document.createElement("span");
  el.className = `mark mark--${markString(mark).toLowerCase()}`;
  el.setAttribute("data-mark", markString(mark));
  el.textContent = markString(mark);
  return el;
}

function turnResultNodes(result: TurnResult, you: Mark, themLabel: string): Node[] {
  const wonIt = result.winner === you;
  const nodes: Node[] = [markChip(result.winner)];

  const text = document.createElement("span");
  text.className = "turn-result__text";
  text.append(
    `${wonIt ? "You" : themLabel} took `,
    strong(CELL_NAMES[result.cell]),
    " for ",
    strong(String(result.bid)),
  );
  nodes.push(text);

  if (result.tieBreak) {
    const tie = document.createElement("span");
    tie.className = "badge badge--tie";
    tie.textContent = "tie-break";
    nodes.push(tie);
  }
  return nodes;
}

function strong(text: string): HTMLElement {
  const el = document.createElement("strong");
  el.textContent = text;
  return el;
}


/** How the match ended, from the local player's point of view. */
export type MatchOutcomeKind = "win" | "loss" | "draw";

export function matchOutcomeKind(outcome: Outcome, you: Mark): MatchOutcomeKind {
  if (outcome === Outcome.Draw) return "draw";
  const winner = outcome === Outcome.XWins ? Mark.X : Mark.O;
  return winner === you ? "win" : "loss";
}

/**
 * The end-of-match banner: a headline naming the result in the player's own
 * terms, then both final balances with their movement from the starting
 * budget. `outcomeString` names are engine-level ("OWins") and have no place
 * in front of a player.
 */
export function renderMatchOver(opts: {
  outcome: Outcome;
  you: Mark;
  budgets: readonly [number, number];
  youLabel: string;
  themLabel: string;
  initialBudget: number;
}): HTMLElement {
  const kind = matchOutcomeKind(opts.outcome, opts.you);
  const youIdx = opts.you === Mark.X ? 0 : 1;
  const themIdx = youIdx === 0 ? 1 : 0;

  const el = document.createElement("section");
  el.className = `match-over match-over--${kind}`;
  el.setAttribute("role", "status");
  el.setAttribute("data-match-over", kind);

  const headline = document.createElement("p");
  headline.className = "match-over__headline";
  headline.setAttribute("data-headline", "");
  headline.textContent =
    kind === "win" ? "🏆 You win!"
      : kind === "draw" ? "🤝 Draw"
        : `😔 ${opts.themLabel} wins`;

  const balances = document.createElement("div");
  balances.className = "match-over__balances";
  balances.append(
    finalBalance(opts.youLabel, opts.budgets[youIdx], opts.initialBudget, "you"),
    finalBalance(opts.themLabel, opts.budgets[themIdx], opts.initialBudget, "them"),
  );

  el.append(headline, balances);
  return el;
}

function finalBalance(label: string, value: number, initial: number, who: string): HTMLElement {
  const row = document.createElement("div");
  row.className = `match-over__balance match-over__balance--${who}`;
  row.setAttribute("data-final-balance", who);

  const name = document.createElement("span");
  name.className = "match-over__balance-label";
  name.textContent = label;

  const amount = document.createElement("span");
  amount.className = "match-over__balance-value";
  amount.textContent = String(value);

  row.append(name, amount);

  // The winner's bid is transferred to the loser every turn, so the movement
  // from the starting budget is the story of the match.
  const delta = value - initial;
  if (delta !== 0) {
    const move = document.createElement("span");
    move.className = `match-over__balance-delta match-over__balance-delta--${delta > 0 ? "up" : "down"}`;
    move.textContent = delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
    row.append(move);
  }
  return row;
}
