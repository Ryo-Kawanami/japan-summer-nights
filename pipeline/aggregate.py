"""夏平均グリッドから表示用の派生値を計算する。

このモジュールはネットワークにもファイルにも触らない。純粋な配列演算だけを置く。
数字の正しさがこのアプリの価値の全部なので、ここは単体テストで守る。

グリッドの形状はどれも (年, 緯度, 経度) で、単位はケルビン。海は NaN。
"""

import numpy as np

KELVIN = 273.15

EARLY = (2000, 2004)
LATE = (2020, 2024)


def to_celsius(grid):
    """ケルビンを摂氏に。NaN はそのまま残す。"""
    return grid - KELVIN


def period_mean(years, stack, lo, hi):
    """[lo, hi] 年の平均グリッドを返す（両端を含む）。

    years: (年数,) の年配列
    stack: (年数, 緯度, 経度)
    """
    sel = (years >= lo) & (years <= hi)
    if not sel.any():
        raise ValueError(f"{lo}-{hi} 年のデータが1年もない")
    return np.nanmean(stack[sel], axis=0)


def anomaly(stack, reference):
    """基準グリッドからの差。reference は (緯度, 経度)。"""
    return stack - reference


def national_mean(grid):
    """陸地だけの空間平均。海の NaN は除外する。"""
    return float(np.nanmean(grid))


def national_series(stack):
    """年ごとの全国陸地平均の系列 (年数,)。"""
    return np.array([np.nanmean(g) for g in stack])


def linear_trend(years, values):
    """最小二乗の傾きと有意性を返す。

    戻り値: (10年あたりの傾き, 相関係数 r, t値)
    |t| > 2.07 で n=25 の両側5%有意。
    """
    x = np.asarray(years, dtype="float64")
    y = np.asarray(values, dtype="float64")
    x = x - x.mean()
    n = len(x)

    # 完全に平坦な系列は分散が0で相関が NaN になる。これは「トレンドなし」であって
    # 「計算不能」ではないので、r=t=0 として返す。
    if x.std() == 0 or y.std() == 0:
        return 0.0, 0.0, 0.0

    slope = float(np.polyfit(x, y, 1)[0])
    r = float(np.corrcoef(x, y)[0, 1])
    # r が ±1 に張り付くと t が発散するので保護する
    denom = max(1.0 - r * r, 1e-12)
    t = float(r * np.sqrt((n - 2) / denom))
    return slope * 10.0, r, t


def pixel_trends(years, stack):
    """ピクセルごとの傾き (緯度, 経度)、単位は 10年あたり℃。

    NaN を含むピクセルは NaN のまま返す。
    """
    x = np.asarray(years, dtype="float64")
    x = x - x.mean()
    n_years = stack.shape[0]
    flat = stack.reshape(n_years, -1)
    valid = ~np.isnan(flat).any(axis=0)

    out = np.full(flat.shape[1], np.nan, dtype="float64")
    if valid.any():
        cols = flat[:, valid]
        xc = x[:, None]
        num = ((xc - xc.mean()) * (cols - cols.mean(axis=0))).sum(axis=0)
        den = ((x - x.mean()) ** 2).sum()
        out[valid] = num / den * 10.0
    return out.reshape(stack.shape[1:])


def land_fraction_warming(trend_grid):
    """陸ピクセルのうち正のトレンドを持つ割合。

    海の NaN を分母に含めないこと。検証時に一度ここを間違えた。
    """
    land = trend_grid[~np.isnan(trend_grid)]
    if land.size == 0:
        return float("nan")
    return float((land > 0).mean())


def bin_stats(value_grid, key_grid, bins):
    """key_grid の値で区分けして、各区分の value_grid の平均と画素数を返す。

    bins は (下限, 上限, ラベル) の並び。上限は含まない。
    どちらかが NaN の画素は除外する。value 側の NaN を除外しないと、
    雲で欠測した画素が1つ混じるだけで区分全体の平均が NaN になる。

    戻り値: [{"label": str, "lo": float, "hi": float, "n": int, "mean": float|None}]
    """
    out = []
    for lo, hi, label in bins:
        m = (~np.isnan(value_grid)) & (~np.isnan(key_grid)) & (key_grid >= lo) & (key_grid < hi)
        n = int(m.sum())
        out.append({
            "label": label,
            "lo": float(lo),
            "hi": float(hi),
            "n": n,
            "mean": float(value_grid[m].mean()) if n else None,
        })
    return out


def zonal_means(grid, code_raster, n_codes):
    """コードラスタで区切った領域ごとの平均値を返す。

    code_raster: (緯度, 経度) の uint8。0 は「どの領域でもない」を意味する。
    戻り値: 長さ n_codes+1 の配列。index 0 は未使用で NaN。
    """
    out = np.full(n_codes + 1, np.nan, dtype="float64")
    for code in range(1, n_codes + 1):
        sel = (code_raster == code) & ~np.isnan(grid)
        if sel.any():
            out[code] = float(grid[sel].mean())
    return out
