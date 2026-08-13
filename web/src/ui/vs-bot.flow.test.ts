import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";

describe("vs-bot flow end-to-end", () => {
  it("plays a full match and the Rematch button restarts", async () => {
    const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: "http://localhost/" });
    const root = dom.window.document.getElementById("root")! as HTMLElement;
    // Minimal stub of createBidInput so vs-bot doesn't try to create range inputs
    // (jsdom doesn't implement slider value semantics; that's fine, we only
    // care about the click flow).
    // We'll just use the real DOM API since jsdom supports <input type=range>.

    // Import the actual vs-bot module — vitest will transpile.
    const { runVsBot } = await import("./vs-bot");

    // Don't await — runVsBot is an infinite loop until user picks Leave.
    void runVsBot(root);

    // Wait for the first board to render.
    await new Promise((r) => setTimeout(r, 50));
    let cells = root.querySelectorAll(".board__cell") as NodeListOf<HTMLButtonElement>;
    expect(cells.length).toBe(9);

    // Click cell 0 to commit a bid (default value is half the budget).
    (cells[0] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));

    // After 9 such commits a game should end. Just click cell 0 every time
    // it's available; once it's disabled, click the next empty cell.
    for (let i = 0; i < 10; i++) {
      cells = root.querySelectorAll(".board__cell") as NodeListOf<HTMLButtonElement>;
      const open = Array.from(cells).find((c) => !c.disabled);
      if (!open) break;
      open.click();
      await new Promise((r) => setTimeout(r, 10));
    }

    // Either the game is over (we see a result banner) or still going.
    // In any case, look for the Rematch button.
    const rematch = root.querySelector(".rematch") as HTMLButtonElement | null;
    expect(rematch, "Rematch button should be present after a match").not.toBeNull();

    // Click Rematch — the result banner should disappear and a fresh board
    // should render.
    rematch!.click();
    await new Promise((r) => setTimeout(r, 50));

    const freshCells = root.querySelectorAll(".board__cell") as NodeListOf<HTMLButtonElement>;
    expect(freshCells.length).toBe(9);
    // No result banner should remain.
    expect(root.querySelector(".result-banner")).toBeNull();
    // First cell should be empty again (fresh game).
    expect((freshCells[0] as HTMLButtonElement).textContent).toBe("_");
  }, 15_000);
});