import { describe, it, expect } from "vitest";
import { createBidInput } from "./bid-input";

function mount() {
  const c = createBidInput({ max: 10, initial: 5 });
  document.body.appendChild(c.el);
  return c;
}

describe("bid-input", () => {
  it("initialises with the requested value clamped to max", () => {
    const c = mount();
    expect(c.value()).toBe(5);
    const over = createBidInput({ max: 10, initial: 99 });
    expect(over.value()).toBe(10);
    const under = createBidInput({ max: 10, initial: -3 });
    expect(under.value()).toBe(0);
  });

  it("slider and number field share value: changing slider updates number field", () => {
    const c = mount();
    const slider = c.el.querySelector('input[type="range"]') as HTMLInputElement;
    const num = c.el.querySelector('input[type="number"]') as HTMLInputElement;
    slider.value = "7";
    slider.dispatchEvent(new Event("input"));
    expect(c.value()).toBe(7);
    expect(num.value).toBe("7");
  });

  it("changing number field updates slider", () => {
    const c = mount();
    const slider = c.el.querySelector('input[type="range"]') as HTMLInputElement;
    const num = c.el.querySelector('input[type="number"]') as HTMLInputElement;
    num.value = "3";
    num.dispatchEvent(new Event("input"));
    expect(c.value()).toBe(3);
    expect(slider.value).toBe("3");
  });

  it("clamps out-of-range number entry to [0, max]", () => {
    const c = mount();
    const num = c.el.querySelector('input[type="number"]') as HTMLInputElement;
    num.value = "999";
    num.dispatchEvent(new Event("input"));
    expect(c.value()).toBe(10);
    num.value = "-5";
    num.dispatchEvent(new Event("input"));
    expect(c.value()).toBe(0);
  });

  it("fires onChange when the value changes", () => {
    let seen: number | null = null;
    const c = createBidInput({ max: 10, initial: 5, onChange: (v) => (seen = v) });
    document.body.appendChild(c.el);
    c.setValue(8);
    expect(seen).toBe(8);
  });

  it("respects a smaller remaining budget when setMax is called", () => {
    const c = mount();
    c.setMax(4);
    expect(c.value()).toBe(4); // 5 > 4 -> clamped down
    const slider = c.el.querySelector('input[type="range"]') as HTMLInputElement;
    const num = c.el.querySelector('input[type="number"]') as HTMLInputElement;
    expect(slider.max).toBe("4");
    expect(num.max).toBe("4");
  });

  it("disable() disables both inputs", () => {
    const c = mount();
    c.disable(true);
    const slider = c.el.querySelector('input[type="range"]') as HTMLInputElement;
    const num = c.el.querySelector('input[type="number"]') as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    expect(num.disabled).toBe(true);
  });
});