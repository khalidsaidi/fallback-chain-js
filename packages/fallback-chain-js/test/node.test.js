import test from "node:test";
import assert from "node:assert/strict";
import { runSpec } from "./spec.js";
import { runChainSpec } from "./chain.spec.js";
import { runStreamSpec } from "./stream.spec.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("fallback-chain-js spec (node)", async () => {
  await runSpec(assert, sleep);
});

test("createFallbackChain spec (node)", async () => {
  await runChainSpec(assert, sleep);
});

test("fallbackStream spec (node)", async () => {
  await runStreamSpec(assert, sleep);
});
