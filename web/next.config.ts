import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare の静的アセット配信に載せるため完全な静的書き出しにする。
  // サーバー側の処理は一切ない。データは事前に焼いた PNG と JSON だけ。
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
