import { defineConfig } from "astro/config";

export default defineConfig({
  // CrazyGames accepts a static HTML5 bundle; Static is the default output.
  output: "static",
  // WebRTC + SDK will run client-side; Astro's client:only pattern keeps the
  // game UI out of the server build.
  devToolbar: { enabled: false },
});