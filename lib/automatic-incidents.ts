import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { services } from "@/lib/services";
import { getIncidentComponents } from "@/lib/incident-components";
import { legacyPaymentComponent, legacyQrisComponent, paymentComponentKeys, skippedComponentKeys } from "@/lib/components";

export const automaticIncidentPolicy = {
  confirmationMinutes: 10,
  minimumFailures: 3,
  maximumGapMinutes: 10,
  minimumSampleSeconds: 60,
  recoveryMinutes: 10,
} as const;

type Observation = { serviceKey: string; ok: boolean };
const componentServices = services.filter((service) => getIncidentComponents(service.key).length > 0);
const catalog = services.flatMap<{ key: string; parent: string; name: string; parentName: string }>((service) => {
  const choices = getIncidentComponents(service.key);
  return choices.length
    ? choices.filter((component) => !skippedComponentKeys.includes(component.key)).map((component) => ({ key: component.key, parent: service.key, name: component.name, parentName: service.name }))
    : [{ key: service.key, parent: service.key, name: service.name, parentName: service.name }];
});

// All schedulers take the same transaction lock before reading or changing incident state.
export const automaticIncidentLock = sql`SELECT pg_advisory_xact_lock(742901, 10)`;

export function buildIncidentObservationQuery(results: Observation[], at: Date) {
  const values = sql.join(results.map((result) => sql`(${result.serviceKey}::text, ${result.ok}::boolean)`), sql`, `);
  const gap = sql`monitor_incident_states.checked_at < EXCLUDED.checked_at - make_interval(mins => ${automaticIncidentPolicy.maximumGapMinutes})`;
  const newSample = sql`monitor_incident_states.counted_at <= EXCLUDED.checked_at - make_interval(secs => ${automaticIncidentPolicy.minimumSampleSeconds})`;
  return sql`INSERT INTO monitor_incident_states (service_key, ok, checked_at, failed_since, healthy_since, failure_count, counted_at)
    SELECT service_key, ok, ${at}::timestamptz,
      CASE WHEN NOT ok THEN ${at}::timestamptz END,
      CASE WHEN ok THEN ${at}::timestamptz END,
      CASE WHEN ok THEN 0 ELSE 1 END, ${at}::timestamptz
    FROM (VALUES ${values}) AS input(service_key, ok)
    ON CONFLICT (service_key) DO UPDATE SET
      ok = EXCLUDED.ok, checked_at = EXCLUDED.checked_at,
      failed_since = CASE WHEN EXCLUDED.ok THEN NULL
        WHEN ${gap} OR monitor_incident_states.ok THEN EXCLUDED.checked_at
        ELSE monitor_incident_states.failed_since END,
      healthy_since = CASE WHEN NOT EXCLUDED.ok THEN NULL
        WHEN ${gap} OR NOT monitor_incident_states.ok THEN EXCLUDED.checked_at
        ELSE monitor_incident_states.healthy_since END,
      failure_count = CASE WHEN EXCLUDED.ok THEN 0
        WHEN ${gap} OR monitor_incident_states.ok THEN 1
        WHEN ${newSample} THEN monitor_incident_states.failure_count + 1
        ELSE monitor_incident_states.failure_count END,
      counted_at = CASE WHEN ${gap} OR EXCLUDED.ok <> monitor_incident_states.ok OR ${newSample}
        THEN EXCLUDED.checked_at ELSE monitor_incident_states.counted_at END,
      incident_id = CASE WHEN EXCLUDED.ok AND NOT ${gap}
        AND monitor_incident_states.healthy_since <= EXCLUDED.checked_at - make_interval(mins => ${automaticIncidentPolicy.recoveryMinutes})
        THEN NULL ELSE monitor_incident_states.incident_id END
    WHERE monitor_incident_states.checked_at < EXCLUDED.checked_at`;
}

export function buildIncidentPublicationQuery(at: Date) {
  const values = sql.join(catalog.map((item) => sql`(${item.key}::text, ${item.parent}::text, ${item.name}::text, ${item.parentName}::text)`), sql`, `);
  return sql`WITH catalog(key, parent, name, parent_name) AS (VALUES ${values}),
    pending AS (
      SELECT state.service_key, state.failed_since, catalog.*, existing.id AS existing_id, existing.automatic
      FROM monitor_incident_states AS state JOIN catalog ON catalog.key = state.service_key
      LEFT JOIN LATERAL (
        SELECT incident.id, incident.automatic FROM incidents AS incident
        WHERE incident.state <> 'resolved' AND (incident.kind = 'incident' OR incident.state = 'in_progress') AND (
          (incident.service_key = catalog.parent AND incident.automatic)
          OR (incident.service_key IN (catalog.parent, 'all') AND (
            incident.affected_component_keys IS NULL OR incident.affected_component_keys ? catalog.key
            OR (catalog.key = 'sapada-qris-generate' AND incident.affected_component_keys ? ${legacyQrisComponent.key})
            OR (catalog.key IN (${sql.join(paymentComponentKeys.map((key) => sql`${key}`), sql`, `)})
              AND incident.affected_component_keys ? ${legacyPaymentComponent.key})))
        ) ORDER BY incident.automatic, incident.id LIMIT 1
      ) AS existing ON true
      WHERE NOT state.ok AND state.incident_id IS NULL AND state.checked_at = ${at}::timestamptz
        AND state.failure_count >= ${automaticIncidentPolicy.minimumFailures}
        AND state.failed_since <= ${at}::timestamptz - make_interval(mins => ${automaticIncidentPolicy.confirmationMinutes})
    ), grouped AS (
      SELECT parent, parent_name, jsonb_agg(key ORDER BY key) AS keys,
        string_agg(name, ', ' ORDER BY key) AS names, min(failed_since) AS started_at
      FROM pending WHERE existing_id IS NULL GROUP BY parent, parent_name
    ), created AS (
      INSERT INTO incidents (service_key, affected_component_keys, title, message, kind, state, created_at, updated_at, automatic, title_review_required)
      SELECT parent, CASE WHEN parent IN (${sql.join(componentServices.map((service) => sql`${service.key}`), sql`, `)}) THEN keys END,
        'Gangguan terdeteksi pada ' || parent_name,
        'Pemantauan otomatis mencatat kegagalan berulang selama sedikitnya 10 menit pada ' || names || '. Penyebab belum dikonfirmasi. Pengelola perlu memeriksa gangguan dan memperbarui informasi ini.',
        'incident', 'investigating', started_at, ${at}::timestamptz, true, true FROM grouped
      RETURNING id, service_key, state, message
    ), additions AS (
      SELECT existing_id, jsonb_agg(key ORDER BY key) AS keys, string_agg(name, ', ' ORDER BY key) AS names
      FROM pending WHERE existing_id IS NOT NULL AND automatic GROUP BY existing_id
    ), expanded AS (
      UPDATE incidents AS incident SET affected_component_keys = (
        SELECT jsonb_agg(DISTINCT key) FROM jsonb_array_elements(COALESCE(incident.affected_component_keys, '[]'::jsonb) || additions.keys) AS key
      ), updated_at = ${at}::timestamptz
      FROM additions WHERE incident.id = additions.existing_id AND incident.affected_component_keys IS NOT NULL
        AND NOT incident.affected_component_keys @> additions.keys
      RETURNING incident.id, incident.state, 'Pemantauan otomatis juga mengonfirmasi gangguan pada ' || additions.names || '. Pengelola perlu memperbarui informasi dampaknya.' AS message
    ), announced AS (
      INSERT INTO incident_updates (incident_id, state, message, created_at)
      SELECT id, state, message, ${at}::timestamptz FROM created
      UNION ALL SELECT id, state, message, ${at}::timestamptz FROM expanded RETURNING incident_id
    ), linked AS (
      UPDATE monitor_incident_states AS state SET incident_id = COALESCE(pending.existing_id, created.id)
      FROM pending LEFT JOIN created ON created.service_key = pending.parent
      WHERE state.service_key = pending.service_key RETURNING state.service_key
    ) SELECT (SELECT count(*)::int FROM created) AS created,
      (SELECT count(*)::int FROM expanded) AS expanded,
      (SELECT count(*)::int FROM announced) AS updates`;
}

export async function processAutomaticIncidents(results: Observation[], at: Date) {
  const knownKeys = new Set(catalog.map((item) => item.key));
  const observations = [...new Map(results.filter((result) => knownKeys.has(result.serviceKey)).map((result) => [result.serviceKey, result])).values()];
  if (!observations.length) return { created: 0, expanded: 0, updates: 0 };
  const client = neon(process.env.DATABASE_URL!);
  const dialect = new PgDialect();
  const queries = [automaticIncidentLock, buildIncidentObservationQuery(observations, at), buildIncidentPublicationQuery(at)].map((statement) => {
    const query = dialect.sqlToQuery(statement);
    return client.query(query.sql, query.params);
  });
  // Separate statements see prior writes; the lock serializes concurrent cron invocations.
  const result = await client.transaction(queries, { isolationLevel: "ReadCommitted" });
  return result[2][0] as { created: number; expanded: number; updates: number };
}
