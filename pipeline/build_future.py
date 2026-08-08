"""気象・体感・2050年予測をまとめて計算し、フロント向けの JSON に落とす。

依存: weather.py が取得を終えていること（pipeline/cache/weather/）。

## 流れ
  1. 都道府県の代表点（県庁所在地）から体感の指標を作る
     熱帯夜・猛暑日の日数、体感温度。将来の体感温度は過去で学習した変換式で出す
  2. 0.5度格子の気象を 5km 格子へ広げ、地表面温度と突き合わせる
  3. 「気象＋土地の性質 → 地表面温度」を学習し、検証してから将来へ適用する
  4. 2025〜2050年を年ごとに予測する

## 予測を出す前に必ず見ること
  - 将来の入力が学習範囲に収まっているか（木モデルは範囲外を外挿できない）
  - 2000-2019で学習して2020-2024を当てられるか（未知の暖かさへの転移）
  これらの結果も JSON に入れて画面に出す。当たらないモデルの数字だけ出さない。
"""

import json
import pathlib

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

import aggregate as ag
import downscale as ds
import heatstroke as hs
import interp as ip
import landcover as lc
import prefectures as pref
import weather as wx
import weather_stats as ws
from fetch import BBOX, load_stack

OUT = pathlib.Path(__file__).resolve().parents[1] / "web" / "public" / "data"
DAYNIGHTS = ("daytime", "nighttime")


def load_cached(target, kind, year):
    """キャッシュからのみ読む。

    weather.load_or_fetch を使うと、未取得の年に当たったときここでも取得を
    始めてしまう。取得は weather.py の1プロセスに任せる約束にしないと、
    並行して走って API の利用枠を食い合う（実際に一度やった）。
    """
    p = wx.cache_path(target, kind, year)
    if not p.exists():
        raise FileNotFoundError(
            f"{target}/{kind} {year} が未取得。先に `uv run python pipeline/weather.py` "
            f"を完走させること")
    z = np.load(p)
    return {k: z[k] for k in z.files}


def check_cache_complete():
    """必要な年が全部そろっているかを先に確かめ、足りなければ一覧で報告する。"""
    missing = []
    for target in ("pref", "grid"):
        for kind, years in (("hist", wx.HIST_YEARS), ("future", wx.FUTURE_YEARS)):
            for y in years:
                if not wx.cache_path(target, kind, y).exists():
                    missing.append(f"{target}/{kind}/{y}")
    if missing:
        raise FileNotFoundError(
            f"気象データが {len(missing)} 年分足りない。最初の5件: {missing[:5]}")


# --------------------------------------------------------------------------
# 1. 都道府県ごとの体感指標
# --------------------------------------------------------------------------

def prefecture_indicators():
    """県庁所在地の気象から、体感に結びつく指標を年ごとに作る。"""
    hist_years = list(wx.HIST_YEARS)
    fut_years = list(wx.FUTURE_YEARS)
    lats, lons = wx.load_points("pref")

    # 体感温度の変換式は過去データ全部で作る。年ごとに作り直すと係数が揺れる。
    tmax, tmin, rh, app = [], [], [], []
    hist = {}
    for y in hist_years:
        d = load_cached("pref", "hist", y)
        hist[y] = d
        tmax.append(d["temperature_2m_max"])
        tmin.append(d["temperature_2m_min"])
        rh.append(d["relative_humidity_2m_mean"])
        app.append(d["apparent_temperature_mean"])
    coef, r2, mae = ws.fit_apparent(np.concatenate(tmax), np.concatenate(tmin),
                                    np.concatenate(rh), np.concatenate(app))
    fit_info = {"r2": round(r2, 4), "mae": round(mae, 3),
                "usable_for_future": bool(r2 >= ws.APPARENT_MIN_R2)}
    print(f"  体感温度の変換式: R2={r2:.4f} 平均絶対誤差={mae:.2f}℃ "
          f"{'将来にも使える' if fit_info['usable_for_future'] else '将来には使わない'}")

    out = {"years": hist_years + fut_years, "histYears": hist_years,
           "futureYears": fut_years, "apparentFit": fit_info, "byPrefecture": {}}

    # 「特に暑い日」のしきい値は基準期間(2000-2004)の各地点の分位点で決める。
    # 絶対値だと再解析の格子平均が都市の実測より低いぶん、日数が過小になる。
    lo_y, hi_y = ws.BASELINE_YEARS
    base = [y for y in hist_years if lo_y <= y <= hi_y]
    th_night = ws.baseline_threshold([hist[y]["temperature_2m_min"] for y in base])
    th_day = ws.baseline_threshold([hist[y]["temperature_2m_max"] for y in base])
    out["baseline"] = {
        "years": [lo_y, hi_y],
        "percentile": ws.HOT_PERCENTILE,
        "nightThreshold": [round(float(v), 2) for v in th_night],
        "dayThreshold": [round(float(v), 2) for v in th_day],
    }

    series = {k: [] for k in ("tropical_nights", "extreme_days", "midsummer_days",
                              "t_max_mean", "t_min_mean", "apparent_mean",
                              "hot_nights", "hot_days")}
    for y in hist_years:
        d = hist[y]
        st = ws.per_site_stats(d["temperature_2m_max"], d["temperature_2m_min"],
                               d["relative_humidity_2m_mean"],
                               apparent=d["apparent_temperature_mean"],
                               hot_night_threshold=th_night, hot_day_threshold=th_day)
        for k in series:
            series[k].append(st[k])
    for y in fut_years:
        d = load_cached("pref", "future", y)
        st = ws.per_site_stats(d["temperature_2m_max"], d["temperature_2m_min"],
                               d["relative_humidity_2m_mean"],
                               coef=coef if fit_info["usable_for_future"] else None,
                               hot_night_threshold=th_night, hot_day_threshold=th_day)
        for k in series:
            series[k].append(st.get(k, np.full(len(lats), np.nan)))

    for k in series:
        series[k] = np.stack(series[k])          # (年, 県)

    _, names = pref.load()
    for code in range(1, pref.N_PREF + 1):
        out["byPrefecture"][str(code)] = {
            k: [None if np.isnan(v) else round(float(v), 2)
                for v in series[k][:, code - 1]]
            for k in series
        }
    out["national"] = {k: [round(float(np.nanmean(row)), 2) for row in series[k]]
                       for k in series}
    return out


def heatstroke_block():
    """熱中症搬送者数を年・都道府県別でまとめる。

    温度も気温も「何度だった」しか言わない。実際に人が倒れた数は、
    その暑さが人にとって何を意味したかを直接示す唯一のデータになる。

    ただし搬送者数は気温だけの関数ではない。高齢化、通報のしやすさ、
    熱中症という言葉の浸透度も効く。しかもそれらは全部増加方向なので、
    「年とともに増えた」という相関は特に疑ってかかる必要がある。
    その注意書きもデータと一緒に持たせる。
    """
    years, counts = hs.load()
    return {
        "years": [int(y) for y in years],
        "national": [int(v) for v in counts[:, 1:].sum(axis=1)],
        "byPrefecture": {str(c): [int(v) for v in counts[:, c]]
                         for c in range(1, pref.N_PREF + 1)},
        "caveat": ("搬送者数は気温だけで決まらない。高齢化や通報体制の変化も効き、"
                   "それらも増加方向なので、年とともに増えたという相関だけでは"
                   "暑さのせいと言い切れない。"),
        "source": "総務省消防庁「熱中症による救急搬送状況」",
    }


# --------------------------------------------------------------------------
# 2. 気象を 5km 格子へ広げて学習データを作る
# --------------------------------------------------------------------------

def _grid_weather(kind, years, shape, idx, w):
    """年ごとの夏平均気温・湿度を格子で返す。"""
    lats, lons = wx.load_points("grid")
    out = {}
    for y in years:
        d = load_cached("grid", kind, y)
        out[y] = {
            "air_temp": ip.apply_weights(np.nanmean(d["temperature_2m_mean"], axis=1),
                                         idx, w, shape),
            "humidity": ip.apply_weights(np.nanmean(d["relative_humidity_2m_mean"], axis=1),
                                         idx, w, shape),
        }
    return out


def training_matrix(daynight, japan, urban, lat_grid, weather_hist, years):
    """(特徴量, 目的変数, 年) を積み上げる。日本の陸地のみ。"""
    _, stack_k = load_stack(daynight)
    lst = np.where(japan[None], ag.to_celsius(stack_k), np.nan)

    X, y, yr = [], [], []
    for i, year in enumerate(years):
        wgt = weather_hist[year]
        feat = ds.build_features(wgt["air_temp"], wgt["humidity"], urban, lat_grid)
        target = lst[i].ravel()
        ok = ~np.isnan(target) & ~np.isnan(feat).any(axis=1)
        X.append(feat[ok])
        y.append(target[ok])
        yr.append(np.full(ok.sum(), year))
    return np.concatenate(X), np.concatenate(y), np.concatenate(yr)


# --------------------------------------------------------------------------
# 3. 学習と検証
# --------------------------------------------------------------------------

def _fit_gbm(X, y):
    m = HistGradientBoostingRegressor(
        max_iter=300, learning_rate=0.08, max_depth=6,
        early_stopping=True, validation_fraction=0.15, random_state=0)
    m.fit(X, y)
    return m


def _predict_gbm(m, X):
    return m.predict(X)


def evaluate(X, y, years):
    """2つのモデルを年で分けて検証する。数字は画面に出す。"""
    res = {}
    for name, fit, predict in (("linear", ds.fit_linear, ds.predict_linear),
                               ("gbm", _fit_gbm, _predict_gbm)):
        cv = ds.year_block_cv(X, y, years, fit, predict, n_blocks=5)
        warm = ds.warm_year_holdout(X, y, years, fit, predict, split_year=2020)
        res[name] = {
            "cv_r2": round(float(np.mean([f["r2"] for f in cv])), 4),
            "cv_rmse": round(float(np.mean([f["rmse"] for f in cv])), 3),
            "warm_holdout": {k: (round(v, 4) if isinstance(v, float) else v)
                             for k, v in warm.items()},
        }
        w = res[name]["warm_holdout"]
        print(f"  {name}: 年ブロックCV R2={res[name]['cv_r2']:.3f} "
              f"RMSE={res[name]['cv_rmse']:.2f}℃ / "
              f"暖年抜き取り R2={w['r2']:.3f} RMSE={w['rmse']:.2f}℃ "
              f"偏り {w['bias']:+.2f}℃")
    return res


def choose_model(scores):
    """暖年抜き取りの成績で選ぶ。

    普通の交差検証だけで選ぶと、内挿が上手いだけのモデルを選んでしまう。
    ここで問いたいのは「見たことのない暖かさに耐えるか」なので、
    抜き取りの二乗平均誤差と偏りの小ささで決める。
    """
    def penalty(name):
        w = scores[name]["warm_holdout"]
        return w["rmse"] + abs(w["bias"])
    return min(scores, key=penalty)


# --------------------------------------------------------------------------
# 4. 将来の予測と書き出し
# --------------------------------------------------------------------------

def predict_future(model_name, fit, predict, X, y, japan, urban, lat_grid,
                   weather_future, years, shape, codes):
    """学習済みの関係を将来の気象に当てはめ、年ごとの全国・県別平均を返す。"""
    model = fit(X, y)
    national, by_pref = [], {str(c): [] for c in range(1, pref.N_PREF + 1)}
    grids = {}
    for year in years:
        wgt = weather_future[year]
        feat = ds.build_features(wgt["air_temp"], wgt["humidity"], urban, lat_grid)
        pred = np.full(feat.shape[0], np.nan)
        ok = ~np.isnan(feat).any(axis=1)
        pred[ok] = predict(model, feat[ok])
        grid = pred.reshape(shape)
        grid = np.where(japan, grid, np.nan)
        grids[year] = grid
        national.append(round(float(np.nanmean(grid)), 3))
        zm = ag.zonal_means(grid, codes, pref.N_PREF)
        for c in range(1, pref.N_PREF + 1):
            v = zm[c]
            by_pref[str(c)].append(None if np.isnan(v) else round(float(v), 2))
    return {"model": model_name, "national": national, "byPrefecture": by_pref}, grids


def build():
    check_cache_complete()
    codes, names = pref.load()
    japan = codes > 0
    shape = codes.shape
    urban = np.where(japan, lc.load(), np.nan).ravel()

    lon0, lat0, lon1, lat1 = BBOX
    H, W = shape
    lat_grid = np.repeat(
        (lat1 - (np.arange(H) + 0.5) / H * (lat1 - lat0))[:, None], W, axis=1).ravel()

    print("[1/4] 都道府県ごとの体感指標")
    indicators = prefecture_indicators()

    print("[2/4] 気象を5km格子へ広げる")
    glats, glons = wx.load_points("grid")
    idx, w = ip.build_weights(shape, BBOX, glats, glons)
    hist_years = list(wx.HIST_YEARS)
    fut_years = list(wx.FUTURE_YEARS)
    wx_hist = _grid_weather("hist", hist_years, shape, idx, w)
    wx_future = _grid_weather("future", fut_years, shape, idx, w)

    payload = {
        "years": hist_years,
        "futureYears": fut_years,
        "indicators": indicators,
        "heatstroke": heatstroke_block(),
        "climate": {},
        "relation": {},
    }

    for daynight in DAYNIGHTS:
        print(f"[3/4] {daynight}: 学習と検証")
        X, y, yrs = training_matrix(daynight, japan, urban, lat_grid, wx_hist, hist_years)
        scores = evaluate(X, y, yrs)

        Xf = np.concatenate([
            ds.build_features(wx_future[yy]["air_temp"], wx_future[yy]["humidity"],
                              urban, lat_grid)
            for yy in fut_years])
        cov = ds.coverage_report(X, Xf[~np.isnan(Xf).any(axis=1)])
        worst = max(cov.items(), key=lambda kv: kv[1]["above"])
        print(f"  学習範囲の外に出る割合が最大の特徴量: {worst[0]} "
              f"{100*worst[1]['above']:.1f}%（学習上限 {worst[1]['train_max']:.1f} / "
              f"将来最大 {worst[1]['future_max']:.1f}）")

        chosen = choose_model(scores)
        print(f"  採用: {chosen}")
        fit, predict = ((ds.fit_linear, ds.predict_linear) if chosen == "linear"
                        else (_fit_gbm, _predict_gbm))

        print(f"[4/4] {daynight}: 2025-2050年を予測")
        fut, _grids = predict_future(chosen, fit, predict, X, y, japan, urban,
                                     lat_grid, wx_future, fut_years, shape, codes)

        # 気温と地表面温度の関係そのものも出す。読者への説明に使う。
        air = np.concatenate([wx_hist[yy]["air_temp"].ravel() for yy in hist_years])
        lst_all = y
        air_ok = air[~np.isnan(air)]
        payload["relation"][daynight] = {
            "slope_per_air_degree": round(float(np.polyfit(X[:, 0], y, 1)[0]), 3),
            "r": round(float(np.corrcoef(X[:, 0], y)[0, 1]), 3),
            "mean_gap": round(float(np.nanmean(lst_all) - np.nanmean(air_ok)), 2),
        }
        payload["climate"][daynight] = {"scores": scores, "coverage": cov, **fut}

    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / "future.json"
    p.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                 encoding="utf-8")
    print(f"書き出し: {p} ({p.stat().st_size/1024:.0f}KB)")
    return payload


if __name__ == "__main__":
    build()
