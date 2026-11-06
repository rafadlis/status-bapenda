"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { AdminHistoryIncidentDialog } from "@/components/admin-history-incident-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type HistoryBar = {
  from: number;
  to: number;
  ongoing: boolean;
  period: string;
  label: string;
  state: string;
  summary: string;
  coverage: string | null;
  failure: string | null;
  href: string | null;
};

type Endpoint = Pick<HistoryBar, "from" | "to" | "ongoing">;
type Selection = { anchor: Endpoint; end: Endpoint; complete: boolean };

export function HistoryBars({ bars, name, serviceKey, componentKeys, canReport }: {
  bars: HistoryBar[];
  name: string;
  serviceKey: string;
  componentKeys: string[];
  canReport: boolean;
}) {
  const hintId = useId();
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const from = selection ? Math.min(selection.anchor.from, selection.end.from) : null;
  const to = selection ? Math.max(selection.anchor.to, selection.end.to) : null;
  const ongoing = Boolean(selection && (selection.anchor.ongoing || selection.end.ongoing));
  const period = from !== null && to !== null ? [from, to].map((value) => new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short",
  }).format(value)).join(" – ") + " WIB" : null;

  function selectBar(bar: HistoryBar, extend: boolean) {
    // Store timestamps so refreshes cannot move an in-progress report to another period.
    const endpoint = { from: bar.from, to: bar.to, ongoing: bar.ongoing };
    setSelection((previous) => previous && (extend || !previous.complete)
      ? { anchor: previous.anchor, end: endpoint, complete: true }
      : { anchor: endpoint, end: endpoint, complete: false });
  }

  return <>
    {canReport && <div className="history-report-controls">
      <Button type="button" variant="outline" size="sm" aria-pressed={selecting} onClick={() => {
        setSelecting(!selecting);
        setSelection(null);
      }}>{selecting ? "Batal memilih" : "Catat kejadian"}</Button>
      {selecting && <span id={hintId}>Pilih satu batang, atau pilih batang awal lalu batang akhir.</span>}
    </div>}
    <div className={`reference-bars${bars.length > 60 ? " reference-bars-dense" : ""}${selecting ? " history-bars-selecting" : ""}`} style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
      {bars.map((bar) => {
        const selected = selecting && from !== null && to !== null && bar.from < to && bar.to > from;
        const className = `reference-bar reference-bar-${bar.state}${selected ? " history-bar-selected" : ""}`;
        const trigger = selecting
          ? <button type="button" className={className} aria-label={`${bar.label}. Pilih waktu kejadian.`} aria-pressed={selected} aria-describedby={hintId}
            disabled={bar.from >= bar.to} onClick={(event) => selectBar(bar, event.shiftKey)} />
          : bar.href
            ? <Link href={bar.href} className={className} aria-label={`${bar.label}. Lihat semua pemeriksaan.`} />
            : <button type="button" className={className} aria-label={bar.label} />;
        return <Tooltip key={bar.from}>
          <TooltipTrigger render={trigger} />
          <TooltipContent side="top" className="reference-check-tooltip">
            <strong>{name} · {bar.period}</strong>
            <span>{bar.summary}</span>
            {bar.coverage && <span>{bar.coverage}</span>}
            {bar.failure && <span>{bar.failure}</span>}
            {(selecting || bar.href) && <span className="reference-tooltip-action">{selecting ? "Klik untuk memilih waktu kejadian" : "Klik batang untuk melihat pemeriksaan"}</span>}
          </TooltipContent>
        </Tooltip>;
      })}
    </div>
    {selecting && <div className="history-report-selection">
      <p role="status">{period ?? "Belum ada waktu yang dipilih."}</p>
      {from !== null && to !== null && <AdminHistoryIncidentDialog key={`${from}:${to}`} name={name} serviceKey={serviceKey} componentKeys={componentKeys} from={from} to={to} ongoing={ongoing} />}
    </div>}
  </>;
}
