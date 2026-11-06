"use client";

import { AdminSelect } from "@/components/admin-select";
import { AdminComponentCheckboxes } from "@/components/admin-component-checkboxes";
import { getIncidentComponents } from "@/lib/incident-components";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { incidentStates, maintenanceStates, stateLabel } from "@/lib/incident";

type AdminIncidentDialogProps = {
  id: number;
  title: string;
  description: string;
  kind: string;
  state: string;
  serviceKey: string;
  affectedComponentKeys: string[] | null;
  titleReviewRequired?: boolean;
};

export function AdminIncidentDialog({ id, title, description, kind, state, serviceKey, affectedComponentKeys, titleReviewRequired }: AdminIncidentDialogProps) {
  const options = (kind === "maintenance" ? maintenanceStates : incidentStates)
    .map((value) => ({ value, label: stateLabel(value) }));
  const incidentComponents = getIncidentComponents(serviceKey);

  return <Dialog>
    <DialogTrigger render={<Button type="button" variant="outline" size="sm" aria-label={`Perbarui ${title}`} />}>
      Perbarui
    </DialogTrigger>
    <DialogContent className="admin-update-dialog sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Perbarui informasi</DialogTitle>
        <DialogDescription>{title}</DialogDescription>
      </DialogHeader>
      <form className="admin-form admin-dialog-form" action={`/api/admin/incidents/${id}`} method="post">
        <label htmlFor={`title-${id}`}>Judul</label>
        <input id={`title-${id}`} name="title" defaultValue={title} maxLength={120} required aria-describedby={titleReviewRequired ? `title-hint-${id}` : undefined} />
        {titleReviewRequired && <p id={`title-hint-${id}`} className="form-hint">Informasi ini dibuat otomatis. Judul dan keterangan dapat dilengkapi setelah gangguan diperiksa, termasuk saat sudah selesai.</p>}
        <label htmlFor={`description-${id}`}>Keterangan kejadian</label>
        <textarea id={`description-${id}`} name="description" rows={3} maxLength={2000} defaultValue={description} placeholder="Opsional. Jelaskan apa yang terjadi pada waktu tersebut." />
        {incidentComponents.length > 0 && <AdminComponentCheckboxes serviceKey={serviceKey} defaultSelected={affectedComponentKeys ?? incidentComponents.map((component) => component.key)} />}
        <AdminSelect id={`state-${id}`} label="Tahap berikutnya" name="state" defaultValue={state} options={options} />
        <label htmlFor={`note-${id}`}>Catatan pembaruan</label>
        <textarea id={`note-${id}`} name="message" rows={4} maxLength={2000} placeholder="Opsional. Tambahkan perkembangan terbaru kepada publik." />
        <DialogFooter className="admin-dialog-actions">
          <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          <Button type="submit">Terbitkan pembaruan</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
