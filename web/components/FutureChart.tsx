"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface FutureSeries {
  key: string;
  label: string;
  color: string;
  /** years と同じ長さ。欠測は null。 */
  values: (number | null)[];
  /** 比較の基準として添える系列。破線にして主役と区別する。 */
  reference?: boolean;
  /** 補助的に添える細い系列。主役より弱く描く。 */
  faint?: boolean;
}

/**
 * 中心化した移動平均。
 *
 * 気候モデルは「どの年が暑いか」を再現しない。統計を再現するだけで、
 * 年の並びは実際と一致しない。年ごとのギザギザを予測として見せると
 * 「2025年は涼しくなる」と読まれてしまうので、均した線を重ねる。
 */
export function rollingMean(values: (number | null)[], window = 5): (number | null)[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), i + half + 1).filter((v): v is number => v != null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

interface Props {
  years: number[];
  series: FutureSeries[];
  /** この年までが実測。翌年から先は予測として破線で描く。 */
  lastObservedYear: number;
  unit: string;
  caption: string;
  /** 目盛を 0 から始めるか。日数のように 0 に意味がある量では true。 */
  zeroBased?: boolean;
}

/**
 * 実測と予測を1本の線でつなぐグラフ。
 *
 * 予測部分は破線にし、境界に縦線とラベルを置く。線種だけに頼らないのは、
 * 印刷や色覚特性で見分けがつかない場合があるため。境界の位置は文字でも書く。
 */
export default function FutureChart({
  years,
  series,
  lastObservedYear,
  unit,
  caption,
  zeroBased = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(720);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = W < 480;
  const H = narrow ? 240 : 300;
  const PAD = { top: 14, right: narrow ? 14 : 58, bottom: 30, left: 46 };

  /**
   * 目盛を人が読める刻みに丸める。
   *
   * 単に範囲を4等分すると「96100 / 72075 / 48050」のような値が並ぶ。
   * 1・2・2.5・5 の倍数から刻みを選べば、桁がいくつでも読める数字になる。
   */
  const niceStep = (span: number, count: number) => {
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  };

  const { lo, hi } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
    if (!all.length) return { lo: 0, hi: 1 };
    const min = Math.min(...all);
    const max = Math.max(...all);
    const pad = Math.max((max - min) * 0.12, 0.5);
    return { lo: zeroBased ? 0 : min - pad, hi: max + pad };
  }, [series, zeroBased]);

  const x = (i: number) => PAD.left + (i / (years.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  const splitIndex = Math.max(years.indexOf(lastObservedYear), 0);
  // 予測がまだ無いときは境界線も凡例も出さない。空の予測を匂わせない。
  const hasFuture = years[years.length - 1] > lastObservedYear;
  const ticks = useMemo(() => {
    const step = niceStep(hi - lo, 4);
    const start = Math.ceil(lo / step) * step;
    const out: number[] = [];
    for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(6)));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lo, hi]);
  const yearTicks = useMemo(() => {
    const want = [years[0], lastObservedYear, years[years.length - 1]];
    return want.map((v) => years.indexOf(v)).filter((i) => i >= 0);
  }, [years, lastObservedYear]);

  const path = (values: (number | null)[], from: number, to: number) =>
    values
      .slice(from, to + 1)
      .map((v, k) => (v == null ? null : `${x(from + k)},${y(v)}`))
      .filter(Boolean)
      .join(" ");

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
      <figcaption className="mb-1 text-sm font-medium">{caption}</figcaption>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block h-0.5 w-4 ${s.reference ? "border-t-2 border-dashed" : "rounded-full"}`}
              style={s.reference ? { borderColor: s.color } : { background: s.color }}
            />
            {s.label}
          </span>
        ))}
        {hasFuture && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[var(--text-secondary)]" />
            {lastObservedYear + 1}年以降は予測
          </span>
        )}
      </div>

      <div ref={wrapRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full touch-pan-y"
          role="img"
          aria-label={hasFuture
            ? `${caption}。${years[0]}年から${lastObservedYear}年までが実測、${lastObservedYear + 1}年から${years[years.length - 1]}年までが予測。`
            : `${caption}。${years[0]}年から${years[years.length - 1]}年までの実測。`}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {ticks.map((v, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--text-secondary)">
                {Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}千` : v.toFixed(Number.isInteger(v) ? 0 : 1)}
              </text>
            </g>
          ))}

          {/* 実測と予測の境界。線種だけに意味を持たせないよう文字も添える。 */}
          {hasFuture && (
            <g>
              <line x1={x(splitIndex)} x2={x(splitIndex)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--text-secondary)" strokeWidth={1} />
              <text x={x(splitIndex) + 4} y={PAD.top + 10} fontSize={10} fill="var(--text-secondary)">
                ここから予測 →
              </text>
            </g>
          )}

          {series.map((s) => (
            <g key={s.key}>
              <polyline
                points={path(s.values, 0, splitIndex)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.reference ? 1.5 : s.faint ? 1 : 2.5}
                strokeDasharray={s.reference ? "5 4" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={s.faint ? 0.45 : 1}
              />
              {hasFuture && (
                <polyline
                  points={path(s.values, splitIndex, years.length - 1)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.faint ? 1 : 2.5}
                  strokeDasharray="5 4"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={s.faint ? 0.45 : 1}
                />
              )}
              {!narrow && !s.faint && s.values[s.values.length - 1] != null && (
                <text x={W - PAD.right + 5} y={y(s.values[s.values.length - 1] as number)} dominantBaseline="middle" fontSize={11} fill="var(--text-secondary)">
                  {(s.values[s.values.length - 1] as number).toFixed(1)}
                </text>
              )}
            </g>
          ))}

          {yearTicks.map((i) => (
            <text key={i} x={x(i)} y={H - 10} textAnchor={i === 0 ? "start" : i === years.length - 1 ? "end" : "middle"} fontSize={11} fill="var(--text-secondary)">
              {years[i]}
            </text>
          ))}

          {hoverIndex != null && (
            <g>
              <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--grid)" strokeWidth={1} />
              {series.map((s) => {
                const v = s.values[hoverIndex];
                return v == null ? null : (
                  <circle key={s.key} cx={x(hoverIndex)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
                );
              })}
            </g>
          )}
        </svg>
      </div>

      <p className="mt-1 min-h-5 text-xs text-[var(--text-secondary)]">
        {hoverIndex != null
          ? `${years[hoverIndex]}年${hasFuture && years[hoverIndex] > lastObservedYear ? "（予測）" : ""}　` +
            series
              .map((s) => {
                const v = s.values[hoverIndex];
                return `${s.label} ${v == null ? "—" : v.toFixed(1) + unit}`;
              })
              .join("　")
          : ""}
      </p>
    </figure>
  );
}
