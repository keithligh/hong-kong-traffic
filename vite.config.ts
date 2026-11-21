import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

const stub = fileURLToPath(new URL("./src/cache/worker-db-stub.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@electric-sql/pglite": stub,
      pg: stub,
    },
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
