import { eq, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { isAdmin, sameOrigin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { incidents } from "@/lib/db/schema";
import { isValidIncidentState } from "@/lib/incident";
import { parseAffectedComponentKeys } from "@/lib/incident-components";
import { incidentHistoryTag } from "@/lib/incident-history";
import { deleteIncident, mutateIncidents } from "@/lib/incident-management";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const { id } = await context.params;
  const incidentId = Number(id);
  if (!Number.isSafeInteger(incidentId) || incidentId < 1) return new Response("Invalid incident", { status: 400 });
  const form = await request.formData();
  if (form.get("intent") === "delete") {
    if (!(await deleteIncident(incidentId))) return new Response("Incident not found", { status: 404 });
    revalidateTag(incidentHistoryTag, { expire: 0 });
    return Response.redirect(new URL("/admin?deleted=1", request.url), 303);
  }
  const state = String(form.get("state") ?? "");
  const message = String(form.get("message") ?? "").trim();
  const description = form.has("description") ? String(form.get("description") ?? "").trim() : undefined;
  const title = String(form.get("title") ?? "").trim();
  const db = getDb();
  const [incident] = await db.select().from(incidents).where(eq(incidents.id, incidentId)).limit(1);
  if (!incident) return new Response("Incident not found", { status: 404 });
  const affectedComponentKeys = parseAffectedComponentKeys(incident.serviceKey, form.getAll("componentKeys"));
  if (!isValidIncidentState(incident.kind === "maintenance" ? "maintenance" : "incident", state)
    || !title || title.length > 120 || (description?.length ?? 0) > 2000
    || message.length > 2000 || affectedComponentKeys === undefined) {
    return Response.redirect(new URL("/admin?error=validation", request.url), 303);
  }
  const updatedAt = new Date();
  const nextDescription = description ?? incident.message;
  await mutateIncidents(sql`WITH previous AS (
    SELECT id, state, message FROM incidents WHERE id = ${incidentId}
  ), changed AS (
    UPDATE incidents SET state = ${state}, title = ${title}, message = ${nextDescription},
      title_review_required = ${incident.titleReviewRequired && title === incident.title}, affected_component_keys = ${JSON.stringify(affectedComponentKeys)}::jsonb,
      updated_at = ${updatedAt}, resolved_at = CASE WHEN ${state} = 'resolved' THEN COALESCE(resolved_at, ${updatedAt}) ELSE NULL END
    WHERE id = ${incidentId} RETURNING id
  ) INSERT INTO incident_updates (incident_id, state, message, created_at)
    SELECT changed.id, ${state}, CASE WHEN ${message} <> '' THEN ${message}
      WHEN previous.message <> ${nextDescription} THEN ${nextDescription} ELSE '' END, ${updatedAt}
    FROM changed JOIN previous ON previous.id = changed.id
    WHERE ${message} <> '' OR previous.state <> ${state} OR previous.message <> ${nextDescription}`);
  revalidateTag(incidentHistoryTag, { expire: 0 });
  return Response.redirect(new URL("/admin?updated=1", request.url), 303);
}
