---
format: https://specscore.md/idea-specification
status: Implementing
---
# Idea: Crazy Games Web App

**Status:** Implementing
**Date:** 2026-08-11
**Owner:** alex
**Promotes To:** web-app
**Supersedes:** —
**Related Ideas:** —

## Problem Statement

How might we let any logged-in CrazyGames player challenge a CrazyGames friend to a hidden-bid tic-tac-toe match in the browser, with negligible server infrastructure, packaged as a self-contained HTML5 game?

## Context

The game rule and a Go match/session layer already exist in this repo
(`server-go/btttplay`, `server-go/btttmatch`). `btttplay` is a small (~290 LOC)
pure engine for the hidden-bid auction variant of tic-tac-toe. There is no
frontend of any kind and no live surface. CrazyGames distributes HTML5 games
with their SDK v3 and supports a Full Implementation "Play with Friends"
surface: account module, in-game username display, `game.updateRoom` /
`inviteLink` / `addJoinRoomListener` / `leftRoom`, `isInstantMultiplayer`, and
round-based rematch. CrazyGames explicitly sanctions WebRTC-direct rooms
("The room doesn't have to exist on the server... players connected to each
other directly, via WebRTC for example"), but the SDK does NOT relay WebRTC
signaling between peers, and the `data` module is per-user (synced across one
user's devices, not a shared mailbox), so it cannot be a signaling channel.

The founder has decided the MVP is client-only for game logic: single-player
vs. a bot fully in-browser, and player-to-player over WebRTC with a tiny
Cloudflare Worker acting as signaling relay only (no DB, no auth, no game
state). A parallel Sneat Competios cup (server-side, via the future
`sneat-co/bidding-tictactoe` host facade and `ext-competios`) is tracked
separately and is out of scope here.

## Recommended Direction

Port `server-go/btttplay` to vanilla TypeScript as a faithful mirror of the Go
rule-of-record, ship an Astro + TypeScript client that compiles to a static
bundle, and run two game modes in the browser:

1. **vs Bot** — a bot strategy in TS plays the other side locally; the
   engine is the same TS port.
2. **vs Friend over WebRTC** — brokered by a minimal Cloudflare Worker
   signaling relay (`POST /signal/{roomId}/{role}/{type}`, SDP + ICE forwarded
   by `roomId`, entries in Workers KV with a 1-minute TTL, zero auth, zero
   DB). The CrazyGames SDK v3 drives the social plumbing:
   `game.updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } })`,
   `game.inviteLink({ roomId })`, `game.addJoinRoomListener` for in-game
   joins, `game.inviteParams` for join-from-link at startup, and
   `game.isInstantMultiplayer` drops a player straight into a private room
   from the Multiplayer landing page. Both peers display CrazyGames
   usernames (required for the Multiplier landing page) via
   `user.getUser` / `user.listFriends`.

Because Bidding Tic-Tac-Toe is a hidden-bid game, peers cannot just send
`{bid, cell}` — that would leak the bid. Moves use a commit-reveal protocol
over the DataChannel: each peer first sends
`{bidCommit: sha256(bid|salt|cell)}`; once both commits are received, both
reveal `{bid, salt}`; each peer locally runs `resolveTurn` on the revealed
moves. This preserves the engine's hidden-bid semantics over the wire.

Astro keeps the bundle small (no React/Ionic weight) and matches the
founder's "vanilla JS or TS" choice. Compilation to WASM was rejected as too
heavy for such a small engine.

## Alternatives Considered

- **Compile `btttplay` to WASM and call it from JS.** Rejected by founder as
  too heavy for ~290 LOC; adds a Go toolchain to the web build and inflates
  the Crazy Games zip. Vanilla TS keeps one source of truth in the language
  the client speaks.
- **Manual SDP+ICE copy-paste (truly no server) for vs-friend.** Rejected:
  breaks the in-game "challenge a friend" experience CrazyGames expects and
  clashes with the Full Implementation multiplayer surface that gets the
  game onto the Multiplayer landing page. The CF Worker signaling relay is
  deliberately minimal (no DB, no auth, no game state) so it honours the
  founder's "no server side in MVP" intent in substance — no Sneat backend,
  no `btttmatch`, no coins — while not sabotaging the social UX.
- **Server-authoritative MVP via `sneat-go`.** Rejected for the MVP scope.
  The Sneat Competios cup (parallel workstream) will provide server authority
  when it lands; the Crazy Games MVP does not depend on it.
- **Ship vs-bot only, defer PvP.** Rejected by founder: "challenge a Crazy
  Games friend" is a stated requirement; the Full Implementation multiplayer
  surface is in scope.

## MVP Scope

A single self-contained HTML5 build that CrazyGames accepts as a static
zip, plus a tiny Cloudflare Worker signaling relay. Two modes: vs-bot
end-to-end (board renders, hidden-bid UI, turn resolves, rematch and
share), and vs-friend over WebRTC using the CF Worker signaling relay and
the CrazyGames v3 SDK Play-with-Friends surface (account, friends, room,
invite link, instant-multiplayer, round-based rematch, displayed CrazyGames
usernames). One user per tab, no Sneat login, no backend game state.

## Not Doing (and Why)

- Server-side match making, Sneat accounts, leaderboards, in-game purchases,
  ads integration (separate Full Launch concern) — not in this MVP.
- Wallet / coins / payouts — `btttmatch` already models these server-side
  and the Competios cup will use them; the web MVP treats budget as a plain
  int.
- Persisted state across sessions beyond what the CrazyGames `data` module
  offers by default — out of MVP scope; a single match in a tab.
- In-game chat — not shipped (the `disableChat` setting is honored by virtue
  of having no chat UI, and the settings listener is still wired so a
  future chat surfaces correctly).
- Bot difficulty levels beyond a single baseline strategy — kept simple for
  v1.
- WebGL/Canvas — a plain DOM/CSS board is enough for tic-tac-toe.
- Leaderboards, banners, rewarded ads — Full Launch monetization work,
  separate from this MVP.

## Key Assumptions to Validate

| Tier | Assumption | How to validate |
|------|------------|-----------------|
| Must-be-true | `btttplay` engine rules fit fully in a vanilla TS port with no behavioural drift | Port + port fixtures, run typecheck and tests on the TS side |
| Must-be-true | CrazyGames accepts a static Astro build as an HTML5 game (no required server round-trip for game logic) | Build `dist/` zip and review against Crazy Games SDK v3 submission requirements |
| Must-be-true | The CF Worker signaling relay (no DB, no auth, zero game state) is acceptable to CrazyGames as "the room doesn't have to exist on the server... via WebRTC" | Verify against the multiplayer-requirements page; the relay handles only SDP/ICE forwarding |
| Should-be-true | Commit-reveal over WebRTC DataChannel preserves the hidden-bid semantics well enough for an MVP | Playtest a vs-friend match and confirm neither peer can read the other's bid before reveal |
| Might-be-true | A single baseline bot strategy is fun enough for v1 | Playtest after the build runs |

## SpecScore Integration

- **New Features this would create:** `web-app` (this idea promotes to it)
- **Existing Features affected:** none — no prior Feature existed; `spec/`
  was empty before this work.
- **Dependencies:** the Go `btttplay` package as the rule-of-record; Crazy
  Games SDK v3 docs for the packaging and multiplayer surface; a Cloudflare
  Workers account for the signaling relay; the parallel Sneat Competios cup
  is an independent workstream and not a dependency of this MVP.

## Open Questions

- Should `roomId` be a uuid v4 (unguessable capability, long URL) or a
  short human-readable code (better invite UX, higher collision risk) for
  the `inviteLink` payload?
- Does any HTML5-SDK v3 lifecycle requirement (script-tag load order,
  init-time environment gate, sitelock) conflict with Astro's static
  output for the SDK script tag in `index.html`?
- Should the bot strategy be deterministic (reproducible given a seed) for
  potential competitive modes later, or is randomness fine for the web app?

---
*This document follows the https://specscore.md/idea-specification*