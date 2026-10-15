import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildIncidentObservationQuery, buildIncidentPublicationQuery } from "./automatic-incidents";
import { components, getComponent, monitoredPaymentComponentKeys, paymentComponentKeys, sapadaComponents, sapadaHistoryKeys } from "./components";
import { alertFailureName } from "./whatsapp-alerts";

test("current payment labels and historical keys remain distinct", () => {
  assert.deepEqual(components.filter((item) => (paymentComponentKeys as readonly string[]).includes(item.key)).map((item) => item.name),
    ["Generate QRIS", "Cek Status QRIS", "Virtual Account BJB", "Kode Bayar"]);
  assert.equal(sapadaComponents.length, 7);
  assert.equal(components.some((item) => String(item.key) === "sapada-payment"), false);
  assert.equal(getComponent("sapada-payment")?.name, "Payment API");
  assert.ok(sapadaHistoryKeys.includes("sapada-payment"));
  assert.ok(sapadaHistoryKeys.includes("sapada-qris"));
  assert.ok(!sapadaHistoryKeys.includes("sapada-qris-check"));
  assert.equal(getComponent("sapada-qris")?.name, "QRIS (gabungan)");
  assert.deepEqual(paymentComponentKeys.map(alertFailureName), ["Generate QRIS", "Cek Status QRIS", "Virtual Account BJB", "Kode Bayar"]);
  assert.equal(alertFailureName("sapada-payment"), "Payment API");
});

test("legacy manual incidents cover new payment methods and isolated failures target only that method", async () => {
  const client = new PGlite();
  const dialect = new PgDialect();
  const base = new Date("2026-10-07T00:00:00Z");
  const run = async (statement: ReturnType<typeof buildIncidentPublicationQuery>) => {
    const query = dialect.sqlToQuery(statement);
    return client.query(query.sql, query.params);
  };
  try {
    await client.exec(`
      CREATE TABLE incidents (id serial PRIMARY KEY, service_key text, affected_component_keys jsonb,
        title text, message text, kind text DEFAULT 'incident', state text DEFAULT 'investigating',
        created_at timestamptz, updated_at timestamptz, automatic boolean DEFAULT false, title_review_required boolean DEFAULT false);
      CREATE TABLE incident_updates (id serial PRIMARY KEY, incident_id int, state text, message text, created_at timestamptz);
      CREATE TABLE monitor_incident_states (service_key text PRIMARY KEY, ok boolean, checked_at timestamptz,
        failed_since timestamptz, healthy_since timestamptz, failure_count int DEFAULT 0, counted_at timestamptz, incident_id int);
      INSERT INTO incidents (service_key, affected_component_keys, title, message)
        VALUES ('sapada', '["sapada-payment"]', 'Gangguan pembayaran', 'Catatan');
    `);
    for (const minute of [0, 5, 10]) {
      const at = new Date(base.getTime() + minute * 60_000);
      await run(buildIncidentObservationQuery(monitoredPaymentComponentKeys.map((serviceKey) => ({ serviceKey, ok: false })), at));
      await run(buildIncidentPublicationQuery(at));
    }
    const covered = await client.query<{ incident_id: number }>("SELECT incident_id FROM monitor_incident_states");
    assert.deepEqual(covered.rows.map((row) => row.incident_id), [1, 1, 1]);
    assert.equal((await client.query("SELECT * FROM incidents")).rows.length, 1);
    assert.equal((await client.query("SELECT * FROM incident_updates")).rows.length, 0);

    await client.exec(`TRUNCATE incidents, incident_updates, monitor_incident_states RESTART IDENTITY;
      INSERT INTO incidents (service_key, affected_component_keys, title, message)
        VALUES ('sapada', '["sapada-qris"]', 'Gangguan QRIS', 'Catatan');`);
    for (const minute of [0, 5, 10]) {
      const at = new Date(base.getTime() + minute * 60_000);
      await run(buildIncidentObservationQuery(monitoredPaymentComponentKeys.map((serviceKey) => ({ serviceKey, ok: serviceKey !== "sapada-qris-generate" })), at));
      await run(buildIncidentPublicationQuery(at));
    }
    const qrisCovered = await client.query<{ incident_id: number }>("SELECT incident_id FROM monitor_incident_states WHERE service_key = 'sapada-qris-generate'");
    assert.equal(qrisCovered.rows[0].incident_id, 1);
    assert.equal((await client.query("SELECT * FROM incidents")).rows.length, 1);
    assert.equal((await client.query("SELECT * FROM incident_updates")).rows.length, 0);

    await client.exec("TRUNCATE incidents, incident_updates, monitor_incident_states RESTART IDENTITY");
    for (const minute of [0, 5, 10]) {
      const at = new Date(base.getTime() + minute * 60_000);
      await run(buildIncidentObservationQuery(monitoredPaymentComponentKeys.map((serviceKey) => ({ serviceKey, ok: serviceKey !== "sapada-qris-generate" })), at));
      await run(buildIncidentPublicationQuery(at));
    }
    const isolated = await client.query<{ affected_component_keys: string[]; message: string }>("SELECT * FROM incidents");
    assert.equal(isolated.rows.length, 1);
    assert.deepEqual(isolated.rows[0].affected_component_keys, ["sapada-qris-generate"]);
    assert.match(isolated.rows[0].message, /QRIS/);
    assert.doesNotMatch(isolated.rows[0].message, /Virtual Account|Kode Bayar/);

    await client.exec("TRUNCATE incidents, incident_updates, monitor_incident_states RESTART IDENTITY");
    for (const minute of [0, 5, 10]) {
      const at = new Date(base.getTime() + minute * 60_000);
      await run(buildIncidentObservationQuery(paymentComponentKeys.map((serviceKey) => ({ serviceKey, ok: serviceKey !== "sapada-qris-check" })), at));
      await run(buildIncidentPublicationQuery(at));
    }
    assert.equal((await client.query("SELECT * FROM incidents")).rows.length, 0);
  } finally {
    await client.close();
  }
});
