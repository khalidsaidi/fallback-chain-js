import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/workers.test.js"],
    poolOptions: {
      workers: {
        // Minimal wrangler config so the Workers runtime has a compatibility_date.
        wrangler: { configPath: "./wrangler.jsonc" }
      }
    }
  }
});
