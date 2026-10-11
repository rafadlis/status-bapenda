# Status Layanan Bapenda Garut

Public status page for six Bapenda Kabupaten Garut services: SAPADA, Struk Berhadiah, Simpul PAD, SOP Studio, Bapenda Belajar (LMS), and the main Bapenda website. It is deployed on Vercel with Neon Postgres at `https://status.bapenda.garutkab.go.id`.

The page shows the latest status for each service and history ranges from 30 minutes to 90 days. The default is 30 days. Each bar represents one minute, hour, or Jakarta calendar day according to the selected range. Green bars have only successful checks, yellow bars have both successful and failed checks, red bars have only failed checks, and gray bars have no recorded check. Hover or select a bar to see its exact period, failure count, latest error time, and reason. Its detail link lists every check in that period with exact timestamps. The displayed uptime is estimated from recorded checks, not continuous observation. Open pages refresh every minute while visible. When a service has no result for 20 minutes, its state becomes unknown.

## Setup

1. Install dependencies with `bun install`.
2. Copy `.env.example` to `.env.local` and set the Neon connection strings and secrets.
3. Apply the Drizzle migrations with `bunx drizzle-kit migrate`.
4. Run `bun run lint -- app lib components` and `node scripts/check-app-conventions.mjs`.

`DATABASE_URL` is the pooled Neon URL used by the app. `DATABASE_URL_UNPOOLED` is the direct URL used for migrations. Keep both out of Git. The `@shadcn/lint` plugin is registered in `eslint.config.mjs`.

## Search and link previews

`lib/seo.ts` defines the production origin used by canonical URLs, social previews, structured data, and the sitemap. Update it if the production domain changes. The homepage canonical consolidates history-range variants; history pagination and period archives each retain their own canonical URL. Incident titles and descriptions use the published incident and latest update, with data shared between metadata and page rendering for each request.

`/sitemap.xml` lists the homepage, history, and all published incidents with their actual update timestamps. `/robots.txt` advertises the sitemap and excludes API routes from crawling. Admin and check-detail pages have `noindex` metadata and remain crawlable so search engines can read that rule. Vercel preview deployments disallow crawling and have `noindex` metadata. `/opengraph-image` provides the shared social image, and public pages advertise the RSS feed. After deployment, submit the production sitemap in Google Search Console.

## Monitoring and updates

The GitHub Actions workflow calls `POST /api/check` on a five-minute schedule. Configure `MONITOR_TOKEN` as both a GitHub Actions repository secret and a Vercel environment variable, and set the `STATUS_URL` repository variable to the Vercel production URL. Vercel Cron calls `GET /api/check` through 96 daily jobs as a backup; set `CRON_SECRET` in Vercel production environment variables. A request checks all six public services and the SAPADA integrations concurrently, records each result in Neon, and returns the results as JSON. The workflow can also be triggered manually.

### WhatsApp failure alerts

The monitor notifies active WhatsApp recipients through OCA when a service or component remains failed across checks for at least five minutes. It rearms only after at least five minutes of healthy checks. Gaps over 20 minutes restart confirmation. Repeated failures and short recoveries do not produce new alerts.

Each recipient has a 30-minute cooldown and a limit of six send attempts in a rolling 24 hours, including rejected attempts and retries. Queued failures are combined into one message per recipient. Recovered components are removed before sending, and pending alerts expire after one hour. Recipient row locks prevent overlapping monitor runs from sending multiple messages to the same number. Provider timeouts, ambiguous responses, and interrupted send invocations require review and are never automatically resent. Explicit OCA rate-limit rejections may retry up to three times, subject to the same recipient limits.

Manage names and numbers in `/admin`: add, edit, activate, deactivate, or remove recipients. Disabling, removing, or changing a number cancels its pending messages; a message already submitted to OCA cannot be recalled. Recipient numbers are stored in the database and are only visible to authenticated admins. An alert lists the failing checks, the Jakarta time, and their HTTP status or an unreachable reason. The database stores each recipient's delivery result; `/admin` shows the latest results with masked numbers.

OCA approved the Indonesian template on 30 September 2026 with the code `marketing:peringatan_gangguan_layanan_bapenda`. Its body is:

```text
Peringatan gangguan layanan Bapenda Garut.

Layanan/komponen: {{1}}
Waktu: {{2}} WIB
Hasil pemeriksaan: {{3}}

Mohon segera periksa layanan, telusuri penyebab gangguan, dan lakukan penanganan. Pantau status di https://status.bapenda.garutkab.go.id/.

Pesan ini dikirim otomatis oleh sistem.
```

Apply the database migration and set `WHATSAPP_BIZ_OCA_ENDPOINT`, `WHATSAPP_BIZ_OCA_TOKEN`, and `WHATSAPP_BIZ_OCA_TEMPLATE_CODE_STATUS_ALERT=marketing:peringatan_gangguan_layanan_bapenda` in Vercel production. Add recipients in `/admin` using international format, such as `6281234567890`. Keep the token and real recipient numbers out of Git. Alerts require all three OCA settings and an active recipient. Initial failures go through the same five-minute confirmation. The spam-prevention migration preserves existing failure notifications so deployment does not resend them. Review the admin delivery table after the first live alert. “Diterima OCA” confirms provider acceptance, not delivery to the handset.

The SAPADA section has eight rows: its public website, TTE, Storage, Generate QRIS, Cek Status QRIS, Virtual Account BJB, Kode Bayar, and ATR BPN API. Cek Status QRIS is temporarily skipped and labelled "Dilewati". It has no checks, uptime, automatic incidents or alerts and does not affect overall health. The seven monitored components determine the parent state. Old `sapada-payment` and combined `sapada-qris` checks remain in SAPADA's historical uptime and check details. They are never copied into the generator's history. Existing incidents remain readable and editable. An active manual Payment API incident still covers the monitored payment methods.

The status app calls SAPADA's protected, read only `/api/internal/integration-health?version=3` route because the VPN endpoints cannot be reached from Vercel. Generate QRIS checks only the generator's TCP endpoint. Cek Status QRIS returns `ok: null`, `latencyMs: null`, `skipped: true` without contacting the provider. Virtual Account BJB checks its own TCP endpoint. Kode Bayar checks both inbound bank inquiry and payment handlers with empty, unauthenticated POST requests and requires their specific authentication error. It also requires the bank VPN listener to reject unauthenticated GET requests for both paths with HTTP 403. These checks send no credentials or taxpayer data and create no payments. They verify local handlers and the local VPN listener, not the complete network path from the bank or successful settlement. The unrelated PBB endpoint is excluded from these three active payment monitors. No provider URL or credential appears on the public status page.

Deploy SAPADA's version 3 probe before this status app. SAPADA preserves the default four-result and version 2 six-result contracts for old monitors, both excluding the status check. During rollout or rollback, an old four-result response retains TTE, Storage and ATR BPN while payment methods remain unknown. An old version 2 response also retains VA and Kode Bayar but cannot establish generator health. The status row remains skipped in every case. A missing signing seed records no integration checks; a failed or malformed probe records failures for the six monitored integrations. The existing Ed25519 signing seed and public key remain unchanged. No new secret or database migration is needed. Run the focused tests for component checks, payment components, feeds, incidents, rollup and `lib/qris-monitoring.test.tsx`, plus `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.payment-components.json`.

Open `/admin` and sign in with `ADMIN_PASSWORD` to publish a disruption or planned maintenance for one service or all services in a single update. The page uses `SESSION_SECRET` to sign its session cookie. Every stage change requires a public note and creates a dated update. The homepage highlights active updates, `/history` lists earlier events, `/incidents/:id` shows each timeline and affected services, and `/rss.xml` publishes official updates. The migration assigns existing SAPADA checks and updates to the SAPADA service.

## History bar colors

All history ranges and the SAPADA parent use a shared 99% success threshold for green bars. Yellow means a mixed result below 99% success, red means every observed check failed, and gray means no checks. The inclusive cutoff is applied to raw counts before percentage rounding. For example, one failure among 113 checks gives 99.12% success and stays green, while one failure among 12 hourly checks remains yellow. Tooltips still report the exact failures and link to the underlying checks. Recorded uptime and current status are unchanged. This is a visual summary based on check counts, not a time-weighted uptime SLA. The choice follows [Oh Dear's documented 99% status-page threshold](https://ohdear.app/news-and-updates/our-redesigned-status-pages-can-now-show-uptime-history); providers use configurable thresholds rather than a universal standard. Run `bunx tsx --test lib/history-bar-policy.test.ts` and the scoped `bunx tsc --project tsconfig.history-bars.json --noEmit` to verify it.

## Automatic incidents

Both schedulers use `/api/check`. After saving checks, it creates a public incident when a service or SAPADA component has at least three failed observations spanning ten minutes. Observations less than one minute apart do not increase the sample count. A successful check or a monitoring gap over ten minutes restarts failure confirmation. With the nominal five-minute schedule, confirmation takes about ten minutes after the first failure, or roughly ten to fifteen minutes from the actual outage. Scheduler delays can make it later. This duration is a project choice following the pending-alert approach described in [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/).

The cron job groups confirmed SAPADA component failures into one incident, records an initial timeline update, and marks its default title for admin review. The admin update dialog requires a replacement title before saving an automatically created incident for the first time. A title-only change does not require a timeline note. Stage or affected-component changes require a note. New confirmed component failures extend an open automatic incident and add one update for the newly affected components. Existing manual incidents or ongoing maintenance suppress automatic posts for components they already cover. Future scheduled maintenance does not suppress a current failure.

Repeated checks do not create repeated posts. A PostgreSQL transaction lock serializes the two schedulers, and each component stores its associated incident. An admin can close an incident during an ongoing failure without the next cron reopening it. A component becomes eligible for a new incident only after ten minutes of observed healthy checks followed by a new confirmed failure. Automatic incidents remain open until an admin confirms recovery, including previously published combined QRIS incidents. Manual incidents covering the old QRIS key also cover the generator, preventing duplicate posts during rollout. Public messages report the observed failure without claiming a root cause. WhatsApp confirmation and sending limits remain independent and unchanged.

Apply the `automatic_incidents` migration before deploying this code. Verify the policy with `INCIDENT_POLICY_TEST_DATABASE_URL` and `bunx tsx --test lib/automatic-incidents.test.ts`. These opt-in tests use temporary tables inside transactions, create no public incidents, and send no messages. For a scoped typecheck, run `bunx tsc --project tsconfig.automatic-incidents.json --noEmit`.

On the current Vercel Hobby plan, each Cron job runs once per day with timing precision of roughly one hour. The 96 daily jobs add backup checks but cannot guarantee a precise 15-minute interval. GitHub Actions remains the five-minute scheduler; its scheduled runs can be late or skipped under load, and GitHub may disable them in an inactive public repository. The public page marks monitoring as unknown when results stop arriving. The status site and Neon must be reachable for checks to be saved.

## SAPADA in-app notices

`GET /api/status` is the public version 1 JSON feed for SAPADA's in-app notices.
It returns the combined SAPADA state, the five version 1 component states and check times,
and all active incidents targeting SAPADA or all services. Incident messages use
the latest public update belonging to that incident, ordered by update time and
then update ID. The query builder preserves the outer incident ID in the
correlated subquery; inline SQL in a single-table projection can lose table
qualifiers and select an unrelated incident's message. Resolved events and incidents for other services are
excluded. Queries read only the latest check per component and active incidents,
without history aggregation or a recent-event limit that could hide an older
active incident. Version 1 preserves the `sapada-payment` key by combining the three
independent payment states, with failures taking precedence over unknown states.
Payment incident keys are projected to that same legacy key so existing SAPADA
notices keep accepting the feed. Public page rows and automation retain the
independent payment keys.

The version 1 `paymentMethods` array exposes QRIS, Virtual Account BJB and Kode
Bayar states and check times. Incidents also include `affectedPaymentMethodKeys`:
specific payment keys for method incidents, an empty array for unrelated incidents,
and `null` for whole-service or general payment incidents. SAPADA uses these
details to name affected methods in its banner; legacy feeds and broad payment
incidents keep the label "Pembayaran." Its reader rechecks each method's freshness.

`GET /api/status?version=2` keeps the five aggregate components and exposes four
payment rows with separate `sapada-qris-generate` and `sapada-qris-check` keys.
The check row has `state: "skipped"` and `checkedAt: null`. It is excluded from
aggregate health and timestamps. Status-only incidents retain their scope in
version 2 but do not trigger SAPADA warnings. Version 1 omits these incidents
for older readers.

The response excludes provider URLs, probe errors, credentials and recipient
data. Its CDN cache lasts 30 seconds, with no stale response window. Failed data
reads return HTTP 503 and an unavailable/unknown snapshot with no caching. Monitor
results expire after 20 minutes, matching the public page. No new secret or
migration is required. SAPADA proxies the feed on its server, so browser CORS is
not required. Deploy this endpoint before SAPADA's notice integration.

Focused checks are `bun run test:status-feed`,
`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.incident-message-check.json`, and
`bun run lint -- app/api/status/route.ts lib/status-feed-query.ts lib/status-feed-query.test.ts`.

## Domain

`status.bapenda.garutkab.go.id` is attached to the Vercel project and serves the status page over HTTPS. Cloudflare has a DNS-only A record named `status.bapenda` in the `garutkab.go.id` zone pointing to `76.76.21.21`. Public resolvers return that address. Vercel now recommends a project-specific CNAME, while its domain settings say the legacy A record continues to work. The app is also available at `sapada-status.vercel.app`.
