import assert from "node:assert/strict";
import { runSpec } from "./spec.js";
import { runChainSpec } from "./chain.spec.js";
import { runStreamSpec } from "./stream.spec.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (typeof Bun !== "undefined") {
  const { test } = await import("bun:test");

  test("fallback-chain-js spec (bun)", async () => {
    await runSpec(assert, sleep);
  });

  test("createFallbackChain spec (bun)", async () => {
    await runChainSpec(assert, sleep);
  });

  test("fallbackStream spec (bun)", async () => {
    await runStreamSpec(assert, sleep);
  });
}
