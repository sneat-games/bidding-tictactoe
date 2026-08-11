// Bid input: linked slider + number input so the user can use either.
//
// Both controls bind to the same value. The slider gives fast rough aim; the
// number field gives precise entry. A DevTools-friendly data attribute is
// emitted on the container for inspection.
//
// Keep accessibility: the <label> wraps both controls; the slider exposes
// aria-valuetext (e.g. "5 of 10 coins"); the number input has aria-label
// "Exact bid".
//
// Coin-agnostic: `max` is the player's remaining budget (an int). `min` is 0.
// `step` is 1 because the engine treats budget as a whole number.

export interface BidInputOptions {
  max: number;
  initial?: number;
  onChange?: (value: number) => void;
}

export interface BidInput {
  el: HTMLElement;
  value(): number;
  setMax(max: number): void;
  setValue(value: number): void;
  disable(disabled: boolean): void;
}

export function createBidInput(opts: BidInputOptions): BidInput {
  const max = Math.max(0, Math.floor(opts.max));
  let value = clamp(opts.initial ?? Math.floor(max / 2), 0, max);
  let disabled = false;
  const listeners = new Set<(v: number) => void>();
  if (opts.onChange) listeners.add(opts.onChange);

  const el = document.createElement("div");
  el.className = "bid-input";
  el.setAttribute("data-bid-input", "");

  const label = document.createElement("label");
  label.textContent = "Your bid: ";

  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = String(max);
  range.step = "1";
  range.value = String(value);
  range.setAttribute("aria-label", "Bid slider");
  range.className = "bid-input__slider";

  const number = document.createElement("input");
  number.type = "number";
  number.min = "0";
  number.max = String(max);
  number.step = "1";
  number.value = String(value);
  number.setAttribute("aria-label", "Exact bid");
  number.className = "bid-input__number";

  label.appendChild(range);
  label.appendChild(number);
  el.appendChild(label);

  const fire = () => {
    range.value = String(value);
    number.value = String(value);
    range.setAttribute("aria-valuetext", `${value} of ${max} coins`);
    for (const l of listeners) l(value);
  };

  range.addEventListener("input", () => {
    const v = parseInt(range.value, 10);
    if (!Number.isNaN(v)) {
      value = clamp(v, 0, max);
      fire();
    }
  });

  number.addEventListener("input", () => {
    const raw = parseInt(number.value, 10);
    if (Number.isNaN(raw)) return; // let the user clear the field mid-typing
    value = clamp(raw, 0, max);
    // Don't clobber the field while the user is actively typing — only sync
    // the slider.
    range.value = String(value);
    range.setAttribute("aria-valuetext", `${value} of ${max} coins`);
    for (const l of listeners) l(value);
  });

  number.addEventListener("blur", () => {
    // On blur, snap invalid/empty back to the current value.
    number.value = String(value);
  });

  const api: BidInput = {
    el,
    value: () => value,
    setMax: (newMax: number) => {
      const m = Math.max(0, Math.floor(newMax));
      if (m === max) return;
      (range as HTMLInputElement).max = String(m);
      (number as HTMLInputElement).max = String(m);
      // If the current value now exceeds the new max, clamp it.
      if (value > m) {
        value = m;
        fire();
      } else {
        // Update aria-valuetext max reference even when value unchanged.
        range.setAttribute("aria-valuetext", `${value} of ${m} coins`);
      }
    },
    setValue: (v: number) => {
      const next = clamp(v, 0, max);
      if (next === value) return;
      value = next;
      fire();
    },
    disable: (d: boolean) => {
      disabled = d;
      range.disabled = d;
      number.disabled = d;
      el.classList.toggle("bid-input--disabled", d);
    },
  };
  // Initial aria-valuetext.
  range.setAttribute("aria-valuetext", `${value} of ${max} coins`);
  // Unused-flag suppression: `disabled` is for callers; we keep it tracked
  // so the API stays symmetric even if the MVP only sets it from one place.
  void disabled;
  return api;
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}