import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getHistoryRange } from "@/lib/history-range";
import { services } from "@/lib/services";
import { getServiceComponents } from "@/lib/components";
import { historyBarLegend } from "@/lib/history-bar-policy";

export function HistoryChartSkeleton({ range, overlay = false }: {
  range: ReturnType<typeof getHistoryRange>;
  overlay?: boolean;
}) {
  return <div className={overlay ? "chart-loading-overlay" : "reference-system-card chart-loading-card"} role="status" aria-live="polite" data-testid="history-chart-skeleton">
    <span className="visually-hidden">Memuat status {range.label} terakhir…</span>
    <div className="reference-system-head"><h2>Status sistem</h2><span className="chart-loading-range">{range.label} terakhir</span></div>
    <div className="reference-service-legend"><div className="reference-legend" aria-hidden="true">{historyBarLegend.map((item) => <span key={item.state}><i className={`reference-bar-${item.state}`} />{item.label}</span>)}</div></div>
    {services.map((service) => {
      const componentCount = getServiceComponents(service.key).length;
      return <div className="reference-service" key={service.key}>
        <div className="reference-service-head"><div><span className="loading-line chart-loading-icon" /><strong>{service.name}</strong>{componentCount > 0 && <span className="reference-components-toggle">{componentCount + 1} komponen <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} aria-hidden="true" /></span>}{componentCount === 0 && <span className="reference-service-domain">{service.host}</span>}</div><span className="loading-line chart-loading-uptime" /></div>
        <div className={`reference-bars${range.buckets > 60 ? " reference-bars-dense" : ""}`} style={{ gridTemplateColumns: `repeat(${range.buckets}, minmax(0, 1fr))` }} aria-hidden="true">{Array.from({ length: range.buckets }, (_, index) => <span className="chart-loading-bar" key={index} />)}</div>
        <div className="reference-bar-axis"><span>{range.label} lalu</span><span>Sekarang</span></div>
      </div>;
    })}
  </div>;
}
