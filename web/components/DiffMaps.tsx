"use client";

import { useEffect, useRef, useState } from "react";

import { buildLut, divergingCss } from "@/lib/colormap";
import { Grid, loadGrid, paint, toCanvas } from "@/lib/raster";
import { DAYNIGHT_LABEL, type DayNight, type Payload } from "@/lib/types";

const ORDER: DayNight[] = ["daytime", "nighttime"];

interface Props {
  data: Payload;
  mode: "light" | "dark";
}

/**
 * 「後期 − 前期」の変化量を昼と夜で並べる。
 *
 * 主地図（実測温度）と役割を分けてある。実測温度は物差しが 5〜40℃ と広いので、
 * 1〜2℃ の変化はほとんど見えない。それが実態だが、変化そのものを見たいときは
 * ゼロを中心にした差分で見るのが正しい。左右で色を仕込む必要もなくなる。
 * 昼と夜を同じスケールで並べるので、比較も公平になる。
 */
export default function DiffMaps({ data, mode }: Props) {
  const refs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const gridsRef = useRef<Record<string, Grid> | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gh, gw] = data.shape;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const grids = await Promise.all(
          ORDER.map((dn) => loadGrid(`./data/${data.assets[`diff_${dn}`]}`)),
        );
        if (!alive) return;
        gridsRef.current = Object.fromEntries(ORDER.map((dn, i) => [dn, grids[i]]));
        setReady(true);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [data.assets]);

  useEffect(() => {
    if (!ready || !gridsRef.current) return;
    const lut = buildLut("diff", mode, data.noData);
    for (const dn of ORDER) {
      const target = refs.current[dn];
      if (!target) continue;
      const src = toCanvas(paint(gridsRef.current[dn], lut));
      const cssW = target.clientWidth;
      const cssH = Math.round((cssW * gh) / gw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      target.width = Math.round(cssW * dpr);
      target.height = Math.round(cssH * dpr);
      target.style.height = `${cssH}px`;
      const ctx = target.getContext("2d");
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, cssW, cssH);
    }
  }, [ready, mode, data.noData, gw, gh]);

  if (error) {
    return (
      <p role="alert" className="text-sm">
        変化量の地図を読み込めませんでした: {error}
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-4">
        {ORDER.map((dn) => {
          const s = data.stats[dn];
          return (
            <figure key={dn} className="m-0">
              <figcaption className="mb-1 text-sm font-medium">
                {DAYNIGHT_LABEL[dn]}の変化量
                <span className="ml-2 font-normal tabular-nums text-[var(--text-secondary)]">
                  全国平均 {s.difference > 0 ? "+" : ""}
                  {s.difference.toFixed(2)}℃
                </span>
              </figcaption>
              <canvas
                ref={(el) => {
                  refs.current[dn] = el;
                }}
                className="block w-full"
                role="img"
                aria-label={
                  `${DAYNIGHT_LABEL[dn]}の地表面温度の変化量。` +
                  `${data.late[0]}–${data.late[1]}年から${data.early[0]}–${data.early[1]}年を引いた値。` +
                  `全国平均 ${s.difference.toFixed(2)}℃、上昇した陸地は ${Math.round(s.risenPixelFraction * 100)}%。`
                }
              />
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                上昇した陸地 {Math.round(s.risenPixelFraction * 100)}%（
                {s.diffP5 > 0 ? "+" : ""}
                {s.diffP5.toFixed(2)} 〜 {s.diffP95 > 0 ? "+" : ""}
                {s.diffP95.toFixed(2)}℃ が中央9割）
              </p>
            </figure>
          );
        })}
      </div>

      <div className="mt-3">
        <div
          className="h-3 w-full rounded-full"
          style={{ background: divergingCss(mode) }}
          aria-hidden
        />
        <div className="mt-1 flex justify-between text-xs tabular-nums text-[var(--text-secondary)]">
          <span>−{data.diffRange.toFixed(1)}℃</span>
          <span>変化なし</span>
          <span>+{data.diffRange.toFixed(1)}℃</span>
        </div>
      </div>
    </div>
  );
}
