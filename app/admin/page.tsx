import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { AdminIncidentDialog } from "@/components/admin-incident-dialog";
import { AdminIncidentDeleteDialog } from "@/components/admin-incident-delete-dialog";
import { AdminIncidentTarget } from "@/components/admin-incident-target";
import { AdminSelect } from "@/components/admin-select";
import { AdminRecipientDialog } from "@/components/admin-recipient-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SiteHeader } from "@/components/site-header";
import { PageLoading } from "@/components/page-loading";
import { isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { incidents, whatsappAlertDeliveries, whatsappAlertRecipients } from "@/lib/db/schema";
import { formatJakarta, getStatusData } from "@/lib/status";
import { kindLabel, stateLabel } from "@/lib/incident";
import { affectedComponentNames } from "@/lib/incident-components";
import { incidentServiceLabel } from "@/lib/incident-service";
import { alertFailureName, whatsappAlertConfigured, whatsappAlertPolicy } from "@/lib/whatsapp-alerts";

export const metadata: Metadata = {
  title: "Pengelola",
  description: "Halaman pengelola pembaruan layanan Bapenda Garut.",
  robots: { index: false, follow: false },
};

type AdminProps = { searchParams: Promise<{ error?: string; created?: string; updated?: string; deleted?: string; recipients?: string; page?: string }> };
const incidentPageSize = 25;

export default function AdminPage({ searchParams }: AdminProps) {
  return <div className="status-site"><SiteHeader />
    <Suspense fallback={<PageLoading page="admin" />}><AdminContent searchParams={searchParams} /></Suspense>
  </div>;
}

async function AdminContent({ searchParams }: AdminProps) {
  await connection();
  const params = await searchParams;
  const authorized = await isAdmin();
  const requestedPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100_000 ? requestedPage : 1;
  const [data, alertDeliveries, recipients, incidentRows] = authorized
    ? await Promise.all([
      getStatusData(null),
      getDb().select().from(whatsappAlertDeliveries).orderBy(desc(whatsappAlertDeliveries.createdAt)).limit(20),
      getDb().select().from(whatsappAlertRecipients).orderBy(whatsappAlertRecipients.id),
      getDb().select().from(incidents).orderBy(desc(incidents.createdAt), desc(incidents.id)).limit(incidentPageSize + 1).offset((page - 1) * incidentPageSize),
    ])
    : [null, [], [], []];
  const displayedIncidents = incidentRows.slice(0, incidentPageSize);
  return <main className="site-width subpage-main admin-main">
    <span className="eyebrow">PENGELOLA BAPENDA</span><h1>{authorized ? "Kelola pembaruan" : "Masuk sebagai pengelola"}</h1>
    {params.error === "login" && !authorized && <p className="form-feedback form-error" role="alert">Kata sandi tidak sesuai. Coba lagi.</p>}
    {params.error === "validation" && authorized && <p className="form-feedback form-error" role="alert">Periksa judul, komponen terdampak, tahap, dan rentang waktu. Judul maksimal 120 karakter; keterangan dan catatan maksimal 2.000 karakter. Informasi baru memerlukan catatan publik.</p>}
    {(params.created === "1" || params.updated === "1") && authorized && <p className="form-feedback form-success" role="status">Pembaruan telah diterbitkan.</p>}
    {params.deleted === "1" && authorized && <p className="form-feedback form-success" role="status">Informasi dan seluruh pembaruannya telah dihapus permanen.</p>}
    {params.error === "recipient" && authorized && <p className="form-feedback form-error" role="alert">Masukkan satu nomor WhatsApp yang valid dan nama maksimal 80 karakter.</p>}
    {params.error === "recipient-duplicate" && authorized && <p className="form-feedback form-error" role="alert">Nomor tersebut sudah terdaftar atau penerima tidak ditemukan.</p>}
    {params.recipients === "updated" && authorized && <p className="form-feedback form-success" role="status">Daftar penerima WhatsApp telah diperbarui.</p>}
    {!authorized ? <form className="admin-form" action="/api/admin/login" method="post">
      <p>Masukkan kata sandi untuk menerbitkan informasi layanan.</p>
      <label htmlFor="password">Kata sandi</label><input id="password" name="password" type="password" autoComplete="current-password" required />
      <button type="submit">Masuk</button>
    </form> : <>
      <p className="page-description">Gangguan diterbitkan otomatis setelah sedikitnya tiga pemeriksaan gagal selama 10 menit. Saat seluruh komponen terdampak kembali normal, informasi otomatis ditutup menjadi Selesai tanpa keterangan tambahan. Pengelola tetap dapat melengkapi, memperbarui, atau menghapusnya.</p>
      <p><Link className="text-link" href="/?range=60m#system-status-title">Pilih batang riwayat untuk mencatat kejadian pada rentang waktu tertentu →</Link></p>
      <div className="admin-monitor-list">{data?.services.map((service) => <div className="admin-monitor" key={service.service.key}>
        <div><span className={`service-dot dot-${service.state}`} /><strong>{service.service.name}: {service.state === "operational" ? "dapat diakses" : service.state === "degraded" ? "pemeriksaan gagal" : "status belum diketahui"}</strong></div>
        <span>{service.latest ? `Pemeriksaan ${formatJakarta(service.latest.checkedAt, { dateStyle: "medium", timeStyle: "medium" })} WIB` : "Belum ada pemeriksaan"}</span>
      </div>)}</div>
      <section className="admin-section"><Card className="admin-panel">
        <CardHeader className="border-b"><CardTitle><h2>Terbitkan informasi baru</h2></CardTitle></CardHeader>
        <CardContent><form className="admin-form admin-create-form" action="/api/admin/incidents" method="post">
          <AdminIncidentTarget />
          <AdminSelect id="kind" label="Jenis informasi" name="kind" defaultValue="incident" options={[{ value: "incident", label: "Gangguan" }, { value: "maintenance", label: "Pemeliharaan terjadwal" }]} />
          <p className="form-hint">Gangguan dimulai pada tahap “Sedang diselidiki”. Pemeliharaan dimulai pada tahap “Dijadwalkan”.</p>
          <label htmlFor="title">Judul</label><input id="title" name="title" maxLength={120} placeholder="Contoh: Akses layanan terganggu" required />
          <label htmlFor="message">Catatan untuk publik</label><textarea id="message" name="message" rows={5} maxLength={2000} placeholder="Jelaskan dampak, penyebab jika diketahui, dan langkah berikutnya." required />
          <button type="submit">Terbitkan informasi</button>
        </form></CardContent>
      </Card></section>
      <section className="admin-section"><Card className="admin-panel">
        <CardHeader className="border-b"><CardTitle><h2>Kelola informasi</h2></CardTitle>
          <CardDescription>{displayedIncidents.length} informasi · halaman {page}</CardDescription>
        </CardHeader>
        <CardContent className="admin-table-content">{displayedIncidents.length ? <Table aria-label="Daftar informasi layanan" className="admin-incident-table">
          <TableHeader><TableRow>
            <TableHead>Informasi</TableHead><TableHead>Tahap</TableHead><TableHead>Diperbarui</TableHead><TableHead className="text-right">Aksi</TableHead>
          </TableRow></TableHeader>
          <TableBody>{displayedIncidents.map((incident) => <TableRow key={incident.id}>
            <TableCell className="admin-table-title"><strong>{incident.title}</strong>{incident.titleReviewRequired && <span className="admin-stage">Otomatis · judul perlu diperbarui</span>}<span>{incidentServiceLabel(incident.serviceKey)} · {kindLabel(incident.kind)}</span>{incident.affectedComponentKeys && <span>{affectedComponentNames(incident.affectedComponentKeys).join(" · ")}</span>}</TableCell>
            <TableCell><span className="admin-stage">{stateLabel(incident.state)}</span></TableCell>
            <TableCell className="admin-table-date">{formatJakarta(incident.updatedAt, { dateStyle: "medium", timeStyle: "short" })} WIB</TableCell>
            <TableCell><div className="admin-row-actions"><Link href={`/incidents/${incident.id}`} aria-label={`Lihat ${incident.title} di halaman publik`}>Lihat publik</Link><AdminIncidentDialog id={incident.id} title={incident.title} description={incident.message} kind={incident.kind} state={incident.state} serviceKey={incident.serviceKey} affectedComponentKeys={incident.affectedComponentKeys} titleReviewRequired={incident.titleReviewRequired} /><AdminIncidentDeleteDialog id={incident.id} title={incident.title} /></div></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <p className="admin-empty">Belum ada informasi yang diterbitkan.</p>}</CardContent>
      </Card></section>
      {(page > 1 || incidentRows.length > incidentPageSize) && <nav className="pager" aria-label="Halaman informasi pengelola">
        {page > 1 ? <Link href={`/admin?page=${page - 1}`}>Informasi lebih baru</Link> : <span />}
        <span>Halaman {page}</span>
        {incidentRows.length > incidentPageSize && <Link href={`/admin?page=${page + 1}`}>Informasi lebih lama</Link>}
      </nav>}
      <section className="admin-section" id="whatsapp-recipients"><Card className="admin-panel">
        <CardHeader className="border-b admin-recipient-header">
          <div><CardTitle><h2>Penerima WhatsApp</h2></CardTitle>
            <CardDescription>{recipients.filter((recipient) => recipient.enabled).length} penerima aktif · peringatan gangguan otomatis</CardDescription>
          </div><AdminRecipientDialog />
        </CardHeader>
        <CardContent className="admin-table-content">{recipients.length ? <Table aria-label="Daftar penerima WhatsApp" className="admin-incident-table admin-recipient-table">
          <TableHeader><TableRow><TableHead>Penerima</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
          <TableBody>{recipients.map((recipient) => <TableRow key={recipient.id}>
            <TableCell><strong>{recipient.name || recipient.phone}</strong>{recipient.name && <div>{recipient.phone}</div>}</TableCell>
            <TableCell><span className="admin-stage">{recipient.enabled ? "Aktif" : "Nonaktif"}</span></TableCell>
            <TableCell><div className="admin-row-actions">
              <AdminRecipientDialog recipient={{ id: recipient.id, name: recipient.name, phone: recipient.phone }} />
              <form action="/api/admin/whatsapp-recipients" method="post">
                <input type="hidden" name="intent" value="toggle" /><input type="hidden" name="id" value={recipient.id} />
                <Button type="submit" variant="outline" size="sm" aria-label={`${recipient.enabled ? "Nonaktifkan" : "Aktifkan"} ${recipient.name || recipient.phone}`}>{recipient.enabled ? "Nonaktifkan" : "Aktifkan"}</Button>
              </form>
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <p className="admin-empty">Tambahkan penerima untuk mendapat peringatan gangguan.</p>}</CardContent>
      </Card></section>
      <section className="admin-section"><Card className="admin-panel">
        <CardHeader className="border-b"><CardTitle><h2>Peringatan WhatsApp</h2></CardTitle>
          <CardDescription>{whatsappAlertConfigured() && recipients.some((recipient) => recipient.enabled) ? "Aktif · pesan dikirim saat gangguan baru terdeteksi" : "Belum aktif · lengkapi konfigurasi OCA dan penerima"}</CardDescription>
          <CardDescription>Gangguan dan pemulihan dikonfirmasi selama {whatsappAlertPolicy.confirmationMinutes} menit. Maksimal satu pengiriman per {whatsappAlertPolicy.cooldownMinutes} menit dan {whatsappAlertPolicy.dailyLimit} per 24 jam untuk tiap penerima. Gangguan yang menunggu digabung; pesan kedaluwarsa setelah {whatsappAlertPolicy.expiryMinutes} menit.</CardDescription>
        </CardHeader>
        <CardContent className="admin-table-content">{alertDeliveries.length ? <Table aria-label="Riwayat pengiriman peringatan" className="admin-incident-table">
          <TableHeader><TableRow><TableHead>Waktu</TableHead><TableHead>Penerima</TableHead><TableHead>Gangguan</TableHead><TableHead>Pengiriman</TableHead></TableRow></TableHeader>
          <TableBody>{alertDeliveries.map((delivery) => <TableRow key={delivery.id}>
            <TableCell className="admin-table-date">{formatJakarta(delivery.createdAt, { dateStyle: "medium", timeStyle: "short" })} WIB</TableCell>
            <TableCell>••••{delivery.phone.slice(-4)}</TableCell>
            <TableCell>{delivery.failures.map((failure) => alertFailureName(failure.serviceKey)).join(", ")}</TableCell>
            <TableCell><span className="admin-stage">{{ pending: "Menunggu", sending: "Memproses", accepted: "Diterima OCA", retry: "Mencoba lagi", failed: "Gagal", needs_review: "Perlu ditinjau", cancelled: "Dibatalkan" }[delivery.status] ?? delivery.status}</span>{delivery.lastError && <span className="admin-alert-error">{delivery.lastError}</span>}</TableCell>
          </TableRow>)}</TableBody>
        </Table> : <p className="admin-empty">Belum ada peringatan yang dikirim.</p>}</CardContent>
      </Card></section>
      <form action="/api/admin/logout" method="post"><button className="button-text" type="submit">Keluar dari pengelola</button></form>
    </>}
  </main>;
}
