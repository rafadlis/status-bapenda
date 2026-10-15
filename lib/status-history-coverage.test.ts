import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { inArray, sql } from "drizzle-orm";
import { monitoredComponents, sapadaHistoryKeys } from "./components";
import { checks } from "./db/schema";
import { countMonitoredSapadaChecks } from "./status";

test("legacy QRIS observations retain history but cannot complete current monitor coverage", async () => {
  const client = new PGlite();
  try {
    await client.exec(`CREATE TABLE checks (id serial primary key, service_key text, checked_at timestamptz,
      ok boolean, status_code integer, latency_ms integer, error text)`);
    const db = drizzle({ client });
    const currentKeys = ["sapada", ...monitoredComponents.filter((component) => component.parentKey === "sapada").map((component) => component.key)];
    const legacyKeys = currentKeys.map((key) => key === "sapada-qris-generate" ? "sapada-qris" : key);
    const legacyAt = new Date("2026-10-07T08:00:00Z");
    const currentAt = new Date("2026-10-07T08:05:00Z");
    await db.insert(checks).values([
      ...legacyKeys.map((serviceKey) => ({ serviceKey, checkedAt: legacyAt, ok: serviceKey !== "sapada-qris" })),
      ...[...currentKeys, "sapada-qris", "sapada-qris-check", "sapada-qris-generate"].map((serviceKey) => ({
        serviceKey, checkedAt: currentAt, ok: true,
      })),
    ]);
    const runs = await db.select({
      checkedAt: checks.checkedAt,
      observed: countMonitoredSapadaChecks(),
      failed: sql<boolean>`bool_or(${checks.ok} = false)`,
      total: sql<number>`count(*)::integer`,
    }).from(checks).where(inArray(checks.serviceKey, sapadaHistoryKeys))
      .groupBy(checks.checkedAt).orderBy(checks.checkedAt);
    assert.equal(runs[0].total, 7);
    assert.equal(runs[0].observed, currentKeys.length - 1);
    assert.equal(runs[0].failed, true);
    assert.equal(runs[1].observed, currentKeys.length);
    assert.equal(runs[1].failed, false);
  } finally {
    await client.close();
  }
});
