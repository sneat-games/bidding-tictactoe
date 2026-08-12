// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createConfirmButton } from "./confirm-button";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function button(onConfirm = vi.fn(), armedMs?: number) {
  const b = createConfirmButton({
    label: "New game",
    confirmLabel: "Restart — click again",
    armedMs,
    onConfirm,
  });
  document.body.append(b.el);
  return { ...b, onConfirm };
}

describe("confirm button", () => {
  it("does nothing destructive on the first click", () => {
    const b = button();
    b.el.click();
    expect(b.onConfirm).not.toHaveBeenCalled();
    expect(b.el.textContent).toBe("Restart — click again");
    expect(b.el.hasAttribute("data-armed")).toBe(true);
  });

  it("fires on the second click", () => {
    const b = button();
    b.el.click();
    b.el.click();
    expect(b.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("returns to its resting label after firing", () => {
    const b = button();
    b.el.click();
    b.el.click();
    expect(b.el.textContent).toBe("New game");
    expect(b.el.hasAttribute("data-armed")).toBe(false);
  });

  it("needs arming again for a second restart", () => {
    const b = button();
    b.el.click();
    b.el.click();
    b.el.click();
    expect(b.onConfirm).toHaveBeenCalledTimes(1);
    b.el.click();
    expect(b.onConfirm).toHaveBeenCalledTimes(2);
  });

  it("disarms itself once the window passes", () => {
    vi.useFakeTimers();
    const b = button(vi.fn(), 4_000);
    b.el.click();
    vi.advanceTimersByTime(5_000);
    expect(b.el.textContent).toBe("New game");
    b.el.click();
    expect(b.onConfirm).not.toHaveBeenCalled();
  });

  it("stays armed inside the window", () => {
    vi.useFakeTimers();
    const b = button(vi.fn(), 4_000);
    b.el.click();
    vi.advanceTimersByTime(3_000);
    b.el.click();
    expect(b.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disarms when the player looks away", () => {
    // A board click moves focus off the button; a live restart must not be
    // left sitting under the cursor.
    const b = button();
    b.el.click();
    b.el.dispatchEvent(new FocusEvent("blur"));
    expect(b.el.textContent).toBe("New game");
    b.el.click();
    expect(b.onConfirm).not.toHaveBeenCalled();
  });

  it("can be disarmed by the caller, repeatedly and when already resting", () => {
    const b = button();
    b.el.click();
    b.disarm();
    b.disarm();
    expect(b.el.textContent).toBe("New game");
    b.el.click();
    expect(b.onConfirm).not.toHaveBeenCalled();
  });
});
