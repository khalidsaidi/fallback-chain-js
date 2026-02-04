import {
  fallback,
  acceptOk,
  acceptTruthy,
  acceptDefined,
  acceptStatus,
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
}
