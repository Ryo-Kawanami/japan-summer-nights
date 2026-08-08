"""解析結果をフロントエンドが読む静的アセットに書き出す。

出力先: web/public/data/
  abs_{daytime,nighttime}_{early,late}.png   実測の地表面温度
  diff_{daytime,nighttime}.png               後期 − 前期 の変化量
  prefectures.png                            都道府県コードラスタ（クリック逆引き用）
  series.json                                都道府県別・全国の25年系列と統計量

画面に出る数字はすべてこの JSON から来る。コードに直接書かない。
そうしないと、パイプラインを直したときに表示だけ古い値のまま残る。

## スケールの設計方針

主地図は**実測温度**を、昼夜・前後期すべて共通の1本のスケールで塗る。
以前は両パネルを「25年平均からの差」で塗っていたが、それだと前期は定義上ほぼ必ず
平均より下（青）、後期は上（赤）になり、実際の差の大きさに関わらず青→赤の
フルスイングに見えてしまう。1枚の地図の中の空間差が約18℃あるのに対し、
25年の時間変化は昼 +0.59℃ / 夜 +1.51℃ しかない。同じ発色で描けば
10分の1の量を同じ迫力で見せることになる。

変化量は別のアセットとして「後期 − 前期」を1枚で出す。差を見せるならこれが正しく、
左右で色を仕込む必要がない。昼と夜を同じスケールで並べれば比較も公平になる。
"""

import json
import pathlib

import numpy as np
from PIL import Image

import aggregate as ag
import landcover as lc
import prefectures as pref
from fetch import BBOX, PPU, YEARS, load_stack

# 市街地率の区分。日本の陸セルは中央値が 0 なので等分位では潰れる。
# 「ほぼ非市街地」を1本にまとめ、都市側を細かく切る。
URBAN_BINS = [
    (0.00, 0.02, "ほぼ非市街地"),
    (0.02, 0.10, "市街地 2〜10%"),
    (0.10, 0.30, "市街地 10〜30%"),
    (0.30, 0.60, "市街地 30〜60%"),
    (0.60, 1.01, "高度市街地 60%以上"),
]

OUT = pathlib.Path(__file__).resolve().parents[1] / "web" / "public" / "data"

# 実測温度の表示レンジ ℃。昼と夜で別スケールにすると切り替えるたびに
# 物差しが変わるので1本に統一する。
#
# 実測の最小最大（昼 12.9〜39.3、夜 6.3〜27.0）に合わせて 5〜40 にしていたが、
# それだと稀な極値がレンジを決めてしまい、各地図の 5〜95% がランプの3割しか
# 使えなかった。1〜99パーセンタイルに寄せると使用域が広がり、地図の中の
# 濃淡が読めるようになる。切り捨ては 0.36%。
# これ以上詰める（10〜34など）と昼の高温側が白飛びして情報が落ちる。
ABS_RANGE = (8.0, 36.0)
# 変化量の表示レンジ ±℃。実測の |最大| は昼 3.69 / 夜 3.51。
DIFF_RANGE = 3.0
# 0 は「データなし（海・日本国外）」の番兵。値は 1-255 に載せる。
NODATA = 0


def quantize(arr, lo, hi):
    """値を [lo, hi] で uint8 に量子化する。NaN は NODATA。"""
    x = (arr - lo) / (hi - lo)                  # 0..1
    q = np.round(np.clip(x, 0, 1) * 254 + 1)    # 1..255
    q[np.isnan(arr)] = NODATA
    return q.astype("uint8")


def dequantize(q, lo, hi):
    """量子化の逆。ラウンドトリップ検証用。"""
    out = (q.astype("float64") - 1) / 254 * (hi - lo) + lo
    out[q == NODATA] = np.nan
    return out


def save_png(arr, name):
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "L").save(OUT / name, optimize=True)
    return (OUT / name).stat().st_size


def _emit(arr, name, lo, hi):
    """量子化して書き出し、量子化誤差とレンジ外の割合を別々に報告する。

    この2つを混ぜて測ると「量子化が粗い」と誤読してレンジ設計を誤る。
    """
    q = quantize(arr, lo, hi)
    size = save_png(q, name)
    valid = ~np.isnan(arr)
    inside = valid & (arr >= lo) & (arr <= hi)
    qerr = np.max(np.abs(dequantize(q, lo, hi)[inside] - arr[inside])) if inside.any() else 0.0
    clipped = np.mean(~inside[valid]) if valid.any() else 0.0
    print(f"  {name}: {size/1024:.0f}KB  量子化誤差 最大 {qerr:.4f}℃  "
          f"レンジ外 {100*clipped:.2f}%")
    return name


def build():
    codes, names = pref.load()
    japan = codes > 0                 # 日本の陸地だけ。大陸・半島は落とす
    urban = np.where(japan, lc.load(), np.nan)   # セルごとの市街地率

    payload = {
        "bbox": BBOX,
        "ppu": PPU,
        "shape": list(codes.shape),
        "years": list(YEARS),
        "absRange": list(ABS_RANGE),
        "diffRange": DIFF_RANGE,
        "noData": NODATA,
        "early": list(ag.EARLY),
        "late": list(ag.LATE),
        "prefectures": {str(k): v for k, v in sorted(names.items(), key=lambda x: int(x[0]))},
        "series": {},
        "stats": {},
        "assets": {},
        "urban": {"bins": [b[2] for b in URBAN_BINS], "landcoverYear": lc.YEAR, "by": {}},
    }

    lo, hi = ABS_RANGE

    for daynight in ("daytime", "nighttime"):
        years, stack_k = load_stack(daynight)
        stack = ag.to_celsius(stack_k)
        stack = np.where(japan[None, :, :], stack, np.nan)   # 日本の陸地に限定

        series_nat = ag.national_series(stack)
        slope, r, t = ag.linear_trend(years, series_nat)
        trend_grid = ag.pixel_trends(years, stack)

        early = ag.period_mean(years, stack, *ag.EARLY)
        late = ag.period_mean(years, stack, *ag.LATE)

        for period, grid in (("early", early), ("late", late)):
            key = f"abs_{daynight}_{period}"
            payload["assets"][key] = _emit(grid, f"{key}.png", lo, hi)

        key = f"diff_{daynight}"
        payload["assets"][key] = _emit(late - early, f"{key}.png",
                                       -DIFF_RANGE, DIFF_RANGE)

        early_m = ag.national_mean(early)
        late_m = ag.national_mean(late)
        diff = late - early
        land_diff = diff[~np.isnan(diff)]

        payload["stats"][daynight] = {
            "trendPerDecade": round(slope, 4),
            "r": round(r, 4),
            "t": round(t, 3),
            "significant": bool(abs(t) > 2.07),      # n=25 両側5%
            "warmingPixelFraction": round(ag.land_fraction_warming(trend_grid), 4),
            "earlyMean": round(early_m, 3),
            "lateMean": round(late_m, 3),
            "difference": round(late_m - early_m, 3),
            "yearlyStd": round(float(series_nat.std()), 3),
            # 1枚の地図の中の空間的な広がり。時間変化と比べるための物差し。
            "spatialSpread": round(
                float(np.nanpercentile(late, 99) - np.nanpercentile(late, 1)), 2),
            "diffP5": round(float(np.percentile(land_diff, 5)), 2),
            "diffP95": round(float(np.percentile(land_diff, 95)), 2),
            "risenPixelFraction": round(float((land_diff > 0).mean()), 4),
        }
        # 市街地率で区分けした内訳。ヒートアイランドの寄与を切り分けるため、
        # 「いまどれだけ暑いか（後期の実測）」と「どれだけ上がったか（変化量）」を
        # 別々に出す。前者は大きな差が出るが、後者はほとんど差が出ない。
        payload["urban"]["by"][daynight] = {
            "lateMean": ag.bin_stats(late, urban, URBAN_BINS),
            "change": ag.bin_stats(diff, urban, URBAN_BINS),
        }
        rural = ag.bin_stats(diff, urban, URBAN_BINS[:1])[0]
        city = ag.bin_stats(diff, urban, URBAN_BINS[-1:])[0]
        rural_abs = ag.bin_stats(late, urban, URBAN_BINS[:1])[0]
        city_abs = ag.bin_stats(late, urban, URBAN_BINS[-1:])[0]
        payload["urban"]["by"][daynight]["heatIslandGap"] = round(
            city_abs["mean"] - rural_abs["mean"], 2)
        payload["urban"]["by"][daynight]["changeGap"] = round(
            city["mean"] - rural["mean"], 2)

        payload["series"][daynight] = {
            "national": [round(float(v), 3) for v in series_nat],
            "prefecture": {},
        }
        for y_i, year in enumerate(years):
            zm = ag.zonal_means(stack[y_i], codes, pref.N_PREF)
            for code in range(1, pref.N_PREF + 1):
                payload["series"][daynight]["prefecture"].setdefault(str(code), [])
                v = zm[code]
                payload["series"][daynight]["prefecture"][str(code)].append(
                    None if np.isnan(v) else round(float(v), 3))

        s = payload["stats"][daynight]
        print(f"  {daynight}: {s['earlyMean']:.2f}℃ → {s['lateMean']:.2f}℃ "
              f"({s['difference']:+.2f}℃)  地図内の空間差 {s['spatialSpread']:.1f}℃  "
              f"トレンド {s['trendPerDecade']:+.3f}℃/10年 t={s['t']:.2f} "
              f"{'有意' if s['significant'] else '有意でない'}")
        ub = payload["urban"]["by"][daynight]
        print(f"    ヒートアイランド（高度市街地−非市街地の実測差）{ub['heatIslandGap']:+.2f}℃  "
              f"／ 上昇量の差 {ub['changeGap']:+.2f}℃")

    size = save_png(codes, "prefectures.png")
    payload["assets"]["prefectures"] = "prefectures.png"
    print(f"  prefectures.png: {size/1024:.0f}KB")

    path = OUT / "series.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    print(f"  series.json: {path.stat().st_size/1024:.0f}KB")
    total = sum(p.stat().st_size for p in OUT.iterdir())
    print(f"合計ペイロード: {total/1024:.0f}KB")
    return payload


if __name__ == "__main__":
    build()
