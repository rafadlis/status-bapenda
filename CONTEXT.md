# Bapenda service status

The public status page reports access to Bapenda Garut's monitored services, the health of SAPADA integrations, and updates published by its administrators.

## Language

**Layanan**:
One monitored public Bapenda website.

**Komponen**:
One monitored part of SAPADA or Simpul PAD, including its public website and integrations. Bank connection checks run from each application's server so private bank routes can be reached. The public page does not expose private endpoint URLs.

**Status keseluruhan SAPADA**:
The combined health of the SAPADA website and all its monitored integrations. It is degraded when any component fails, unknown when no component fails but at least one has no recent result, and operational when every component is healthy.

The historical parent chart includes every recorded monitoring run, even when older runs only checked the website. A run fails if any observed component fails. Missing components do not remove a run from history. Tooltips identify runs that cover only some components; historical percentages describe the components observed at that time.

Payments have separate Generate QRIS, Cek Status QRIS, Virtual Account BJB and Kode Bayar rows. Status checking is temporarily skipped, labelled "Dilewati", and excluded from current health, new uptime observations, automatic incidents and alerts. Old combined QRIS and Payment API observations remain in SAPADA's history without becoming generator observations. The protected probe requests version 3. Older probes retain attributable results and leave generator health unknown. Kode Bayar monitors the local bank inquiry/payment guards and VPN listener, without sending credentials or creating a payment. It does not prove the bank's complete network path or settlement.

The default public version 1 feed keeps three payment methods and five aggregate components for older SAPADA readers. `?version=2` exposes the four payment rows, including a skipped status row with no check time. SAPADA notices name the failed monitored payment method and retain "Pembayaran" for broad incidents. Status-only incidents do not override monitored health or payment notices.

Simpul PAD has separate Login, QRIS, Virtual Account BJB and API components alongside its website. Login checks its sign-in page and unauthenticated session handler. API checks database readiness, OpenAPI billing routes and the billing lookup authentication guard. Bank components use the signed `/api/internal/status-health` route installed from `integrations/simpul-pad`; until `SIMPUL_PAD_HEALTH_TOKEN` is explicitly configured, they remain unknown. Bank checks verify configuration and TCP reachability, not payment outcomes. Each parent's current status, history coverage, incidents and component selections stay isolated. The public JSON feed continues to describe SAPADA only.

History bar colors summarize the success rate within each bucket. Green means at least 99% of observed checks succeeded, yellow means some succeeded but the rate is below 99%, red means every recorded check failed, and gray means no observations. Tooltips retain exact failure counts even on green bars. This visual threshold does not change the recorded checks, uptime calculation, current status, incident confirmation, or WhatsApp alert policy.

**Informasi layanan**:
A public report of a disruption or planned maintenance with one update timeline. It can concern one layanan or all monitored layanan. A SAPADA report identifies the affected components; older reports without that selection refer to SAPADA as a whole.

**Gangguan otomatis**:
A public report created by `/api/check` after at least three failures spanning ten minutes for an individual monitor. A healthy check or a gap over ten minutes resets failure confirmation. SAPADA component failures join one open automatic report. Covered manual reports suppress duplicates. Admins must replace the default title, confirm the cause, and close the report. A component can generate another report after ten minutes of observed recovery and a new confirmed failure. WhatsApp sending uses its separate confirmation and rate limits.
