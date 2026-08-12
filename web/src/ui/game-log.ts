// Game log panel — the bottom-right card of the match screen, a scrollable
// list of past turns with progress bars showing the size of each bid
// relative to that player's budget at the start of the turn.
//
// The winning bid bar is green; the losing bid bar is red. A tie-break is
// marked with a small badge.
//
// Running balances used to live at the top of this panel; they now have
// their own card (balances.ts) so they can sit beside the bid panel and
// share the board's width.
//
// The log is created once per match and `clear()`-ed on rematch.

import type { Move, TurnResult } from "../engine/btttplay";
import { Mark, markString } from "../engine/btttplay";
import { CELL_NAMES } from "./match-screen";

export interface LogEntry {
  turn: number;
  result: TurnResult;
  xMove: Move;
  oMove: Move;
  budgetsBefore: [number, number];
  /** Post-turn budgets. Used by the balances card, not by the log itself. */
  budgetsAfter: [number, number];
}

export interface GameLog {
  el: HTMLElement;
  append(entry: LogEntry): void;
  clear(): void;
}

export function createGameLog(): GameLog {
  const el = document.createElement("aside");
  el.className = "card game-log";
  el.setAttribute("aria-label", "Game log");
  el.setAttribute("data-game-log", "");

  const header = document.createElement("h3");
  header.textContent = "Game log";
  header.className = "card__title";

  const entries = document.createElement("div");
  entries.className = "game-log__entries";
  entries.setAttribute("data-entries", "");

  el.append(header, entries);

  return {
    el,
    append(entry) {
      entries.prepend(renderEntry(entry));
    },
    clear() {
      entries.innerHTML = "";
    },
  };
}

function renderEntry(entry: LogEntry): HTMLElement {
  const { turn, result, xMove, oMove, budgetsBefore } = entry;
  const card = document.createElement("div");
  card.className = "game-log__entry";

  const head = document.createElement("div");
  head.className = "game-log__entry-head";
  const tieBadge = result.tieBreak ? " <span class=\"game-log__tie\">tie</span>" : "";
  const winner = markString(result.winner);
  head.innerHTML = `<span class="game-log__turn">T${turn + 1}</span> <span class="mark mark--${winner.toLowerCase()}">${winner}</span> took ${CELL_NAMES[result.cell]}${tieBadge}`;
  card.append(head);

  // Both bars are sized against the player's OWN budget at the start of this
  // turn, so the player sees at a glance how big each commitment was.
  const xWon = result.winner === Mark.X;
  card.append(bidBar("X", xMove.bid, budgetsBefore[0], xWon));
  card.append(bidBar("O", oMove.bid, budgetsBefore[1], !xWon));
  return card;
}

/**
 * A single bid bar, coloured by PLAYER (X green, O red) so a bar means the
 * same thing here as the mark on the board and the balance bar above it.
 * Winning the turn is shown by weight and a marker rather than by hue, which
 * is now spoken for.
 */
function bidBar(player: string, bid: number, ownBudget: number, won: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = `game-log__bid game-log__bid--${won ? "won" : "lost"}`;

  const lbl = document.createElement("span");
  lbl.className = "game-log__bid-label";
  const marker = won ? ' <span class="game-log__bid-won-marker" title="won the turn">\u2713</span>' : "";
  lbl.innerHTML = `<span class="mark mark--${player.toLowerCase()}">${player}</span> bid ${bid}${marker}`;

  const track = document.createElement("div");
  track.className = "bar-track";
  const fill = document.createElement("div");
  fill.className = `bar-fill bar-fill--${player.toLowerCase()}`;
  const pct = ownBudget > 0 ? Math.max(0, Math.min(1, bid / ownBudget)) : 0;
  fill.style.width = `${(pct * 100).toFixed(1)}%`;
  track.append(fill);

  row.append(lbl, track);
  return row;
}
