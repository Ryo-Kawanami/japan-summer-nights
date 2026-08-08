"use client";

import { useEffect, useRef, useState } from "react";

import type { Payload } from "@/lib/types";

const SERIES = [
  { key: "daytime", label: "昼", color: "var(--day)" },
  { key: "nighttime", label: "夜", color: "var(--night)" },
] as const;

interface Props {
  data: Payload;
}

interface PanelSpec {
  title: string;
  field: "lateMean" | "change";
  unit: string;
}

// 棒の長さが量を表すので、横軸は必ず 0 から始める。
// 下限を切り上げると差が誇張される。実測温度の差は 0 基点でも十分読める。
const PANELS: PanelSpec[] = [
  { title: "いま、どれだけ暑いか", field: "lateMean", unit: "℃" },
  { title: "25年で、どれだけ上がったか", field: "change", unit: "℃" },
];

const ROW_H = 34;
const BAR_H = 11;
const GAP = 2; // 隣り合う棒のあいだはサーフェス色の隙間で分ける。囲み線は引かない
const PAD = { top: 8, right: 46, bottom: 24, left: 116 };

/**
 * 市街地率で区分けした内訳。
 *
 * 2つの量はスケールが桁違い（実測 16〜22℃ に対し上昇量 1.4〜1.6℃）なので、
 * 1枚に2軸で重ねてはいけない。軸の位置合わせが恣意的になり、
 * 存在しない相関を作ってしまう。パネルを分けてそれぞれに軸を持たせる。
 */
export default function UrbanBreakdown({ data }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(420);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bins = data.urban.bins;
  const H = PAD.top + bins.length * ROW_H + PAD.bottom;

  return (
    <div ref={wrapRef}>
      <div className="mb-3 flex gap-4 text-xs text-[var(--text-secondary)]">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {PANELS.map((panel) => {
          const rows = bins.map((label, i) => ({
            label,
            values: SERIES.map((s) => data.urban.by[s.key][panel.field][i]?.mean ?? null),
            n: data.urban.by.nighttime[panel.field][i]?.n ?? 0,
          }));
          const all = rows.flatMap((r) => r.values).filter((v): v is number => v != null);
          const hi = Math.max(...all);
          const lo = 0;
          const x = (v: number) => PAD.left + ((v - lo) / (hi - lo)) * (W - PAD.left - PAD.right);

          return (
            <figure key={panel.field} className="m-0">
              <figcaption className="mb-2 text-sm font-medium">{panel.title}</figcaption>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="block w-full"
                role="img"
                aria-label={
                  `市街地率の区分ごとの${panel.title}。` +
                  rows
                    .map(
                      (r) =>
                        `${r.label}: ` +
                        SERIES.map((s, i) =>
                          r.values[i] == null ? "" : `${s.label} ${r.values[i]!.toFixed(2)}℃`,
                        ).join("、"),
                    )
                    .join("。")
                }
              >
                {rows.map((row, ri) => {
                  const y0 = PAD.top + ri * ROW_H;
                  return (
                    <g key={row.label}>
                      <text
                        x={PAD.left - 8}
                        y={y0 + ROW_H / 2}
                        textAnchor="end"
                        dominantBaseline="middle"
                        fontSize={11}
                        fill="var(--text-secondary)"
                      >
                        {row.label}
                      </text>
                      {SERIES.map((s, si) => {
                        const v = row.values[si];
                        if (v == null) return null;
                        const y = y0 + ROW_H / 2 - BAR_H - GAP / 2 + si * (BAR_H + GAP);
                        const w = Math.max(x(v) - PAD.left, 1);
                        return (
                          <g key={s.key}>
                            <rect
                              x={PAD.left}
                              y={y}
                              width={w}
                              height={BAR_H}
                              rx={3}
                              fill={s.color}
                            />
                            <text
                              x={PAD.left + w + 5}
                              y={y + BAR_H / 2}
                              dominantBaseline="middle"
                              fontSize={10}
                              fill="var(--text-secondary)"
                            >
                              {v.toFixed(panel.field === "change" ? 2 : 1)}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
                <line
                  x1={PAD.left}
                  x2={PAD.left}
                  y1={PAD.top}
                  y2={H - PAD.bottom}
                  stroke="var(--grid)"
                  strokeWidth={1}
                />
                <text x={PAD.left} y={H - 8} fontSize={10} fill="var(--text-secondary)">
                  0{panel.unit}
                </text>
                <text
                  x={W - PAD.right}
                  y={H - 8}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--text-secondary)"
                >
                  {hi.toFixed(1)}
                  {panel.unit}
                </text>
              </svg>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
