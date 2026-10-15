import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { inArray, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryChart } from "../components/history-chart";
import { buildIncidentObservationQuery, buildIncidentPublicationQuery } from "./automatic-incidents";
import { getServiceHistoryKeys } from "./components";
import { checks } from "./db/schema";
import { affectedComponentNames, parseAffectedComponentKeys } from "./incident-components";
import { countMonitoredServiceChecks, getStatusData } from "./status";

test("each service chart shows its own site and components when all monitors are supplied", async (context) => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  context.after(() => {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });
  const now = new Date("2026-10-15T08:00:00Z");
  const data = await getStatusData(undefined, now);
  const renderService = (serviceKey: string) => renderToStaticMarkup(<HistoryChart
    services={data.services.filter((service) => service.service.key === serviceKey)}
    components={data.components} selectedRange="60m" now={now} />);

  const simpul = renderService("simpul-pad");
  assert.match(simpul, /Tampilkan 5 komponen Simpul PAD/);
  for (const name of ["Situs Simpul PAD", "Login", "QRIS", "Virtual Account BJB", "API"]) {
    assert.ok(simpul.includes(`aria-label="${name}: Belum diketahui"`), `missing Simpul monitor: ${name}`);
  }
  assert.doesNotMatch(simpul, /Situs SAPADA|Generate QRIS|Cek Status QRIS|ATR BPN|Storage/);

  const sapada = renderService("sapada");
  assert.match(sapada, /Tampilkan 8 komponen SAPADA/);
  assert.match(sapada, /Situs SAPADA: Belum diketahui/);
  assert.match(sapada, /Generate QRIS: Belum diketahui/);
  assert.doesNotMatch(sapada, /Situs Simpul PAD|aria-label="Login:|aria-label="API:/);
});

test("mixed service history keeps Simpul coverage and failures separate from SAPADA", async () => {
  const client = new PGlite();
  try {
    await client.exec(`CREATE TABLE checks (id serial primary key, service_key text, checked_at timestamptz,
      ok boolean, status_code integer, latency_ms integer, error text)`);
    const db = drizzle({ client });
    const first = new Date("2026-10-15T08:00:00Z");
    const second = new Date("2026-10-15T08:05:00Z");
    const sapadaKeys = ["sapada", "sapada-tte", "sapada-storage", "sapada-qris-generate", "sapada-va-bjb", "sapada-kode-bayar", "sapada-atr-bpn"];
    const simpulKeys = ["simpul-pad", "simpul-pad-login", "simpul-pad-qris", "simpul-pad-va", "simpul-pad-api"];
    await db.insert(checks).values([
      ...sapadaKeys.map((serviceKey) => ({ serviceKey, checkedAt: first, ok: true })),
      ...simpulKeys.filter((key) => key !== "simpul-pad-va").map((serviceKey) => ({ serviceKey, checkedAt: first, ok: serviceKey !== "simpul-pad-api" })),
      ...simpulKeys.map((serviceKey) => ({ serviceKey, checkedAt: second, ok: true })),
      { serviceKey: "sapada", checkedAt: second, ok: false },
    ]);
    const history = (serviceKey: string) => db.select({
      checkedAt: checks.checkedAt,
      observed: countMonitoredServiceChecks(serviceKey),
      failed: sql<boolean>`bool_or(${checks.ok} = false)`,
      count: sql<number>`count(*)::integer`,
    }).from(checks).where(inArray(checks.serviceKey, getServiceHistoryKeys(serviceKey)))
      .groupBy(checks.checkedAt).orderBy(checks.checkedAt);
    const simpul = await history("simpul-pad");
    assert.deepEqual(simpul.map(({ observed, failed, count }) => ({ observed, failed, count })), [
      { observed: 4, failed: true, count: 4 },
      { observed: 5, failed: false, count: 5 },
    ]);
    const sapada = await history("sapada");
    assert.deepEqual(sapada.map(({ observed, failed, count }) => ({ observed, failed, count })), [
      { observed: 7, failed: false, count: 7 },
      { observed: 1, failed: true, count: 1 },
    ]);
  } finally {
    await client.close();
  }
});

test("incident selection accepts Simpul children and rejects components from another parent", () => {
  const selected = ["simpul-pad", "simpul-pad-login", "simpul-pad-qris", "simpul-pad-va", "simpul-pad-api"];
  assert.deepEqual(parseAffectedComponentKeys("simpul-pad", selected), selected);
  assert.deepEqual(affectedComponentNames(["simpul-pad-login", "simpul-pad-api"]), ["Login", "API"]);
  assert.equal(parseAffectedComponentKeys("simpul-pad", ["sapada-qris-generate"]), undefined);
  assert.equal(parseAffectedComponentKeys("simpul-pad", ["simpul-pad-qris", "sapada-payment"]), undefined);
  assert.equal(parseAffectedComponentKeys("sapada", ["simpul-pad-qris"]), undefined);
  assert.equal(parseAffectedComponentKeys("bapenda", ["simpul-pad-api"]), undefined);
  assert.equal(parseAffectedComponentKeys("simpul-pad", []), undefined);
  assert.equal(parseAffectedComponentKeys("simpul-pad", ["simpul-pad-login", "simpul-pad-login"]), undefined);
});

test("automatic incidents group by parent and expand only the affected Simpul incident", async () => {
  const client = new PGlite();
  const dialect = new PgDialect();
  const run = async (statement: ReturnType<typeof buildIncidentPublicationQuery>) => {
    const query = dialect.sqlToQuery(statement);
    return client.query(query.sql, query.params);
  };
  type IncidentRow = { id: number; service_key: string; affected_component_keys: string[] };
  try {
    await client.exec(`
      CREATE TABLE incidents (id serial PRIMARY KEY, service_key text, affected_component_keys jsonb,
        title text, message text, kind text DEFAULT 'incident', state text DEFAULT 'investigating',
        created_at timestamptz, updated_at timestamptz, automatic boolean DEFAULT false, title_review_required boolean DEFAULT false);
      CREATE TABLE incident_updates (id serial PRIMARY KEY, incident_id int, state text, message text, created_at timestamptz);
      CREATE TABLE monitor_incident_states (service_key text PRIMARY KEY, ok boolean, checked_at timestamptz,
        failed_since timestamptz, healthy_since timestamptz, failure_count int DEFAULT 0, counted_at timestamptz, incident_id int);
    `);
    const base = new Date("2026-10-15T00:00:00Z");
    for (const minute of [0, 5, 10, 15, 20]) {
      const at = new Date(base.getTime() + minute * 60_000);
      await run(buildIncidentObservationQuery([
        { serviceKey: "sapada-qris-generate", ok: false },
        { serviceKey: "simpul-pad-login", ok: false },
        { serviceKey: "simpul-pad-qris", ok: false },
        ...(minute >= 10 ? [{ serviceKey: "simpul-pad-va", ok: false }] : []),
      ], at));
      const publication = await run(buildIncidentPublicationQuery(at));
      assert.deepEqual(publication.rows[0], {
        created: minute === 10 ? 2 : 0,
        expanded: minute === 20 ? 1 : 0,
        updates: minute === 10 ? 2 : minute === 20 ? 1 : 0,
      });
      if (minute === 10) {
        const initial = await client.query<IncidentRow>("SELECT id, service_key, affected_component_keys FROM incidents ORDER BY service_key");
        assert.deepEqual(initial.rows.map(({ service_key, affected_component_keys }) => ({ service_key, affected_component_keys })), [
          { service_key: "sapada", affected_component_keys: ["sapada-qris-generate"] },
          { service_key: "simpul-pad", affected_component_keys: ["simpul-pad-login", "simpul-pad-qris"] },
        ]);
      }
    }
    const final = await client.query<IncidentRow>("SELECT id, service_key, affected_component_keys FROM incidents ORDER BY service_key");
    assert.equal(final.rows.length, 2);
    assert.deepEqual(final.rows[0].affected_component_keys, ["sapada-qris-generate"]);
    assert.deepEqual(final.rows[1].affected_component_keys.toSorted(), ["simpul-pad-login", "simpul-pad-qris", "simpul-pad-va"]);
    const timeline = await client.query<{ service_key: string; updates: number }>(`SELECT incidents.service_key, count(*)::integer AS updates
      FROM incident_updates JOIN incidents ON incidents.id = incident_updates.incident_id GROUP BY incidents.service_key ORDER BY incidents.service_key`);
    assert.deepEqual(timeline.rows, [{ service_key: "sapada", updates: 1 }, { service_key: "simpul-pad", updates: 2 }]);
    const linked = await client.query<{ service_key: string; parent: string }>(`SELECT state.service_key, incidents.service_key AS parent
      FROM monitor_incident_states AS state JOIN incidents ON incidents.id = state.incident_id ORDER BY state.service_key`);
    assert.deepEqual(linked.rows, [
      { service_key: "sapada-qris-generate", parent: "sapada" },
      { service_key: "simpul-pad-login", parent: "simpul-pad" },
      { service_key: "simpul-pad-qris", parent: "simpul-pad" },
      { service_key: "simpul-pad-va", parent: "simpul-pad" },
    ]);
  } finally {
    await client.close();
  }
});
