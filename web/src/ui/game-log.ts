// Game log panel — a right-side scrollable list of past turns with progress
// bars showing the size of each bid relative to the max budget across both
// players.
//
// Budget bars live ABOVE the board (see budget-display.ts), not in the log.
// The log shows only turn entries: who won, which cell, bid bars (green win,
// red loss).
//
// X/O marks are coloured (purple X, amber O) to match the budget bars.
// The log is created once per match and `clear()`-ed on rematch.

import type { Move, TurnResult } from "../engine/btttplay";
import { markString } from "../engine/btttplay";
import { saveLogEntries, loadLogEntries, clearLogEntries } from "../pvp/game-store";

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
  void opts; // labels kept for potential future use in log headers
  const el = document.createElement("aside");
  el.className = "game-log";
  el.setAttribute("aria-label", "Game log");
  el.setAttribute("data-game-log", "");

  const header = document.createElement("h3");
  header.textContent = "Game log";
  header.className = "game-log__title";

  const entries = document.createElement("div");
  entries.className = "game-log__entries";
  entries.setAttribute("data-entries", "");

  el.append(header, entries);

  const allEntries: LogEntry[] = [];
  let restoring = false;

  function renderAll() {
    entries.innerHTML = "";
    for (let i = allEntries.length - 1; i >= 0; i--) {
      entries.append(renderEntry(allEntries[i]));
    }
  }

  function append(entry: LogEntry) {
    allEntries.push(entry);
    if (!restoring) {
      void saveLogEntries(allEntries);
    }
    entries.prepend(renderEntry(entry));
  }

  async function clear() {
    allEntries.length = 0;
    entries.innerHTML = "";
    await clearLogEntries();
  }

  // Async: load saved entries from IndexedDB and re-render so a page
  // reload restores the full log.
  restoring = true;
  void loadLogEntries().then((saved) => {
    if (saved.length > 0) {
      allEntries.push(...saved);
      renderAll();
    }
    restoring = false;
  });

  return { el, append, clear };
}

function renderEntry(entry: LogEntry): HTMLElement {
  const { turn, result, xMove, oMove, budgetsBefore } = entry;
  const card = document.createElement("div");
  card.className = "game-log__entry";

  const head = document.createElement("div");
  head.className = "game-log__entry-head";
  const tieBadge = result.tieBreak ? " <span class=\"game-log__tie\">tie</span>" : "";
  const winnerMark = markString(result.winner);
  head.innerHTML = `<span class="game-log__turn">T${turn + 1}</span> <span class="game-log__mark game-log__mark--${winnerMark.toLowerCase()}">${winnerMark}</span> took cell ${result.cell}${tieBadge}`;
  card.append(head);

  const maxBudget = Math.max(budgetsBefore[0], budgetsBefore[1], 1);
  const xWon = result.winner === 1 /* Mark.X */;
  card.append(bidBar("X", xMove.bid, maxBudget, xWon));
  card.append(bidBar("O", oMove.bid, maxBudget, !xWon));
  return card;
}

function bidBar(
  player: string,
  bid: number,
  maxBudget: number,
  won: boolean,
): HTMLElement {
  const row = document.createElement("div");
  row.className = `game-log__bid game-log__bid--${won ? "win" : "loss"}`;
  const lbl = document.createElement("span");
  lbl.className = "game-log__bid-label";
  const pctOfBudget = maxBudget > 0 ? Math.max(0, Math.min(1, bid / maxBudget)) : 0;
  lbl.innerHTML = `<span class="game-log__mark game-log__mark--${player.toLowerCase()}">${player}</span> bid <code>${bid}</code>`;
  const track = document.createElement("div");
  track.className = "game-log__bar-track";
  const fill = document.createElement("div");
  fill.className = `game-log__bar-fill game-log__bar-fill--${won ? "win" : "loss"}`;
  fill.style.width = `${(pctOfBudget * 100).toFixed(1)}%`;
  track.append(fill);
  row.append(lbl, track);
  return row;
}