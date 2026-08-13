import { test, expect, type Page } from "@playwright/test";
import { chooseMode, balanceValue } from "./helpers";

// Journey (docs/DESIGN.md "Testing"): host <-> guest full PvP match across
// two browser contexts against @sneat/game-kit's local relay double
// (playwright.config.ts's second webServer, test-relay.mjs on its own
// isolated port — see that file's comment for why it isn't the kit's usual
// shared :8787). This exercises the SAME hostPeer/guestPeer/reserveRoomId
// path src/ui/vs-friend.ts runs against the real webrtc.sneat.games relay in
// production, gameId-namespaced ("bidding-tictactoe") like every other
// sneat-games title. Unlike hex's classic mode (strict alternating
// placement), Bidding Tic-Tac-Toe's PvP turn is SIMULTANEOUS: on every turn
// both peers independently commit a hidden bid + cell, then reveal, and only
// the auction winner's cell is placed — so both pages are clicked every
// turn, not one after the other.

test("PvP: invite link, both peers commit bids every turn, both boards agree on the result", async ({ browser }) => {
  test.setTimeout(90_000);

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await host.goto("/");
    await chooseMode(host, "vs-friend");

    // The invite card (src/ui/vs-friend.ts's renderInvite) must appear
    // BEFORE the host/guest DataChannel opens — see that file's fix for
    // game-kit/docs/APP-PLAYBOOK.md gotcha 5 (rendering the invite UI only
    // after awaiting hostPeer left the host staring at a blank screen with
    // no code to share, deadlocked against a guest who could never connect).
    const link = host.locator(".invite-link");
    await expect(link).toBeVisible({ timeout: 15_000 });
    const shareLink = (await link.innerText()).trim();
    const url = new URL(shareLink);

    await guest.goto(`${url.pathname}${url.search}${url.hash}`);

    // Both sides reach the match screen once the WebRTC handshake completes
    // against the local relay.
    await expect(host.locator(".board")).toBeVisible({ timeout: 30_000 });
    await expect(guest.locator(".board")).toBeVisible({ timeout: 30_000 });

    await playUntilOver(host, guest);

    const hostOver = host.locator("[data-match-over]");
    const guestOver = guest.locator("[data-match-over]");
    await expect(hostOver).toBeVisible();
    await expect(guestOver).toBeVisible();

    // Boards agree: either both call it a draw, or exactly one side won and
    // the other lost — a real disagreement would have left one side hung
    // waiting rather than both terminal.
    const outcomes = [await hostOver.getAttribute("data-match-over"), await guestOver.getAttribute("data-match-over")];
    outcomes.sort();
    expect(["draw,draw", "loss,win"]).toContain(outcomes.join(","));

    // First-price transfer conservation holds on BOTH independently-computed
    // boards: X's final balance + O's final balance is always 200.
    const hostTotal = (await balanceValue(host, "p1")) + (await balanceValue(host, "p2"));
    const guestTotal = (await balanceValue(guest, "p1")) + (await balanceValue(guest, "p2"));
    expect(hostTotal).toBe(200);
    expect(guestTotal).toBe(200);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

/** Click the first available cell on BOTH pages every tick — BTTT's PvP
 *  turn is simultaneous (both peers commit a bid + cell before either
 *  reveals), unlike an alternating-placement game where only one side has a
 *  legal move at a time. A page that already committed this turn simply
 *  no-ops on a repeat click (askMove's promise only resolves once). */
async function playUntilOver(a: Page, b: Page): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const [aOver, bOver] = await Promise.all([
      a.locator("[data-match-over]").count(),
      b.locator("[data-match-over]").count(),
    ]);
    if (aOver > 0 && bOver > 0) return;

    for (const page of [a, b]) {
      const cell = page.locator(".board__cell:not([disabled])").first();
      if ((await cell.count()) > 0) {
        await cell.click().catch(() => {});
      }
    }
    await a.waitForTimeout(200);
  }
  throw new Error("pvp match did not finish in time");
}
