import type { ServiceStatus, ServiceHistoryBucket, PublicStatus } from "./status";

export function rollupServiceStatus(site: ServiceStatus, components: ServiceStatus[], history: ServiceHistoryBucket[]): ServiceStatus {
  const monitors = [site, ...components].filter((monitor) => monitor.state !== "skipped");
  const state: PublicStatus = monitors.some((monitor) => monitor.state === "degraded") ? "degraded"
    : monitors.some((monitor) => monitor.state === "unknown") ? "unknown" : "operational";
  const total = history.reduce((sum, bucket) => sum + bucket.count, 0);
  const failed = history.reduce((sum, bucket) => sum + bucket.failedCount, 0);
  const uptime = total ? Math.round(((total - failed) / total) * 10000) / 100 : null;
  const latest = monitors.reduce<ServiceStatus["latest"]>((current, monitor) =>
    !current || (monitor.latest && monitor.latest.checkedAt > current.checkedAt) ? monitor.latest : current, null);
  return { ...site, state, history, uptime, latest, isOverall: true };
}

export const rollupSapadaStatus = rollupServiceStatus;
