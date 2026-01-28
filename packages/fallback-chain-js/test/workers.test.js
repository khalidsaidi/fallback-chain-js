import { runSpec } from "./spec.js";

const isVitest = Boolean(import.meta.vitest) ||
  (typeof process !== "undefined" && process.env && process.env.VITEST);

if (isVitest) {
  const { describe, it, expect } = await import("vitest");

  const assertAdapter = {
    equal: (a, b) => expect(a).toBe(b),
    rejects: async (p) => expect(p).rejects.toBeTruthy()
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  describe("fallback-chain-js spec (workers)", () => {
    it("passes", async () => {
      await runSpec(assertAdapter, sleep);
    });
  });
}
