import { sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { isAdmin, sameOrigin } from "@/lib/auth";
import { initialState, isIncidentKind, isValidIncidentState } from "@/lib/incident";
import { parseAffectedComponentKeys } from "@/lib/incident-components";
import { incidentHistoryTag } from "@/lib/incident-history";
import { isIncidentServiceKey } from "@/lib/incident-service";
import { mutateIncidents } from "@/lib/incident-management";
import { parseIncidentPeriod } from "@/lib/incident-period";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();
  const kind = String(form.get("kind") ?? "incident");
  const serviceKey = String(form.get("serviceKey") ?? "");
  const affectedComponentKeys = parseAffectedComponentKeys(serviceKey, form.getAll("componentKeys"));
  const now = new Date();
  const period = parseIncidentPeriod(form, now);
  const state = String(form.get("state") ?? (isIncidentKind(kind) ? initialState(kind) : ""));
  if (!title || !message || title.length > 120 || message.length > 2000 || !isIncidentKind(kind)
    || !isValidIncidentState(kind, state) || !isIncidentServiceKey(serviceKey) || affectedComponentKeys === undefined
    || period === undefined || (state === "resolved" && !period)) {
    return Response.redirect(new URL("/admin?error=validation", request.url), 303);
  }
  const startedAt = period?.from ?? now;
  const resolvedAt = state === "resolved" && period ? period.to : null;
  await mutateIncidents(sql`WITH created AS (
    INSERT INTO incidents (title, message, kind, state, service_key, affected_component_keys, created_at, updated_at, resolved_at)
    VALUES (${title}, ${message}, ${kind}, ${state}, ${serviceKey}, ${JSON.stringify(affectedComponentKeys)}::jsonb, ${startedAt}, ${now}, ${resolvedAt})
    RETURNING id
  ) INSERT INTO incident_updates (incident_id, state, message, created_at)
    SELECT id, ${initialState(kind)}, ${message}, ${startedAt} FROM created
    UNION ALL SELECT id, ${state}, '', ${resolvedAt ?? now} FROM created WHERE ${state !== initialState(kind)}`);
  revalidateTag(incidentHistoryTag, { expire: 0 });
  return Response.redirect(new URL("/admin?created=1", request.url), 303);
}
