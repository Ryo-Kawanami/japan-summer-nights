"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildLut, divergingCss, heatCss } from "@/lib/colormap";
import { Grid, loadGrid, paint, toCanvas } from "@/lib/raster";
import type { GridFuturePayload } from "@/lib/future-types";
import type { DayNight, Payload } from "@/lib/types";

interface Props {
  data: Payload;
  grid: GridFuturePayload;
  daynight: DayNight;
  mode: "light" | "dark";
}

type Mode = "compare" | "diff";

/**
 * 2050年ごろの地表面温度を 5km 格子で見せる。
 *
 * 上の地図と同じ作り（左右を拭って比べる）にしてある。
 * 違うのは右側が観測ではなく予測であること。
 * 県別の折れ線では見えない、都市や地形の細かさが出る。
 */
export default function FutureMap({ data, grid, daynight, mode }: Props) {
  // 格子の予測がまだ焼けていないうちは何も出さない。
  // 空の枠だけ見せても読者には意味がない。
  const hasAssets = Boolean(grid.assets?.abs_nighttime_future);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridsRef = useRef<Record<string, Grid> | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [divider, setDivider] = useState(0.5);
  const [view, setView] = useState<Mode>("compare");
  const [dragging, setDragging] = useState(false);
  const [gh, gw] = data.shape;

  useEffect(() => {
    if (!hasAssets) return;
    let alive = true;
    (async () => {
      try {
        const keys = [
          `abs_daytime_future`, `abs_nighttime_future`,
          `diff_daytime_future`, `diff_nighttime_future`,
        ];
        const loaded = await Promise.all([
          ...keys.map((k) => loadGrid(`./data/${grid.assets[k]}`)),
          loadGrid(`./data/${data.assets.abs_daytime_late}`),
          loadGrid(`./data/${data.assets.abs_nighttime_late}`),
        ]);
        if (!alive) return;
        gridsRef.current = Object.fromEntries(
          [...keys, "obs_daytime", "obs_nighttime"].map((k, i) => [k, loaded[i]]),
        );
        setReady(true);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [grid.assets, data.assets, hasAssets]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const g = gridsRef.current;
    if (!canvas || !g || !ready) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cssW = canvas.clientWidth;
    const cssH = Math.round((cssW * gh) / gw);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = false;

    if (view === "diff") {
      const lut = buildLut("diff", mode, grid.noData);
      ctx.drawImage(toCanvas(paint(g[`diff_${daynight}_future`], lut)), 0, 0, cssW, cssH);
      return;
    }

    const lut = buildLut("abs", mode, grid.noData);
    ctx.drawImage(toCanvas(paint(g[`obs_${daynight}`], lut)), 0, 0, cssW, cssH);
    const split = divider * cssW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(split, 0, cssW - split, cssH);
    ctx.clip();
    ctx.drawImage(toCanvas(paint(g[`abs_${daynight}_future`], lut)), 0, 0, cssW, cssH);
    ctx.restore();

    ctx.strokeStyle = mode === "dark" ? "#ffffff" : "#0b0b0b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(split, 0);
    ctx.lineTo(split, cssH);
    ctx.stroke();
  }, [ready, view, mode, daynight, divider, gw, gh, grid.noData]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      setDivider(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const obsLabel = `${grid.obsWindow[0]}–${grid.obsWindow[1]}年`;
  const futLabel = `${grid.futureWindow[0]}–${grid.futureWindow[1]}年`;

  if (!hasAssets) return null;

  if (error) {
    return (
      <p role="alert" className="rounded border border-[var(--rule)] p-4 text-sm">
        地図を読み込めませんでした: {error}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 inline-flex rounded-lg border border-[var(--rule)] p-1" role="group" aria-label="表示の切り替え">
        {(
          [
            ["compare", "実測と予測を比べる"],
            ["diff", "変化量を見る"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            aria-pressed={view === key}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === key
                ? "bg-[var(--text-primary)] text-[var(--surface-1)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div ref={wrapRef} className="relative select-none">
        <canvas
          ref={canvasRef}
          className="block w-full"
          role="img"
          aria-label={
            view === "diff"
              ? `${futLabel}の予測から${obsLabel}の観測を引いた変化量の地図`
              : `左が${obsLabel}の観測、右が${futLabel}の予測。同じ温度スケール`
          }
        />

        {view === "compare" && (
          <>
            <span
              className="pointer-events-none absolute top-2 whitespace-nowrap rounded bg-[var(--surface-1)]/90 px-2 py-1 text-xs text-[var(--text-secondary)] transition-opacity"
              style={{ right: `calc(${(1 - divider) * 100}% + 26px)`, opacity: divider < 0.2 ? 0 : 1 }}
            >
              ◀ {obsLabel}（観測）
            </span>
            <span
              className="pointer-events-none absolute top-2 whitespace-nowrap rounded bg-[var(--surface-1)]/90 px-2 py-1 text-xs text-[var(--text-secondary)] transition-opacity"
              style={{ left: `calc(${divider * 100}% + 26px)`, opacity: divider > 0.8 ? 0 : 1 }}
            >
              {futLabel}（予測）▶
            </span>
            <div
              className="absolute inset-y-0 z-10 flex w-16 -translate-x-1/2 cursor-ew-resize items-center justify-center focus:outline-none"
              style={{ left: `${divider * 100}%` }}
              onPointerDown={startDrag}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.1 : 0.02;
                if (e.key === "ArrowLeft") setDivider((d) => Math.max(0, d - step));
                else if (e.key === "ArrowRight") setDivider((d) => Math.min(1, d + step));
                else return;
                e.preventDefault();
              }}
              role="slider"
              tabIndex={0}
              aria-label={`${obsLabel}と${futLabel}の境界`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(divider * 100)}
            >
              <span
                className={`pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-[var(--surface-1)] px-3 py-2 text-[11px] leading-none shadow-sm transition-transform ${
                  dragging ? "scale-105 border-[var(--text-primary)]" : "border-[var(--rule)]"
                }`}
              >
                <span aria-hidden className="text-[var(--text-secondary)]">◀</span>
                <span className="font-semibold">今</span>
                <span aria-hidden className="text-[var(--rule)]">│</span>
                <span className="font-semibold">2050</span>
                <span aria-hidden className="text-[var(--text-secondary)]">▶</span>
              </span>
            </div>
          </>
        )}
      </div>

      <div className="mt-3">
        <div
          className="h-3 w-full rounded-full"
          style={{ background: view === "diff" ? divergingCss(mode) : heatCss() }}
          aria-hidden
        />
        <div className="mt-1 flex justify-between text-xs tabular-nums text-[var(--text-secondary)]">
          {view === "diff" ? (
            <>
              <span>−{grid.diffRange.toFixed(1)}℃</span>
              <span>変化なし</span>
              <span>+{grid.diffRange.toFixed(1)}℃</span>
            </>
          ) : (
            [grid.absRange[0], (grid.absRange[0] + grid.absRange[1]) / 2, grid.absRange[1]].map((v) => (
              <span key={v}>{v.toFixed(0)}℃</span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
