import { test, expect } from "@playwright/test";

// Journey (docs/DESIGN.md "Testing"): the theme toggle persists across a
// reload with no flash of the wrong theme — game-kit's ui/theme.ts stores
// the preference in `localStorage["sneat-games-theme"]`, and Layout.astro's
// pre-paint inline script (not a JS module import, which would run too
// late) re-applies it before first paint.

test("theme toggle persists across a reload", async ({ page }) => {
  await page.goto("/");

  const toggle = page.locator(".theme-toggle");
  await expect(toggle).toBeVisible();

  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));

  await toggle.click();
  const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(after).not.toBeNull();
  expect(after).not.toBe(before);
  expect(["light", "dark"]).toContain(after);

  const stored = await page.evaluate(() => localStorage.getItem("sneat-games-theme"));
  expect(stored).toBe(after);

  await page.reload();
  const afterReload = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(afterReload).toBe(after);
});
