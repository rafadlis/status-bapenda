import Link from "next/link";
import Image from "next/image";
import { RssIcon, WhatsappIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const whatsappHref = "https://wa.me/6285183205278";

export function SiteHeader() {
  return <header className="site-header"><div className="site-width site-header-inner">
    <Link className="brand" href="/" aria-label="Beranda Status Bapenda Garut"><Image className="brand-symbol" src="/bapenda-mark.png" alt="" width={119} height={180} priority /><span className="brand-copy"><strong>BAPENDA</strong><small>Status layanan Garut</small></span></Link>
    <div className="site-header-actions"><Link className="header-contact" href={whatsappHref} target="_blank" rel="noopener noreferrer" aria-label="Hubungi Bapenda Garut lewat WhatsApp di 0851-8320-5278"><HugeiconsIcon icon={WhatsappIcon} strokeWidth={1.8} aria-hidden="true" /><span>0851-8320-5278</span></Link><Link className="header-subscribe" href="/rss.xml"><HugeiconsIcon icon={RssIcon} strokeWidth={1.8} aria-hidden="true" /><span>RSS pembaruan</span></Link></div>
  </div></header>;
}

export function SiteFooter() {
  return <footer className="site-footer"><div className="site-width site-footer-inner"><span>Bapenda Kabupaten Garut</span><div><span>Waktu WIB</span><Link className="footer-contact" href={whatsappHref} target="_blank" rel="noopener noreferrer"><HugeiconsIcon icon={WhatsappIcon} strokeWidth={1.8} aria-hidden="true" />WhatsApp 0851-8320-5278</Link><Link href="https://bapenda.garutkab.go.id/" target="_blank" rel="noreferrer">Buka Bapenda</Link><Link href="/admin">Pengelola</Link></div></div></footer>;
}
