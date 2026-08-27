import { fallbackStream, FallbackError, TimeoutError } from "../dist/index.js";

async function collect(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

export async function runStreamSpec(assert, sleep) {
  // 1) happy path: first candidate streams through untouched
  {
    async function* good() {
      yield "a";
      yield "b";
      yield "c";
    }
    const out = await collect(fallbackStream([() => good()]));
    assert.deepEqual(out, ["a", "b", "c"]);
  }

  // 2) error BEFORE first chunk → fall back to next candidate
  {
    const outcomes = [];
    async function* broken() {
      throw new Error("provider down");
    }
    async function* backup() {
      yield "x";
      yield "y";
    }
    const out = await collect(
      fallbackStream(
        [
          { name: "broken", run: () => broken() },
          { name: "backup", run: () => backup() }
        ],
        { onAttempt: (i) => outcomes.push(`${i.name}:${i.outcome}`) }
      )
    );
    assert.deepEqual(out, ["x", "y"]);
    assert.deepEqual(outcomes, ["broken:rejected", "backup:success"]);
  }

  // 3) error AFTER first chunk propagates — committed, no mid-stream fallback
  {
    let backupCalled = false;
    async function* midFail() {
      yield "a";
      throw new Error("mid-stream failure");
    }
    const received = [];
    let caught;
    try {
      for await (const chunk of fallbackStream([
        () => midFail(),
        () => {
          backupCalled = true;
          return (async function* () {
            yield "never";
          })();
        }
      ])) {
        received.push(chunk);
      }
    } catch (err) {
      caught = err;
    }
    assert.deepEqual(received, ["a"]);
    assert.equal(caught.message, "mid-stream failure");
    assert.equal(backupCalled, false);
  }

  // 4) timeoutMs-to-first-chunk: slow candidate abandoned; its late chunk
  //    never leaks; its cleanup (finally) runs
  {
    let slowFinally = false;
    const outcomes = [];
    async function* slow() {
      try {
        await sleep(60);
        yield "late";
      } finally {
        slowFinally = true;
      }
    }
    async function* fast() {
      yield "f1";
      yield "f2";
    }
    const out = await collect(
      fallbackStream(
        [
          { name: "slow", run: () => slow() },
          { name: "fast", run: () => fast() }
        ],
        {
          timeoutMs: 15,
          onAttempt: (i) => outcomes.push(`${i.name}:${i.outcome}`)
        }
      )
    );
    assert.deepEqual(out, ["f1", "f2"]);
    assert.deepEqual(outcomes, ["slow:timeout", "fast:success"]);
    await sleep(100); // let the abandoned generator settle
    assert.equal(slowFinally, true);
    assert.deepEqual(out, ["f1", "f2"]); // late chunk did not leak
  }

  // 5) acceptFirstChunk veto → fallback before anything reaches the consumer
  {
    let vetoedClosed = false;
    const outcomes = [];
    async function* garbage() {
      try {
        yield "<html>rate limited</html>";
        yield "more garbage";
      } finally {
        vetoedClosed = true;
      }
    }
    async function* clean() {
      yield "real data";
    }
    const out = await collect(
      fallbackStream(
        [
          { name: "garbage", run: () => garbage() },
          { name: "clean", run: () => clean() }
        ],
        {
          acceptFirstChunk: (chunk) => !chunk.includes("<html>"),
          onAttempt: (i) => outcomes.push(`${i.name}:${i.outcome}`)
        }
      )
    );
    assert.deepEqual(out, ["real data"]);
    assert.deepEqual(outcomes, ["garbage:unacceptable", "clean:success"]);
    await sleep(10);
    assert.equal(vetoedClosed, true);
  }

  // 6) consumer break propagates cleanup to the inner iterator
  {
    // break on the FIRST chunk (before the internal for-await starts)
    let innerFinally1 = false;
    async function* src1() {
      try {
        yield 1;
        yield 2;
      } finally {
        innerFinally1 = true;
      }
    }
    for await (const chunk of fallbackStream([() => src1()])) {
      void chunk;
      break;
    }
    assert.equal(innerFinally1, true);

    // break on a LATER chunk (inside the internal for-await)
    let innerFinally2 = false;
    async function* src2() {
      try {
        yield 1;
        yield 2;
        yield 3;
      } finally {
        innerFinally2 = true;
      }
    }
    const seen = [];
    for await (const chunk of fallbackStream([() => src2()])) {
      seen.push(chunk);
      if (chunk === 2) break;
    }
    assert.deepEqual(seen, [1, 2]);
    assert.equal(innerFinally2, true);
  }

  // 7) outer abort before first chunk → throws, no fallback
  {
    let backupCalled = false;
    const controller = new AbortController();
    const stream = fallbackStream(
      [
        ({ signal }) => ({
          [Symbol.asyncIterator]() {
            return {
              next: () =>
                new Promise((_, reject) => {
                  signal.addEventListener("abort", () =>
                    reject(Object.assign(new Error("Aborted"), { name: "AbortError" }))
                  );
                })
            };
          }
        }),
        () => {
          backupCalled = true;
          return (async function* () {
            yield "never";
          })();
        }
      ],
      { signal: controller.signal }
    );
    const pending = collect(stream);
    const guarded = pending.catch((e) => e);
    await sleep(5);
    controller.abort();
    const err = await guarded;
    assert.equal(err.name, "AbortError");
    assert.equal(backupCalled, false);
  }

  // 8) all candidates fail → FallbackError with .errors
  {
    let caught;
    try {
      await collect(
        fallbackStream([
          async function* () {
            throw new Error("one");
          },
          async function* () {
            throw new Error("two");
          }
        ])
      );
    } catch (err) {
      caught = err;
    }
    assert.equal(caught instanceof FallbackError, true);
    assert.equal(caught.errors.length, 2);
    assert.equal(caught.errors[1].message, "two");
  }

  // 9) retryable=false stops immediately
  {
    let backupCalled = false;
    let caught;
    try {
      await collect(
        fallbackStream(
          [
            async function* () {
              throw Object.assign(new Error("bad request"), { status: 400 });
            },
            async function* () {
              backupCalled = true;
              yield "never";
            }
          ],
          { retryable: (e) => e?.status !== 400 }
        )
      );
    } catch (err) {
      caught = err;
    }
    assert.equal(caught.message, "bad request");
    assert.equal(backupCalled, false);
  }

  // 10) clean zero-chunk completion completes the output stream (no fallback)
  {
    let backupCalled = false;
    async function* empty() {}
    const out = await collect(
      fallbackStream([
        () => empty(),
        () => {
          backupCalled = true;
          return (async function* () {
            yield "never";
          })();
        }
      ])
    );
    assert.deepEqual(out, []);
    assert.equal(backupCalled, false);
  }

  // 11) timeout applies only to the FIRST chunk
  {
    async function* slowTail() {
      yield "head";
      await sleep(50);
      yield "tail";
    }
    const out = await collect(fallbackStream([() => slowTail()], { timeoutMs: 20 }));
    assert.deepEqual(out, ["head", "tail"]);
  }

  // 12) sync iterables are accepted as candidate sources
  {
    const out = await collect(fallbackStream([() => [1, 2, 3]]));
    assert.deepEqual(out, [1, 2, 3]);
  }

  // 13) TimeoutError lands in FallbackError.errors when everything times out
  {
    let caught;
    try {
      await collect(
        fallbackStream(
          [
            async function* () {
              await sleep(50);
              yield "slow";
            }
          ],
          { timeoutMs: 10 }
        )
      );
    } catch (err) {
      caught = err;
    }
    assert.equal(caught instanceof FallbackError, true);
    assert.equal(caught.errors[0] instanceof TimeoutError, true);
  }
}
