import {
  fallback,
  acceptOk,
  acceptTruthy,
  acceptDefined,
  acceptStatus,
  FallbackError,
} from "../dist/index.js";

export async function runSpec(assert, makeSleep) {
  // 1) first success wins
  {
    const out = await fallback([
      () => "ok",
      () => "nope"
    ]);
    assert.equal(out, "ok");
  }

  // 2) rejects -> next candidate
  {
    const out = await fallback([
      () => Promise.reject(new Error("fail")),
      () => 123
    ]);
    assert.equal(out, 123);
  }

  // 3) fallback on unacceptable result
  {
    const out = await fallback(
      [() => ({ ok: false }), () => ({ ok: true })],
      { accept: (v) => v.ok === true }
    );
    assert.equal(out.ok, true);
  }

  // 4) per-attempt timeout enforces fallback
  {
    const sleep = makeSleep;
    const out = await fallback(
      [
        async () => {
          await sleep(50);
          return "slow";
        },
        () => "fast"
      ],
      { timeoutMs: 10 }
    );
    assert.equal(out, "fast");
  }

  // 5) non-retryable stops immediately
  {
    await assert.rejects(
      fallback(
        [
          () => Promise.reject(Object.assign(new Error("stop"), { code: "NO_FALLBACK" })),
          () => "never"
        ],
        { retryable: (e) => !(e && typeof e === "object" && "code" in e && e.code === "NO_FALLBACK") }
      )
    );
  }

  // 6) acceptOk helper
  {
    const out = await fallback(
      [() => ({ ok: false, status: 500 }), () => ({ ok: true, status: 200 })],
      { accept: acceptOk }
    );
    assert.equal(out.ok, true);
  }

  // 7) acceptStatus helper
  {
    const out = await fallback(
      [() => ({ ok: false, status: 500 }), () => ({ ok: true, status: 200 })],
      { accept: acceptStatus(200, 201) }
    );
    assert.equal(out.status, 200);
  }

  // 8) acceptTruthy helper
  {
    const out = await fallback(
      [() => null, () => 0, () => "truthy"],
      { accept: acceptTruthy }
    );
    assert.equal(out, "truthy");
  }

  // 9) acceptDefined helper
  {
    const out = await fallback(
      [() => null, () => undefined, () => 0],
      { accept: acceptDefined }
    );
    assert.equal(out, 0);
  }

  // 10) invalid timeoutMs throws a clear TypeError (never a silently-disabled timeout)
  {
    for (const bad of [-1, Number.NaN, "1000", {}]) {
      let err;
      try {
        await fallback([() => "ok"], { timeoutMs: bad });
      } catch (e) {
        err = e;
      }
      assert.equal(err instanceof TypeError, true);
      assert.equal(err.message.includes("timeoutMs must be a non-negative number"), true);
    }
  }

  // 11) function-form timeoutMs returning an invalid value throws too
  {
    let err;
    try {
      await fallback([() => "ok"], { timeoutMs: () => -5 });
    } catch (e) {
      err = e;
    }
    assert.equal(err instanceof TypeError, true);
    assert.equal(err.message.includes("timeoutMs must be a non-negative number"), true);
  }

  // 12) FallbackError carries candidate names: .named view + names in the message,
  //     while the existing .errors contract is unchanged
  {
    let err;
    try {
      await fallback([
        { name: "primary", run: () => Promise.reject(new Error("boom")) },
        () => Promise.reject(new Error("bust"))
      ]);
    } catch (e) {
      err = e;
    }
    assert.equal(err instanceof FallbackError, true);
    assert.equal(err.errors.length, 2);
    assert.equal(err.errors[0].message, "boom");
    assert.equal(err.errors[1].message, "bust");
    assert.equal(err.named.length, 2);
    assert.equal(err.named[0].name, "primary");
    assert.equal(err.named[0].error, err.errors[0]);
    assert.equal(err.named[1].name, undefined);
    assert.equal(err.named[1].error, err.errors[1]);
    assert.equal(err.message.includes("primary: Error: boom"), true);
    assert.equal(err.message.includes("All 2 fallback candidates failed"), true);
  }

  // 13) unnamed-only chains keep the plain message, and .named still aligns with .errors
  {
    let err;
    try {
      await fallback([() => Promise.reject(new Error("a")), () => Promise.reject(new Error("b"))]);
    } catch (e) {
      err = e;
    }
    assert.equal(err instanceof FallbackError, true);
    assert.equal(err.message, "All 2 fallback candidates failed");
    assert.equal(err.named.length, 2);
    assert.equal(err.named[0].name, undefined);
    assert.equal(err.named[1].error, err.errors[1]);
  }
}
