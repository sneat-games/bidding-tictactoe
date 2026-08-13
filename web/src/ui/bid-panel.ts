// Bid panel card — the top-right panel of the match screen, sharing a column
// (and therefore a width) with the game log below it.
//
// It owns the bid controls (the linked slider + number from bid-input.ts) and
// the turn countdown. Committing is still a click on a board cell, so the
// panel never needs a submit button: pick a number here, click a square
// there.
//
// The countdown shows the bid that will be submitted for the player if they
// let it run out, so an auto-bid is never a surprise.

import { createBidInput, type BidInput } from "./bid-input";
import { startCountdown, type Countdown } from "@sneat/game-kit";

export interface ClockOptions {
  ms: number;
  /** Short line above the bar, e.g. "Opponent has bid — answer within". */
  label: string;
  /** The bid submitted on the player's behalf when this clock expires. */
  autoBid: number;
  onExpire(): void;
}

export interface BidPanel {
  el: HTMLElement;
  /** Rebuild the bid controls for a new turn's budget. Stops any clock. */
  beginTurn(opts: { max: number; initial?: number }): void;
  /** The bid currently dialled in. */
  value(): number;
  /** Start (or replace) the countdown. */
  runClock(opts: ClockOptions): void;
  /** Cancel the countdown and hide it. */
  stopClock(): void;
  /** Disable the controls and explain what the player is waiting for. */
  setWaiting(message: string): void;
}

export function createBidPanel(): BidPanel {
  const el = document.createElement("section");
  el.className = "card bid-panel";
  el.setAttribute("aria-label", "Your bid");
  el.setAttribute("data-bid-panel", "");

  const title = document.createElement("h3");
  title.className = "card__title";
  title.textContent = "Your bid";

  const slot = document.createElement("div");
  slot.className = "bid-panel__input";

  const hint = document.createElement("p");
  hint.className = "bid-panel__hint";
  hint.setAttribute("data-bid-hint", "");

  const clockBox = document.createElement("div");
  clockBox.className = "bid-panel__clock";
  clockBox.setAttribute("data-clock", "");
  clockBox.hidden = true;

  const clockHead = document.createElement("div");
  clockHead.className = "bid-panel__clock-head";
  const clockLabel = document.createElement("span");
  clockLabel.className = "bid-panel__clock-label";
  const clockSecs = document.createElement("span");
  clockSecs.className = "bid-panel__clock-secs";
  clockSecs.setAttribute("data-clock-secs", "");
  clockHead.append(clockLabel, clockSecs);

  const track = document.createElement("div");
  track.className = "bar-track bar-track--clock";
  const fill = document.createElement("div");
  fill.className = "bar-fill bar-fill--clock";
  track.append(fill);

  const auto = document.createElement("p");
  auto.className = "bid-panel__auto";
  auto.setAttribute("data-auto-bid", "");

  clockBox.append(clockHead, track, auto);
  el.append(title, slot, hint, clockBox);

  let input: BidInput | null = null;
  let clock: Countdown | null = null;

  function stopClock() {
    clock?.stop();
    clock = null;
    clockBox.hidden = true;
    // The bar is re-shown full by the next runClock; resetting here keeps a
    // stale sliver from flashing when it is.
    fill.style.width = "100%";
    clockBox.classList.remove("bid-panel__clock--urgent");
  }

  function beginTurn(opts: { max: number; initial?: number }) {
    stopClock();
    slot.innerHTML = "";
    input = createBidInput({
      max: opts.max,
      initial: opts.initial ?? Math.floor(opts.max / 2),
    });
    slot.append(input.el);
    hint.textContent = "Click a cell to commit.";
    el.classList.remove("bid-panel--waiting");
  }

  function runClock(opts: ClockOptions) {
    clock?.stop();
    clockBox.hidden = false;
    clockLabel.textContent = opts.label;
    auto.textContent = `No bid → you auto-bid ${opts.autoBid}`;
    clock = startCountdown({
      ms: opts.ms,
      onTick(left) {
        clockSecs.textContent = `${Math.ceil(left / 1000)}s`;
        fill.style.width = `${((left / opts.ms) * 100).toFixed(1)}%`;
        clockBox.classList.toggle("bid-panel__clock--urgent", left <= 3_000);
      },
      onExpire() {
        clock = null;
        opts.onExpire();
      },
    });
  }

  function setWaiting(message: string) {
    stopClock();
    input?.disable(true);
    hint.textContent = message;
    el.classList.add("bid-panel--waiting");
  }

  return {
    el,
    beginTurn,
    value: () => input?.value() ?? 0,
    runClock,
    stopClock,
    setWaiting,
  };
}
