import { defineConfig, devices } from "@playwright/test";

// e2e webServer stack: a production-equivalent build served by `astro
// preview`, plus @sneat/game-kit's in-process relay mimic (`test-relay.mjs`)
// for the vs-Friend/PvP journey — the same double hex/reversi/dots-and-boxes
// use, now that this repo's src/ui/vs-friend.ts speaks the kit's shared
// `pvp` module (hostPeer/guestPeer/reserveRoomId) against the shared
// webrtc.sneat.games relay instead of its own bespoke signaling-worker.
//
// UNLIKE every sibling's playwright.config.ts, this suite does NOT reuse the
// kit's conventional :8787 (the port `defaultRelayBase()` picks for any
// localhost origin, and the port every sibling's relay entry deliberately
// shares with a developer's real `webrtc-relay` dev server). On this
// machine something can legitimately already be listening on 8787 — a real
// `webrtc-relay` dev instance, left running from other work — and while its
// protocol IS compatible (gameId-namespaced, same as this suite's own),
// this suite still wants an ISOLATED, disposable double: sharing 8787 would
// run against whatever room state that real instance already holds, and a
// stale room from a previous run could make a fresh test flaky in a way
// that has nothing to do with this game. So RELAY_PORT is this repo's own,
// and src/ui/vs-friend.ts is told about it at BUILD time via the Astro
// public-env PUBLIC_RELAY_BASE (unset in every normal dev/production build,
// so that branch is inert outside e2e; see vs-friend.ts's
// `relayBaseOverride()`), fed straight into the kit's `relayBase` option on
// every reserveRoomId/hostPeer/guestPeer call rather than changing the
// kit's own :8787 default.
//
// The relay's own routes all 404 a bare GET / (see test-relay.mjs), so its
// entry uses `port` (a raw TCP-connect readiness check) rather than `url`.
// Both entries set `reuseExistingServer: false`: a stale or foreign
// occupant of either port must fail the run loudly (EADDRINUSE) instead of
// silently testing against the wrong backend — this is what keeps the
// isolation promise above real rather than aspirational.
//
// APP_PORT 4770 is this repo's OWN preview port, deliberately not 4321
// (every sibling sneat-games app answers happily there) and not any port
// already claimed by a sibling (see game-kit/docs/APP-PLAYBOOK.md gotcha
// 6) — checked against hex (4761), dots-and-boxes (4791), reversi (4795),
// gomoku (4762), four-in-a-row (4744), domineering (4799),
// ultimate-tictactoe (4763), greed-game (4766), y-game (4374) at the time
// this was picked. RELAY_PORT 8798 was this repo's own signaling-worker
// port pre-migration and stays unclaimed by any sibling for the same
// reason.
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
      // the build, not at runtime) — this is what points the built
      // bundle's relayBase at RELAY_PORT instead of the kit's :8787 default.
      env: { PUBLIC_RELAY_BASE: `http://localhost:${RELAY_PORT}` },
    },
    {
      // `npm run relay` takes no port itself (defaults to 8787, matching
      // every sibling's manual-dev promise) — `-- ${RELAY_PORT}` forwards
      // this suite's own port through to test-relay.mjs's `argv[2]`.
      command: `npm run relay -- ${RELAY_PORT}`,
      port: RELAY_PORT,
      reuseExistingServer: false,
      timeout: 20_000,
    },
  ],
});
