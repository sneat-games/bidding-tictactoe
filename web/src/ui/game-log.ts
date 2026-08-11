// Game log panel — a right-side scrollable list of past turns with progress
// bars showing the size of each bid relative to the initial budget.
//
// Bar fill = bid / initialBudget. The winning bid bar is green; the losing
// bid bar is red. A tie-break is marked with a small badge. Running budget
// bars for both sides appear at the top of the log and update after each
// turn.
//
// The log is created once per match and `clear()`-ed on rematch.

import type { Move, TurnResult } from "../engine/btttplay";
import { markString } from "../engine/btttplay";

export interface LogEntry {
  turn: number;
  result: TurnResult;
  xMove: Move;
  oMove: Move;
  budgetsBefore: [number, number];
  budgetsAfter: [number, number];
}

export interface GameLog {
  el: HTMLElement;
  append(entry: LogEntry): void;
  clear(): void;
}

export function createGameLog(opts: {
  initialBudget: number;
  xLabel: string;
  oLabel: string;
}): GameLog {
  const el = document.createElement("aside");
  el.className = "game-log";
  el.setAttribute("aria-label", "Game log");
  el.setAttribute("data-game-log", "");

  const header = document.createElement("h3");
  header.textContent = "Game log";
  header.className = "game-log__title";

  const budgets = document.createElement("div");
  budgets.className = "game-log__budgets";
  budgets.setAttribute("data-budgets", "");

  const entries = document.createElement("div");
  entries.className = "game-log__entries";
  entries.setAttribute("data-entries", "");

  el.append(header, budgets, entries);

  function renderBudgets(b: [number, number]) {
    budgets.innerHTML = "";
    budgets.append(
      budgetBar(opts.xLabel, b[0], opts.initialBudget, "x"),
      budgetBar(opts.oLabel, b[1], opts.initialBudget, "o"),
    );
  }

  function append(entry: LogEntry) {
    renderBudgets(entry.budgetsAfter);
    entries.prepend(renderEntry(entry));
  }

  function clear() {
    entries.innerHTML = "";
    renderBudgets([opts.initialBudget, opts.initialBudget]);
  }

  // Initial budget render.
  renderBudgets([opts.initialBudget, opts.initialBudget]);

  return { el, append, clear };
}

function budgetBar(label: string, value: number, max: number, cls: string): HTMLElement {
  const row = document.createElement("div");
  row.className = `game-log__budget game-log__budget--${cls}`;
  const lbl = document.createElement("span");
  lbl.className = "game-log__budget-label";
  lbl.textContent = `${label}: ${value}/${max}`;
  const track = document.createElement("div");
  track.className = "game-log__bar-track";
  const fill = document.createElement("div");
  fill.className = `game-log__bar-fill game-log__bar-fill--${cls}`;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  fill.style.width = `${(pct * 100).toFixed(1)}%`;
  track.append(fill);
  row.append(lbl, track);
  return row;
}

function renderEntry(entry: LogEntry): HTMLElement {
  const { turn, result, xMove, oMove, budgetsBefore } = entry;
  const card = document.createElement("div");
  card.className = "game-log__entry";

  const head = document.createElement("div");
  head.className = "game-log__entry-head";
  const tieBadge = result.tieBreak ? " <span class=\"game-log__tie\">tie</span>" : "";
  head.innerHTML = `<span class="game-log__turn">T${turn + 1}</span> ${markString(result.winner)} took cell ${result.cell}${tieBadge}`;
  card.append(head);

  // Winning bid bar (green) and losing bid bar (red) — both sized relative
  // to the player's own budget at the start of this turn, so the player
  // sees at a glance how big each commitment was.
  const xWon = result.winner === 1 /* Mark.X */;
  card.append(bidBar("X", xMove.bid, budgetsBefore, 0, xWon));
  card.append(bidBar("O", oMove.bid, budgetsBefore, 1, !xWon));
  return card;
}

/** A single bid bar. `won` controls the colour (green win / red loss). */
function bidBar(
  player: string,
  bid: number,
  budgetsBefore: [number, number],
  idx: 0 | 1,
  won: boolean,
): HTMLElement {
  const row = document.createElement("div");
  row.className = `game-log__bid game-log__bid--${won ? "win" : "loss"}`;
  const lbl = document.createElement("span");
  lbl.className = "game-log__bid-label";
  const maxBudget = budgetsBefore[idx];
  const pctOfBudget = maxBudget > 0 ? Math.max(0, Math.min(1, bid / maxBudget)) : 0;
  lbl.textContent = `${player} bid ${bid}`;
  const track = document.createElement("div");
  track.className = "game-log__bar-track";
  const fill = document.createElement("div");
  fill.className = `game-log__bar-fill game-log__bar-fill--${won ? "win" : "loss"}`;
  fill.style.width = `${(pctOfBudget * 100).toFixed(1)}%`;
  track.append(fill);
  row.append(lbl, track);
  return row;
}