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
npm run build        # static dist/ → relative-path zippable for CrazyGames/itch.io
npm run e2e          # Playwright (builds first — see playwright.config.ts)
npm run gen-icons    # regenerate public/icons/*.png from src/assets/icon.svg
```

To run the signaling relay locally:

```sh
npm run worker:dev   # http://localhost:8787 — KV-backed relay
npm run relay        # same thing, named to match the other Sneat Games repos
```

`npm run e2e` builds and serves the app on its own port (4770, not 4321 —
see playwright.config.ts) and starts a SECOND, isolated instance of this
same signaling-worker on its own port (8798) rather than 8787: unlike the
newer kit-based games, this repo's `src/pvp/room.ts` and `src/pvp/peer.ts`
predate `@sneat/game-kit`'s shared `pvp/` module and speak this repo's own
(non-gameId-namespaced) signaling protocol against its own deployed
`signal.bidding-tictactoe.sneat.games` worker — reusing whatever happens to
already be on 8787 locally (e.g. a real `webrtc-relay` dev instance, which
speaks a different protocol) would silently break the PvP e2e journey
instead of failing loudly. See playwright.config.ts's top comment for the
full reasoning.

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
  vs-friend. The bot commits its hidden bid at the start of the turn, so the
  human always plays against the 20s answer clock. When the turn decides the
  match — either side can complete a line — and the bot is richer, it bids
  `opponentBudget + 1`: the cheapest stake the opponent cannot outbid. A
  persistent **New game** button restarts a match at any point; it arms on the
  first click and only restarts on a second.
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

## Match screen

Both modes render one 2x2 grid (`src/ui/match-screen.ts`):

```
┌──────────────┬──────────────┐
│ balances     │ bid panel    │
├──────────────┼──────────────┤
│ board        │ game log     │
└──────────────┴──────────────┘
```

The left column is `--board-width` (the board's own width), so the balances
card and the board are the same width; the right column is `--side-width`, so
the bid panel and the game log are the same width. Below 720px the grid
collapses to a single column in that same order.

## Turn clock

A turn is bounded by two deadlines (`src/ui/turn-clock.ts`), both applied by
`src/ui/ask-move.ts` in both modes:

| Situation | Deadline | Auto-submitted bid |
|---|---|---|
| The opponent's bid is in, yours is not | 10s vs a friend, 20s vs the bot | `0` — the only real bid wins and is transferred to you |
| Neither player has bid | 30s | `floor(own / 2)`, or `opponent + 1` when strictly richer |

The bot gets the longer window because nobody is kept waiting by a slow human,
and the bot's bid is in from the first instant of every turn — a 10s window
would put the human on a permanent sprint.

Both are **self-enforced**: a client only ever auto-submits its OWN move,
through the same commit-reveal path a manual move takes, so a timeout can
never leave the two peers' boards disagreeing. When a peer stops answering
altogether the match is abandoned with a notice rather than resolved by
guesswork. The 10s clock replaces the 30s one as soon as either bid lands, and
the pending auto-bid is shown in the bid panel before it fires.

The clock is a session-layer rule — `resolveTurn` already discards the loser's
cell, so neither `server-go/btttplay` nor its TS port changes to support it.

## Theme

Light and dark themes, following the system preference by default, with a
toggle in the site header (`@sneat/game-kit`'s `createThemeToggle()`, mounted
in `main.ts`). A pre-paint `<script>` in `Layout.astro` applies a stored
choice before first paint, so switching (or reloading with an explicit
choice already stored) never flashes the wrong theme. The choice persists to
`localStorage["sneat-games-theme"]`.

## Colours

One colour per player, used everywhere that player appears — the mark on the
board, their balance bar, their bid bar in the log, and their name in prose:
**X is green, O is red** in both themes. Green and red carry no win/loss
meaning in the log; the winning bid is marked by weight and a `✓` instead.
Every coloured mark is also written out as its letter, so the scheme never
carries information on its own.

| | Light | Dark |
|---|---|---|
| X | `#059669` (kit `--p1`) | `#22c55e` (this game's original palette) |
| O | `#e11d48` (kit `--p2`) | `#ef4444` (this game's original palette) |

Light-theme X/O are aliased to `@sneat/game-kit`'s `--p1`/`--p2` tokens
(`--x-colour`/`--o-colour` in `src/styles/global.css`), which read better
against a light surface (~3.8:1 / ~4.7:1 contrast) than this game's original
dark-tuned hex codes would (~2.3:1 on white). Dark-theme X/O keep the exact
palette this game shipped with before it had a light theme at all — already
~7.8:1 / ~4.7:1 against the dark surface — rather than switching to the
kit's own (different) dark `--p1`/`--p2`, so a returning dark-mode player
sees no colour shift.

## CrazyGames submission

The SDK script is **not** in the document head. `src/crazygames/sdk.ts`
injects `https://sdk.crazygames.com/crazygames-sdk-v3.js` on demand and only
on a CrazyGames surface (served from a CrazyGames domain, framed by one, or
forced with `?cgsdk=1`), then awaits `init()` before any other SDK call per
the v3 docs. Off CrazyGames the SDK only ever reports
`environment: "disabled"`, so loading it is pure cost — a static tag in the
head is render-blocking and delayed the menu on
`bidding-tictactoe.sneat.games` by 7-10s. Astro's static output is still the
HTML5 build CrazyGames accepts.

To exercise the SDK path locally, open `http://localhost:4321/?cgsdk=1`.

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
│   ├── pvp/           WebRTC peer.ts (commit-reveal), room.ts (6-char ids),
│   │                  turn-inbox.ts (per-turn message buffer)
│   ├── ui/            match-screen (2x2 layout), balances, bid-panel,
│   │                  game-log, bid-input, turn-clock, ask-move, menu,
│   │                  win-line (end-of-match highlight), vs-bot + vs-friend
│   │                  screens
│   ├── styles/        global.css — @sneat/game-kit's theme.css (design
│   │                  tokens, both themes, shared chrome) plus this game's
│   │                  own board/mark/invite-screen styles, restated on the
│   │                  kit's tokens
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

### `@sneat/game-kit` dependency

The design system (tokens, both themes, the theme toggle, shared chrome
components, and the cross-game promo footer) comes from
`@sneat/game-kit` (`github:sneat-games/game-kit#v0.1.1`), pinned as a normal
`dependencies` entry in `package.json`. The kit is public and MIT-licensed;
this repo stays GPL-3.0 — consuming an MIT dependency from a GPL-3.0 project
is fine (GPL projects may depend on more-permissively-licensed code). Only
`@sneat/game-kit/theme.css` (CSS, zero JS cost) and a handful of named
imports from the kit's main entry (`createThemeToggle`, `createGamesFooter`)
are used; the rest of the kit (auction/, clock/, pvp/, its own CrazyGames SDK
wrapper, its own board-agnostic UI components) is tree-shaken out of the
build — this game keeps its own engine, bot, PvP transport and CrazyGames
wrapper unchanged.

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