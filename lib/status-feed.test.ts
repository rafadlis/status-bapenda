import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatusFeed, statusFeedMonitorKeys } from "./status-feed";

const now = new Date("2026-10-01T04:00:00Z");
const healthy = () =>
  statusFeedMonitorKeys.map((serviceKey) => ({
    serviceKey,
    checkedAt: now,
    ok: true,
  }));

test("Simpul outages do not change either version of SAPADA's public feed", () => {
  const checks = [...healthy(), ...["simpul-pad", "simpul-pad-login", "simpul-pad-qris", "simpul-pad-va", "simpul-pad-api"]
    .map((serviceKey) => ({ serviceKey, checkedAt: now, ok: false }))];
  for (const version of [1, 2] as const) {
    const feed = buildStatusFeed(checks, [], now, true, version);
    assert.equal(feed.service.state, "operational");
    assert.ok(feed.components.every((component) => component.key.startsWith("sapada")));
    assert.ok(feed.paymentMethods.every((component) => component.key.startsWith("sapada")));
  }
});

test("version 1 feed keeps five monitors and rolls up independent payment failures", () => {
  const checks = healthy();
  assert.equal(buildStatusFeed(checks, [], now).service.state, "operational");
  checks.find((item) => item.serviceKey === "sapada-qris-generate")!.ok = false;
  const feed = buildStatusFeed(checks, [], now);
  assert.equal(feed.service.state, "degraded");
  assert.deepEqual(feed.components.map((item) => item.key), ["sapada", "sapada-tte", "sapada-storage", "sapada-payment", "sapada-atr-bpn"]);
  assert.equal(feed.components[3].state, "degraded");
  assert.deepEqual(feed.paymentMethods.map((item) => [item.key, item.state]), [
    ["sapada-qris", "degraded"],
    ["sapada-va-bjb", "operational"],
    ["sapada-kode-bayar", "operational"],
  ]);
});

test("missing, stale and future checks are unknown and source failure clears incidents", () => {
  assert.equal(buildStatusFeed([], [], now).service.state, "unknown");
  const checks = healthy();
  checks[0].checkedAt = new Date(now.getTime() - 20 * 60_000);
  assert.equal(buildStatusFeed(checks, [], now).components[0].state, "unknown");
  checks[0].checkedAt = new Date(now.getTime() + 120_000);
  assert.equal(buildStatusFeed(checks, [], now).components[0].state, "unknown");
  const feed = buildStatusFeed(healthy(), [], now, false);
  assert.equal(feed.available, false);
  assert.equal(feed.service.state, "unknown");
  assert.ok(feed.paymentMethods.every((item) => item.state === "unknown" && item.checkedAt === null));
});

test("payment aggregation preserves failure precedence and the oldest complete healthy observation", () => {
  const checks = healthy();
  const va = checks.find((item) => item.serviceKey === "sapada-va-bjb")!;
  va.checkedAt = new Date(now.getTime() - 60_000);
  assert.equal(buildStatusFeed(checks, [], now).components[3].checkedAt, va.checkedAt.toISOString());
  const partial = checks.filter((item) => item.serviceKey !== "sapada-va-bjb");
  assert.equal(buildStatusFeed(partial, [], now).components[3].state, "unknown");
  partial.find((item) => item.serviceKey === "sapada-qris-generate")!.ok = false;
  const failed = buildStatusFeed(partial, [], now).components[3];
  assert.equal(failed.state, "degraded");
  assert.equal(failed.checkedAt, now.toISOString());
});

test("public projection excludes probe details and resolved updates", () => {
  const checks = healthy().map((item) => ({
    ...item,
    error: "private provider URL",
    statusCode: 500,
  }));
  const incident = {
    id: 1,
    title: "Gangguan pembayaran",
    message: "Pembaruan terbaru",
    state: "identified",
    kind: "incident",
    updatedAt: now,
    affectedComponentKeys: ["sapada-qris", "sapada-va-bjb"],
    serviceKey: "sapada",
  };
  const feed = buildStatusFeed(
    checks,
    [incident, { ...incident, id: 2, state: "resolved" }],
    now,
  );
  assert.equal(feed.incidents.length, 1);
  assert.equal(feed.incidents[0].message, "Pembaruan terbaru");
  assert.deepEqual(feed.incidents[0].affectedComponentKeys, ["sapada-payment"]);
  assert.deepEqual(feed.incidents[0].affectedPaymentMethodKeys, ["sapada-qris", "sapada-va-bjb"]);
  assert.doesNotMatch(
    JSON.stringify(feed),
    /private provider|statusCode|serviceKey/,
  );
});

test("incident payment detail distinguishes broad scope from specific and unrelated methods", () => {
  const incident = {
    id: 1, title: "Gangguan", message: "Pembaruan", kind: "incident",
    state: "identified", updatedAt: now, affectedComponentKeys: null as string[] | null,
  };
  for (const keys of [null, ["sapada-payment"], ["sapada-payment", "sapada-qris"]]) {
    const feed = buildStatusFeed(healthy(), [{ ...incident, affectedComponentKeys: keys }], now);
    assert.equal(feed.incidents[0].affectedPaymentMethodKeys, null);
  }
  const specific = buildStatusFeed(healthy(), [{ ...incident, affectedComponentKeys: ["sapada-kode-bayar", "sapada-kode-bayar", "sapada-tte"] }], now);
  assert.deepEqual(specific.incidents[0].affectedPaymentMethodKeys, ["sapada-kode-bayar"]);
  assert.deepEqual(specific.incidents[0].affectedComponentKeys, ["sapada-payment", "sapada-tte"]);
  const unrelated = buildStatusFeed(healthy(), [{ ...incident, affectedComponentKeys: ["sapada-tte"] }], now);
  assert.deepEqual(unrelated.incidents[0].affectedPaymentMethodKeys, []);
});

test("version 2 exposes separate generator and skipped status rows without counting a check", () => {
  const checks = healthy().filter((item) => item.serviceKey !== "sapada-qris-check");
  checks.push({ serviceKey: "sapada-qris-check", checkedAt: now, ok: false });
  const feed = buildStatusFeed(checks, [], now, true, 2);
  assert.equal(feed.version, 2);
  assert.equal(feed.service.state, "operational");
  assert.equal(feed.service.checkedAt, now.toISOString());
  assert.equal(feed.components[3].state, "operational");
  assert.deepEqual(feed.paymentMethods.map((item) => [item.key, item.state]), [
    ["sapada-qris-generate", "operational"], ["sapada-qris-check", "skipped"],
    ["sapada-va-bjb", "operational"], ["sapada-kode-bayar", "operational"],
  ]);
  assert.equal(feed.paymentMethods[1].checkedAt, null);
  checks.find((item) => item.serviceKey === "sapada-qris-generate")!.ok = false;
  assert.equal(buildStatusFeed(checks, [], now, true, 2).service.state, "degraded");
});

test("old combined QRIS results do not become generator observations", () => {
  const checks = healthy().filter((item) => !item.serviceKey.startsWith("sapada-qris"));
  checks.push({ serviceKey: "sapada-qris", checkedAt: now, ok: true });
  assert.equal(buildStatusFeed(checks, [], now, true, 2).paymentMethods[0].state, "unknown");
});

test("version 1 omits status-only incidents while version 2 retains their specific scope", () => {
  const incident = { id: 1, title: "Cek status", message: "Catatan", kind: "incident", state: "identified",
    updatedAt: now, affectedComponentKeys: ["sapada-qris-check"] };
  assert.equal(buildStatusFeed(healthy(), [incident], now).incidents.length, 0);
  const feed = buildStatusFeed(healthy(), [incident], now, true, 2);
  assert.deepEqual(feed.incidents[0].affectedPaymentMethodKeys, ["sapada-qris-check"]);
  const mixed = buildStatusFeed(healthy(), [{ ...incident, affectedComponentKeys: ["sapada-qris-check", "sapada-tte"] }], now);
  assert.deepEqual(mixed.incidents[0].affectedComponentKeys, ["sapada-tte"]);
  assert.deepEqual(mixed.incidents[0].affectedPaymentMethodKeys, []);
});
