#!/usr/bin/env node
// Rewrites root-absolute asset URLs in the built dist/ to be relative, so
// the zip stays playable from any subpath — a CrazyGames game path, an
// itch.io `html.itch.zone` bundle, or a plain `file://` open of dist/
// (docs/DESIGN.md's Distribution section requires "builds use relative
// asset paths"). Mirrors dots-and-boxes/web/scripts/relativize-dist.mjs,
// the working reference this was copied from.
//
// Astro (verified empirically against v5) always emits root-absolute URLs
// for hashed assets (`/_astro/...`) and for @vite-pwa/astro's manifest
// link — `vite.base` and Astro's own `base` option either don't affect the
// CSS link at all or produce a malformed `.//` path, so this is a small,
// dependency-free postbuild pass instead of fighting that configuration
// surface. It only ever touches `href="/..."` / `src="/..."` attribute
// values (never `//host` protocol-relative or `http(s)://` absolute URLs),
// and the icon/start_url/scope fields inside manifest.webmanifest (which
// the Web App Manifest spec resolves relative to the manifest's own URL,
// so a leading "/" there is exactly as broken off-root as it is in HTML) —
// astro.config.mjs already configures those fields without a leading "/",
// so this is defence in depth for the manifest, not the primary fix.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

function relativizeHtmlAttrs(html) {
  // `href="/foo"` / `src="/foo"` -> `href="./foo"` / `src="./foo"`.
  // Negative lookahead excludes `//host` (protocol-relative) URLs; a plain
  // leading "/" is always root-absolute and always what we want to fix.
  return html.replace(/((?:href|src)=")\/(?!\/)/g, "$1./");
}

function relativizeManifest(json) {
  const manifest = JSON.parse(json);
  if (typeof manifest.start_url === "string" && manifest.start_url.startsWith("/")) {
    manifest.start_url = "." + manifest.start_url.slice(1) || ".";
  }
  if (typeof manifest.scope === "string" && manifest.scope.startsWith("/")) {
    manifest.scope = "." + manifest.scope.slice(1) || ".";
  }
  if (Array.isArray(manifest.icons)) {
    for (const icon of manifest.icons) {
      if (typeof icon.src === "string" && icon.src.startsWith("/")) {
        icon.src = icon.src.slice(1);
      }
    }
  }
  return JSON.stringify(manifest);
}

if (!existsSync(dist)) {
  console.error(`relativize-dist: ${dist} does not exist — run \`astro build\` first`);
  process.exit(1);
}

const indexHtml = join(dist, "index.html");
if (existsSync(indexHtml)) {
  const before = readFileSync(indexHtml, "utf8");
  const after = relativizeHtmlAttrs(before);
  writeFileSync(indexHtml, after);
  console.log(`relativize-dist: rewrote ${(before.match(/(href|src)="\//g) ?? []).length} absolute ref(s) in index.html`);
}

const manifestPath = join(dist, "manifest.webmanifest");
if (existsSync(manifestPath)) {
  writeFileSync(manifestPath, relativizeManifest(readFileSync(manifestPath, "utf8")));
  console.log("relativize-dist: rewrote manifest.webmanifest icon/start_url/scope paths");
}
