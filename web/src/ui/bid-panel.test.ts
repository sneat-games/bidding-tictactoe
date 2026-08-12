// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBidPanel } from "./bid-panel";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function panel() {
  const p = createBidPanel();
  document.body.append(p.el);
  return p;
}

const clockBox = (p: ReturnType<typeof panel>) =>
  p.el.querySelector<HTMLElement>("[data-clock]")!;

describe("bid panel", () => {
  it("seeds the bid at half the balance and caps it there", () => {
    const p = panel();
    p.beginTurn({ max: 80 });
    expect(p.value()).toBe(40);
    const slider = p.el.querySelector<HTMLInputElement>(".bid-input__slider")!;
    expect(slider.max).toBe("80");
  });

  it("rebuilds the controls for each turn's balance", () => {
    const p = panel();
    p.beginTurn({ max: 100 });
    p.beginTurn({ max: 30 });
    expect(p.value()).toBe(15);
    expect(p.el.querySelectorAll(".bid-input")).toHaveLength(1);
  });

  it("reports 0 before any turn has begun", () => {
    expect(panel().value()).toBe(0);
  });
});

describe("bid panel clock", () => {
  it("shows the countdown and the bid that will fire", () => {
    vi.useFakeTimers();
    const p = panel();
    p.beginTurn({ max: 100 });
    p.runClock({ ms: 10_000, label: "Answer within", autoBid: 0, onExpire: () => {} });
    expect(clockBox(p).hidden).toBe(false);
    expect(p.el.querySelector("[data-clock-secs]")!.textContent).toBe("10s");
    expect(p.el.querySelector("[data-auto-bid]")!.textContent).toContain("auto-bid 0");
  });

  it("counts down and expires once", () => {
    vi.useFakeTimers();
    const p = panel();
    const onExpire = vi.fn();
    p.beginTurn({ max: 100 });
    p.runClock({ ms: 10_000, label: "Answer within", autoBid: 7, onExpire });
    vi.advanceTimersByTime(4_000);
    expect(p.el.querySelector("[data-clock-secs]")!.textContent).toBe("6s");
    vi.advanceTimersByTime(10_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("flags the last three seconds as urgent", () => {
    vi.useFakeTimers();
    const p = panel();
    p.beginTurn({ max: 100 });
    p.runClock({ ms: 10_000, label: "Answer within", autoBid: 0, onExpire: () => {} });
    vi.advanceTimersByTime(5_000);
    expect(clockBox(p).classList.contains("bid-panel__clock--urgent")).toBe(false);
    vi.advanceTimersByTime(2_500);
    expect(clockBox(p).classList.contains("bid-panel__clock--urgent")).toBe(true);
  });

  it("replaces a running clock rather than stacking two", () => {
    vi.useFakeTimers();
    const p = panel();
    const first = vi.fn();
    const second = vi.fn();
    p.beginTurn({ max: 100 });
    p.runClock({ ms: 30_000, label: "Bid within", autoBid: 50, onExpire: first });
    p.runClock({ ms: 10_000, label: "Answer within", autoBid: 0, onExpire: second });
    vi.advanceTimersByTime(40_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("hides the clock and cancels expiry on stopClock", () => {
    vi.useFakeTimers();
    const p = panel();
    const onExpire = vi.fn();
    p.beginTurn({ max: 100 });
    p.runClock({ ms: 10_000, label: "Answer within", autoBid: 0, onExpire });
    p.stopClock();
    expect(clockBox(p).hidden).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("stops the clock when a new turn begins", () => {
    vi.useFakeTimers();
    const p = panel();
    const onExpire = vi.fn();
    p.beginTurn({ max: 100 });
    p.runClock({ ms: 10_000, label: "Answer within", autoBid: 0, onExpire });
    p.beginTurn({ max: 100 });
    vi.advanceTimersByTime(30_000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(clockBox(p).hidden).toBe(true);
  });
});

describe("bid panel waiting state", () => {
  it("disables the controls, hides the clock and explains the wait", () => {
    vi.useFakeTimers();
    const p = panel();
    const onExpire = vi.fn();
    p.beginTurn({ max: 100 });
    p.runClock({ ms: 10_000, label: "Answer within", autoBid: 0, onExpire });
    p.setWaiting("Waiting for your friend…");

    expect(clockBox(p).hidden).toBe(true);
    expect(p.el.querySelector("[data-bid-hint]")!.textContent).toBe("Waiting for your friend…");
    expect(p.el.querySelector<HTMLInputElement>(".bid-input__slider")!.disabled).toBe(true);
    expect(p.el.querySelector<HTMLInputElement>(".bid-input__number")!.disabled).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("re-enables the controls on the next turn", () => {
    const p = panel();
    p.beginTurn({ max: 100 });
    p.setWaiting("Waiting…");
    p.beginTurn({ max: 100 });
    expect(p.el.querySelector<HTMLInputElement>(".bid-input__slider")!.disabled).toBe(false);
    expect(p.el.querySelector("[data-bid-hint]")!.textContent).toBe("Click a cell to commit.");
  });
});

describe("bid panel stylesheet contract", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");

  it("re-states [hidden] for the clock", () => {
    // `.bid-panel__clock { display: flex }` matches the UA's `[hidden]` rule
    // on specificity and beats it on origin, so without this the expired
    // countdown stays on screen for the rest of the match.
    expect(css).toMatch(/\.bid-panel__clock\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
  });
});
