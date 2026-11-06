import assert from "node:assert/strict";
import test from "node:test";
import { parseIncidentPeriod } from "./incident-period";

const now = new Date("2026-11-06T03:00:00Z");

function period(from: string, to: string) {
  const form = new FormData();
  form.set("from", from);
  form.set("to", to);
  return form;
}

test("selected periods preserve the exact bar boundaries, including a single minute", () => {
  const to = now.getTime();
  for (const duration of [60_000, 3_600_000, 90 * 24 * 3_600_000]) {
    assert.deepEqual(parseIncidentPeriod(period(String(to - duration), String(to)), now), {
      from: new Date(to - duration), to: now,
    });
  }
  assert.equal(parseIncidentPeriod(new FormData(), now), null);
});

test("invalid, partial, reversed, excessive and future periods are rejected", () => {
  const to = now.getTime();
  for (const [fromValue, toValue] of [["", ""], ["invalid", String(to)], [String(to), String(to)],
    [String(to), String(to - 1)], [String(to - 60_000), String(to + 1)], ["-1", "1"],
    [String(to - 91 * 24 * 3_600_000), String(to)]]) {
    assert.equal(parseIncidentPeriod(period(fromValue, toValue), now), undefined);
  }
  const partial = new FormData();
  partial.set("from", String(to - 60_000));
  assert.equal(parseIncidentPeriod(partial, now), undefined);
});
