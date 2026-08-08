"""日次の気象データから、人が実感できる指標に落とす。

「夏の平均が1.5℃上がった」は正確だが、体には結びつかない。
「寝苦しい夜が年に何日増えた」なら結びつく。ここはその変換を担う。

## 指標
  熱帯夜   最低気温 25℃以上の日数
  真夏日   最高気温 30℃以上の日数
  猛暑日   最高気温 35℃以上の日数
  体感温度 気温・湿度・風から計算される「どれだけ暑く感じたか」

## 体感温度の扱い（ここが厄介）
  過去は ERA5 が apparent_temperature を持っているのでそのまま使える。
  将来の気候予測 API は同じ変数が null を返す。

  そこで過去期間で「気温と湿度から体感温度を当てる」変換式を最小二乗で作り、
  その精度を検証したうえで将来に適用する。式を思い込みで決めず、
  実際の ERA5 の値に合わせて係数を決めるので、検証可能な形になる。
  精度が出なければ、体感温度は過去だけの指標にとどめる。
"""

import numpy as np

TROPICAL_NIGHT = 25.0    # 熱帯夜: 最低気温がこの値以上
MIDSUMMER_DAY = 30.0     # 真夏日
EXTREME_DAY = 35.0       # 猛暑日

# 基準期間の上位何パーセントを「特に暑い日」と定義するか。
# 90 なら夏92日のうち上位およそ9日ぶん。
HOT_PERCENTILE = 90.0
BASELINE_YEARS = (2000, 2004)

# 体感温度の当てはめがこれを下回ったら将来には使わない。
APPARENT_MIN_R2 = 0.95


def count_days(daily, threshold, above=True):
    """しきい値を超えた（下回った）日数を地点ごとに数える。

    daily: (地点, 日) の配列。欠測は数えない。
    """
    ok = ~np.isnan(daily)
    hit = (daily >= threshold) if above else (daily <= threshold)
    return (hit & ok).sum(axis=1)


def summer_mean(daily):
    """地点ごとの夏平均。欠測は除外する。"""
    return np.nanmean(daily, axis=1)


def baseline_threshold(daily_by_year, percentile=HOT_PERCENTILE):
    """基準期間の日次データから、地点ごとの「特に暑い」しきい値を作る。

    daily_by_year: 基準期間の各年の (地点, 日) 配列の並び。

    ## なぜ絶対値（25℃、35℃）を使わないか
      再解析データは10〜30km格子の平均なので、都市の尖った最高気温がならされる。
      実測で猛暑日13日あった2010年の東京が、ERA5では0日になる。
      この状態で「猛暑日が何日」と出すのは誤り。

      各地点の過去を基準にしたしきい値なら、その偏りは分子と分母の両方に
      同じようにかかるので大きく相殺される。「その土地で昔から見て
      特に暑い日」という意味も保てる。
    """
    stacked = np.concatenate(list(daily_by_year), axis=1)   # (地点, 年数×日数)
    return np.nanpercentile(stacked, percentile, axis=1)


def count_above_baseline(daily, threshold):
    """地点ごとのしきい値を超えた日数。threshold は (地点,)。"""
    if threshold.shape[0] != daily.shape[0]:
        raise ValueError(f"地点数が合わない ({threshold.shape[0]} != {daily.shape[0]})")
    ok = ~np.isnan(daily)
    return ((daily >= threshold[:, None]) & ok).sum(axis=1)


def apparent_features(t_max, t_min, rh):
    """体感温度を当てるための説明変数。

    水蒸気圧を入れるのは、蒸し暑さが効くのは湿度そのものではなく
    空気が含む水の量だから。気温と湿度の掛け算で効く。
    """
    t_mean = (t_max + t_min) / 2
    # Magnus 式による飽和水蒸気圧(hPa)から実際の水蒸気圧を出す
    e_sat = 6.105 * np.exp(17.27 * t_mean / (237.7 + t_mean))
    e = rh / 100.0 * e_sat
    return np.stack([t_mean, t_max, e, np.ones_like(t_mean)], axis=-1)


def fit_apparent(t_max, t_min, rh, apparent):
    """過去データから体感温度の変換式を作り、係数と精度を返す。

    戻り値: (係数, R2, 平均絶対誤差)
    """
    X = apparent_features(t_max, t_min, rh).reshape(-1, 4)
    y = np.asarray(apparent).reshape(-1)
    ok = ~np.isnan(y) & ~np.isnan(X).any(axis=1)
    X, y = X[ok], y[ok]
    if len(y) < 100:
        raise RuntimeError(f"体感温度の当てはめに使える点が少なすぎる ({len(y)})")

    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    pred = X @ coef
    ss_res = ((y - pred) ** 2).sum()
    ss_tot = ((y - y.mean()) ** 2).sum()
    r2 = float(1 - ss_res / ss_tot)
    mae = float(np.abs(y - pred).mean())
    return coef, r2, mae


def apply_apparent(coef, t_max, t_min, rh):
    """学習した変換式で体感温度を推定する。"""
    return apparent_features(t_max, t_min, rh) @ coef


def per_site_stats(t_max, t_min, rh, apparent=None, coef=None,
                   hot_night_threshold=None, hot_day_threshold=None):
    """1年ぶんの日次データから地点ごとの指標をまとめて返す。

    apparent が無い（将来データ）ときは coef から推定する。
    しきい値を渡すと、その土地の過去を基準にした「特に暑い日」の日数も出す。

    絶対値のしきい値（熱帯夜25℃・猛暑日35℃）も返すが、再解析の格子平均は
    都市の実測より低く出るため過小になる。表示するときは必ずその旨を添えること。
    """
    out = {
        "tropical_nights": count_days(t_min, TROPICAL_NIGHT),
        "midsummer_days": count_days(t_max, MIDSUMMER_DAY),
        "extreme_days": count_days(t_max, EXTREME_DAY),
        "t_max_mean": summer_mean(t_max),
        "t_min_mean": summer_mean(t_min),
        "rh_mean": summer_mean(rh),
    }
    if hot_night_threshold is not None:
        out["hot_nights"] = count_above_baseline(t_min, hot_night_threshold)
    if hot_day_threshold is not None:
        out["hot_days"] = count_above_baseline(t_max, hot_day_threshold)
    if apparent is not None:
        out["apparent_mean"] = summer_mean(apparent)
        out["apparent_source"] = "era5"
    elif coef is not None:
        out["apparent_mean"] = summer_mean(apply_apparent(coef, t_max, t_min, rh))
        out["apparent_source"] = "fitted"
    return out
