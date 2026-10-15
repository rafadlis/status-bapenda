import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { whatsappAlertRecipients } from "@/lib/db/schema";
import { getComponent } from "@/lib/components";
import { services } from "@/lib/services";

export type AlertFailure = { serviceKey: string; statusCode: number | null };
export const whatsappAlertPolicy = {
  confirmationMinutes: 5,
  cooldownMinutes: 30,
  dailyLimit: 6,
  expiryMinutes: 60,
  freshnessMinutes: 20,
} as const;
type CheckResult = AlertFailure & { ok: boolean };
type ClaimedDelivery = {
  id: number;
  phone: string;
  failures: AlertFailure[];
  created_at: Date;
  attempts: number;
};

export function parseAlertRecipients(raw: string) {
  const recipients = raw.split(/[\s,;]+/).filter(Boolean).map((value) => {
    const digits = value.replace(/^\+/, "").replace(/[()-]/g, "");
    const phone = digits.startsWith("08") ? `62${digits.slice(1)}` : digits;
    if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error("Invalid WhatsApp alert recipient configuration");
    return phone;
  });
  return [...new Set(recipients)];
}

export function parseAlertRecipient(raw: string) {
  try {
    const recipients = parseAlertRecipients(raw.trim());
    return recipients.length === 1 && !/[\s,;]/.test(raw.trim()) ? recipients[0] : null;
  } catch {
    return null;
  }
}

export function alertFailureName(key: string) {
  const service = services.find((service) => service.key === key);
  if (service) return service.name;
  const component = getComponent(key);
  if (!component) return key;
  const parent = services.find((entry) => entry.key === component.parentKey);
  return component.parentKey === "sapada" ? component.name : `${parent?.name ?? component.parentKey} · ${component.name}`;
}

export function alertBodyValues(failures: AlertFailure[], checkedAt: Date) {
  const names = failures.map((failure) => alertFailureName(failure.serviceKey)).join(", ");
  const time = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short",
  }).format(checkedAt).replace(" pukul ", ", ");
  const reasons = failures.map((failure) => `${alertFailureName(failure.serviceKey)}: ${failure.statusCode === null ? "tidak dapat diakses" : `HTTP ${failure.statusCode}`}`).join("; ");
  return [names, time, reasons];
}

export function buildOcaAlertPayload(phone: string, templateCode: string, failures: AlertFailure[], checkedAt: Date) {
  return {
    phone_number: phone,
    message: {
      type: "template",
      template: {
        template_code_id: templateCode,
        payload: [{ position: "body", parameters: alertBodyValues(failures, checkedAt).map((text) => ({ type: "text", text })) }],
      },
    },
  };
}

function alertConfig() {
  const endpoint = process.env.WHATSAPP_BIZ_OCA_ENDPOINT;
  const token = process.env.WHATSAPP_BIZ_OCA_TOKEN;
  const templateCode = process.env.WHATSAPP_BIZ_OCA_TEMPLATE_CODE_STATUS_ALERT;
  if (!endpoint || !token || !templateCode) return null;
  if (new URL(endpoint).protocol !== "https:") throw new Error("OCA endpoint must use HTTPS");
  return { endpoint, token, templateCode };
}

export function whatsappAlertConfigured() {
  try {
    return Boolean(alertConfig());
  } catch {
    return false;
  }
}

export async function sendOcaAlert(
  input: { phone: string; failures: AlertFailure[]; checkedAt: Date },
  config: { endpoint: string; token: string; templateCode: string },
  request: typeof fetch = fetch,
): Promise<{ status: "accepted" | "retry" | "failed" | "needs_review"; messageId?: string; error?: string }> {
  try {
    const response = await request(config.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildOcaAlertPayload(input.phone, config.templateCode, input.failures, input.checkedAt)),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const errorBody: unknown = await response.json().catch(() => null);
      const providerCode = errorBody && typeof errorBody === "object" && "errors" in errorBody
        && Array.isArray(errorBody.errors) ? errorBody.errors[0]?.code : null;
      if (response.status === 429 || String(providerCode ?? "") === "9") return { status: "retry", error: "OCA rate limit" };
      if (response.status >= 500 || response.status === 408) return { status: "needs_review", error: `OCA HTTP ${response.status}; acceptance uncertain` };
      return { status: "failed", error: `OCA HTTP ${response.status}` };
    }
    const data: unknown = await response.json().catch(() => null);
    if (data && typeof data === "object" && "success" in data && data.success === false) {
      return { status: "failed", error: "OCA rejected the message" };
    }
    if (!data || typeof data !== "object" || !("success" in data) || data.success !== true
      || !("msgid" in data) || typeof data.msgid !== "string" || !data.msgid) {
      return { status: "needs_review", error: "OCA acceptance could not be verified" };
    }
    return { status: "accepted", messageId: data.msgid };
  } catch {
    return { status: "needs_review", error: "OCA request outcome uncertain" };
  }
}

export function buildAlertTransitionQuery(results: CheckResult[], recipients: string[], checkedAt: Date) {
  const values = sql.join(results.map((result) => sql`(${result.serviceKey}::text, ${result.ok}::boolean, ${result.statusCode}::integer)`), sql`, `);
  const confirmedFailure = sql`NOT EXCLUDED.ok AND NOT monitor_alert_states.alerted
    AND monitor_alert_states.failed_since <= EXCLUDED.checked_at - make_interval(mins => ${whatsappAlertPolicy.confirmationMinutes})
    AND monitor_alert_states.checked_at >= EXCLUDED.checked_at - make_interval(mins => ${whatsappAlertPolicy.freshnessMinutes})`;
  return sql`WITH input(service_key, ok, status_code) AS (VALUES ${values}),
    changed AS (
      INSERT INTO monitor_alert_states (service_key, ok, checked_at, new_failure, failed_since, healthy_since)
      SELECT service_key, ok, ${checkedAt}::timestamptz, false,
        CASE WHEN NOT ok THEN ${checkedAt}::timestamptz END,
        CASE WHEN ok THEN ${checkedAt}::timestamptz END FROM input WHERE true
      ON CONFLICT (service_key) DO UPDATE
      SET ok = EXCLUDED.ok, checked_at = EXCLUDED.checked_at,
        failed_since = CASE WHEN EXCLUDED.ok THEN NULL
          WHEN monitor_alert_states.checked_at < EXCLUDED.checked_at - make_interval(mins => ${whatsappAlertPolicy.freshnessMinutes}) THEN EXCLUDED.checked_at
          ELSE COALESCE(monitor_alert_states.failed_since, EXCLUDED.checked_at) END,
        healthy_since = CASE WHEN NOT EXCLUDED.ok THEN NULL
          WHEN monitor_alert_states.checked_at < EXCLUDED.checked_at - make_interval(mins => ${whatsappAlertPolicy.freshnessMinutes}) THEN EXCLUDED.checked_at
          ELSE COALESCE(monitor_alert_states.healthy_since, EXCLUDED.checked_at) END,
        new_failure = COALESCE(${confirmedFailure}, false),
        alerted = CASE WHEN ${confirmedFailure} THEN true
          WHEN EXCLUDED.ok
            AND monitor_alert_states.healthy_since <= EXCLUDED.checked_at - make_interval(mins => ${whatsappAlertPolicy.confirmationMinutes})
            AND monitor_alert_states.checked_at >= EXCLUDED.checked_at - make_interval(mins => ${whatsappAlertPolicy.freshnessMinutes}) THEN false
          ELSE monitor_alert_states.alerted END
      WHERE monitor_alert_states.checked_at < EXCLUDED.checked_at
      RETURNING service_key, new_failure
    ),
    failures AS (
      SELECT jsonb_agg(jsonb_build_object('serviceKey', input.service_key, 'statusCode', input.status_code)
        ORDER BY input.service_key) AS details
      FROM changed JOIN input USING (service_key) WHERE changed.new_failure
    )
    INSERT INTO whatsapp_alert_deliveries (phone, failures)
    SELECT recipient.phone, failures.details
    FROM failures CROSS JOIN jsonb_array_elements_text(${JSON.stringify(recipients)}::jsonb) AS recipient(phone)
    WHERE failures.details IS NOT NULL`;
}

async function recordAlertTransitions(results: CheckResult[], recipients: string[], checkedAt: Date) {
  if (results.length === 0) return;
  await getDb().execute(buildAlertTransitionQuery(results, recipients, checkedAt));
}

export function buildAlertClaimQuery(at: Date) {
  return sql<ClaimedDelivery>`WITH recipients AS (
    SELECT recipient.phone FROM whatsapp_alert_recipients AS recipient
    WHERE recipient.enabled AND EXISTS (
      SELECT 1 FROM whatsapp_alert_deliveries AS delivery
      WHERE delivery.phone = recipient.phone AND delivery.status = 'pending' AND delivery.next_attempt_at <= ${at}::timestamptz
        AND delivery.created_at >= ${at}::timestamptz - make_interval(mins => ${whatsappAlertPolicy.expiryMinutes})
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(delivery.failures) AS failure
          JOIN monitor_alert_states AS state ON state.service_key = failure->>'serviceKey'
          WHERE NOT state.ok AND state.alerted
            AND state.checked_at >= ${at}::timestamptz - make_interval(mins => ${whatsappAlertPolicy.freshnessMinutes}))
    ) AND NOT EXISTS (
      SELECT 1 FROM whatsapp_alert_deliveries AS recent
      WHERE recent.phone = recipient.phone AND recent.claimed_at > ${at}::timestamptz - make_interval(mins => ${whatsappAlertPolicy.cooldownMinutes})
    ) AND (
      SELECT COALESCE(sum(attempts), 0) FROM whatsapp_alert_deliveries AS recent
      WHERE recent.phone = recipient.phone AND recent.claimed_at > ${at}::timestamptz - interval '24 hours'
    ) < ${whatsappAlertPolicy.dailyLimit}
    ORDER BY recipient.id LIMIT 4 FOR UPDATE OF recipient SKIP LOCKED
  ), locked AS (
    SELECT delivery.* FROM whatsapp_alert_deliveries AS delivery JOIN recipients USING (phone)
    WHERE delivery.status = 'pending' AND delivery.next_attempt_at <= ${at}::timestamptz
      AND delivery.created_at >= ${at}::timestamptz - make_interval(mins => ${whatsappAlertPolicy.expiryMinutes})
    FOR UPDATE OF delivery SKIP LOCKED
  ), live_failures AS (
    SELECT DISTINCT ON (locked.phone, failure->>'serviceKey') locked.phone, failure
    FROM locked CROSS JOIN jsonb_array_elements(locked.failures) AS failure
    JOIN monitor_alert_states AS state ON state.service_key = failure->>'serviceKey'
    WHERE NOT state.ok AND state.alerted
      AND state.checked_at >= ${at}::timestamptz - make_interval(mins => ${whatsappAlertPolicy.freshnessMinutes})
    ORDER BY locked.phone, failure->>'serviceKey', locked.id DESC
  ), grouped AS (
    SELECT phone, jsonb_agg(failure ORDER BY failure->>'serviceKey') AS failures,
      (SELECT min(id) FROM locked WHERE locked.phone = live_failures.phone) AS first_id
    FROM live_failures GROUP BY phone
  ), updated AS (
    UPDATE whatsapp_alert_deliveries AS delivery SET
      status = CASE WHEN delivery.id = grouped.first_id THEN 'sending' ELSE 'cancelled' END,
      failures = CASE WHEN delivery.id = grouped.first_id THEN grouped.failures ELSE delivery.failures END,
      attempts = delivery.attempts + CASE WHEN delivery.id = grouped.first_id THEN 1 ELSE 0 END,
      claimed_at = CASE WHEN delivery.id = grouped.first_id THEN ${at}::timestamptz ELSE delivery.claimed_at END,
      last_error = CASE WHEN delivery.id = grouped.first_id THEN NULL ELSE 'Combined into another alert' END
    FROM grouped WHERE delivery.phone = grouped.phone AND delivery.id IN (SELECT id FROM locked)
    RETURNING delivery.id, delivery.phone, delivery.failures, delivery.created_at, delivery.attempts, delivery.status
  ) SELECT id, phone, failures, created_at, attempts FROM updated WHERE status = 'sending'`;
}

export function buildAlertMaintenanceQuery(at: Date) {
  return sql`WITH interrupted AS (
    UPDATE whatsapp_alert_deliveries SET status = 'needs_review', last_error = 'Send interrupted; acceptance uncertain'
    WHERE status = 'sending' AND claimed_at < ${at}::timestamptz - interval '10 minutes' RETURNING id
  ), expired AS (
    UPDATE whatsapp_alert_deliveries AS delivery SET status = 'cancelled', last_error = 'Alert expired or checks recovered'
    WHERE delivery.status = 'pending' AND (
      delivery.created_at < ${at}::timestamptz - make_interval(mins => ${whatsappAlertPolicy.expiryMinutes})
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(delivery.failures) AS failure
        JOIN monitor_alert_states AS state ON state.service_key = failure->>'serviceKey'
        WHERE NOT state.ok AND state.alerted AND state.checked_at >= ${at}::timestamptz - make_interval(mins => ${whatsappAlertPolicy.freshnessMinutes}))
    ) RETURNING id
  ) SELECT (SELECT count(*) FROM interrupted) AS interrupted, (SELECT count(*) FROM expired) AS expired`;
}

async function dispatchPendingAlerts(config: { endpoint: string; token: string; templateCode: string }) {
  // Unknown send outcomes are never automatically retried, including interrupted invocations.
  await getDb().execute(buildAlertMaintenanceQuery(new Date()));
  const claimed = await getDb().execute(buildAlertClaimQuery(new Date()));
  const deliveries = claimed.rows as ClaimedDelivery[];
  await Promise.all(deliveries.map(async (delivery) => {
    const result = await sendOcaAlert({
      phone: delivery.phone, failures: delivery.failures, checkedAt: new Date(delivery.created_at),
    }, config);
    const status = result.status === "retry" && delivery.attempts >= 3 ? "failed" : result.status === "retry" ? "pending" : result.status;
    const nextAttemptAt = status === "pending" ? new Date(Date.now() + 10 * 60_000) : new Date();
    await getDb().execute(sql`UPDATE whatsapp_alert_deliveries
      SET status = ${status}, next_attempt_at = ${nextAttemptAt},
        provider_message_id = ${result.messageId ?? null}, last_error = ${result.error ?? null}
      WHERE id = ${delivery.id} AND status = 'sending'`);
  }));
  return deliveries.length;
}

export async function processWhatsappAlerts(results: CheckResult[]) {
  const config = alertConfig();
  if (!config) return { status: "unconfigured" as const, processed: 0 };
  const recipients = await getDb().select({ phone: whatsappAlertRecipients.phone }).from(whatsappAlertRecipients)
    .where(eq(whatsappAlertRecipients.enabled, true));
  const checkedAt = new Date();
  await recordAlertTransitions(results, recipients.map((recipient) => recipient.phone), checkedAt);
  const processed = await dispatchPendingAlerts(config);
  return { status: "enabled" as const, processed };
}
