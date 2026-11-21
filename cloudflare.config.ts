import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  accountId: "2afdf6b7c62695451004d204e795ed9a",
  worker: defineWorker({
    name: "hong-kong-traffic",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-21",
    cache: { enabled: true },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
    },
  }),
});
