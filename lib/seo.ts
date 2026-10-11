import type { Metadata } from "next";

export const siteUrl = "https://status.bapenda.garutkab.go.id";
export const siteName = "Status Layanan Bapenda Garut";
export const siteDescription = "Pantau status SAPADA, Struk Berhadiah, Simpul PAD, SOP Studio, Bapenda Belajar, dan situs Bapenda Garut. Lihat ketersediaan layanan, gangguan, serta jadwal pemeliharaan.";

export function absoluteUrl(path: string) {
  return new URL(path, siteUrl).toString();
}

export function pageMetadata(title: string, description: string, path: string): Metadata {
  const socialTitle = title === siteName ? title : `${title} | Status Bapenda Garut`;
  const image = { url: absoluteUrl("/opengraph-image"), width: 1200, height: 630, alt: siteName };

  return {
    title,
    description,
    alternates: {
      canonical: absoluteUrl(path),
      types: { "application/rss+xml": absoluteUrl("/rss.xml") },
    },
    openGraph: {
      type: "website",
      locale: "id_ID",
      siteName,
      title: socialTitle,
      description,
      url: absoluteUrl(path),
      images: [image],
    },
    twitter: { card: "summary_large_image", title: socialTitle, description, images: [image] },
  };
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
