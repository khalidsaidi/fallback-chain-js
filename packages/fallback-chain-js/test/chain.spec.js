import { createFallbackChain } from "../dist/index.js";

export async function runChainSpec(assert, sleep) {
  // 1) a failing candidate is put on cooldown and deprioritized next run
  {
    let t = 1_000;
    const now = () => t;
    const order = [];
    const chain = createFallbackChain(
      [
        { name: "primary", run: () => { order.push("primary"); throw new Error("down"); } },
        { name: "backup", run: () => { order.push("backup"); return "b"; } }
      ],
      { cooldownMs: 5_000, now }
    );

    assert.equal(await chain.run(), "b");
    assert.deepEqual(order, ["primary", "backup"]);

    order.length = 0;
    assert.equal(await chain.run(), "b"); // primary cooling → backup goes first
    assert.deepEqual(order, ["backup"]);

    // 2) cooldown expiry: primary is tried first again
    t += 6_000;
    order.length = 0;
    assert.equal(await chain.run(), "b");
    assert.deepEqual(order, ["primary", "backup"]);
  }

  // 3) success resets failure/cooldown memory
  {
    let t = 0;
    const now = () => t;
    let failuresLeft = 1;
    const order = [];
    const chain = createFallbackChain(
      [
        {
          name: "flaky",
          run: () => {
            order.push("flaky");
            if (failuresLeft-- > 0) throw new Error("blip");
            return "recovered";
          }
        },
        { name: "backup", run: () => { order.push("backup"); return "b"; } }
      ],
      { cooldownMs: 1_000, now }
    );

    assert.equal(await chain.run(), "b"); // flaky fails → cooldown
    t += 2_000; // cooldown expired
    assert.equal(await chain.run(), "recovered"); // flaky succeeds → reset
    const h = chain.health();
    assert.equal(h[0].consecutiveFailures, 0);
    assert.equal(h[0].coolingDown, false);
    assert.equal(h[0].cooldownUntil, 0);

    order.length = 0;
    assert.equal(await chain.run(), "recovered"); // healthy again → first
    assert.deepEqual(order, ["flaky"]);
  }

  // 4) cooling-down candidates are deprioritized, never skipped outright
  {
    let calls = 0;
    const chain = createFallbackChain(
      [
        () => { calls++; throw new Error("a down"); },
        () => { calls++; throw new Error("b down"); }
      ],
      { cooldownMs: 60_000 }
    );

    await assert.rejects(chain.run());
    assert.equal(calls, 2);
    // Both cooling down now — they must still be tried as last resort.
    await assert.rejects(chain.run());
    assert.equal(calls, 4);
  }

  // 5) failureThreshold: cooldown only after N consecutive failures
  {
    let t = 0;
    const now = () => t;
    const order = [];
    const chain = createFallbackChain(
      [
        { name: "p", run: () => { order.push("p"); throw new Error("down"); } },
        { name: "s", run: () => { order.push("s"); return "ok"; } }
      ],
      { cooldownMs: 5_000, failureThreshold: 2, now }
    );

    await chain.run(); // p fails once — below threshold, no cooldown
    assert.equal(chain.health()[0].coolingDown, false);
    order.length = 0;
    await chain.run(); // p still tried first, fails again → threshold hit
    assert.deepEqual(order, ["p", "s"]);
    assert.equal(chain.health()[0].coolingDown, true);
    order.length = 0;
    await chain.run(); // now deprioritized
    assert.deepEqual(order, ["s"]);
  }

  // 6) health() snapshot shape
  {
    const boom = new Error("boom");
    const chain = createFallbackChain(
      [
        { name: "a", run: () => { throw boom; } },
        { name: "b", run: () => "ok" }
      ],
      { cooldownMs: 60_000 }
    );
    await chain.run();
    const h = chain.health();
    assert.equal(h.length, 2);
    assert.equal(h[0].index, 0);
    assert.equal(h[0].name, "a");
    assert.equal(h[0].consecutiveFailures, 1);
    assert.equal(h[0].coolingDown, true);
    assert.equal(h[0].lastError, boom);
    assert.equal(h[1].name, "b");
    assert.equal(h[1].consecutiveFailures, 0);
    assert.equal(h[1].coolingDown, false);

    // 7) reset() clears memory
    chain.reset();
    const r = chain.health();
    assert.equal(r[0].consecutiveFailures, 0);
    assert.equal(r[0].coolingDown, false);
  }

  // 8) concurrent runs interleave sanely
  {
    let primaryCalls = 0;
    const chain = createFallbackChain(
      [
        {
          name: "primary",
          run: async () => {
            primaryCalls++;
            await sleep(10);
            throw new Error("slow failure");
          }
        },
        { name: "backup", run: () => "b" }
      ],
      { cooldownMs: 60_000 }
    );

    const [r1, r2] = await Promise.all([chain.run(), chain.run()]);
    assert.equal(r1, "b");
    assert.equal(r2, "b");
    assert.equal(primaryCalls, 2); // both snapshots saw primary as healthy
    const h = chain.health();
    assert.equal(h[0].consecutiveFailures, 2);
    assert.equal(h[0].coolingDown, true);
    // A third run now deprioritizes primary
    assert.equal(await chain.run(), "b");
    assert.equal(primaryCalls, 2);
  }

  // 9) caller aborts do NOT count against candidate health
  {
    const chain = createFallbackChain(
      [
        {
          name: "p",
          run: ({ signal }) =>
            new Promise((_, reject) => {
              signal.addEventListener("abort", () =>
                reject(Object.assign(new Error("Aborted"), { name: "AbortError" }))
              );
            })
        }
      ],
      { cooldownMs: 60_000 }
    );

    const controller = new AbortController();
    const pending = chain.run({ signal: controller.signal });
    const guarded = pending.catch(() => "aborted");
    await sleep(5);
    controller.abort();
    assert.equal(await guarded, "aborted");
    const h = chain.health();
    assert.equal(h[0].consecutiveFailures, 0);
    assert.equal(h[0].coolingDown, false);
  }

  // 10) per-run overrides merge over base options
  {
    const makeChain = () =>
      createFallbackChain(
        [() => ({ ok: false }), () => ({ ok: true })],
        { accept: (v) => v.ok === true }
      );
    const out = await makeChain().run();
    assert.equal(out.ok, true);
    // per-run override: accept anything → first candidate's value sticks
    const anything = await makeChain().run({ accept: () => true });
    assert.equal(anything.ok, false);
  }
}
