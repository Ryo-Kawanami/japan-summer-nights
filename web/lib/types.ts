/** pipeline/encode.py が書き出す series.json の形。 */

export type DayNight = "daytime" | "nighttime";
export type Period = "early" | "late";

export interface Stats {
  trendPerDecade: number;
  r: number;
  t: number;
  significant: boolean;
  warmingPixelFraction: number;
  earlyMean: number;
  lateMean: number;
  difference: number;
  yearlyStd: number;
  /** 1枚の地図の中の空間的な広がり(℃)。時間変化と比べるための物差し。 */
  spatialSpread: number;
  diffP5: number;
  diffP95: number;
  risenPixelFraction: number;
}

export interface Series {
  national: number[];
  /** 都道府県コード(1-47) → 年ごとの値。観測がない年は null。 */
  prefecture: Record<string, (number | null)[]>;
}

export interface BinStat {
  label: string;
  lo: number;
  hi: number;
  n: number;
  mean: number | null;
}

export interface UrbanBreakdownData {
  bins: string[];
  /** 土地被覆図の年。25年分はないので「いま都市か」しか判定できない。 */
  landcoverYear: number;
  by: Record<
    DayNight,
    {
      lateMean: BinStat[];
      change: BinStat[];
      /** 高度市街地と非市街地の実測温度の差＝ヒートアイランドの大きさ(℃) */
      heatIslandGap: number;
      /** 同じ2区分の「上昇量」の差(℃)。小さいほど都市化の寄与が小さい。 */
      changeGap: number;
    }
  >;
}

export interface Payload {
  bbox: [number, number, number, number];
  ppu: number;
  shape: [number, number];
  years: number[];
  /** 実測温度の表示レンジ [下限, 上限] ℃。昼夜・前後期すべて共通。 */
  absRange: [number, number];
  /** 変化量の表示レンジ ±℃。 */
  diffRange: number;
  noData: number;
  early: [number, number];
  late: [number, number];
  prefectures: Record<string, string>;
  series: Record<DayNight, Series>;
  stats: Record<DayNight, Stats>;
  assets: Record<string, string>;
  urban: UrbanBreakdownData;
}

export const DAYNIGHT_LABEL: Record<DayNight, string> = {
  daytime: "昼",
  nighttime: "夜",
};
