import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import { stageTrackerAssets } from "./scripts/stage-assets.mjs";

declare const process: { env: { VITEST?: string } };

const testing = Boolean(process.env.VITEST);

if (!testing) stageTrackerAssets();

export default defineConfig({
  publicDir: testing ? false : "tracker-assets",
  plugins: testing
    ? []
    : [cloudflare({ experimental: { headersAndRedirectsDevModeSupport: true } })],
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      "public/**",
      "server.js",
      "lib/**",
      "README.md",
      "fixtures/**",
      "scripts/**",
      "tools/**",
      "third_party_licenses/**",
      "tracker-assets/**",
      "dist/**",
      ".cloudflare/**",
      ".wrangler/**",
      "worker-configuration.d.ts",
    ],
  },
  lint: {
    ignorePatterns: [
      "public/**",
      "server.js",
      "lib/**",
      "README.md",
      "fixtures/**",
      "scripts/**",
      "tools/**",
      "third_party_licenses/**",
      "tracker-assets/**",
      "dist/**",
      ".cloudflare/**",
      ".wrangler/**",
      "worker-configuration.d.ts",
    ],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
