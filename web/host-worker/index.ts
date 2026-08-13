/// <reference types="@cloudflare/workers-types" />
// Cloudflare Worker that deploys bidding-tictactoe.sneat.games.
//
// Serves the static `dist/` build from the repo (uploaded as a static asset)
// and rewrites the SPA fallback so `#room=<code>` share-link navigation
// works without any server route. It is the only Cloudflare worker this
// repo's source manages — vs-Friend's WebRTC signaling now runs against the
// shared `sneat-games/webrtc-relay` deployment (webrtc.sneat.games) instead
// of a worker of this repo's own; per `[[cloudflare-not-firebase-hosting]]`
// we deliberately don't extend the legacy Firebase `deploy.yml`.

interface Env {
  ASSETS: Fetcher; // Cloudflare Pages/Workers static-assets binding
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // SPA fallback for in-app routing (we use `#room=` fragments, so this
    // is mostly defensive; everything past the leading slash routes to
    // index.html anyway in a single-page build).
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url), req));
    }
    // Try the static asset first; fall back to index.html for any path
    // that isn't a file.
    const assetRes = await env.ASSETS.fetch(req);
    if (assetRes.status !== 404) return assetRes;
    return env.ASSETS.fetch(new Request(new URL("/index.html", url), req));
  },
};