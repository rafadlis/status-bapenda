import { checkTimeoutMs } from "./check-result";
import { simpulPadComponents } from "./components";
import { healthAuthorization } from "./integration-signature";
import { getService } from "./services";

export const simpulPadHealthPath = "/api/internal/status-health";
const bankComponents = simpulPadComponents.filter((component) => component.key === "simpul-pad-qris" || component.key === "simpul-pad-va");
const origin = getService("simpul-pad")!.url;

type CheckResult = {
  serviceKey: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
};
type BankResult = { key: string; ok: boolean; latencyMs: number | null };
type Endpoint = { path: string; status: number; valid: (response: Response) => Promise<boolean> };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function json(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) return undefined;
  return response.json();
}

export function parseSimpulPadBankResults(value: unknown): BankResult[] | null {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.results) || value.results.length !== bankComponents.length) return null;
  const rows = new Map<string, BankResult>();
  for (const row of value.results) {
    if (!record(row) || typeof row.key !== "string" || !bankComponents.some((component) => component.key === row.key)
      || rows.has(row.key) || typeof row.ok !== "boolean" || "skipped" in row
      || (row.latencyMs !== null && (typeof row.latencyMs !== "number" || !Number.isInteger(row.latencyMs) || row.latencyMs < 0 || row.latencyMs > 60_000))) return null;
    rows.set(row.key, { key: row.key, ok: row.ok, latencyMs: row.latencyMs as number | null });
  }
  return bankComponents.map((component) => rows.get(component.key)!);
}

async function checkEndpoints(serviceKey: string, endpoints: Endpoint[]): Promise<CheckResult> {
  const started = performance.now();
  const signal = AbortSignal.timeout(checkTimeoutMs);
  const observations = await Promise.all(endpoints.map(async (endpoint) => {
    let statusCode: number | null = null;
    try {
      const response = await fetch(new URL(endpoint.path, origin), {
        cache: "no-store", redirect: "manual", signal,
        headers: { "user-agent": "Bapenda-Status-Monitor/1.0" },
      });
      statusCode = response.status;
      const ok = statusCode === endpoint.status && await endpoint.valid(response);
      return { ok, statusCode, error: ok ? null : "Unexpected health response" };
    } catch {
      return { ok: false, statusCode, error: signal.aborted ? "Health check timed out" : "Health endpoint unavailable" };
    }
  }));
  const result = observations.find((observation) => !observation.ok) ?? observations[0];
  return { serviceKey, ...result, latencyMs: Math.round(performance.now() - started) };
}

async function runBankChecks(): Promise<CheckResult[]> {
  const seed = process.env.SIMPUL_PAD_HEALTH_TOKEN;
  if (!seed) return [];
  try {
    const response = await fetch(new URL(simpulPadHealthPath, origin), {
      headers: { authorization: healthAuthorization(seed, Date.now(), simpulPadHealthPath) },
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(checkTimeoutMs),
    });
    if (!response.ok) throw new Error("Probe unavailable");
    const results = parseSimpulPadBankResults(await json(response));
    if (!results) throw new Error("Invalid probe response");
    return results.map((row) => ({ serviceKey: row.key, ok: row.ok, statusCode: null,
      latencyMs: row.latencyMs, error: row.ok ? null : "Bank connection unavailable" }));
  } catch {
    return bankComponents.map((component) => ({ serviceKey: component.key, ok: false,
      statusCode: null, latencyMs: null, error: "Bank health probe unavailable" }));
  }
}

export async function runSimpulPadChecks(): Promise<CheckResult[]> {
  const [login, api, banks] = await Promise.all([
    checkEndpoints("simpul-pad-login", [
      { path: "/masuk", status: 200, valid: async (response) => {
        if (!response.headers.get("content-type")?.includes("text/html")) return false;
        const body = await response.text();
        return /<input\b[^>]*\btype=["']email["']/i.test(body) && /<input\b[^>]*\btype=["']password["']/i.test(body);
      } },
      { path: "/api/auth/get-session", status: 200, valid: async (response) => await json(response) === null },
    ]),
    checkEndpoints("simpul-pad-api", [
      { path: "/api/health/ready", status: 200, valid: async (response) => {
        const body = await json(response);
        return record(body) && body.status === "ready" && record(body.checks) && body.checks.database === "up";
      } },
      { path: "/api/openapi", status: 200, valid: async (response) => {
        const body = await json(response);
        return record(body) && typeof body.openapi === "string" && body.openapi.startsWith("3.") && record(body.paths)
          && record(body.paths["/api/v1/bills"]) && record(body.paths["/api/v1/bills"].post)
          && record(body.paths["/api/v1/bills/{id}"]) && record(body.paths["/api/v1/bills/{id}"].get);
      } },
      // No credential is sent; authentication runs before the bill lookup.
      { path: "/api/v1/bills/00000000-0000-4000-8000-000000000000", status: 401, valid: async (response) => {
        const body = await json(response);
        return record(body) && record(body.error) && body.error.code === "INVALID_API_CREDENTIAL";
      } },
    ]),
    runBankChecks(),
  ]);
  return [login, ...banks, api];
}
