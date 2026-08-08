"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { FuturePayload } from "@/lib/future-types";
import type { DayNight } from "@/lib/types";

const SERIES: { key: DayNight; label: string; color: string }[] = [
  { key: "daytime", label: "昼", color: "var(--day)" },
  { key: "nighttime", label: "夜", color: "var(--night)" },
];

interface Point {
  air: number;
  lst: number;
}

/**
 * 気温と地表面温度の連動を1枚で見せる散布図。
 *
 * ## 紛らわしさへの対処
 *   この2つは別の量なのに名前が似ている。並べると混同されやすい。
 *   そこで「地表面温度 ＝ 気温」の基準線を引いた。
 *   昼の点はその線の上、夜の点は下に来るので、
 *   「同じ気温でも地面は昼は熱く夜は冷たい」が位置だけで読める。
 *   色を見分けられなくても、上下の位置で区別がつく。
 *
 *   1点は「ある県のある年の夏」。47県 × 25年分ある。
 */
export default function AirLstScatter({ data }: { data: FuturePayload }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = useMemo(() => {
    const ind = data.indicators;
    const out: Record<DayNight, Point[]> = { daytime: [], nighttime: [] };
    for (const dn of ["daytime", "nighttime"] as DayNight[]) {
      const obs = data.climate[dn].observed.byPrefecture;
      for (const code of Object.keys(data.prefectures)) {
        const p = ind.byPrefecture[code];
        const lstSeries = obs[code];
        if (!p || !lstSeries) continue;
        data.years.forEach((year, i) => {
          const j = ind.years.indexOf(year);
          const lst = lstSeries[i];
          if (j < 0 || lst == null) return;
          // モデルの入力と同じ「最高と最低の中間」を気温として使う
          out[dn].push({ air: (p.t_max_mean[j] + p.t_min_mean[j]) / 2, lst });
        });
      }
    }
    return out;
  }, [data]);

  const narrow = W < 480;
  const H = narrow ? 300 : 380;
  const PAD = { top: 14, right: 14, bottom: 42, left: 46 };

  const { lo, hi } = useMemo(() => {
    const all = [...points.daytime, ...points.nighttime];
    if (!all.length) return { lo: 10, hi: 32 };
    const vals = all.flatMap((p) => [p.air, p.lst]);
    return { lo: Math.floor(Math.min(...vals) - 1), hi: Math.ceil(Math.max(...vals) + 1) };
  }, [points]);

  // 縦横を同じ目盛にしないと 1:1 の線が45度にならず、上下の判定が狂う
  const x = (v: number) => PAD.left + ((v - lo) / (hi - lo)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  const ticks = useMemo(() => {
    const step = hi - lo > 20 ? 5 : 2;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  }, [lo, hi]);

  const fit = (ps: Point[]) => {
    const n = ps.length;
    if (n < 2) return null;
    const mx = ps.reduce((a, p) => a + p.air, 0) / n;
    const my = ps.reduce((a, p) => a + p.lst, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of ps) {
      num += (p.air - mx) * (p.lst - my);
      den += (p.air - mx) ** 2;
    }
    if (den === 0) return null;
    const slope = num / den;
    return { slope, intercept: my - slope * mx };
  };

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-sm font-medium">
        気温と地表面温度の関係（1点＝ある県のある年の夏）
      </figcaption>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[var(--text-secondary)]" />
          地表面温度 ＝ 気温 の線
        </span>
      </div>

      <div ref={wrapRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full"
          role="img"
          aria-label={
            "気温を横軸、地表面温度を縦軸にとった散布図。" +
            "昼の点は「地表面温度＝気温」の線より上、夜の点は下に分布する。" +
            `昼は気温1℃あたり${data.relation.daytime.slope_per_air_degree.toFixed(2)}℃、` +
            `夜は${data.relation.nighttime.slope_per_air_degree.toFixed(2)}℃ の傾き。`
          }
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
              <line x1={x(v)} x2={x(v)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--grid)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--text-secondary)">
                {v}
              </text>
              <text x={x(v)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
                {v}
              </text>
            </g>
          ))}

          {/* 1:1 の基準線。ここより上なら地面の方が熱い。 */}
          <line
            x1={x(lo)}
            y1={y(lo)}
            x2={x(hi)}
            y2={y(hi)}
            stroke="var(--text-secondary)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />

          {SERIES.map((s) => (
            <g key={s.key}>
              {points[s.key].map((p, i) => (
                <circle key={i} cx={x(p.air)} cy={y(p.lst)} r={1.8} fill={s.color} opacity={0.35} />
              ))}
              {(() => {
                const f = fit(points[s.key]);
                if (!f) return null;
                const a = Math.min(...points[s.key].map((p) => p.air));
                const b = Math.max(...points[s.key].map((p) => p.air));
                return (
                  <line
                    x1={x(a)}
                    y1={y(f.slope * a + f.intercept)}
                    x2={x(b)}
                    y2={y(f.slope * b + f.intercept)}
                    stroke={s.color}
                    strokeWidth={2.5}
                  />
                );
              })()}
            </g>
          ))}

          <text x={(W + PAD.left) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
            夏の平均気温（℃）
          </text>
          <text
            x={12}
            y={(H - PAD.bottom + PAD.top) / 2}
            textAnchor="middle"
            fontSize={11}
            fill="var(--text-secondary)"
            transform={`rotate(-90 12 ${(H - PAD.bottom + PAD.top) / 2})`}
          >
            夏の地表面温度（℃）
          </text>
        </svg>
      </div>

      <p className="mt-2 text-xs text-[var(--text-secondary)]">
        点が破線より<strong className="text-[var(--text-primary)]">上</strong>にあれば地面の方が空気より熱く、
        <strong className="text-[var(--text-primary)]">下</strong>なら地面の方が冷たい、という意味です。
        昼の点はすべて上、夜の点はすべて下に来ます。
        太い線はそれぞれの回帰直線で、傾きが「気温1℃あたり地表面温度が何℃動くか」です。
      </p>
    </figure>
  );
}
