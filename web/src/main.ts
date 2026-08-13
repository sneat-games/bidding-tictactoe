// Top-level bootstrap for the Bidding Tic-Tac-Toe web app.
//
// Routing:
//   - If `#room=<id>` is in the URL, enter vs-friend mode as the GUEST.
//   - Else if the CrazyGames SDK reports `isInstantMultiplayer`, enter
//     vs-friend mode as the HOST immediately.
//   - Else show the mode-select menu (vs-bot / vs-friend).
//
// After a vs-bot or vs-friend session ends (user clicks "Back to menu"),
// the menu re-renders so the player can pick another mode without a page
// reload.
//
// All screens are vanilla TS DOM; the CrazyGames SDK wrapper gates every
// SDK call so the same bundle runs on sneat.games (no SDK) and on CrazyGames
// (full SDK).

import { initSdk, isSdkAvailable, isInstantMultiplayer, inviteParams, addSettingsChangeListener, getSettings, gameplayStart, gameplayStop, loadingStart, loadingStop } from "./crazygames/sdk";
import { roomIdFromLocation } from "./pvp/room";
import { loadState, clearAll } from "./pvp/game-store";
import { renderMenu } from "./ui/menu";
import { runVsBot } from "./ui/vs-bot";
import { runVsFriend } from "./ui/vs-friend";

export async function bootstrap() {
  loadingStart();
  try {
    await initSdk();
    const s = getSettings();
    if (s) applySettings(s);
    addSettingsChangeListener(applySettings);
  } catch (e) {
    console.warn("[boot] SDK init skipped/failed:", e);
  } finally {
    loadingStop();
  }

  const root = document.getElementById("game")!;

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

  // 3. Resume a saved game if one exists (page reload mid-match).
  const saved = await loadState();
  if (saved && saved.mode === "vs-bot") {
    gameplayStart();
    await runVsBot(root);
    gameplayStop();
  } else if (saved && saved.mode === "vs-friend" && saved.roomId && saved.as) {
    if (!fromLink) {
      renderReconnectingStatus(root);
      gameplayStart();
      await runVsFriend(root, { as: saved.as, roomId: saved.roomId });
      gameplayStop();
    }
  }

  // 4. Mode-select menu, loops back whenever a session ends.
  while (true) {
    root.innerHTML = "";
    clearAll(); // wipe game state + log entries before fresh menu
    const choice = await renderMenu(root);
    if (choice === "vs-bot") {
      gameplayStart();
      await runVsBot(root);
      gameplayStop();
    } else if (choice === "vs-friend") {
      gameplayStart();
      await runVsFriend(root, { as: "host" });
      gameplayStop();
    }
  }
}

function renderReconnectingStatus(root: HTMLElement) {
  root.innerHTML = "";
  const overlay = document.createElement("div");
  overlay.className = "reconnecting";
  const spinner = document.createElement("div");
  spinner.className = "reconnecting__spinner";
  const text = document.createElement("p");
  text.className = "reconnecting__text";
  text.textContent = "Reconnecting…";
  const sub = document.createElement("p");
  sub.className = "reconnecting__sub";
  sub.textContent = "Re-establishing WebRTC channel";
  overlay.append(spinner, text, sub);
  root.append(overlay);
}

function applySettings(s: { disableChat?: boolean; muteAudio?: boolean }) {
  if (s.muteAudio) document.documentElement.classList.add("muted");
  else document.documentElement.classList.remove("muted");
  // No chat UI ships in the MVP; `disableChat` is honored by virtue of
  // having no chat surface. The listener is wired so a future chat
  // implementation lifts correctly.
}
