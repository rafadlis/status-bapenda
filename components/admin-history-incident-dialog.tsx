"use client";

import { useId } from "react";
import { AdminSelect } from "@/components/admin-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function AdminHistoryIncidentDialog({ serviceKey, name, componentKeys, from, to, ongoing }: {
  serviceKey: string;
  name: string;
  componentKeys: string[];
  from: number;
  to: number;
  ongoing: boolean;
}) {
  const formId = useId();
  const formatTime = (timestamp: number) => new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short",
  }).format(timestamp);

  return <Dialog>
    <DialogTrigger render={<Button type="button" size="sm" />}>Tulis kejadian</DialogTrigger>
    <DialogContent className="admin-update-dialog sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Catat kejadian {name}</DialogTitle>
        <DialogDescription>{formatTime(from)} – {formatTime(to)} WIB</DialogDescription>
      </DialogHeader>
      <form className="admin-form admin-dialog-form" action="/api/admin/incidents" method="post">
        <input type="hidden" name="serviceKey" value={serviceKey} />
        <input type="hidden" name="kind" value="incident" />
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="to" value={to} />
        {componentKeys.map((key) => <input key={key} type="hidden" name="componentKeys" value={key} />)}
        <label htmlFor={`${formId}-title`}>Judul</label>
        <input id={`${formId}-title`} name="title" maxLength={120} required placeholder="Ringkasan kejadian" />
        <label htmlFor={`${formId}-message`}>Apa yang terjadi pada waktu tersebut?</label>
        <textarea id={`${formId}-message`} name="message" rows={4} maxLength={2000} required placeholder="Jelaskan kejadian dan dampaknya pada layanan." />
        <AdminSelect id={`${formId}-state`} label="Status kejadian" name="state" defaultValue={ongoing ? "investigating" : "resolved"}
          options={[{ value: "resolved", label: "Selesai pada akhir rentang terpilih" }, { value: "investigating", label: "Masih berlangsung" }]} />
        <DialogFooter className="admin-dialog-actions">
          <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          <Button type="submit">Terbitkan kejadian</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
