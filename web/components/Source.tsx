"use client";

import type { ReactNode } from "react";

/**
 * 節ごとの出典表示。
 *
 * ページ末尾にまとめるだけだと、いま見ている図が何のデータなのか分からない。
 * 節によって使っているデータが違う（衛星・再解析・気候モデル・行政統計）ので、
 * その場で出せるようにする。
 */
export default function Source({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-xs text-[var(--text-secondary)]">
      <span className="font-medium">出典:</span> {children}
    </p>
  );
}

/** 使い回す出典の断片。文言を1か所に置いて食い違いを防ぐ。 */
export const SOURCES = {
  lst: (
    <>
      地表面温度 = NASA MODIS/Terra MOD11C3 v061（
      <a className="underline" href="https://doi.org/10.5067/MODIS/MOD11C3.061">
        doi:10.5067/MODIS/MOD11C3.061
      </a>
      ）を{" "}
      <a className="underline" href="https://data.earth.jaxa.jp/">
        JAXA Earth API
      </a>{" "}
      経由で取得。夏（6〜8月）の月平均、約5km格子、日本の陸地のみ
    </>
  ),
  landcover: <>市街地率 = JAXA EORC 高解像度土地利用土地被覆図（ALOS、10m解像度、v25.04、2024年）</>,
  era5: (
    <>
      気温・湿度 = ERA5 再解析を{" "}
      <a className="underline" href="https://open-meteo.com/">
        Open-Meteo
      </a>{" "}
      経由で取得。県庁所在地47地点の日別値
    </>
  ),
  cmip6: (
    <>
      将来の気温・湿度 = CMIP6 MRI_AGCM3_2_S（気象庁気象研究所の全球モデル、約20km格子）を
      Open-Meteo 経由で取得
    </>
  ),
  heatstroke: <>熱中症搬送者数 = 総務省消防庁「熱中症による救急搬送状況」（日別×都道府県）</>,
  prefectures: <>都道府県境 = 地球地図日本（国土地理院）</>,
} as const;
