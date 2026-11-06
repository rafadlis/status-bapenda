import Link from "next/link";
import type { PublicIncident } from "@/components/incident-card";
import { formatJakarta } from "@/lib/status";
import { incidentServiceLabel } from "@/lib/incident-service";
import { stateLabel } from "@/lib/incident";

export function IncidentRow({ incident }: { incident: PublicIncident }) {
  const latest = incident.updates[0];
  const date = incident.createdAt;
  const note = latest?.message || incident.message;
  return <article>
    <Link className={`reference-incident-row ${incident.state === "resolved" ? "row-resolved" : "row-active"}`} href={`/incidents/${incident.id}`} aria-label={`Lihat detail ${incident.title}`}>
      <div className="reference-incident-date"><strong>{formatJakarta(date, { day: "numeric" })}</strong><span>{formatJakarta(date, { weekday: "short" })}</span></div>
      <div className="reference-incident-content"><span className="reference-incident-service">{incidentServiceLabel(incident.serviceKey)} · {stateLabel(incident.state)}</span><span className="reference-incident-title">{incident.title}</span>{note && <p>{note}</p>}</div>
      <time dateTime={date.toISOString()}>{formatJakarta(date, { timeStyle: "short" })} WIB</time>
    </Link>
  </article>;
}
