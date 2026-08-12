// Balances card — the top-left panel of the match screen, showing both
// players' remaining budget as a bar against the initial budget.
//
// Balances are public information in Bidding Tic-Tac-Toe: the bid is hidden,
// the bankroll is not. Keeping them on screen is also what makes the stall
// default in turn-clock.ts predictable — a player can read off what their
// auto-bid would be before the clock fires.
//
// This card is exactly as wide as the board below it (see .match in
// global.css), which is why it lives here rather than inside the game log
// where the bars used to be.

export interface Balances {
  el: HTMLElement;
  /** Redraw both bars from the post-turn budgets `[X, O]`. */
  update(budgets: readonly [number, number]): void;
}

export function createBalances(opts: {
  initialBudget: number;
  xLabel: string;
  oLabel: string;
}): Balances {
  const el = document.createElement("section");
  el.className = "card balances";
  el.setAttribute("aria-label", "Balances");
  el.setAttribute("data-balances", "");

  const title = document.createElement("h3");
  title.className = "card__title";
  title.textContent = "Balances";

  const rows = document.createElement("div");
  rows.className = "balances__rows";

  el.append(title, rows);

  function update(budgets: readonly [number, number]) {
    rows.innerHTML = "";
    rows.append(
      balanceBar(opts.xLabel, budgets[0], opts.initialBudget, "x"),
      balanceBar(opts.oLabel, budgets[1], opts.initialBudget, "o"),
    );
  }

  update([opts.initialBudget, opts.initialBudget]);

  return { el, update };
}

function balanceBar(label: string, value: number, max: number, cls: string): HTMLElement {
  const row = document.createElement("div");
  row.className = `balances__row balances__row--${cls}`;
  row.setAttribute("data-balance", cls);

  const lbl = document.createElement("span");
  lbl.className = "balances__label";
  lbl.textContent = `${label}: ${value}/${max}`;

  const track = document.createElement("div");
  track.className = "bar-track";
  const fill = document.createElement("div");
  fill.className = `bar-fill bar-fill--${cls}`;
  // A budget can exceed the initial one — the winner's bid is transferred to
  // the loser — so clamp the bar at full rather than overflowing the track.
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  fill.style.width = `${(pct * 100).toFixed(1)}%`;
  track.append(fill);

  row.append(lbl, track);
  return row;
}
