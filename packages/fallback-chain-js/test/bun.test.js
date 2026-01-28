import assert from "node:assert/strict";
import { runSpec } from "./spec.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (typeof Bun !== "undefined") {
  const { test } = await import("bun:test");

  test("fallback-chain-js spec (bun)", async () => {
    await runSpec(assert, sleep);
  });
}
