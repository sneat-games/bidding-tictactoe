import { test, expect } from "@playwright/test";
import { chooseMode, playVsBotToEnd, balanceValue, matchOverKind } from "./helpers";

// Journey (docs/DESIGN.md "Testing" / game-kit's APP-PLAYBOOK): vs Bot ->
// auction flow visible -> terminal screen, with the first-price TRANSFER
// (game-kit's auction/auction.ts, mirrored by src/engine/btttplay.ts)
// actually moving budgets away from the 100/100 start while the total stays
// conserved. Bidding Tic-Tac-Toe has no separate "classic" mode — the
// bidding auction IS the game — so this single vs-Bot journey covers what
// the sibling games split into "classic vs bot" and "bidding vs bot".

test("vs Bot: commits bids and cells to a terminal banner with budgets transferred (conserved)", async ({ page }) => {
  await page.goto("/");
  await chooseMode(page, "vs-bot");

  // Both start at the initial budget.
  await expect.poll(() => balanceValue(page, "p1")).toBe(100);
  await expect.poll(() => balanceValue(page, "p2")).toBe(100);

  // Commit a real (non-zero) bid on the first turn so a tie against the
  // bot's own (randomised) bid is vanishingly unlikely, without hard-coding
  // the bot's own bid.
  const bidInput = page.locator(".bid-input__number");
  await bidInput.fill("30");
  const cell = page.locator(".board__cell:not([disabled])").first();
  await cell.click();

  // First-price TRANSFER: the winner's bid moves entirely to the loser, so
  // the total (200) is conserved but at least one side's balance must move
  // off 100.
  await expect
    .poll(async () => (await balanceValue(page, "p1")) + (await balanceValue(page, "p2")), { timeout: 10_000 })
    .toBe(200);
  await expect
    .poll(async () => (await balanceValue(page, "p1")) !== 100 || (await balanceValue(page, "p2")) !== 100, {
      timeout: 10_000,
    })
    .toBe(true);

  await playVsBotToEnd(page, 15);

  await expect(page.locator("[data-match-over]")).toBeVisible();
  const kind = await matchOverKind(page);
  expect(["win", "loss", "draw"]).toContain(kind);
  await expect(page.locator(".match-over__balances")).toBeVisible();

  // Conservation holds at match end too: X's final balance + O's final
  // balance is always 200 — the auction only ever moves coins between the
  // two players, never creates or destroys them.
  const finalX = await balanceValue(page, "p1");
  const finalO = await balanceValue(page, "p2");
  expect(finalX + finalO).toBe(200);
});
