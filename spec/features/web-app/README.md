---
format: https://specscore.md/feature-specification
status: Implementing
---

# Feature: Crazy Games Web App

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/sneat-games/bidding-tictactoe/spec/features/web-app?op=explore) | [Edit](https://specscore.studio/app/github.com/sneat-games/bidding-tictactoe/spec/features/web-app?op=edit) | [Ask question](https://specscore.studio/app/github.com/sneat-games/bidding-tictactoe/spec/features/web-app?op=ask) | [Request change](https://specscore.studio/app/github.com/sneat-games/bidding-tictactoe/spec/features/web-app?op=request-change) |
**Status:** Implementing
**Source Ideas:** crazy-games-web-app

## Summary

Client-only Astro + TypeScript web build of Bidding Tic-Tac-Toe for CrazyGames, with vs-bot and WebRTC vs-friend modes, a tiny Cloudflare Worker signaling relay, and a vanilla TS port of `btttplay` as the engine; packaged as a static `dist/` zip plus full Play-with-Friends SDK v3 integration.

## Problem

The Bidding Tic-Tac-Toe engine exists only as Go server code (`server-go/btttplay`, `server-go/btttmatch`); there is no playable surface. CrazyGames distributes HTML5 games as self-contained static bundles with their SDK v3 and supports a Full Implementation Play-with-Friends multiplayer surface (account module, displayed usernames, room lifecycle, invite link, instant-multiplayer, round-based rematch) that is gated on a logged-in CrazyGames account. To ship on CrazyGames AND let a player challenge a CrazyGames friend — without spinning up a Sneat backend for the MVP — the game needs a browser-runnable engine, a UI that drives the SDK v3 multiplayer surface, and a signaling channel for WebRTC that is deliberately minimal (no DB, no auth, no game state) so it honors the founder's "no server side in MVP" intent in substance. The existing Go engine remains the rule-of-record so the parallel Sneat Competios cup can reuse the same game definition server-side.

## Behavior

The web app is a single Astro site that compiles to a static `dist/` bundle. The CrazyGames SDK v3 script tag is loaded in `index.html` head and `await window.CrazyGames.SDK.init()` runs on the loading screen before any other SDK call; the environment (`local` on `localhost`/`127.0.0.1`, `crazygames` in production, `disabled` elsewhere) is checked before every SDK call, so the app degrades gracefully in preview tooling and on dev. On startup:

- If `game.inviteParams` is non-null, the app was launched from an invite link — route the player straight to the join flow with that `roomId`.
- Else if `game.isInstantMultiplayer === true`, the app was launched from the CrazyGames Multiplayer landing page — skip mode select and drop the player directly into a new private joinable room.
- Else show mode select (vs-bot / vs-friend).

In **vs-bot** mode the local TS port of `btttplay` resolves the turn against a TS bot strategy and renders the result (winner, taken cell, spent bid, tie-break flag, board outcome). After a win or a draw a rematch restarts in the same tab.

In **vs-friend** mode the inviter generates a uuid v4 `roomId`, calls `game.updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } })`, generates `game.inviteLink({ roomId })`, displays the CrazyGames username (via `user.getUser`), and registers `game.addJoinRoomListener`. The invitee arrives either via the Friends drawer (CrazyGames UI), via an invite link (`inviteParams.roomId`), or via the instant-multiplayer entry. Both peers then exchange SDP+ICE through the Cloudflare Worker signaling relay (`POST /signal/{roomId}/{role}/{type}`, Workers KV with a 1-minute TTL, zero DB, zero auth), open a WebRTC DataChannel, and play. Because Bidding Tic-Tac-Toe is a hidden-bid game, moves use a commit-reveal protocol: each peer first sends `{bidCommit: sha256(bid|salt|cell), cell}`; once both commits are in, both reveal `{bid, salt}`; each peer locally runs `resolveTurn` on the revealed moves so neither side can read the other's bid before commitment. After a win or draw, both peers can rematch in the same room without navigating back through the CrazyGames UI; `game.leftRoom()` fires only when a peer actually leaves. `settings.disableChat=true` disables chat (the MVP ships no chat UI; the settings listener is wired so a future chat surface honors it), `settings.muteAudio=true` mutes all game audio, and a settings change listener applies updates live.

The TS engine in `web/src/engine` is a faithful vanilla-TypeScript port of `server-go/btttplay` and mirrors its public surface: `Mark`, `Board`, `Outcome`, `Move`, `Game`, `TurnResult`, `newGame`, `resolveTurn`, `boardOutcome`, `emptyCells`, `parseBoard`, and the five error conditions. Test fixtures are ported from `btttplay_test.go` so any rule change in Go trips a TS test failure.

The Cloudflare Worker signaling relay lives at `web/signaling-worker/` and is deployed via `wrangler`. It exposes four routes — `POST /signal/{roomId}/host/{type}` (offer, ICE), `POST /signal/{roomId}/guest/{type}` (answer, ICE), `GET /signal/{roomId}/host` (long-poll for guest's answer/ICE), `GET /signal/{roomId}/guest` (long-poll for host's offer/ICE). Entries are stored in a Workers KV namespace with a 1-minute TTL. The `roomId` is an unguessable uuid v4, effectively a capability; no auth, no DB, no game state traverses the relay.

## Acceptance Criteria

- `web-app#ac:engine-port`: `web/src/engine` exports `Mark`, `Board`, `Outcome`, `Move`, `Game`, `TurnResult`, `newGame`, `resolveTurn`, `boardOutcome`, `emptyCells`, `parseBoard` with signatures and behaviour matching `server-go/btttplay`.
- `web-app#ac:engine-testsuite`: A TS test suite in `web/src/engine` reproduces every case in `btttplay_test.go` (Outcome, String/Parse round-trip, EmptyCells, ResolveTurn higher-bid/tie-break/errors/unchanged-on-error/game-over/budget-runs-out) and passes under the project's test runner.
- `web-app#ac:bot-mode`: A human can complete a full vs-bot match in a browser: choose bid + cell, see turn result, reach a win or draw, and start a rematch without page reload.
- `web-app#ac:sdk-init`: `await window.CrazyGames.SDK.init()` runs on the loading screen before any SDK call; the `environment` gate (`local`/`crazygames`/`disabled`) prevents SDK calls outside the supported environments so localhost and the preview tool both work without throwing.
- `web-app#ac:crazygames-friends`: A logged-in CrazyGames user sees their own username in-game; the inviter's room appears in the Friends drawer / invite link / instant-multiplayer entry; the invitee can join via any of these, and both peers' CrazyGames usernames are displayed in-game so friends can recognize each other.
- `web-app#ac:webrtc-signaling`: Two browser tabs (one inviter, one invitee via `inviteParams`) establish a WebRTC DataChannel through the CF Worker signaling relay, exchange hidden moves with commit-reveal (commit before reveal, both sides reveal simultaneously), and both boards agree on the final position with no other network round-trips.
- `web-app#ac:instant-multiplayer`: When `game.isInstantMultiplayer === true` at SDK init, the app skips mode select and drops the player directly into a new private joinable room.
- `web-app#ac:round-based-rematch`: After a win or draw, both peers can rematch in the same room without navigating back through the CrazyGames UI; `game.leftRoom()` fires only when a peer actually leaves.
- `web-app#ac:settings-compliance`: `settings.disableChat=true` disables chat (no chat UI ships; the listener is wired for future chat), `settings.muteAudio=true` mutes all game audio, and a settings change listener applies updates live.
- `web-app#ac:cf-worker-signaling`: A Cloudflare Worker defined in `web/signaling-worker/` (`index.ts`, `wrangler.jsonc`) with a KV namespace relays SDP + ICE by `roomId` with a 1-minute TTL; documented in `web/README.md`. No DB, no auth, no game state.
- `web-app#ac:static-dist`: `npm run build` produces a self-contained `dist/` that runs offline from the file system (no fetch required to start a vs-bot match) and is sized for Crazy Games submission.
- `web-app#ac:typecheck-and-lint`: `npm run typecheck` and `npm run lint` pass on the web workspace with zero errors.
- `web-app#ac:sneat-games-hosting`: A second Cloudflare Worker (`web/host-worker/`) serves the static `dist/` build at `https://bidding-tictactoe.sneat.games/`, SPA-fallback so the `#room=<code>` share link works with no server route, no legacy Firebase `deploy.yml`.
- `web-app#ac:share-link-invitation`: An inviter can copy a share link `https://bidding-tictactoe.sneat.games/#room=<6-char-code>`; a friend opening that link is dropped directly into the same match as the guest via the CF Worker signaling relay — no CrazyGames account or Friends drawer required. On CrazyGames the same `roomId` is additionally pushed to `game.updateRoom` so the Friends drawer and invite link work in parallel.

## Open Questions

- Should `roomId` be a uuid v4 (unguessable capability, long URL) or a short human-readable code (better invite UX, higher collision risk) for the `inviteLink` payload?
- Does any HTML5-SDK v3 lifecycle requirement (script-tag load order, init-time environment gate, sitelock) conflict with Astro's static output for the SDK script tag in `index.html`?
- Should the bot strategy be deterministic given a seed (for future competitive modes) or is randomness fine for the web app?

---
*This document follows the https://specscore.md/feature-specification*