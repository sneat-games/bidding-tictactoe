# Bidding Tic-Tac-Toe

Open-source part of Bidding Tic-Tac-Toe game by [prizarena.com](https://prizarena.com/)

**Twitter account**: [@TicTacToeBid](https://twitter.com/TicTacToeBid)

## Source of truth

**SpecScore is the source of truth for this project.** The product rule, the
MVP scope, and every acceptance criterion live under `spec/` and are driven by
the SpecScore CLI (`specscore spec lint`, `specscore feature change-status`,
etc.). Code is the implementation of those specs, not the other way around —
when a rule changes, update the spec first, then the code:

```sh
specscore spec list                 # show ideas + features
specscore feature info web-app      # show the live Feature + ACs
specscore spec lint                 # enforce lint
```

The active Feature is [`web-app`](spec/features/web-app/README.md) — the
client-only Astro + TypeScript web build for CrazyGames and
`bidding-tictactoe.sneat.games`. Its acceptance criteria are normative; the
Go `server-go/btttplay` package is the rule-of-record and the TS port in
`web/src/engine` mirrors it fixture-for-fixture.

See `web/README.md` for web build/deploy details and Cloudflare worker layout.