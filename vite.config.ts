import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
    VitePWA({
      strategies: "generateSW",
      registerType: "autoUpdate",
      injectRegister: null, // src/lib/pwa.ts is the only registrar
      filename: "sw.js",
      manifest: false, // public/manifest.webmanifest is the manifest
      devOptions: { enabled: false },
      workbox: {
        // The whole app shell, so a Home Screen launch with no signal opens the vault.
        globPatterns: ["**/*.{js,css,html,woff2,png,ico,svg,jpg,webmanifest}"],
        // Only the latin and latin-ext font subsets are cached; other scripts load on demand.
        globIgnores: ["**/*-cyrillic-*", "**/*-cyrillic-ext-*", "**/*-greek-*", "**/*-greek-ext-*", "**/*-vietnamese-*"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/sw\.js$/, /^\/workbox-/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Map style, glyphs and tiles: viewed areas keep working offline.
            urlPattern: ({ url }) => url.origin === "https://tiles.openfreemap.org",
            handler: "CacheFirst",
            options: {
              cacheName: "alien-technology-map",
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
