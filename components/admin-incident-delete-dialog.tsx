"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function AdminIncidentDeleteDialog({ id, title }: { id: number; title: string }) {
  return <Dialog>
    <DialogTrigger render={<Button type="button" variant="destructive" size="sm" aria-label={`Hapus ${title}`} />}>Hapus</DialogTrigger>
    <DialogContent className="admin-update-dialog">
      <DialogHeader>
        <DialogTitle>Hapus informasi ini?</DialogTitle>
        <DialogDescription>“{title}” beserta seluruh pembaruannya akan dihapus permanen dari halaman publik dan riwayat.</DialogDescription>
      </DialogHeader>
      <form action={`/api/admin/incidents/${id}`} method="post">
        <input type="hidden" name="intent" value="delete" />
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          <Button type="submit" variant="destructive">Hapus permanen</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
