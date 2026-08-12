// A button that asks twice before doing something destructive.
//
// "New game" mid-match throws away the position, both balances and the whole
// log, and it sits a few pixels from the board. A browser `confirm()` is not
// an option (a modal dialog blocks the page, and it reads as a bug in a
// game), so the button arms itself instead: the first click swaps the label,
// a second click within `armedMs` commits, and anything else disarms it.

const DEFAULT_ARMED_MS = 4_000;

export interface ConfirmButton {
  el: HTMLButtonElement;
  /** Drop back to the resting label; safe to call when already disarmed. */
  disarm(): void;
}

export function createConfirmButton(opts: {
  label: string;
  confirmLabel: string;
  className?: string;
  armedMs?: number;
  onConfirm(): void;
}): ConfirmButton {
  const el = document.createElement("button");
  el.type = "button";
  el.className = opts.className ?? "menu-btn";
  el.textContent = opts.label;
  el.setAttribute("data-confirm-button", "");

  let armed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function disarm() {
    armed = false;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    el.textContent = opts.label;
    el.classList.remove("is-armed");
    el.removeAttribute("data-armed");
  }

  el.addEventListener("click", () => {
    if (armed) {
      disarm();
      opts.onConfirm();
      return;
    }
    armed = true;
    el.textContent = opts.confirmLabel;
    el.classList.add("is-armed");
    el.setAttribute("data-armed", "");
    timer = setTimeout(disarm, opts.armedMs ?? DEFAULT_ARMED_MS);
  });

  // Clicking anywhere else means the player moved on — a board click above
  // all, which must not leave a live restart sitting under the cursor.
  el.addEventListener("blur", disarm);

  return { el, disarm };
}
