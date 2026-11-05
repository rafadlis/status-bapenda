import { neon } from "@neondatabase/serverless";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { automaticIncidentLock } from "@/lib/automatic-incidents";

export async function mutateIncidents(...statements: SQL[]) {
  const client = neon(process.env.DATABASE_URL!);
  const dialect = new PgDialect();
  const queries = [automaticIncidentLock, ...statements].map((statement) => {
    const query = dialect.sqlToQuery(statement);
    return client.query(query.sql, query.params);
  });
  return client.transaction(queries, { isolationLevel: "ReadCommitted" });
}

export function buildIncidentUnlinkQuery(id: number) {
  // A null failure start suppresses another post for this same continuous failure.
  // The next healthy-to-failed transition starts a new confirmation period.
  return sql`UPDATE monitor_incident_states SET incident_id = NULL, failed_since = NULL, failure_count = 0
    WHERE incident_id = ${id}`;
}

export async function deleteIncident(id: number) {
  const results = await mutateIncidents(buildIncidentUnlinkQuery(id), sql`DELETE FROM incidents WHERE id = ${id} RETURNING id`);
  // The existing foreign key cascades deletion to every public timeline update.
  return results[2].length > 0;
}
