import { test, expect } from "@playwright/test";

// Saves handed over from the retired bidding-tictactoe.sneat.games subdomain.
// Its /__migrate.html (sneat-games/sneat.games) reads the old origin's
// localStorage and navigates to https://sneat.games/bidding-tictactoe/#migrate=<b64>;
// bootstrap() imports through game-kit's consumeMigratedStorage() and strips
// the parameter. Encoding: base64url (unpadded) of a JSON object. This game
// has no per-game save key, so only the shared theme key is imported.
function payload(saves: Record<string, string>): string {
  return Buffer.from(JSON.stringify(saves), "utf8").toString("base64url");
}

test("imports the old subdomain's theme and ignores unknown keys, then strips #migrate", async ({ page }) => {
  const migrate = payload({ "sneat-games-theme": "dark", "not-allowlisted": "x" });
  await page.goto(`/#migrate=${migrate}`);
  await expect(page.locator(".theme-toggle")).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  const stored = await page.evaluate(() => ({
    theme: localStorage.getItem("sneat-games-theme"),
    other: localStorage.getItem("not-allowlisted"),
    attr: document.documentElement.getAttribute("data-theme"),
  }));
  expect(stored).toEqual({ theme: "dark", other: null, attr: "dark" });
});

test("a theme already chosen here wins over the hand-over", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("sneat-games-theme", "light"));
  await page.goto("about:blank"); // a hash-only change would not reload the page
  await page.goto(`/#migrate=${payload({ "sneat-games-theme": "dark" })}`);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  expect(await page.evaluate(() => localStorage.getItem("sneat-games-theme"))).toBe("light");
});
