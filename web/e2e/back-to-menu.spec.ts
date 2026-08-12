import { test, expect } from "@playwright/test";
import { chooseMode, playVsBotToEnd } from "./helpers";

// Regression (game-kit/docs/APP-PLAYBOOK.md non-negotiables): "Back to
// menu" on the end-of-match banner used to do nothing visible in EIGHT
// sibling games at once — every e2e suite asserted the terminal banner and
// stopped there, one click short of the post-match controls, so nobody's
// `bootstrap` was ever driven past the end of a single session. main.ts's
// `for (;;)` menu loop is what fixes it: this journey does not stop at the
// banner, it clicks through and starts a NEW match.

test("vs Bot: 'Back to menu' returns to a live menu, and a new match can be started", async ({ page }) => {
  await page.goto("/");
  await chooseMode(page, "vs-bot");

  // Off the menu and into a match: the board is up, the menu is gone.
  await expect(page.locator(".board")).toBeVisible();
  await expect(page.locator(".menu-card")).toHaveCount(0);

  await playVsBotToEnd(page, 15);
  await expect(page.locator("[data-match-over]")).toBeVisible();

  await page.getByRole("button", { name: "Back to menu" }).click();

  // THE POINT OF THIS TEST: the menu comes back, and the finished match is
  // gone with it.
  await expect(page.locator(".menu-card")).toHaveCount(2);
  await expect(page.locator("[data-match-over]")).toHaveCount(0);

  // ...and the menu is live, not a screenshot of one: a second match starts
  // from it.
  await chooseMode(page, "vs-bot");
  await expect(page.locator(".board")).toBeVisible();
  await expect(page.locator(".bid-input__number")).toBeVisible();
});
