/**
 * 平年差は「基準より高いか低いか」という極性を持つ量なので発散カラーマップを使う。
 * 中点は必ず無彩色のグレー。中点に色相を置くと「ゼロ＝何かある」と読めてしまう。
 * 両極は寒色と暖色で、反対に読める組み合わせにする。
 */

type RGB = [number, number, number];

const hex = (s: string): RGB => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

/** 中点のグレー。サーフェスに応じて明暗を切り替える。 */
const MID = { light: hex("#f0efec"), dark: hex("#383835") };

/**
 * 海と国外の色。
 *
 * 以前は透明にしてページ背景を透かしていたが、サーモ配色は高温側が明るいので、
 * 白背景だと昼の一番暑い場所が消える（コントラスト比 1.1:1 だった）。
 * 海に中間的な色を敷くと、暗い低温側とも明るい高温側とも差がつく。
 * 青みを残して水だと分かるようにしつつ、彩度は落として温度の色と競合させない。
 */
const OCEAN = { light: hex("#cbd5e1"), dark: hex("#4b5563") };

// 寒色側（基準より低い）: 青。暖色側（基準より高い）: 赤。
const COOL_MID = hex("#2a78d6");
const COOL_END = hex("#0d366b");
const WARM_MID = hex("#e34948");
const WARM_END = hex("#7a1113");

const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/**
 * -1..+1 に正規化した平年差を色に変換する。
 * 各腕を「中点 → 中間色 → 濃色」の2段で繋いで、弱い差でも動きが見えるようにする。
 */
export function diverging(x: number, mode: "light" | "dark"): RGB {
  const mid = MID[mode];
  const t = Math.min(Math.abs(x), 1);
  const [midColor, endColor] = x < 0 ? [COOL_MID, COOL_END] : [WARM_MID, WARM_END];
  const BREAK = 0.6;
  return t <= BREAK
    ? mix(mid, midColor, t / BREAK)
    : mix(midColor, endColor, (t - BREAK) / (1 - BREAK));
}

/** 凡例に敷く連続グラデーション用の CSS 文字列。 */
export function divergingCss(mode: "light" | "dark", steps = 24): string {
  const stops: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * 2 - 1;
    const [r, g, b] = diverging(x, mode);
    stops.push(`rgb(${r} ${g} ${b}) ${((i / steps) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * 実測温度は「低い→高い」という順序だけを持つ量なので単調な連続ランプで塗る。
 *
 * サーモグラフィと同じく、低温を暗く高温を明るくする。
 * 以前は淡黄→深紅にしていたが、昼夜を同じ物差し（5〜40℃）にした結果、
 * 夜の値がランプの前半（位置 0.08〜0.63）に集中し、始点がほぼ白だったため
 * 屋外の明るい画面で飛んでいた。暗い側から始めれば、低温域でも
 * 背景との明度差が大きく残る。
 *
 * 温度は「セマンティック・ヒート」に当たるので多色ランプを使ってよい。
 * 条件は明度が単調に変わることと、凡例に実数値を添えること。虹色にはしない。
 */
const HEAT: RGB[] = [
  hex("#1b1035"),
  hex("#59206e"),
  hex("#a52c60"),
  hex("#e1583b"),
  hex("#f9a12b"),
  hex("#fcf4a3"),
];

/** 0..1 に正規化した温度を色に変換する。 */
export function heat(x: number): RGB {
  const t = Math.min(Math.max(x, 0), 1) * (HEAT.length - 1);
  const i = Math.min(Math.floor(t), HEAT.length - 2);
  return mix(HEAT[i], HEAT[i + 1], t - i);
}

/** 凡例に敷く連続グラデーション用の CSS 文字列。 */
export function heatCss(steps = 24): string {
  const stops: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const [r, g, b] = heat(i / steps);
    stops.push(`rgb(${r} ${g} ${b}) ${((i / steps) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * 256段の索引表。1画素ずつ関数を呼ぶと重いので先に作る。
 * kind="abs" は実測温度（0..1 の順序尺度）、"diff" は変化量（-1..+1 の極性）。
 */
export function buildLut(
  kind: "abs" | "diff",
  mode: "light" | "dark",
  noData: number,
): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const ocean = OCEAN[mode];
  for (let v = 0; v < 256; v++) {
    if (v === noData) {
      lut[v * 4] = ocean[0];
      lut[v * 4 + 1] = ocean[1];
      lut[v * 4 + 2] = ocean[2];
      lut[v * 4 + 3] = 255;
      continue;
    }
    const u = (v - 1) / 254;
    const [r, g, b] = kind === "abs" ? heat(u) : diverging(u * 2 - 1, mode);
    lut[v * 4] = r;
    lut[v * 4 + 1] = g;
    lut[v * 4 + 2] = b;
    lut[v * 4 + 3] = 255;
  }
  return lut;
}
