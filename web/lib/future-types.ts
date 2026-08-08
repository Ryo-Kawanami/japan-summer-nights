/** pipeline/build_pref_future.py が書き出す future.json の形。 */

import type { DayNight } from "@/lib/types";

export interface ApparentFit {
  r2: number;
  mae: number;
  /** 過去データへの当てはまりが基準を満たし、将来にも使えるか。 */
  usable_for_future: boolean;
}

/** 年ごとの体感指標。並びは Indicators.years と対応する。 */
export interface IndicatorSeries {
  /** その県の基準期間で上位10%に入る暑さの夜の日数。 */
  hot_nights: number[];
  hot_days: number[];
  t_min_mean: number[];
  t_max_mean: number[];
  apparent_mean: number[];
  /** 最低気温25℃以上の日数。再解析の格子平均なので実測より少なく出る。 */
  tropical_nights: number[];
}

export interface Indicators {
  years: number[];
  histYears: number[];
  apparentFit: ApparentFit;
  baseline: {
    years: [number, number];
    percentile: number;
    nightThreshold: number[];
    dayThreshold: number[];
  };
  national: IndicatorSeries;
  byPrefecture: Record<string, IndicatorSeries>;
}

export interface Heatstroke {
  years: number[];
  national: number[];
  byPrefecture: Record<string, number[]>;
  caveat: string;
  source: string;
}

export interface ModelScore {
  cv_r2: number;
  cv_rmse: number;
  /** 2000-2019で学習し2020-2024を当てた結果。将来予測の予行。 */
  warm_holdout: {
    train_years: [number, number];
    test_years: [number, number];
    r2: number;
    rmse: number;
    mae: number;
    bias: number;
    n: number;
  };
}

export interface Coverage {
  below: number;
  above: number;
  train_min: number;
  train_max: number;
  future_min: number;
  future_max: number;
}

export interface ClimateBlock {
  model: "linear" | "gbm";
  scores: Record<"linear" | "gbm", ModelScore>;
  coverage: Record<string, Coverage> | null;
  /** 将来の予測。バイアス補正ができていないときは空。 */
  national: number[];
  byPrefecture: Record<string, number[]>;
  observed: {
    national: number[];
    byPrefecture: Record<string, (number | null)[]>;
  };
}

export interface Relation {
  /** 気温が1℃上がると地表面温度が何℃上がるか。 */
  slope_per_air_degree: number;
  r: number;
  /** 地表面温度から気温を引いた平均差。夜は負（地面の方が冷たい）。 */
  mean_gap: number;
}

export interface BiasReport {
  mean: number;
  abs_mean: number;
  max_abs: number;
  largest: { index: number; name: string; offset: number }[];
}

export interface CorrelationFinding {
  label: string;
  /** 生の相関。 */
  r: number;
  /** 年で回帰した残差どうしの相関。見せかけかどうかはこちらで判断する。 */
  r_detrended: number;
  t: number;
  n: number;
  significant: boolean;
}

export interface Findings {
  heatstrokeVs: Record<string, CorrelationFinding>;
  /** 気温と地表面温度が年ごとのブレまで一致しているか。 */
  airVsLst: Record<DayNight, CorrelationFinding>;
  trendsPerDecade: {
    night_lst: number;
    day_lst: number;
    /** 散布図の横軸と同じ「日最高と日最低の中間」の気温。 */
    t_mean: number;
    t_min: number;
    t_max: number;
    hot_nights: number;
  };
  /**
   * 気温・湿度・市街地率・緯度で説明したあとに残る、地表面温度の上がり方。
   * 0 なら与えた4つで説明しきれている。夜だけ 0 でない。
   */
  unexplained: Record<DayNight, UnexplainedTrend>;
}

export interface UnexplainedTrend {
  /** 残差の年平均が動く速さ（℃/10年）。 */
  perDecade: number;
  t: number;
  n: number;
  significant: boolean;
  /** 残差の年平均、最初の5年と最後の5年（℃）。 */
  firstYears: number;
  lastYears: number;
}

export interface FuturePayload {
  years: number[];
  futureYears: number[];
  missingFutureYears: number[];
  /** 気候モデルと再解析の系統差を打ち消せているか。false なら将来は出さない。 */
  biasCorrected: boolean;
  biasCorrection: Record<string, BiasReport> | null;
  prefectures: Record<string, string>;
  indicators: Indicators;
  heatstroke: Heatstroke;
  climate: Record<DayNight, ClimateBlock>;
  relation: Record<DayNight, Relation>;
  findings: Findings;
}

export const MODEL_LABEL: Record<"linear" | "gbm", string> = {
  linear: "線形モデル",
  gbm: "勾配ブースティング",
};


/** pipeline/build_grid_future.py が書き出す grid_future.json の形。 */
export interface GridFuturePayload {
  /** 予測を平均する期間 [開始, 終了]。単年はモデル内部の変動なので平均で出す。 */
  futureWindow: [number, number];
  /** 比べる観測期間。 */
  obsWindow: [number, number];
  absRange: [number, number];
  diffRange: number;
  noData: number;
  scores: Record<
    DayNight,
    {
      model: "linear" | "gbm";
      warm_holdout: { r2: number; rmse: number; mae: number; bias: number; n: number };
      allScores: Record<string, { r2: number; rmse: number; bias: number }>;
    }
  >;
  assets: Record<string, string>;
}
