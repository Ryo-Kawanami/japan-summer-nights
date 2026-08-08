import type { Metadata } from "next";
import "./globals.css";

const TITLE = "日本の夏は、夜が暑くなった";
const DESCRIPTION =
  "人工衛星が25年間測り続けた日本の夏の地表面温度。昼は年ごとのばらつきに埋もれ、夜だけが確かに上がっていた。";
const SITE = "https://japan-summer-nights.mdo4nt6n.workers.dev";

export const metadata: Metadata = {
  // 相対パスの og:image を絶対URLに直すのに要る。これが無いと画像が出ない。
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "article",
    locale: "ja_JP",
    url: SITE,
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    images: [{
      url: "/og.png",
      width: 1200,
      height: 630,
      // 画像しか届かない場所でも中身が伝わるようにしておく。
      alt: "夏の夜の地表面温度の日本地図と、特に寝苦しい夜が年10日から年22日に増えたことを示す数字",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
