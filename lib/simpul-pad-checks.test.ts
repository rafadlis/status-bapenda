import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { test } from "node:test";
import { healthAuthorization } from "./integration-signature";
import { parseSimpulPadBankResults, runSimpulPadChecks, simpulPadHealthPath } from "./simpul-pad-checks";

const banks = [
  { key: "simpul-pad-qris", ok: true, latencyMs: 12 },
  { key: "simpul-pad-va", ok: false, latencyMs: null },
];

function publicResponse(path: string) {
  switch (path) {
    case "/masuk": return new Response('<form><input type="email"><input type="password"></form>', { headers: { "content-type": "text/html" } });
    case "/api/auth/get-session": return Response.json(null);
    case "/api/health/ready": return Response.json({ status: "ready", checks: { database: "up" } });
    case "/api/openapi": return Response.json({ openapi: "3.1.0", paths: { "/api/v1/bills": { post: {} }, "/api/v1/bills/{id}": { get: {} } } });
    case "/api/v1/bills/00000000-0000-4000-8000-000000000000": return Response.json({ error: { code: "INVALID_API_CREDENTIAL" } }, { status: 401 });
    default: throw new Error(`Unexpected endpoint ${path}`);
  }
}

test("Simpul signatures are bound to their own probe path", () => {
  const timestamp = 1_700_000_000_000;
  const header = healthAuthorization("07".repeat(32), timestamp, simpulPadHealthPath);
  const signature = Buffer.from(header.split(".")[1], "base64url");
  const key = createPublicKey({ key: Buffer.from("MCowBQYDK2VwAyEA6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=", "base64"), format: "der", type: "spki" });
  assert.equal(verify(null, Buffer.from(`GET\n${simpulPadHealthPath}\n${timestamp}`), key, signature), true);
  assert.equal(verify(null, Buffer.from(`GET\n/api/internal/integration-health\n${timestamp}`), key, signature), false);
});

test("bank results require exactly the two Simpul monitors and bounded latencies", () => {
  assert.deepEqual(parseSimpulPadBankResults({ version: 1, results: [...banks].reverse() }), banks);
  for (const results of [banks.slice(0, 1), [banks[0], banks[0]], [{ ...banks[0], key: "sapada-qris-generate" }, banks[1]],
    [{ ...banks[0], latencyMs: -1 }, banks[1]], [{ ...banks[0], latencyMs: 1.5 }, banks[1]],
    [{ ...banks[0], ok: null }, banks[1]], [{ ...banks[0], skipped: true }, banks[1]]]) {
    assert.equal(parseSimpulPadBankResults({ version: 1, results }), null);
  }
  assert.equal(parseSimpulPadBankResults({ results: banks }), null);
});

test("public checks need no credentials and missing bank configuration leaves banks unobserved", async (context) => {
  const seed = process.env.SIMPUL_PAD_HEALTH_TOKEN;
  delete process.env.SIMPUL_PAD_HEALTH_TOKEN;
  context.after(() => { if (seed !== undefined) process.env.SIMPUL_PAD_HEALTH_TOKEN = seed; });
  const paths: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
    assert.equal(input.origin, "https://simpul-pad.bapenda.garutkab.go.id");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "manual");
    assert.equal(init.method, undefined);
    assert.equal(new Headers(init.headers).has("authorization"), false);
    assert.equal(new Headers(init.headers).has("cookie"), false);
    paths.push(input.pathname);
    return publicResponse(input.pathname);
  });
  const results = await runSimpulPadChecks();
  assert.deepEqual(results.map((row) => [row.serviceKey, row.ok]), [["simpul-pad-login", true], ["simpul-pad-api", true]]);
  assert.equal(paths.length, 5);
});

test("login redirects and a broken database cannot look healthy just because HTTP responds", async (context) => {
  const seed = process.env.SIMPUL_PAD_HEALTH_TOKEN;
  delete process.env.SIMPUL_PAD_HEALTH_TOKEN;
  context.after(() => { if (seed !== undefined) process.env.SIMPUL_PAD_HEALTH_TOKEN = seed; });
  context.mock.method(globalThis, "fetch", async (input: URL) => {
    if (input.pathname === "/masuk") return new Response(null, { status: 302, headers: { location: "/" } });
    if (input.pathname === "/api/health/ready") return Response.json({ status: "not_ready", checks: { database: "down" } });
    return publicResponse(input.pathname);
  });
  assert.deepEqual((await runSimpulPadChecks()).map((row) => row.ok), [false, false]);
});

test("API guards must return their expected authentication error", async (context) => {
  const seed = process.env.SIMPUL_PAD_HEALTH_TOKEN;
  delete process.env.SIMPUL_PAD_HEALTH_TOKEN;
  context.after(() => { if (seed !== undefined) process.env.SIMPUL_PAD_HEALTH_TOKEN = seed; });
  context.mock.method(globalThis, "fetch", async (input: URL) => input.pathname.startsWith("/api/v1/bills/")
    ? Response.json({ error: { code: "BILLING_UNAVAILABLE" } }, { status: 401 }) : publicResponse(input.pathname));
  const results = await runSimpulPadChecks();
  assert.equal(results.find((row) => row.serviceKey === "simpul-pad-login")!.ok, true);
  assert.equal(results.find((row) => row.serviceKey === "simpul-pad-api")!.ok, false);
});

test("protected bank failures remain isolated from public login and API observations", async (context) => {
  const seed = process.env.SIMPUL_PAD_HEALTH_TOKEN;
  process.env.SIMPUL_PAD_HEALTH_TOKEN = "07".repeat(32);
  context.after(() => { if (seed === undefined) delete process.env.SIMPUL_PAD_HEALTH_TOKEN; else process.env.SIMPUL_PAD_HEALTH_TOKEN = seed; });
  let payload: unknown = { version: 1, results: banks };
  context.mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
    if (input.pathname !== simpulPadHealthPath) return publicResponse(input.pathname);
    assert.match(new Headers(init.headers).get("authorization")!, /^HealthSignature /);
    assert.equal(init.redirect, "manual");
    return Response.json(payload);
  });
  assert.deepEqual((await runSimpulPadChecks()).map((row) => [row.serviceKey, row.ok]), [
    ["simpul-pad-login", true], ["simpul-pad-qris", true], ["simpul-pad-va", false], ["simpul-pad-api", true],
  ]);
  payload = { version: 1, results: [banks[0]] };
  assert.deepEqual((await runSimpulPadChecks()).filter((row) => !row.ok).map((row) => row.serviceKey), ["simpul-pad-qris", "simpul-pad-va"]);
});
