# Bidding Tic-Tac-Toe — Web

Client-only Astro + TypeScript web build of Bidding Tic-Tac-Toe, packaged
for both CrazyGames and `bidding-tictactoe.sneat.games`. No server-side
game state: vs-bot plays locally, vs-friend uses a tiny Cloudflare Worker
signaling relay (no DB, no auth, no game state) plus WebRTC DataChannel with
a commit-reveal protocol so neither peer sees the other's bid before
commitment.

## Local development

```sh
npm install
npm run dev          # http://localhost:4321 — SDK runs in `local` env
npm run test         # vitest (engine, bot, room, bid-input)
npm run typecheck    # astro check + tsc + worker tscconfigs
npm run lint         # eslint flat config
npm run build        # static dist/ → zippable for CrazyGames
```

To run the signaling relay locally:

```sh
npm run worker:dev   # http://localhost:8787 — KV-backed relay
```

## Deploy

| Surface                | Worker                                          | Domain                                   |
|------------------------|-------------------------------------------------|------------------------------------------|
| Static game            | `web/host-worker/`                              | `bidding-tictactoe.sneat.games`          |
| WebRTC signaling relay | `web/signaling-worker/`                         | `signal.bidding-tictactoe.sneat.games`  |
| CrazyGames build       | `web/dist/` zip uploaded via Developer Portal   | `crazygames.com/game/bidding-tic-tac-toe`|

Deploy workers:

```sh
npm run host:deploy     # bidding-tictactoe.sneat.games
npm run worker:deploy   # signal.bidding-tictactoe.sneat.games
```

Before first deploy:
- Create a KV namespace `SIGNAL` and put its id + preview_id into
  `web/signaling-worker/wrangler.jsonc` (`binding: "SIGNAL"`).
- Verify DNS for `bidding-tictactoe.sneat.games` and
  `signal.bidding-tictactoe.sneat.games` point at Cloudflare.

## Modes

- **vs Bot** — the bot strategy in `src/bot/bot.ts` plays the other side.
  The engine is the same TS port in `src/engine/btttplay.ts` that powers
  vs-friend.
- **vs Friend** — inviter generates a 6-char room code (`src/pvp/room.ts`),
  reserves it on the signaling worker, and shares
  `https://bidding-tictactoe.sneat.games/#room=<code>`. The invitee opens
  the link: the bootstrap in `src/main.ts` detects `#room=`, becomes the
  guest, and establishes a WebRTC DataChannel through the signaling worker
  (`src/pvp/peer.ts`). Moves run a commit-reveal protocol over the channel
  so both peers' hidden bids stay hidden until both are committed.
- On CrazyGames the same `roomId` is additionally pushed to
  `window.CrazyGames.SDK.game.updateRoom({...})`, so the Friends drawer,
  invite link, instant-multiplayer entry and room-join listener all work
  on top of the share-link fallback.

## CrazyGames submission

The `index.html` loads `https://sdk.crazygames.com/crazygames-sdk-v3.js`
in the `<head>` (per the v3 docs). Astro's static output is the HTML5
build CrazyGames accepts.

1. `npm run build`
2. `zip -r bidding-tictactoe.zip dist/`
3. Upload through the [CrazyGames Developer Portal](https://developer.crazygames.com/games).
4. Use the Preview tool to validate the SDK + Multiplayer surface.

## Repository layout

```
web/
├── src/
│   ├── engine/        vanilla TS port of server-go/btttplay + tests
│   ├── bot/           baseline vs-bot strategy + tests
│   ├── crazygames/    SDK v3 wrapper (init, env gate, settings, room)
│   ├── pvp/           WebRTC peer.ts (commit-reveal), room.ts (6-char ids)
│   ├── ui/            bid-input (linked slider + number), menu, vs-bot,
│   │                  vs-friend screens
│   ├── pages/
│   │   └── index.astro
│   ├── layouts/
│   │   └── Layout.astro
│   └── main.ts        bootstrap: invite-link / instant-multiplayer / menu
├── signaling-worker/  CF Worker relay (KV, no DB, no auth)
├── host-worker/       CF Worker serving dist/ at bidding-tictactoe.sneat.games
├── astro.config.mjs
├── tsconfig.json      web tsconfig (excludes signaling-worker; it has its own)
├── vitest.config.ts
└── eslint.config.mjs
```

## Go rule-of-record

The TS engine in `src/engine/btttplay.ts` is a faithful vanilla port of
`server-go/btttplay/btttplay.go` in this repo. Tests in
`src/engine/btttplay.test.ts` mirror `btttplay_test.go` fixture-for-fixture
so any rule change in Go trips a corresponding test failure on the TS side.

## Open Questions

- Should the bot strategy be deterministic (reproducible given a seed) for
  potential competitive modes later, or is randomness fine for the web app?
- Does the CrazyGames SDK v3 HTML5 script tag conflict with any sitelock
  requirement when the same `dist/` is hosted at
  `bidding-tictactoe.sneat.games`? (Expected: no — the SDK disables
  itself on non-CrazyGames domains via `environment: "disabled"`.)