import assert from "node:assert/strict";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { buildIncidentObservationQuery, buildIncidentPublicationQuery, buildIncidentRecoveryQuery } from "./automatic-incidents";
import { buildIncidentUnlinkQuery } from "./incident-management";

// Tests use transaction-local tables. They never publish incidents or send messages.
const url = process.env.INCIDENT_POLICY_TEST_DATABASE_URL;
const base = new Date("2026-10-02T00:00:00Z");
const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);

function setup() {
  const db = neon(url!);
  const dialect = new PgDialect();
  const compile = (statement: ReturnType<typeof buildIncidentPublicationQuery>) => {
    const query = dialect.sqlToQuery(statement);
    return db.query(query.sql, query.params);
  };
  const tables = [
    db.query(`CREATE TEMP TABLE incidents (
      id serial PRIMARY KEY, service_key text NOT NULL, affected_component_keys jsonb,
      title text NOT NULL, message text NOT NULL, kind text NOT NULL DEFAULT 'incident', state text NOT NULL DEFAULT 'investigating',
      created_at timestamptz, updated_at timestamptz, resolved_at timestamptz, automatic boolean DEFAULT false, title_review_required boolean DEFAULT false
    ) ON COMMIT DROP`),
    db.query(`CREATE TEMP TABLE incident_updates (
      id serial PRIMARY KEY, incident_id int REFERENCES incidents(id) ON DELETE CASCADE, state text, message text, created_at timestamptz
    ) ON COMMIT DROP`),
    db.query(`CREATE TEMP TABLE monitor_incident_states (
      service_key text PRIMARY KEY, ok boolean NOT NULL, checked_at timestamptz NOT NULL,
      failed_since timestamptz, healthy_since timestamptz, failure_count int DEFAULT 0, counted_at timestamptz NOT NULL, incident_id int REFERENCES incidents(id)
    ) ON COMMIT DROP`),
  ];
  return { db, tables, compile };
}

test("PostgreSQL: confirm, group, expand, preserve edits and suppress repeats", { skip: !url }, async () => {
  const { db, tables, compile } = setup();
  const statements = [...tables];
  const expected = [0, 0, 1, 0, 0, 0, 0];
  for (const minute of [0, 5, 10, 10, 9, 15, 20]) {
    if (minute === 15) statements.push(db.query("UPDATE incidents SET title = 'Judul diperiksa', state = 'identified', title_review_required = false"));
    statements.push(compile(buildIncidentObservationQuery([
      { serviceKey: "sapada", ok: false }, { serviceKey: "sapada-qris-generate", ok: false },
      ...(minute >= 10 ? [{ serviceKey: "sapada-storage", ok: false }] : []),
    ], at(minute))));
    statements.push(compile(buildIncidentPublicationQuery(at(minute))));
  }
  statements.push(db.query("SELECT * FROM incidents"));
  statements.push(db.query("SELECT * FROM incident_updates ORDER BY id"));
  const rows = await db.transaction(statements);
  const publications = [4, 6, 8, 10, 12, 15, 17].map((index) => rows[index][0]);
  assert.deepEqual(publications.map((row) => row.created), expected);
  assert.equal(publications[publications.length - 1].expanded, 1);
  assert.equal(rows[18].length, 1);
  assert.equal(rows[18][0].title, "Judul diperiksa");
  assert.equal(rows[18][0].state, "identified");
  assert.deepEqual(rows[18][0].affected_component_keys.sort(), ["sapada", "sapada-qris-generate", "sapada-storage"]);
  assert.equal(rows[19].length, 2);
});

test("PostgreSQL: short errors, large gaps, retries and recovery do not fabricate confirmation", { skip: !url }, async () => {
  const { db, tables, compile } = setup();
  const statements = [...tables];
  const sequences = {
    sapada: [[0, false], [5, true], [10, false], [15, false]],
    "struk-berhadiah": [[0, false], [15, false], [20, false]],
    "simpul-pad": [[0, false], [0.2, false], [10, false]],
  } as const;
  for (const [serviceKey, observations] of Object.entries(sequences)) {
    for (const [minute, ok] of observations) {
      statements.push(compile(buildIncidentObservationQuery([{ serviceKey, ok }], at(minute))));
      statements.push(compile(buildIncidentPublicationQuery(at(minute))));
    }
  }
  statements.push(db.query("SELECT count(*)::int AS count FROM incidents"));
  const rows = await db.transaction(statements);
  assert.equal(rows[rows.length - 1][0].count, 0);
});

test("PostgreSQL: covered manual incidents suppress duplicates; scheduled future maintenance does not", { skip: !url }, async () => {
  const { db, tables, compile } = setup();
  const statements = [...tables,
    db.query(`INSERT INTO incidents (service_key,affected_component_keys,title,message) VALUES ('sapada','["sapada-payment"]','Manual','Catatan')`),
    db.query(`INSERT INTO incidents (service_key,title,message,kind,state) VALUES ('struk-berhadiah','Maintenance','Later','maintenance','scheduled')`),
  ];
  for (const minute of [0, 5, 10, 15]) {
    statements.push(compile(buildIncidentObservationQuery([
      { serviceKey: "sapada-qris-generate", ok: false }, { serviceKey: "struk-berhadiah", ok: false },
    ], at(minute))));
    statements.push(compile(buildIncidentPublicationQuery(at(minute))));
  }
  statements.push(db.query("SELECT * FROM incidents ORDER BY id"));
  statements.push(db.query("SELECT count(*)::int AS count FROM incident_updates"));
  const rows = await db.transaction(statements);
  assert.equal(rows[rows.length - 2].length, 3);
  assert.equal(rows[rows.length - 2][2].automatic, true);
  assert.equal(rows[rows.length - 2][2].title_review_required, true);
  assert.equal(rows[rows.length - 1][0].count, 1);
});

test("PostgreSQL: manual resolution stays closed until recovery and a new confirmed outage", { skip: !url }, async () => {
  const { db, tables, compile } = setup();
  const statements = [...tables];
  for (const [minute, ok] of [[0, false], [5, false], [10, false], [15, false], [20, true], [25, false], [30, true], [35, true], [40, true], [45, false], [50, false], [55, false]] as const) {
    if (minute === 15) statements.push(db.query("UPDATE incidents SET state = 'resolved'"));
    statements.push(compile(buildIncidentObservationQuery([{ serviceKey: "sapada", ok }], at(minute))));
    statements.push(compile(buildIncidentPublicationQuery(at(minute))));
  }
  statements.push(db.query("SELECT state FROM incidents ORDER BY id"));
  const rows = await db.transaction(statements);
  assert.deepEqual(rows[rows.length - 1].map((row) => row.state), ["resolved", "investigating"]);
});

test("PostgreSQL: automatic recovery closes once with no generated explanation and preserves later edits", { skip: !url }, async () => {
  const { db, tables, compile } = setup();
  const statements = [...tables];
  for (const [minute, ok] of [[0, false], [5, false], [10, false], [15, true], [20, true]] as const) {
    statements.push(compile(buildIncidentObservationQuery([{ serviceKey: "struk-berhadiah", ok }], at(minute))));
    statements.push(compile(buildIncidentRecoveryQuery(at(minute))));
    statements.push(compile(buildIncidentPublicationQuery(at(minute))));
    if (minute === 15) statements.push(db.query("UPDATE incidents SET title = 'Kejadian diperiksa', message = 'Keterangan pengelola'"));
  }
  statements.push(db.query("SELECT * FROM incidents"));
  statements.push(db.query("SELECT state, message, created_at FROM incident_updates ORDER BY id"));
  const rows = await db.transaction(statements);
  const [incident] = rows[rows.length - 2];
  assert.equal(incident.state, "resolved");
  assert.equal(new Date(incident.resolved_at).getTime(), at(15).getTime());
  assert.equal(incident.title, "Kejadian diperiksa");
  assert.equal(incident.message, "Keterangan pengelola");
  assert.deepEqual(rows[rows.length - 1].map(({ state, message }) => ({ state, message })), [
    { state: "investigating", message: "" }, { state: "resolved", message: "" },
  ]);
});

test("PostgreSQL: grouped recovery waits for every affected component and fresh observations", { skip: !url }, async () => {
  const { db, tables, compile } = setup();
  const statements = [...tables];
  for (const minute of [0, 5, 10]) {
    statements.push(compile(buildIncidentObservationQuery([
      { serviceKey: "sapada-storage", ok: false }, { serviceKey: "sapada-qris-generate", ok: false },
    ], at(minute))));
    statements.push(compile(buildIncidentPublicationQuery(at(minute))));
  }
  statements.push(compile(buildIncidentObservationQuery([{ serviceKey: "sapada-storage", ok: true }], at(15))));
  statements.push(compile(buildIncidentRecoveryQuery(at(15))));
  statements.push(db.query("SELECT state FROM incidents"));
  statements.push(compile(buildIncidentObservationQuery([{ serviceKey: "sapada-qris-generate", ok: true }], at(30))));
  statements.push(compile(buildIncidentRecoveryQuery(at(30))));
  statements.push(db.query("SELECT state FROM incidents"));
  statements.push(compile(buildIncidentObservationQuery([{ serviceKey: "sapada-storage", ok: true }], at(35))));
  statements.push(compile(buildIncidentRecoveryQuery(at(35))));
  statements.push(db.query("SELECT state FROM incidents"));
  const rows = await db.transaction(statements);
  assert.equal(rows[11][0].state, "investigating");
  assert.equal(rows[14][0].state, "investigating");
  assert.equal(rows[17][0].state, "resolved");
});

test("PostgreSQL: permanent deletion removes updates and suppresses repeats until a new outage", { skip: !url }, async () => {
  const { db, tables, compile } = setup();
  const statements = [...tables];
  for (const minute of [0, 5, 10]) {
    statements.push(compile(buildIncidentObservationQuery([{ serviceKey: "struk-berhadiah", ok: false }], at(minute))));
    statements.push(compile(buildIncidentPublicationQuery(at(minute))));
  }
  statements.push(compile(buildIncidentUnlinkQuery(1)));
  statements.push(compile(sql`DELETE FROM incidents WHERE id = 1`));
  for (const minute of [15, 20]) {
    statements.push(compile(buildIncidentObservationQuery([{ serviceKey: "struk-berhadiah", ok: false }], at(minute))));
    statements.push(compile(buildIncidentPublicationQuery(at(minute))));
  }
  statements.push(db.query("SELECT count(*)::int AS count FROM incidents"));
  statements.push(db.query("SELECT count(*)::int AS count FROM incident_updates"));
  for (const [minute, ok] of [[25, true], [30, false], [35, false], [40, false]] as const) {
    statements.push(compile(buildIncidentObservationQuery([{ serviceKey: "struk-berhadiah", ok }], at(minute))));
    statements.push(compile(buildIncidentRecoveryQuery(at(minute))));
    statements.push(compile(buildIncidentPublicationQuery(at(minute))));
  }
  statements.push(db.query("SELECT id, state FROM incidents"));
  const rows = await db.transaction(statements);
  assert.equal(rows[15][0].count, 0);
  assert.equal(rows[16][0].count, 0);
  assert.deepEqual(rows[rows.length - 1], [{ id: 2, state: "investigating" }]);
});
