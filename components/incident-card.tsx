import Link from "next/link";
import type { incidents, incidentUpdates } from "@/lib/db/schema";
import { kindLabel, stateLabel } from "@/lib/incident";
import { incidentServiceLabel } from "@/lib/incident-service";
import { formatJakarta } from "@/lib/status";

export type PublicIncident = typeof incidents.$inferSelect & { updates: (typeof incidentUpdates.$inferSelect)[] };

export function IncidentCard({ incident, compact = false }: { incident: PublicIncident; compact?: boolean }) {
  const latest = incident.updates[0];
  const note = latest?.message || incident.message;
  const date = latest?.createdAt ?? incident.updatedAt;
  return <article className={`incident-card ${incident.state === "resolved" ? "incident-done" : "incident-open"}`}>
    <div className="incident-card-meta"><span>{incidentServiceLabel(incident.serviceKey)} · {kindLabel(incident.kind)} · {stateLabel(incident.state)}</span><time dateTime={date.toISOString()}>{formatJakarta(date, { dateStyle: "medium", timeStyle: "short" })} WIB</time></div>
    <h3><Link href={`/incidents/${incident.id}`}>{incident.title}</Link></h3>
    {note && <p>{note}</p>}
    {!compact && <Link className="text-link" href={`/incidents/${incident.id}`}>Baca kronologi <span aria-hidden="true">→</span></Link>}
  </article>;
}
