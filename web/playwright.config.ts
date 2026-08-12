import { defineConfig, devices } from "@playwright/test";

// e2e webServer stack: a production-equivalent build served by `astro
// preview`, plus a LOCAL signaling relay for the vs-Friend/PvP journey.
//
// Unlike hex/dots-and-boxes/reversi, BTTT does not consume the kit's
// pvp/room.ts + pvp/peer.ts modules or the shared webrtc-relay — it
// predates them and still runs its own bespoke signaling protocol
// (non-gameId-namespaced routes; see src/pvp/room.ts, src/pvp/peer.ts and
// signaling-worker/index.ts) against its own deployed
// signal.bidding-tictactoe.sneat.games worker. DESIGN.md notes "BTTT
// migrates later" — that migration is out of scope here, and reshaping the
// wire protocol to match the kit's gameId-namespaced test-relay.mjs would
// require a coordinated client+worker deploy this task isn't chartered to
// make. So this suite's "relay" is BTTT's OWN signaling-worker
// (signaling-worker/index.ts), run locally via `wrangler dev` (local mode —
// no Cloudflare account needed, verified) instead of
// @sneat/game-kit/test-relay.mjs — the same purpose (an isolated, ephemeral,
// local double instead of the real deployed relay), different backend.
//
// RELAY_PORT is deliberately NOT the conventional :8787 a developer's
// `npm run relay`/`worker:dev` binds to for manual testing. On this machine
// something else can legitimately already be listening on 8787 — in
// practice, an unrelated sibling repo's own real `webrtc-relay` dev server,
// left running from earlier work. Reusing that would be actively wrong for
// BTTT specifically (unlike hex/dots-and-boxes/reversi, whose relay clients
// speak the SAME gameId-namespaced protocol a real webrtc-relay does): every
// request would 404 as "route not found" against the wrong protocol, and
// the failure would read as a broken PvP feature rather than a port
// collision. So e2e gets its OWN port, and src/pvp/room.ts +
// src/pvp/peer.ts are told about it at BUILD time via the Astro public-env
// PUBLIC_SIGNALING_BASE (unset in every normal dev/production build, so
// this is inert outside e2e) rather than changing those files' :8787
// fallback, which stays exactly what `npm run relay`'s own doc comment and
// the README's "npm run worker:dev # http://localhost:8787" promise.
//
// The relay's own routes 404 a plain GET / (see signaling-worker/index.ts's
// parseRoute), so its entry uses `port` (a raw TCP-connect readiness check)
// rather than `url`. reuseExistingServer is false on BOTH entries: a stale
// or foreign occupant of either port must fail the run loudly (EADDRINUSE)
// instead of silently testing against the wrong backend.
//
// APP_PORT 4770 is this repo's OWN preview port, deliberately not 4321
// (every sibling sneat-games app answers happily there) and not any port
// already claimed by a sibling (see game-kit/docs/APP-PLAYBOOK.md gotcha
// 6) — checked against hex (4761), dots-and-boxes (4791), reversi (4795),
// gomoku (4762), four-in-a-row (4744), domineering (4799),
// ultimate-tictactoe (4763), greed-game (4766), y-game (4374) at the time
// this was picked.
const APP_PORT = 4770;
const RELAY_PORT = 8798;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // A single shared `astro preview` + relay stack backs every spec, and
  // several specs open real WebRTC DataChannels or drive turn clocks.
  // Running those concurrently on a loaded dev/CI machine produces pure
  // resource-contention timeouts that have nothing to do with the product —
  // one worker trades run time for determinism, the right trade for a small
  // suite (game-kit/docs/APP-PLAYBOOK.md gotcha 6).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      // Baked in at build time (Vite/Astro resolve import.meta.env.* during
      // the build, not at runtime) — this is what points the built bundle's
      // SIGNALING_BASE at RELAY_PORT instead of the :8787 default.
      env: { PUBLIC_SIGNALING_BASE: `http://localhost:${RELAY_PORT}` },
    },
    {
      command: `wrangler dev --config signaling-worker/wrangler.jsonc --port ${RELAY_PORT}`,
      port: RELAY_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
