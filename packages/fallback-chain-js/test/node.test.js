import test from "node:test";
import assert from "node:assert/strict";
import { runSpec } from "./spec.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("fallback-chain-js spec (node)", async () => {
  await runSpec(assert, sleep);
});
