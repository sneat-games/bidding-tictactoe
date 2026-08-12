#!/usr/bin/env node
// Rasterizes src/assets/icon.svg into the PWA manifest's PNG icons
// (public/icons/icon-{192,512}.png, committed — see astro.config.mjs's
// AstroPWA manifest.icons). Run manually via `npm run gen-icons` whenever
// icon.svg changes; not part of the build (the PNGs are checked in, like
// every other static asset). Mirrors dots-and-boxes/web/scripts/gen-icons.mjs.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const svgPath = join(root, "src/assets/icon.svg");
const outDir = join(root, "public/icons");

mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const out = join(outDir, `icon-${size}.png`);
  await sharp(svgPath).resize(size, size).png().toFile(out);
  console.log(`gen-icons: wrote ${out}`);
}
