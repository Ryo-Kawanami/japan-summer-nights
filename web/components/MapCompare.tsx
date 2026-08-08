"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildLut } from "@/lib/colormap";
import { checkCodes, Grid, loadGrid, paint, toCanvas } from "@/lib/raster";
import type { DayNight, Payload, Period } from "@/lib/types";

const N_PREF = 47;

type Key = `abs_${DayNight}_${Period}`;

interface Props {
  data: Payload;
  daynight: DayNight;
  mode: "light" | "dark";
  selected: number | null;
  onSelect: (code: number | null) => void;
}

interface Probe {
  code: number;
  early: number | null;
  late: number | null;
  /** カーソルが境界より右（＝後期を表示している側）にいるか。 */
  onLateSide: boolean;
  /** 地図の左上を原点とした CSS ピクセル座標。ツールチップの位置に使う。 */
  x: number;
  y: number;
}

/**
 * 県と県の境目だけを拾う。海岸線は海の色で分かるので含めない。
 *
 * 押せる範囲が分からないと、地図がクリックできることに気づけない。
 * ただし主役は温度なので、線は控えめにする。
 */
function buildBorders(codes: Grid): Uint8Array {
  const { width: w, height: h, data } = codes;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = data[i];
      if (c === 0) continue;
      // 右と下だけ見れば、境界の両側を二重に塗らずに済む
      const right = x < w - 1 ? data[i + 1] : c;
      const down = y < h - 1 ? data[i + w] : c;
      if ((right !== 0 && right !== c) || (down !== 0 && down !== c)) edge[i] = 1;
    }
  }
  return edge;
}

export default function MapCompare({ data, daynight, mode, selected, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<Record<Key, HTMLCanvasElement> | null>(null);
  const [codes, setCodes] = useState<Grid | null>(null);
  const [borders, setBorders] = useState<Uint8Array | null>(null);
  const [divider, setDivider] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const [probed, setProbed] = useState<Probe | null>(null);
  const [dragging, setDragging] = useState(false);
  const hover = probed?.code ?? null;

  const [gh, gw] = data.shape;

  // PNG の読み込みは1回だけ。配色モードが変わったら塗り直す。
  const gridsRef = useRef<Record<Key, Grid> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const keys: Key[] = [
          "abs_daytime_early",
          "abs_daytime_late",
          "abs_nighttime_early",
          "abs_nighttime_late",
        ];
        const [pref, ...maps] = await Promise.all([
          loadGrid(`./data/${data.assets.prefectures}`),
          ...keys.map((k) => loadGrid(`./data/${data.assets[k]}`)),
        ]);
        if (!alive) return;
        checkCodes(pref, N_PREF);
        const grids = Object.fromEntries(keys.map((k, i) => [k, maps[i]])) as Record<Key, Grid>;
        gridsRef.current = grids;
        setCodes(pref);
        setBorders(buildBorders(pref));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [data.assets]);

  useEffect(() => {
    if (!gridsRef.current) return;
    const lut = buildLut("abs", mode, data.noData);
    const painted = Object.fromEntries(
      Object.entries(gridsRef.current).map(([k, g]) => [k, toCanvas(paint(g, lut))]),
    ) as Record<Key, HTMLCanvasElement>;
    setLayers(painted);
  }, [mode, data.noData, codes]);

  const accent = mode === "dark" ? "#ffffff" : "#0b0b0b";

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layers || !codes) return;
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

    // 左＝前期、右＝後期。境界より右だけ後期を重ねる。
    // 両方とも同じ実測温度スケールなので、見た目の差はそのまま実際の差の大きさ。
    ctx.drawImage(layers[`abs_${daynight}_early`], 0, 0, cssW, cssH);
    const split = divider * cssW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(split, 0, cssW - split, cssH);
    ctx.clip();
    ctx.drawImage(layers[`abs_${daynight}_late`], 0, 0, cssW, cssH);
    ctx.restore();

    // 海岸線は描かない。海に色を敷いたので陸との明度差で境界が出る。
    const sx = cssW / gw;
    const sy = cssH / gh;

    // 県境。押せる範囲を示すためだが、主役は温度なので控えめにする。
    // サーモ配色は暗い紫から明るい黄まで振れるので、白でも黒でもどちらかで消える。
    // 中間の輝度の中性色なら、両端のどちらに対しても差が残る。
    if (borders) {
      // ダークは白系の線が浮きやすいので、ライトより控えめにして印象を揃える。
      ctx.fillStyle = mode === "dark" ? "rgba(190,190,200,0.38)" : "rgba(55,55,65,0.55)";
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          if (borders[y * gw + x]) {
            ctx.fillRect(x * sx, y * sy, Math.max(sx, 1), Math.max(sy, 1));
          }
        }
      }
    }

    // 選択・ホバー中の県を塗り分ける。色ではなく明度差で示すので凡例と競合しない。
    const focus = hover ?? selected;
    if (focus) {
      ctx.fillStyle = mode === "dark" ? "rgba(255,255,255,0.22)" : "rgba(11,11,11,0.18)";
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          if (codes.data[y * gw + x] === focus) {
            ctx.fillRect(x * sx, y * sy, Math.max(sx, 0.7), Math.max(sy, 0.7));
          }
        }
      }
    }

    // 分割線
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(split, 0);
    ctx.lineTo(split, cssH);
    ctx.stroke();
  }, [layers, codes, borders, daynight, divider, gw, gh, hover, selected, accent, mode]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  const [absLo, absHi] = data.absRange;

  /** 量子化された uint8 を実温度に戻す。NODATA は null。 */
  const decode = useCallback(
    (v: number) => (v === data.noData ? null : ((v - 1) / 254) * (absHi - absLo) + absLo),
    [data.noData, absLo, absHi],
  );

  /**
   * カーソル位置の県と、前期・後期それぞれの実温度を取り出す。
   *
   * 地図を同一スケールにした結果、左右の見た目がほとんど変わらなくなった。
   * 色で判断できない以上、数字を出すのが一番はっきりした手がかりになる。
   */
  const probe = useCallback(
    (clientX: number, clientY: number): Probe | null => {
      const canvas = canvasRef.current;
      if (!canvas || !codes || !gridsRef.current) return null;
      const rect = canvas.getBoundingClientRect();
      const fx = (clientX - rect.left) / rect.width;
      const x = Math.floor(fx * gw);
      const y = Math.floor(((clientY - rect.top) / rect.height) * gh);
      if (x < 0 || y < 0 || x >= gw || y >= gh) return null;
      const code = codes.data[y * gw + x];
      if (!code) return null;
      const i = y * gw + x;
      return {
        code,
        early: decode(gridsRef.current[`abs_${daynight}_early`].data[i]),
        late: decode(gridsRef.current[`abs_${daynight}_late`].data[i]),
        onLateSide: fx >= divider,
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    },
    [codes, gw, gh, daynight, decode, divider],
  );

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      setDivider(Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const nudge = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowLeft") setDivider((d) => Math.max(0, d - step));
    else if (e.key === "ArrowRight") setDivider((d) => Math.min(1, d + step));
    else return;
    e.preventDefault();
  };

  const label = useMemo(
    () => ({
      early: `${data.early[0]}–${data.early[1]}年`,
      late: `${data.late[0]}–${data.late[1]}年`,
    }),
    [data.early, data.late],
  );

  if (error) {
    return (
      <p role="alert" className="rounded border border-[var(--rule)] p-4 text-sm">
        地図データを読み込めませんでした: {error}
      </p>
    );
  }

  // 左右のパネルが同じ物差しになった結果、色では前期と後期を見分けられない。
  // どちら側を見ているかを、位置・文字・数字の3つで冗長に示す。
  const leftShare = Math.round(divider * 100);
  const activeIsLate = probed?.onLateSide ?? null;

  return (
    <div>
      {/* 常設の凡例。つまみをどこまで動かしても、この行の対応は変わらない。
          狭い画面では説明語と比率を落とし、年の表記だけを残す。 */}
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span
          className={`whitespace-nowrap rounded px-2 py-1 transition-colors ${
            activeIsLate === false
              ? "bg-[var(--text-primary)] text-[var(--surface-1)]"
              : "text-[var(--text-secondary)]"
          }`}
        >
          ◀<span className="hidden sm:inline"> 左は</span>{" "}
          <strong className="font-semibold">{label.early}</strong>
        </span>
        <span className="hidden tabular-nums text-[var(--text-secondary)] sm:inline">
          {leftShare}% : {100 - leftShare}%
        </span>
        <span
          className={`whitespace-nowrap rounded px-2 py-1 transition-colors ${
            activeIsLate === true
              ? "bg-[var(--text-primary)] text-[var(--surface-1)]"
              : "text-[var(--text-secondary)]"
          }`}
        >
          <strong className="font-semibold">{label.late}</strong>
          <span className="hidden sm:inline"> は右</span> ▶
        </span>
      </div>

      <div ref={wrapRef} className="relative select-none">
        <canvas
          ref={canvasRef}
          className="block w-full cursor-pointer"
          role="img"
          aria-label={`${label.early}と${label.late}の夏の実測地表面温度を左右で比べる日本地図。両側とも同じ温度スケール。境界は左から${leftShare}パーセントの位置。`}
          onClick={(e) => {
            // タッチ端末にはホバーが無い。タップでも読み出しが残るようにする。
            const p = probe(e.clientX, e.clientY);
            setProbed(p);
            onSelect(p?.code ?? null);
          }}
          onPointerMove={(e) => setProbed(probe(e.clientX, e.clientY))}
          onPointerLeave={(e) => {
            // 指を離しただけで消すと、タップした結果を読む間がない。
            if (e.pointerType === "mouse") setProbed(null);
          }}
        />

        {/* 境界に貼りつくラベル。つまみと一緒に動くので、どちらの領域かを見失わない。 */}
        {/* カーソルの近くに数値を出す。地図から目を離さずに読める。
            指で隠れないよう既定は上に置き、上端に近いときだけ下へ回す。
            画面外に出ないよう左右も折り返す。 */}
        {probed && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--rule)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs shadow-md"
            style={{
              left: `min(max(${probed.x}px, 76px), calc(100% - 76px))`,
              top: probed.y > 90 ? `${probed.y - 74}px` : `${probed.y + 20}px`,
            }}
            role="status"
          >
            <div className="font-semibold">{data.prefectures[String(probed.code)]}</div>
            <div className="mt-0.5 tabular-nums text-[var(--text-secondary)]">
              <span className={activeIsLate === false ? "font-semibold text-[var(--text-primary)]" : ""}>
                {probed.early == null ? "—" : `${probed.early.toFixed(1)}℃`}
              </span>
              {" → "}
              <span className={activeIsLate === true ? "font-semibold text-[var(--text-primary)]" : ""}>
                {probed.late == null ? "—" : `${probed.late.toFixed(1)}℃`}
              </span>
              {probed.early != null && probed.late != null && (
                <span className="ml-1 font-semibold text-[var(--text-primary)]">
                  （{probed.late - probed.early > 0 ? "+" : ""}
                  {(probed.late - probed.early).toFixed(1)}）
                </span>
              )}
            </div>
          </div>
        )}

        <span
          className="pointer-events-none absolute top-2 whitespace-nowrap rounded bg-[var(--surface-1)]/90 px-2 py-1 text-xs text-[var(--text-secondary)] transition-opacity"
          style={{
            right: `calc(${(1 - divider) * 100}% + 26px)`,
            opacity: divider < 0.18 ? 0 : 1,
          }}
        >
          ◀ {label.early}
        </span>
        <span
          className="pointer-events-none absolute top-2 whitespace-nowrap rounded bg-[var(--surface-1)]/90 px-2 py-1 text-xs text-[var(--text-secondary)] transition-opacity"
          style={{
            left: `calc(${divider * 100}% + 26px)`,
            opacity: divider > 0.82 ? 0 : 1,
          }}
        >
          {label.late} ▶
        </span>

        <div
          className="absolute inset-y-0 z-10 flex w-16 -translate-x-1/2 cursor-ew-resize items-center justify-center focus:outline-none"
          style={{ left: `${divider * 100}%` }}
          onPointerDown={startDrag}
          onKeyDown={nudge}
          role="slider"
          tabIndex={0}
          aria-label={`${label.early}と${label.late}の境界`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={leftShare}
          aria-valuetext={`左から${leftShare}パーセント。左が${label.early}、右が${label.late}`}
        >
          {/* 40px の円に4文字を詰めると縁ぎりぎりになる。
              横長の錠剤にして、文字と縁のあいだに余白を持たせる。 */}
          <span
            className={`pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-[var(--surface-1)] px-3 py-2 text-[11px] leading-none shadow-sm transition-transform ${
              dragging ? "scale-105 border-[var(--text-primary)]" : "border-[var(--rule)]"
            }`}
          >
            <span aria-hidden className="text-[var(--text-secondary)]">◀</span>
            <span className="font-semibold">昔</span>
            <span aria-hidden className="text-[var(--rule)]">│</span>
            <span className="font-semibold">今</span>
            <span aria-hidden className="text-[var(--text-secondary)]">▶</span>
          </span>
        </div>
      </div>

      {/* 数値はカーソルの近くのツールチップに出す。ここは操作の説明だけ。
          同じ数字を2か所に出すと、どちらを見ればいいか迷う。 */}
      <div className="mt-2 min-h-12 rounded-lg border border-[var(--rule)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]">
        {probed ? (
          <p>
            <strong>{data.prefectures[String(probed.code)]}</strong>
            <span className="text-[var(--text-secondary)]">
              {" "}を選ぶと、25年分の推移が下のグラフに出ます。いま見ているのは{" "}
            </span>
            <strong>{activeIsLate ? label.late : label.early}</strong>
            <span className="text-[var(--text-secondary)]"> 側です。</span>
          </p>
        ) : (
          <p>
            <span aria-hidden className="mr-1.5">👆</span>
            <strong>地図に触れると</strong>、その地点の温度が出ます。
            <br />
            <span className="text-[var(--text-secondary)]">
              選ぶとその県の25年分の推移が下のグラフに出ます。
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
