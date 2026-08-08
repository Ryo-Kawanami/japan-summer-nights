"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Payload } from "@/lib/types";

const SERIES = [
  { key: "daytime", label: "昼", color: "var(--day)" },
  { key: "nighttime", label: "夜", color: "var(--night)" },
] as const;

interface Props {
  data: Payload;
  selected: number | null;
}

export default function TrendChart({ data, selected }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // viewBox の幅を実寸に合わせる。固定幅にすると、狭い画面で全体が縮小されて
  // 軸ラベルが 5px まで潰れる。1 単位 = 1 CSS px にすれば文字は常に読める大きさ。
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setW(Math.max(280, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = W < 480;
  const H = narrow ? 240 : 300;
  // 終端ラベルは狭い画面では入らないので、その分の余白を取らない。
  const PAD = { top: 16, right: narrow ? 14 : 62, bottom: 28, left: 44 };

  const lines = useMemo(() => {
    return SERIES.map((s) => {
      const raw = selected
        ? data.series[s.key].prefecture[String(selected)]
        : data.series[s.key].national;
      return { ...s, values: raw ?? [] };
    });
  }, [data, selected]);

  const { yMin, yMax } = useMemo(() => {
    const all = lines.flatMap((l) => l.values).filter((v): v is number => v != null);
    if (!all.length) return { yMin: 0, yMax: 1 };
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = Math.max((hi - lo) * 0.12, 0.5);
    return { yMin: lo - pad, yMax: hi + pad };
  }, [lines]);

  const years = data.years;
  const x = (i: number) => PAD.left + (i / (years.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

  const ticks = useMemo(() => {
    const step = (yMax - yMin) / 4;
    return Array.from({ length: 5 }, (_, i) => yMin + step * i);
  }, [yMin, yMax]);

  const title = selected ? data.prefectures[String(selected)] : "全国";

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = (px - PAD.left) / (W - PAD.left - PAD.right);
    const i = Math.round(t * (years.length - 1));
    setHoverIndex(i >= 0 && i < years.length ? i : null);
  };

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-sm font-medium">
        {title}・夏（6〜8月）の地表面温度
      </figcaption>

      {/* 2系列あるので凡例は常に出す。色だけに意味を持たせない。 */}
      <div className="mb-2 flex gap-4 text-xs text-[var(--text-secondary)]">
        {lines.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: l.color }}
            />
            {l.label}
          </span>
        ))}
      </div>

      <div ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-pan-y"
        role="img"
        aria-label={`${title}の夏の地表面温度の推移。昼と夜の2系列、${years[0]}年から${years[years.length - 1]}年。`}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--text-secondary)"
            >
              {v.toFixed(0)}℃
            </text>
          </g>
        ))}

        {[0, Math.floor(years.length / 2), years.length - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === years.length - 1 ? "end" : "middle"}
            fontSize={11}
            fill="var(--text-secondary)"
          >
            {years[i]}
          </text>
        ))}

        {lines.map((l) => {
          const pts = l.values
            .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean) as string[];
          const last = l.values[l.values.length - 1];
          return (
            <g key={l.key}>
              <polyline
                points={pts.join(" ")}
                fill="none"
                stroke={l.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* 直接ラベルは終端だけ。全点に数字を置かない。 */}
              {last != null && !narrow && (
                <text
                  x={W - PAD.right + 6}
                  y={y(last)}
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="var(--text-secondary)"
                >
                  {l.label} {last.toFixed(1)}℃
                </text>
              )}
            </g>
          );
        })}

        {hoverIndex != null && (
          <g>
            <line
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            {lines.map((l) => {
              const v = l.values[hoverIndex];
              return v == null ? null : (
                <circle
                  key={l.key}
                  cx={x(hoverIndex)}
                  cy={y(v)}
                  r={4}
                  fill={l.color}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              );
            })}
          </g>
        )}
      </svg>
      </div>

      <p className="mt-1 min-h-5 text-xs text-[var(--text-secondary)]">
        {hoverIndex != null
          ? `${years[hoverIndex]}年　` +
            lines
              .map((l) => {
                const v = l.values[hoverIndex];
                return `${l.label} ${v == null ? "—" : v.toFixed(1) + "℃"}`;
              })
              .join("　")
          : ""}
      </p>
    </figure>
  );
}
