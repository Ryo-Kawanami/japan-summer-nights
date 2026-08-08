"""5km格子で 2046-2050 年の地表面温度を予測し、地図の素材に焼く。

県別版（build_pref_future.py）と学習の形は同じで、単位が県から 5km セルに変わる。
county 単位では見えない都市や地形の細かさが出るのが利点。

出力:
  abs_{daytime,nighttime}_future.png   予測（2046-2050の平均）
  diff_{daytime,nighttime}_future.png  予測 − 観測（2020-2024）
  grid_future.json                     検証の数字と表示レンジ

## 気をつけたこと
  - 学習は 5km セル × 25年。県別（47×25）の 300倍以上のデータ量になるので、
    同じモデル設定でも当てはまりは変わる。検証はやり直す
  - 気候モデルと再解析の系統差は、格子でも同じように出る。
    格子のモデル過去期間（grid/model_hist）から差分法で打ち消す
  - 予測は 5年平均で出す。単年はモデル内部の変動で上下し、
    「その年を当てた」ものではないため地図にする意味がない

## 結果: この地図は公開しない（2026-07-28）

走らせて検証した結果、夜の予測が使い物にならないと判断した。数字は以下。

  夜 2046-2050 の予測昇温          +0.70℃
  暖年抜き取り（2000-2019で学習し
  2020-2024で試す）の偏り          -0.50℃

偏りが信号の7割ある。原因は木の外挿限界ではない。将来入力のうち学習範囲を
出るのは 0.7% しかなく、線形も GBM も同じ -0.51 / -0.50℃ の偏りを出す。

学習期間の中で残差の年平均を並べると、夜だけ +0.26℃/10年 で上がり続けて
いた（昼は -0.00℃/10年）。つまり気温・湿度・都市率・緯度を正しく与えても、
夜の地表面温度はそれで説明できない分だけ余計に上がっている。2022年から
2048年までの26年ぶんで +0.68℃ になり、予測値そのものと同じ大きさになる。

残差トレンドを足して補正できないかも試した。できない。2000-2019 だけから
推定すると +0.14℃/10年（t=1.52）にしかならず、外側の -0.51℃ を3分の1しか
埋められない。説明できない昇温は安定した直線ではなく近年で加速していて、
2050年まで伸ばす根拠がない。

昼は残差トレンドがゼロで構造的には健全だが、予測昇温が +0.10℃ しかない
一方 RMSE は 1.87℃、変化量の地図は 9.4% のセルが±3℃の表示範囲を振り切る。
描いても中身はほぼ雑音になる。

半分しか出ない値を地図にすると、注釈を付けても読者は地図の方を信じる。
折れ線の予測（build_pref_future.py、暖年抜き取りの偏り ±0.16℃）は基準を
満たしているのでそちらは公開している。このコードは、同じ手を将来だれかが
試したときに同じ検証をやり直せるように残す。
"""

import json
import pathlib

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

import aggregate as ag
import biascorrect as bc
import downscale as ds
import encode as enc
import interp as ip
import landcover as lc
import prefectures as pref
import weather as wx
from fetch import BBOX, load_stack

OUT = pathlib.Path(__file__).resolve().parents[1] / "web" / "public" / "data"
DAYNIGHTS = ("daytime", "nighttime")
FUTURE_WINDOW = (2046, 2050)      # 予測を平均する期間
OBS_WINDOW = ag.LATE              # 比べる観測期間（2020-2024）
CORRECT_VARS = ("temperature_2m_mean",)   # 湿度は比率量なので同じ扱いにしない


def load_cached(kind, year):
    p = wx.cache_path("grid", kind, year)
    if not p.exists():
        return None
    z = np.load(p)
    return {k: z[k] for k in z.files}


def check_ready():
    missing = []
    for kind, years in (("hist", wx.HIST_YEARS), ("model_hist", wx.HIST_YEARS),
                        ("future", wx.FUTURE_YEARS)):
        for y in years:
            if not wx.cache_path("grid", kind, y).exists():
                missing.append(f"{kind}/{y}")
    if missing:
        raise FileNotFoundError(
            f"格子の気象が {len(missing)} 年分足りない。最初の5件: {missing[:5]}")


def grid_offsets():
    """格子の観測点ごとの系統差（モデル − 再解析）。"""
    hist = list(wx.HIST_YEARS)
    out = {}
    for v in CORRECT_VARS:
        out[v] = bc.offsets([load_cached("model_hist", y)[v] for y in hist],
                            [load_cached("hist", y)[v] for y in hist])
        r = bc.report(out[v])
        print(f"  ずれ {v}: 平均 {r['mean']:+.2f}℃ 絶対値平均 {r['abs_mean']:.2f}℃ "
              f"最大 {r['max_abs']:.2f}℃")
    return out


def weather_grids(kind, years, shape, idx, w, offsets=None):
    """年ごとの夏平均気温・湿度を 5km 格子に広げて返す。"""
    out = {}
    for y in years:
        d = load_cached(kind, y)
        if d is None:
            continue
        t = d["temperature_2m_mean"]
        if offsets is not None and "temperature_2m_mean" in offsets:
            t = bc.apply(t, offsets["temperature_2m_mean"])
        out[y] = {
            "air_temp": ip.apply_weights(np.nanmean(t, axis=1), idx, w, shape),
            "humidity": ip.apply_weights(
                np.nanmean(d["relative_humidity_2m_mean"], axis=1), idx, w, shape),
        }
    return out


def _fit_gbm(X, y):
    m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.08, max_depth=6,
                                      early_stopping=False, random_state=0)
    m.fit(X, y)
    return m


def build():
    check_ready()
    codes, _names = pref.load()
    japan = codes > 0
    shape = codes.shape
    urban = np.where(japan, lc.load(), np.nan).ravel()

    lon0, lat0, lon1, lat1 = BBOX
    H, W = shape
    lat_grid = np.repeat(
        (lat1 - (np.arange(H) + 0.5) / H * (lat1 - lat0))[:, None], W, axis=1).ravel()

    glats, glons = wx.load_points("grid")
    idx, w = ip.build_weights(shape, BBOX, glats, glons)

    print("[1/3] 系統差を測る")
    offs = grid_offsets()

    hist_years = list(wx.HIST_YEARS)
    fut_years = [y for y in wx.FUTURE_YEARS if FUTURE_WINDOW[0] <= y <= FUTURE_WINDOW[1]]
    wx_hist = weather_grids("hist", hist_years, shape, idx, w)
    wx_fut = weather_grids("future", fut_years, shape, idx, w, offsets=offs)

    payload = {
        "futureWindow": list(FUTURE_WINDOW),
        "obsWindow": list(OBS_WINDOW),
        "absRange": list(enc.ABS_RANGE),
        "diffRange": enc.DIFF_RANGE,
        "noData": enc.NODATA,
        "scores": {},
        "assets": {},
    }

    for dn in DAYNIGHTS:
        print(f"[2/3] {dn}: 学習と検証")
        years, stack_k = load_stack(dn)
        lst = np.where(japan[None], ag.to_celsius(stack_k), np.nan)

        X, y, yrs = [], [], []
        for i, year in enumerate(hist_years):
            g = wx_hist[year]
            feat = ds.build_features(g["air_temp"], g["humidity"], urban, lat_grid)
            target = lst[list(years).index(year)].ravel()
            ok = ~np.isnan(target) & ~np.isnan(feat).any(axis=1)
            X.append(feat[ok]); y.append(target[ok]); yrs.append(np.full(ok.sum(), year))
        X = np.concatenate(X); y = np.concatenate(y); yrs = np.concatenate(yrs)
        print(f"  学習点 {len(y):,}")

        scores = {}
        for name, fit, predict in (("linear", ds.fit_linear, ds.predict_linear),
                                   ("gbm", _fit_gbm, lambda m, A: m.predict(A))):
            warm = ds.warm_year_holdout(X, y, yrs, fit, predict, split_year=2020)
            scores[name] = {k: (round(v, 4) if isinstance(v, float) else v)
                            for k, v in warm.items()}
            print(f"  {name}: 暖年抜き取り R2={warm['r2']:.3f} RMSE={warm['rmse']:.2f}℃ "
                  f"偏り {warm['bias']:+.2f}℃")

        chosen = min(scores, key=lambda n: scores[n]["rmse"] + abs(scores[n]["bias"]))
        fit, predict = ((ds.fit_linear, ds.predict_linear) if chosen == "linear"
                        else (_fit_gbm, lambda m, A: m.predict(A)))
        print(f"  採用 {chosen}")
        model = fit(X, y)

        print(f"[3/3] {dn}: {FUTURE_WINDOW[0]}-{FUTURE_WINDOW[1]} を予測")
        preds = []
        for year in fut_years:
            g = wx_fut[year]
            feat = ds.build_features(g["air_temp"], g["humidity"], urban, lat_grid)
            p = np.full(feat.shape[0], np.nan)
            ok = ~np.isnan(feat).any(axis=1)
            p[ok] = predict(model, feat[ok])
            preds.append(np.where(japan.ravel(), p, np.nan).reshape(shape))
        future = np.nanmean(np.stack(preds), axis=0)

        obs = ag.period_mean(years, lst, *OBS_WINDOW)
        lo, hi = enc.ABS_RANGE
        payload["assets"][f"abs_{dn}_future"] = enc._emit(
            future, f"abs_{dn}_future.png", lo, hi)
        payload["assets"][f"diff_{dn}_future"] = enc._emit(
            future - obs, f"diff_{dn}_future.png", -enc.DIFF_RANGE, enc.DIFF_RANGE)
        payload["scores"][dn] = {"model": chosen, "warm_holdout": scores[chosen],
                                 "allScores": scores}
        print(f"  全国平均 観測{OBS_WINDOW[0]}-{OBS_WINDOW[1]} "
              f"{np.nanmean(obs):.2f}℃ → 予測 {np.nanmean(future):.2f}℃ "
              f"({np.nanmean(future) - np.nanmean(obs):+.2f}℃)")

    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / "grid_future.json"
    p.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                 encoding="utf-8")
    print(f"書き出し: {p} ({p.stat().st_size/1024:.0f}KB)")
    return payload


if __name__ == "__main__":
    build()
