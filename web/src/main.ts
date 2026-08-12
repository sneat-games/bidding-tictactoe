// Top-level bootstrap for the Bidding Tic-Tac-Toe web app.
//
// Routing:
//   - If `#room=<id>` is in the URL, enter vs-friend mode as the GUEST.
//   - Else if the CrazyGames SDK reports `isInstantMultiplayer`, enter
//     vs-friend mode as the HOST immediately.
//   - Else show the mode-select menu (vs-bot / vs-friend).
//
// All screens are vanilla TS DOM; the CrazyGames SDK wrapper gates every
// SDK call so the same bundle runs on sneat.games (no SDK) and on CrazyGames
// (full SDK).

import { initSdk, isSdkAvailable, isInstantMultiplayer, inviteParams, addSettingsChangeListener, getSettings, gameplayStart, gameplayStop, loadingStart, loadingStop, leftRoom } from "./crazygames/sdk";
import { createThemeToggle, createGamesFooter } from "@sneat/game-kit";
import { roomIdFromLocation } from "./pvp/room";
import { renderMenu } from "./ui/menu";
import { runVsBot } from "./ui/vs-bot";
import { runVsFriend } from "./ui/vs-friend";

export async function bootstrap() {
  // Mounted synchronously, first — no network, no SDK, so neither ever
  // delays (or is delayed by) the instant-menu path below.
  mountThemeToggle();
  mountGamesFooter();

  loadingStart();
  try {
    await initSdk();
    // Apply audio-mute + chat-disable settings up front, and listen for
    // changes (CrazyGames can toggle them while the game is running).
    const s = getSettings();
    if (s) applySettings(s);
    addSettingsChangeListener(applySettings);
  } catch (e) {
    console.warn("[boot] SDK init skipped/failed:", e);
  } finally {
    loadingStop();
  }

  // The boot placeholder has done its job; leaving it up makes a running
  // match look like it is still loading.
  document.getElementById("status")?.remove();

  wireHomeLink();

  const root = document.getElementById("game")!;
  root.innerHTML = "";

  // 1. Invite-link join (sneat.games share-link OR CrazyGames invite link).
  const fromLink = roomIdFromLocation();
  if (fromLink) {
    const cgParams = inviteParams();
    if (cgParams && cgParams.room === fromLink) {
      console.debug("[boot] join via CrazyGames invite link");
    }
    gameplayStart();
    await runVsFriend(root, { as: "guest", roomId: fromLink });
    gameplayStop();
    return;
  }

  // 2. CrazyGames instant-multiplayer: drop straight into a new joinable
  //    private room.
  if (isSdkAvailable() && isInstantMultiplayer()) {
    gameplayStart();
    await runVsFriend(root, { as: "host" });
    gameplayStop();
    return;
  }

  // 3. Mode-select menu.
  const choice = await renderMenu(root);
  if (choice === "vs-bot") {
    gameplayStart();
    await runVsBot(root);
    gameplayStop();
  } else if (choice === "vs-friend") {
    gameplayStart();
    await runVsFriend(root, { as: "host" });
    gameplayStop();
  } else if (choice === "leave") {
    leftRoom();
  }
}

/** Mount the light/dark toggle into the site header's slot (see
 *  index.astro). The pre-paint <script> in Layout.astro already applies
 *  whatever theme is stored, so this only needs to reflect and toggle it —
 *  no flash, no dependency on anything async. */
function mountThemeToggle() {
  const slot = document.getElementById("theme-toggle-slot");
  if (!slot) return;
  slot.replaceWith(createThemeToggle().el);
}

/** Cross-promotion footer (see @sneat/game-kit's games-footer.ts):
 *  "More from Sneat Games", linking every other kit game plus the
 *  sneat.games landing page. Persistent across menu/match/invite screens,
 *  same as the header above it. */
function mountGamesFooter() {
  document.getElementById("app")?.append(createGamesFooter({ current: "bidding-tictactoe" }));
}

function applySettings(s: { disableChat?: boolean; muteAudio?: boolean }) {
  if (s.muteAudio) document.documentElement.classList.add("muted");
  else document.documentElement.classList.remove("muted");
  // No chat UI ships in the MVP; `disableChat` is honored by virtue of
  // having no chat surface. The listener is wired so a future chat
  // implementation lifts correctly.
}

/**
 * The title doubles as "back to the main menu".
 *
 * It is a real anchor so middle-click and open-in-new-tab behave, but a plain
 * same-page navigation would only drop the `#room=` fragment without
 * reloading — leaving a match, its timers and any live peer connection
 * running behind the menu. Reloading is the one reset that is guaranteed to
 * be complete, and the app boots in well under a tenth of a second now that
 * nothing blocks on a third-party script.
 */
function wireHomeLink() {
  const link = document.getElementById("home-link");
  if (!link) return;
  link.addEventListener("click", (e) => {
    // Leave modified clicks to the browser (new tab, new window, download).
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button !== 0) return;
    e.preventDefault();
    if (window.location.hash) {
      // Drop `#room=...` so a reload lands on the menu, not back in the room.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    window.location.reload();
  });
}
