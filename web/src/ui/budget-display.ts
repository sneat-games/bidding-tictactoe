// Budget display — two labelled progress bars (X and O) shown above the
// board, next to the bid input. The max across both players = 100%, so
// whoever holds the larger budget fills the whole bar.

import { Mark } from "../engine/btttplay";
import { markString } from "../engine/btttplay";

export interface BudgetDisplay {
  el: HTMLElement;
  update(budgets: [number, number]): void;
}

export function createBudgetDisplay(opts: {
  xLabel: string;
  oLabel: string;
  initialBudget: number;
}): BudgetDisplay {
  const el = document.createElement("div");
  el.className = "budget-display";
  el.setAttribute("data-budget-display", "");

  update([opts.initialBudget, opts.initialBudget]);

  function update(budgets: [number, number]) {
    el.innerHTML = "";
    const max = Math.max(budgets[0], budgets[1], 1);
    el.append(budgetRow(Mark.X, opts.xLabel, budgets[0], max));
    el.append(budgetRow(Mark.O, opts.oLabel, budgets[1], max));
  }

  return { el, update };
}

function budgetRow(mark: Mark, label: string, value: number, max: number): HTMLElement {
  const markChar = markString(mark);
  const cls = markChar.toLowerCase();
  const row = document.createElement("div");
  row.className = `budget-display__row budget-display__row--${cls}`;

  const markEl = document.createElement("span");
  markEl.className = `budget-display__mark budget-display__mark--${cls}`;
  markEl.textContent = markChar;

  const labelEl = document.createElement("span");
  labelEl.className = "budget-display__label";
  labelEl.textContent = label;

  const amountEl = document.createElement("span");
  amountEl.className = "budget-display__amount";
  amountEl.textContent = `$${value}`;

  const track = document.createElement("div");
  track.className = "budget-display__track";
  const fill = document.createElement("div");
  fill.className = `budget-display__fill budget-display__fill--${cls}`;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  fill.style.width = `${(pct * 100).toFixed(1)}%`;
  track.append(fill);

  row.append(markEl, labelEl, amountEl, track);
  return row;
}