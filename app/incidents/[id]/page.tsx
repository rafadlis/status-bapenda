import type { Metadata } from "next";
import { cache, Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { PageLoading } from "@/components/page-loading";
import { getDb } from "@/lib/db";
import { incidents, incidentUpdates } from "@/lib/db/schema";
import { kindLabel, stateLabel } from "@/lib/incident";
import { affectedComponentNames } from "@/lib/incident-components";
import { getIncidentServices, incidentServiceLabel } from "@/lib/incident-service";
import { formatJakarta } from "@/lib/status";
import { absoluteUrl, pageMetadata, serializeJsonLd, siteName } from "@/lib/seo";

type IncidentProps = { params: Promise<{ id: string }> };

const getIncident = cache(async (rawId: string) => {
  await connection();
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const db = getDb();
  const [incident] = await db.select().from(incidents).where(eq(incidents.id, id)).limit(1);
  if (!incident) notFound();
  const updates = await db.select().from(incidentUpdates).where(eq(incidentUpdates.incidentId, id))
    .orderBy(desc(incidentUpdates.createdAt), desc(incidentUpdates.id));
  const latestMessage = updates[0]?.message || (incident.state === "resolved"
    ? incident.kind === "maintenance" ? "Pemeliharaan telah selesai." : "Gangguan telah selesai."
    : incident.message);
  return { incident, updates, latestMessage };
});

export async function generateMetadata({ params }: IncidentProps): Promise<Metadata> {
  const { incident, latestMessage } = await getIncident((await params).id);
  const message = latestMessage.replace(/\s+/g, " ").trim();
  const summary = `${incidentServiceLabel(incident.serviceKey)}: ${stateLabel(incident.state)}. ${message}`;
  const description = summary.length > 160 ? `${summary.slice(0, 157).trimEnd()}...` : summary;
  const metadata = pageMetadata(incident.title, description, `/incidents/${incident.id}`);
  return {
    ...metadata,
    openGraph: {
      ...metadata.openGraph,
      type: "article",
      publishedTime: incident.createdAt.toISOString(),
      modifiedTime: incident.updatedAt.toISOString(),
    },
  };
}

function elapsedLabel(later: Date, earlier: Date) {
  const minutes = Math.round((later.getTime() - earlier.getTime()) / 60_000);
  if (minutes < 1) return "kurang dari semenit sebelumnya";
  if (minutes < 60) return `${minutes} menit sebelumnya`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam sebelumnya`;
  return `${Math.round(hours / 24)} hari sebelumnya`;
}

function activityWidths(createdAt: Date, resolvedAt: Date | null, now: Date) {
  const end = resolvedAt ?? now;
  const duration = Math.max(end.getTime() - createdAt.getTime(), 60_000);
  const context = Math.max(5 * 60_000, duration / 10);
  const total = duration + context + (resolvedAt ? context : 0);
  return {
    before: (context / total) * 100,
    affected: (duration / total) * 100,
    after: resolvedAt ? (context / total) * 100 : 0,
  };
}

export default function IncidentPage({ params }: IncidentProps) {
  return <div className="status-site reference-site"><SiteHeader />
    <Suspense fallback={<PageLoading page="incident" />}><IncidentContent params={params} /></Suspense>
    <SiteFooter /></div>;
}

async function IncidentContent({ params }: IncidentProps) {
  const { incident, updates, latestMessage } = await getIncident((await params).id);
  const latest = updates[0];
  const latestAt = latest?.createdAt ?? incident.updatedAt;
  const affectedServices = getIncidentServices(incident.serviceKey);
  const affectedComponents = affectedComponentNames(incident.affectedComponentKeys);
  const resolved = incident.state === "resolved";
  const maintenance = incident.kind === "maintenance";
  const affectedAt = maintenance
    ? [...updates].reverse().find((update) => update.state === "in_progress")?.createdAt ?? incident.createdAt
    : incident.createdAt;
  const now = new Date();
  const resolvedAt = resolved ? incident.resolvedAt ?? latestAt : null;
  const activityEnd = resolvedAt ?? now;
  const widths = activityWidths(affectedAt, resolvedAt, now);
  const stageClass = resolved ? "resolved" : maintenance ? "maintenance" : "active";
  const url = absoluteUrl(`/incidents/${incident.id}`);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": url,
        url,
        name: incident.title,
        description: latestMessage,
        datePublished: incident.createdAt.toISOString(),
        dateModified: incident.updatedAt.toISOString(),
        inLanguage: "id-ID",
        isPartOf: { "@type": "WebSite", name: siteName, url: absoluteUrl("/") },
        breadcrumb: { "@id": `${url}#breadcrumb` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: siteName, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: "Riwayat pembaruan", item: absoluteUrl("/history") },
          { "@type": "ListItem", position: 3, name: incident.title, item: url },
        ],
      },
    ],
  };

  return <main className="site-width reference-incident-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
    <nav className="reference-breadcrumb" aria-label="Jejak halaman"><Link href="/">Bapenda Garut</Link><span>/</span><Link href="/history">Riwayat</Link><span>/</span><span>{incident.title}</span></nav>

    <section className={`incident-summary incident-summary-${stageClass}`} aria-labelledby="incident-title">
      <div className="incident-summary-title"><Link href="/history" aria-label="Kembali ke riwayat pembaruan">‹</Link><h1 id="incident-title">{incident.title}</h1></div>
      <div className="incident-summary-meta"><span>{stateLabel(incident.state)}</span><span aria-hidden="true">·</span><span>{kindLabel(incident.kind)} layanan</span></div>
      <div className="incident-summary-body"><p>{latestMessage}</p><div><time dateTime={latestAt.toISOString()}>{formatJakarta(latestAt, { dateStyle: "full", timeStyle: "short" })} WIB</time><span aria-hidden="true">·</span><Link href="#pembaruan">Lihat semua pembaruan</Link></div></div>
    </section>

    <section className="incident-detail-card" aria-labelledby="affected-title">
      <header><h2 id="affected-title">{maintenance ? "Layanan terkait" : "Layanan terdampak"}</h2></header>
      {incident.state !== "scheduled" && <div className="incident-affected-range"><time dateTime={affectedAt.toISOString()}>{formatJakarta(affectedAt, { dateStyle: "medium", timeStyle: "short" })} WIB</time><time dateTime={activityEnd.toISOString()}>{resolved ? `${formatJakarta(activityEnd, { dateStyle: "medium", timeStyle: "short" })} WIB` : "Sekarang"}</time></div>}
      <div className="incident-affected-list">{affectedServices.map((service) => <div className="incident-affected-entry" key={service.key}>
        <div className="incident-affected-service"><strong>{service.name}</strong><Link href={service.url} target="_blank" rel="noopener noreferrer">{service.host}</Link></div>
        {service.key === incident.serviceKey && affectedComponents.length > 0 && <p className="incident-affected-components">{affectedComponents.join(" · ")}</p>}
        {incident.state !== "scheduled" && <div className="incident-impact-track" role="img" aria-label={`${service.name}: ${maintenance ? "pemeliharaan" : "gangguan"} dilaporkan dari ${formatJakarta(affectedAt, { dateStyle: "medium", timeStyle: "short" })} WIB hingga ${resolved ? `${formatJakarta(activityEnd, { dateStyle: "medium", timeStyle: "short" })} WIB` : "sekarang"}`}>
          <span className="incident-impact-before" style={{ width: `${widths.before}%` }} />
          <span className={`incident-impact-affected impact-${maintenance ? "maintenance" : "incident"}`} style={{ width: `${widths.affected}%` }} />
          {resolved && <span className="incident-impact-after" style={{ width: `${widths.after}%` }} />}
        </div>}
      </div>)}</div>
      {incident.state === "scheduled" && <p className="incident-scheduled-note">Pemeliharaan belum dimulai. Perkembangan jadwal tersedia pada pembaruan di bawah.</p>}
    </section>

    <section id="pembaruan" className="incident-detail-card incident-updates-card" aria-labelledby="updates-title">
      <header><h2 id="updates-title">Pembaruan</h2></header>
      <div className="incident-updates-list">{updates.length ? updates.map((update, index) => {
        const previous = updates[index - 1];
        return <article key={update.id} className={`incident-update update-${update.state === "resolved" ? "resolved" : maintenance ? "maintenance" : "active"}`}>
          <span className="incident-update-dot" aria-hidden="true" />
          <div className="incident-update-content"><h3>{stateLabel(update.state)}</h3>{(update.message || update.state === "resolved") && <p>{update.message || (maintenance ? "Pemeliharaan telah selesai." : "Gangguan telah selesai.")}</p>}
            <div className="incident-update-date"><time dateTime={update.createdAt.toISOString()}>{formatJakarta(update.createdAt, { dateStyle: "full", timeStyle: "short" })} WIB</time>{previous && <span>({elapsedLabel(previous.createdAt, update.createdAt)})</span>}</div>
          </div>
        </article>;
      }) : <p className="incident-updates-empty">Belum ada pembaruan untuk informasi ini.</p>}</div>
    </section>
  </main>;
}
