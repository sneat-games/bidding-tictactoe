import { defineConfig } from "astro/config";
import AstroPWA from "@vite-pwa/astro";

export default defineConfig({
  // CrazyGames/itch.io accept a static HTML5 bundle; Static is the default
  // output, and every asset path stays relative (scripts/relativize-dist.mjs,
  // run as part of `npm run build` — see that script's own doc comment and
  // docs/DESIGN.md "Distribution: CrazyGames + itch.io") so the same dist/
  // zips for either portal or deploys to bidding-tictactoe.sneat.games
  // unchanged.
  output: "static",
  // WebRTC + SDK will run client-side; Astro's client:only pattern keeps the
  // game UI out of the server build.
  devToolbar: { enabled: false },
  integrations: [
    AstroPWA({
      registerType: "autoUpdate",
      // Auto-injection is OFF: main.ts registers the built service worker
      // itself via @sneat/game-kit's registerServiceWorker(), gated to
      // *.sneat.games only — never in `astro dev`, and never inside a
      // CrazyGames/itch.io iframe (see docs/DESIGN.md "Offline" and
      // APP-PLAYBOOK gotchas 2 and 9: a bare
      // `navigator.serviceWorker.register()` leaves `registerType:
      // "autoUpdate"` inert with `injectRegister: false`, so returning
      // players never get the new build).
      injectRegister: false,
      manifest: {
        name: "Bidding Tic-Tac-Toe — Sneat Games",
        short_name: "Bidding TTT",
        description:
          "Bidding Tic-Tac-Toe: classic tic-tac-toe with a twist — secretly bid coins for the square you want. vs Bot (offline-capable) or vs a friend. Installable, free, no account needed to play solo.",
        theme_color: "#4f46e5",
        background_color: "#0f172a",
        display: "standalone",
        // Relative, not root-absolute: relativize-dist.mjs would otherwise
        // have to rewrite these too, and a relative start_url/scope also
        // resolves correctly from a nested CrazyGames/itch.io mount path,
        // not just from the sneat.games root (dots-and-boxes/web's kit
        // manifest is the working reference for this).
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Explicit because `registerType: "autoUpdate"` is inert under
        // `injectRegister: false` (see the comment above): these are the
        // workbox-build generateSW options that "autoUpdate" would have set
        // had vite-plugin-pwa injected its own registration script. Without
        // them the WORKER only ever skips waiting/claims clients in
        // response to a page-sent SKIP_WAITING message — and a client
        // already stuck on a stale precache never loads the new page JS
        // that would send it, so the page-side fix in main.ts
        // (registerServiceWorker()) alone cannot rescue it. Setting both
        // here makes the worker self-activate on its own — the browser's
        // byte-diff update check on `sw.js` needs no cooperation from page
        // JS at all.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
      },
    }),
  ],
});
