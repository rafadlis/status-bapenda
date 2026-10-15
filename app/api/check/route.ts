import { getDb } from "@/lib/db";
import { checks } from "@/lib/db/schema";
import { checkTimeoutMs } from "@/lib/check-result";
import { services } from "@/lib/services";
import { runComponentChecks } from "@/lib/component-checks";
import { runSimpulPadChecks } from "@/lib/simpul-pad-checks";
import { processWhatsappAlerts } from "@/lib/whatsapp-alerts";
import { processAutomaticIncidents } from "@/lib/automatic-incidents";
import { revalidateTag } from "next/cache";
import { incidentHistoryTag } from "@/lib/incident-history";

function authorized(request: Request, secret: string | undefined) {
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCheck();
}

export async function POST(request: Request) {
  if (!authorized(request, process.env.MONITOR_TOKEN)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCheck();
}

async function runCheck() {
  const [serviceResults, componentResults, simpulPadResults] = await Promise.all([Promise.all(services.map(async (service) => {
    const started = performance.now();
    let ok = false;
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const response = await fetch(service.url, {
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(checkTimeoutMs),
        headers: { "user-agent": "Bapenda-Status-Monitor/1.0" },
      });
      statusCode = response.status;
      ok = statusCode >= 200 && statusCode < 400;
      if (!ok) error = `HTTP ${statusCode}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message.slice(0, 300) : "Unknown network error";
    }
    return { serviceKey: service.key, ok, statusCode, latencyMs: Math.round(performance.now() - started), error };
  })), runComponentChecks(), runSimpulPadChecks()]);
  const results = [...serviceResults, ...componentResults, ...simpulPadResults];
  const checkedAt = new Date();
  try {
    await getDb().insert(checks).values(results.map((result) => ({ ...result, checkedAt })));
  } catch (cause) {
    console.error("Failed to save health check", cause);
    return Response.json({ error: "Failed to save health check" }, { status: 500 });
  }
  const [incidentResult, alertResult] = await Promise.allSettled([
    processAutomaticIncidents(results, checkedAt), processWhatsappAlerts(results),
  ]);
  if (incidentResult.status === "fulfilled" && incidentResult.value.updates > 0) {
    revalidateTag(incidentHistoryTag, { expire: 0 });
  }
  for (const result of [incidentResult, alertResult]) {
    if (result.status === "rejected") console.error("Failed to process monitor automation", result.reason);
  }
  return Response.json({ results,
    incidents: incidentResult.status === "fulfilled" ? incidentResult.value : { error: "Incident processing failed" },
    alerts: alertResult.status === "fulfilled" ? alertResult.value : { error: "Alert processing failed" },
  }, { status: incidentResult.status === "rejected" || alertResult.status === "rejected" ? 503 : 200,
    headers: { "cache-control": "no-store" } });
}
