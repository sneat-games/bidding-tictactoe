import { type Page, expect } from "@playwright/test";

/** Click the vs-Bot / vs-Friend mode card on the menu (src/ui/menu.ts). Each
 *  card resolves the choice on a single click — there is no separate
 *  submit step. */
export async function chooseMode(page: Page, mode: "vs-bot" | "vs-friend"): Promise<void> {
  await page.locator(`.menu-card[data-mode="${mode}"]`).click();
}

/** Click the first empty (enabled) board cell, if any. Returns whether a
 *  cell was found and clicked. Occupied cells are rendered `disabled` (see
 *  match-screen.ts's renderInto), so this selector alone is enough to find
 *  a legal move. */
export async function clickFirstAvailableCell(page: Page): Promise<boolean> {
  const cell = page.locator(".board__cell:not([disabled])").first();
  if ((await cell.count()) === 0) return false;
  await cell.click();
  return true;
}

/**
 * Play a vs-Bot match to its terminal banner: dial in a fixed bid (when the
 * bid panel is up — it disappears once the match ends), then click the
 * first available cell, every turn. Bidding Tic-Tac-Toe has only one mode
 * (it IS the bidding game — there is no separate "classic" variant, unlike
 * hex/dots-and-boxes), so every vs-Bot journey commits a bid every turn.
 */
export async function playVsBotToEnd(page: Page, bid: number, maxTurns = 20): Promise<void> {
  for (let i = 0; i < maxTurns; i++) {
    if ((await page.locator("[data-match-over]").count()) > 0) return;
    const bidInput = page.locator(".bid-input__number");
    if ((await bidInput.count()) > 0) {
      await bidInput.fill(String(bid));
    }
    const clicked = await clickFirstAvailableCell(page);
    if (!clicked) {
      // No empty cell left but no terminal banner yet — give the last
      // resolution a moment to land before the next poll.
      await page.waitForTimeout(150);
      continue;
    }
    await page.waitForTimeout(150);
  }
  throw new Error("vs-bot match did not reach a terminal banner in time");
}

/** Parse a balances row's "Label: value/max" text into its numeric value.
 *  `player` is "x" | "o" (src/ui/balances.ts's `data-balance` values — this
 *  game has no p1/p2 concept, marks are X and O directly). */
export async function balanceValue(page: Page, player: "x" | "o"): Promise<number> {
  const text = await page.locator(`[data-balance="${player}"] .balances__label`).innerText();
  const match = /:\s*(-?\d+)\/(\d+)/.exec(text);
  if (!match) throw new Error(`could not parse balance text: "${text}"`);
  return Number(match[1]);
}

/** The terminal banner's outcome kind ("win" | "loss" | "draw" — see
 *  match-screen.ts's renderMatchOver, which sets `data-match-over` to the
 *  kind directly rather than a separate attribute). */
export async function matchOverKind(page: Page): Promise<string | null> {
  return page.locator("[data-match-over]").getAttribute("data-match-over");
}

/** Wait for the terminal banner, then assert it is visible. */
export async function expectMatchOver(page: Page): Promise<void> {
  await expect(page.locator("[data-match-over]")).toBeVisible();
}
