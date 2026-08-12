// ESLint flat config (v9+).
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import astro from "eslint-plugin-astro";
import globals from "globals";

export default [
  {
    ignores: [
      "dist",
      "node_modules",
      ".astro",
      ".wrangler",
      "host-worker",
      "signaling-worker",
      "test-results",
      "playwright-report",
    ],
  },
  js.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ["src/**/*.ts", "e2e/**/*.ts", "signaling-worker/**/*.ts", "scripts/**/*.mjs", "*.config.ts", "*.config.mjs"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-undef": "off", // TS already handles this; the DOM/WebRTC globals confuse eslint.
    },
  },
  {
    files: ["src/**/*.astro"],
    languageOptions: {
      parser: astro.parser,
      parserOptions: { extraFileExtensions: [".astro"] },
    },
  },
];