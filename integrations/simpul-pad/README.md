# Simpul PAD payment health probe

This directory contains a route to install in the Simpul PAD application on `bapenda-srv0`. It runs beside Simpul PAD so its TCP probes use the application's bank network and current payment configuration. The public login and API checks are performed separately by the status application.

## Installation

1. Add `app/api/internal/status-health/route.ts` from this directory to the same relative path in a Simpul PAD working branch and commit it there. The server checkout is `/home/bapenda/simpul-pad-source` on `bapenda-srv0`; its deployment builds the committed `origin/main` revision in an isolated worktree. Copying an uncommitted file into the server checkout or current release does not include it in that build.
2. Prepare a 32-byte Ed25519 signing seed as 64 hexadecimal characters, keeping `SIMPUL_PAD_HEALTH_TOKEN` unset in the status deployment until step 4. Set Simpul PAD's `SIMPUL_PAD_HEALTH_PUBLIC_KEY` to its corresponding public key, encoded as base64 DER SPKI. Store the signing seed only in the status application's secret configuration. To reuse the existing integration signing key, explicitly use the existing `INTEGRATION_HEALTH_TOKEN` value for the new seed and provision its corresponding public key in Simpul PAD; there is no implicit fallback.
3. Publish the Simpul PAD change through its existing deployment process once tests and builds are authorized. The production cron job checks `origin/main` every minute; publishing to that branch can start tests and a Next.js build automatically. The pipeline then backs up the database, runs its existing migration/catalogue steps, checks a candidate release, and switches the live release with rollback on failed readiness. This change adds no migration. The source artifact in this repository must be released through Simpul PAD's deployment; deploying the status application alone does not install it.
4. Enable `SIMPUL_PAD_HEALTH_TOKEN` in the status deployment after the route is deployed. Missing monitor configuration leaves payment observations unknown while public login/API checks continue.

No additional package is required. The route uses Node.js crypto/network APIs and the existing Simpul PAD configuration helpers. Its imports are resolved within Simpul PAD, so the artifact is excluded from this status application's TypeScript project.

## Contract and authentication

The monitor sends `GET /api/internal/status-health` with:

```text
Authorization: HealthSignature <timestamp-in-milliseconds>.<base64url-signature>
```

The Ed25519 signature covers the UTF-8 text `GET\n/api/internal/status-health\n<timestamp-in-milliseconds>`, using actual newline characters. The timestamp may differ from server time by at most 60 seconds. Both hosts need synchronized clocks. Missing or invalid public-key configuration returns HTTP 503 before resolving payment configuration or connecting to a bank. Invalid authentication returns HTTP 401. Error responses contain generic messages and every response has `Cache-Control: no-store`.

An authenticated request returns HTTP 200 with exactly this shape:

```json
{
  "version": 1,
  "results": [
    { "key": "simpul-pad-qris", "ok": true, "latencyMs": 3 },
    { "key": "simpul-pad-va", "ok": true, "latencyMs": 4 }
  ]
}
```

Payment failures are represented by `ok: false`. Configuration failures use `latencyMs: null`; otherwise latency measures TCP connection time. Hosts, credentials, error details, billing records, and taxpayer data are never returned.

## Check coverage

- QRIS requires an enabled runtime configuration, configured recipient agency, and cron configuration. It reads the same `getQrisRuntimeConfiguration()` helper as the application, including portal-managed SNAP settings and the legacy environment configuration. Legacy mode connects to both generator and status-query targets; SNAP mode connects to its base URL.
- VA requires `BJB_VA_WORKER_ENABLED=true`, a configured recipient agency, cron configuration, and a valid `getBjbVaEnvironment()` configuration before connecting to its base URL.
- Configuration resolution has a 3-second response deadline. TCP connections have an absolute 3-second deadline, including DNS, and close immediately after success or failure. Payment checks and each bank's targets run concurrently, keeping the response within approximately 6 seconds under normal event-loop operation. The existing QRIS helper does not support cancellation; if its database read exceeds the deadline, the response reports failure while the helper's read finishes under the application's existing database timeouts.

These are configuration and TCP reachability checks. They do not authenticate to a bank, create QR codes or virtual accounts, query real payments, verify bank business responses, prove scheduled workers are running, or establish payment settlement. Worker flags and cron configuration establish configuration readiness only.
