import Link from "next/link";
import type { ReactNode } from "react";
import { ComponentDisclosure, ComponentDisclosurePanel, ComponentDisclosureToggle } from "@/components/component-disclosure";
import { HistoryRangeMenu } from "@/components/history-range-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCheckResult } from "@/lib/check-result";
import { getHistoryRange, getHistoryWindow } from "@/lib/history-range";
import { formatJakarta, type ServiceStatus } from "@/lib/status";
import { getService } from "@/lib/services";
import { getHistoryBarState, getHistoryBarSummary, historyBarLegend } from "@/lib/history-bar-policy";

export function HistoryChart({ services, components, selectedRange, now }: {
  services: ServiceStatus[];
  components: ServiceStatus[];
  selectedRange: string | string[] | undefined;
  now: Date;
}) {
  const range = getHistoryRange(selectedRange);
  return <section className="reference-system-card" aria-labelledby="system-status-title">
    <div className="reference-system-head"><h2 id="system-status-title">Status sistem</h2><HistoryRangeMenu key={range.key} selectedRange={range.key} /></div>
    <div className="reference-service-legend"><div className="reference-legend" aria-label="Legenda pemeriksaan">{historyBarLegend.map((item) => <span key={item.state}><i className={`reference-bar-${item.state}`} aria-hidden="true" />{item.label}</span>)}</div></div>
    {services.map((service) => {
      const serviceComponents = components.filter((component) => component.service.key === service.service.key
        || ("parentKey" in component.service && component.service.parentKey === service.service.key));
      return serviceComponents.length > 0
        ? <ComponentDisclosure key={service.service.key}>
          <ServiceHistoryRow service={service} range={range} now={now} afterName={<ComponentDisclosureToggle count={serviceComponents.length} serviceName={service.service.name} />} />
          <ComponentDisclosurePanel>
            {serviceComponents.map((component) => <ServiceHistoryRow key={component.service.key} service={component} range={range} now={now} />)}
          </ComponentDisclosurePanel>
        </ComponentDisclosure>
        : <div className="reference-service-group" key={service.service.key}>
          <ServiceHistoryRow service={service} range={range} now={now} />
        </div>;
    })}
  </section>;
}

function ServiceHistoryRow({ service, range, now, afterName }: {
  service: ServiceStatus;
  range: ReturnType<typeof getHistoryRange>;
  now: Date;
  afterName?: ReactNode;
}) {
  const { start, bucketMs } = getHistoryWindow(range, now);
  const buckets = service.history;
  const publicService = getService(service.service.key);
  const name = service.displayName ?? service.service.name;
  const overall = service.isOverall === true;
  if (service.state === "skipped") return <div className="reference-service" aria-label={`${name}: Dilewati`}>
    <div className="reference-service-head"><div><span className="reference-service-icon status-unknown" aria-hidden="true">–</span><strong>{name}</strong></div><span className="reference-uptime">Dilewati</span></div>
    <p className="reference-disclaimer">Pemeriksaan status QRIS sementara dilewati. Tidak memengaruhi status keseluruhan atau waktu aktif.</p>
  </div>;
  const stateLabel = service.state === "operational" ? "Beroperasi" : service.state === "degraded" ? "Terganggu" : "Belum diketahui";
  const uptimeHint = overall ? "Persentase putaran saat semua komponen yang diperiksa berhasil. Riwayat lama dapat mencakup sebagian komponen." : "Persentase pemeriksaan yang berhasil selama rentang terpilih";

  return <div className="reference-service" aria-label={`${name}: ${stateLabel}`}>
    <div className="reference-service-head"><div><span className={`reference-service-icon status-${service.state}`} aria-hidden="true">{service.state === "operational" ? "✓" : service.state === "degraded" ? "!" : "?"}</span><strong>{name}</strong>{afterName}
      {publicService && !overall && <Tooltip><TooltipTrigger render={<Link className="reference-service-domain" href={publicService.url} target="_blank" rel="noopener noreferrer" aria-label={`Buka ${name} di tab baru`} />}>{publicService.host}</TooltipTrigger><TooltipContent>Buka {name} di tab baru</TooltipContent></Tooltip>}
    </div><Tooltip><TooltipTrigger render={<span className="reference-uptime" tabIndex={0} aria-label={`${service.uptime === null ? "Waktu aktif belum tersedia" : `${service.uptime.toFixed(2)}% waktu aktif`}. ${uptimeHint}`} />}>{service.uptime === null ? "Waktu aktif belum tersedia" : `${service.uptime.toFixed(2)}% waktu aktif`}</TooltipTrigger><TooltipContent>{uptimeHint}</TooltipContent></Tooltip></div>
    <div className={`reference-bars${range.buckets > 60 ? " reference-bars-dense" : ""}`} style={{ gridTemplateColumns: `repeat(${range.buckets}, minmax(0, 1fr))` }}>{buckets.map((bucket, index) => {
      const bucketStart = new Date(start.getTime() + index * bucketMs);
      const bucketEnd = new Date(start.getTime() + (index + 1) * bucketMs);
      const period = range.bucketLabel === "1 hari"
        ? formatJakarta(bucketStart, { dateStyle: "medium" })
        : `${formatJakarta(bucketStart, { dateStyle: "medium", timeStyle: "short" })}–${formatJakarta(bucketEnd, { timeStyle: "short" })} WIB`;
      const bucketState = getHistoryBarState(bucket);
      const summary = getHistoryBarSummary(bucket, overall);
      const failure = bucket.latestFailure;
      const coverage = overall && bucket.partialCount ? `${bucket.partialCount} putaran hanya mencakup sebagian komponen` : null;
      const label = `${name}, ${period}: ${summary}${coverage ? `. ${coverage}` : ""}${failure ? `. ${formatCheckResult(failure)}` : ""}`;
      const barClass = `reference-bar reference-bar-${bucketState}`;
      const trigger = bucket.count > 0
        ? <Link href={`/checks?service=${service.service.key}&from=${bucketStart.getTime()}&to=${Math.min(bucketEnd.getTime(), now.getTime())}&range=${range.key}${overall ? "&view=overall" : ""}`} className={barClass} aria-label={`${label}. Lihat semua pemeriksaan.`} />
        : <button type="button" className={barClass} aria-label={label} />;
      return <Tooltip key={index}>
        <TooltipTrigger render={trigger} />
        <TooltipContent side="top" className="reference-check-tooltip">
          <strong>{name} · {period}</strong>
          <span>{summary}</span>
          {coverage && <span>{coverage}</span>}
          {failure && <span>Terakhir gagal: {formatJakarta(failure.checkedAt, { dateStyle: "medium", timeStyle: "medium" })} WIB. {formatCheckResult(failure)}</span>}
          {bucket.count > 0 && <span className="reference-tooltip-action">Klik batang untuk melihat pemeriksaan</span>}
        </TooltipContent>
      </Tooltip>;
    })}</div>
    <div className="reference-bar-axis"><span>{range.label} lalu</span><span>1 batang = {range.bucketLabel}</span><span>Sekarang</span></div>
  </div>;
}
