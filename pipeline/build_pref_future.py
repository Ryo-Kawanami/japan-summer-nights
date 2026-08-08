"""都道府県単位で、体感指標と 2025-2050 年の地表面温度予測を作る。

## なぜ県単位なのか
  当初は 0.5 度格子の気象を 5km 格子へ広げて、地図として予測を出す設計だった。
  ただ Open-Meteo の日次上限に当たり、格子ぶんの気象は当日中に揃わなかった。
  （最初に 912地点 × 7変数 × 92日 で取りに行って枠を使い切ったのが原因。）

  県単位なら手元のデータで完結し、しかも読者が自分ごとにできる粒度になる。
  格子版の地図は枠が戻ってから足す。ここで作る関係式はそのまま使える。

## 学習の形
  目的変数: その県・その年の夏の平均地表面温度（衛星）
  説明変数: その県・その年の夏の気温・水蒸気圧・市街地率・緯度
  年は説明変数に入れない。年を入れると「25点の直線当てはめ」に戻ってしまう。

  学習点は 47県 × 25年 = 1,175。将来は同じ関係に気候モデルの気象を入れる。
"""

import json
import pathlib

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

import aggregate as ag
import biascorrect as bc
import downscale as ds
import heatstroke as hs
import landcover as lc
import prefectures as pref
import weather as wx
import weather_stats as ws
from fetch import BBOX, load_stack

OUT = pathlib.Path(__file__).resolve().parents[1] / "web" / "public" / "data"
DAYNIGHTS = ("daytime", "nighttime")


def load_cached(kind, year):
    p = wx.cache_path("pref", kind, year)
    if not p.exists():
        return None
    z = np.load(p)
    return {k: z[k] for k in z.files}


# 差分法で補正する変数。湿度は比率量なので同じ扱いはできず、ここでは補正しない。
CORRECT_VARS = ("temperature_2m_max", "temperature_2m_min")


def bias_offsets(hist_years, names):
    """気候モデルと再解析の系統差を、変数ごと・県ごとに求める。

    モデルの過去（model_hist）が揃っていなければ None を返す。
    そのときは将来の数字を出さない。補正なしの絶対値を出すと、都市部で
    「2025年から涼しくなる」という嘘の絵になることを実測で確認している。
    """
    model = {y: load_cached("model_hist", y) for y in hist_years}
    if any(v is None for v in model.values()):
        got = sum(v is not None for v in model.values())
        print(f"  気候モデルの過去が {got}/{len(hist_years)} 年しかない → "
              f"将来の数字は出さない（差分法の補正ができないため）")
        return None
    obs = {y: load_cached("hist", y) for y in hist_years}
    out = {}
    for v in CORRECT_VARS:
        off = bc.offsets([model[y][v] for y in hist_years],
                         [obs[y][v] for y in hist_years])
        out[v] = off
        r = bc.report(off, names=names)
        print(f"  ずれ {v}: 平均 {r['mean']:+.2f}℃ 絶対値平均 {r['abs_mean']:.2f}℃ "
              f"最大 {r['max_abs']:.2f}℃（{r['largest'][0]['name']}）")
    return out


def corrected_future(year, offsets):
    """将来の日次データを補正して返す。offsets が None なら None。"""
    d = load_cached("future", year)
    if d is None or offsets is None:
        return None
    out = dict(d)
    for v, off in offsets.items():
        out[v] = bc.apply(d[v], off)
    return out


def prefecture_urban_and_lat():
    """県ごとの市街地率と代表緯度。"""
    codes, _ = pref.load()
    urban_grid = np.where(codes > 0, lc.load(), np.nan)
    lats, _lons = wx.prefecture_points()
    urban = np.array([np.nanmean(urban_grid[codes == c]) for c in range(1, pref.N_PREF + 1)])
    return urban, lats


def prefecture_lst():
    """県ごと・年ごとの夏平均地表面温度。(昼夜, 年, 県)"""
    codes, _ = pref.load()
    japan = codes > 0
    out = {}
    for dn in DAYNIGHTS:
        years, stack_k = load_stack(dn)
        stack = np.where(japan[None], ag.to_celsius(stack_k), np.nan)
        rows = [ag.zonal_means(stack[i], codes, pref.N_PREF)[1:] for i in range(len(years))]
        out[dn] = np.stack(rows)          # (年, 県)
    return out


def weather_features(kind, years, urban, lats, offsets=None):
    """年ごとの (県, 特徴量) 行列を作る。取得できていない年は None にする。

    offsets を渡すと、気候モデルの系統差を差分法で打ち消してから使う。
    """
    feats, avail = {}, []
    for y in years:
        d = corrected_future(y, offsets) if kind == "future" else load_cached(kind, y)
        if d is None:
            feats[y] = None
            continue
        t_max = ws.summer_mean(d["temperature_2m_max"])
        t_min = ws.summer_mean(d["temperature_2m_min"])
        rh = ws.summer_mean(d["relative_humidity_2m_mean"])
        air = (t_max + t_min) / 2
        feats[y] = ds.build_features(air, rh, urban, lats)
        avail.append(y)
    return feats, avail


def _fit_gbm(X, y):
    m = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06, max_depth=5,
                                      early_stopping=False, random_state=0)
    m.fit(X, y)
    return m


def build():
    codes, names = pref.load()
    urban, lats = prefecture_urban_and_lat()
    lst = prefecture_lst()

    hist_years = [y for y in wx.HIST_YEARS if load_cached("hist", y) is not None]
    fut_years = list(wx.FUTURE_YEARS)
    if len(hist_years) < 20:
        raise RuntimeError(f"過去の気象が {len(hist_years)} 年しかない")

    name_list = [names[str(c)] for c in range(1, pref.N_PREF + 1)]
    offsets = bias_offsets(hist_years, name_list)

    hist_feats, _ = weather_features("hist", hist_years, urban, lats)
    fut_feats, fut_avail = weather_features("future", fut_years, urban, lats, offsets)
    missing = [y for y in fut_years if fut_feats[y] is None]
    if missing and offsets is not None:
        print(f"  未取得のため予測を出さない年: {missing}")

    payload = {
        "years": hist_years,
        "futureYears": fut_avail,
        "missingFutureYears": missing,
        "biasCorrected": offsets is not None,
        "biasCorrection": (None if offsets is None else {
            v: bc.report(off, names=[names[str(c)] for c in range(1, pref.N_PREF + 1)])
            for v, off in offsets.items()}),
        "prefectures": {str(k): v for k, v in sorted(names.items(), key=lambda x: int(x[0]))},
        "indicators": indicators_block(hist_years, fut_years, offsets),
        "heatstroke": heatstroke_block(),
        "climate": {},
        "relation": {},
    }
    payload["findings"] = findings_block(payload["indicators"], payload["heatstroke"],
                                         lst, hist_years)

    all_years = np.array(list(wx.HIST_YEARS))
    for dn in DAYNIGHTS:
        X = np.concatenate([hist_feats[y] for y in hist_years])
        y_idx = [list(all_years).index(y) for y in hist_years]
        target = np.concatenate([lst[dn][i] for i in y_idx])
        yrs = np.concatenate([np.full(pref.N_PREF, y) for y in hist_years])
        ok = ~np.isnan(target) & ~np.isnan(X).any(axis=1)
        X, target, yrs = X[ok], target[ok], yrs[ok]

        scores = {}
        for name, fit, predict in (("linear", ds.fit_linear, ds.predict_linear),
                                   ("gbm", _fit_gbm, lambda m, A: m.predict(A))):
            cv = ds.year_block_cv(X, target, yrs, fit, predict, n_blocks=5)
            warm = ds.warm_year_holdout(X, target, yrs, fit, predict, split_year=2020)
            scores[name] = {
                "cv_r2": round(float(np.mean([f["r2"] for f in cv])), 4),
                "cv_rmse": round(float(np.mean([f["rmse"] for f in cv])), 3),
                "warm_holdout": {k: (round(v, 4) if isinstance(v, float) else v)
                                 for k, v in warm.items()},
            }
            w = scores[name]["warm_holdout"]
            print(f"  {dn}/{name}: CV R2={scores[name]['cv_r2']:.3f} "
                  f"RMSE={scores[name]['cv_rmse']:.2f}℃ / 暖年抜き取り "
                  f"R2={w['r2']:.3f} RMSE={w['rmse']:.2f}℃ 偏り {w['bias']:+.2f}℃")

        cov = None
        if offsets is not None and fut_avail:
            Xf = np.concatenate([fut_feats[y] for y in fut_avail])
            cov = ds.coverage_report(X, Xf)
            worst = max(cov.items(), key=lambda kv: kv[1]["above"])
            print(f"  {dn}: 学習範囲を超える割合が最大の特徴量 {worst[0]} "
                  f"{100*worst[1]['above']:.1f}%（学習上限 {worst[1]['train_max']:.1f} / "
                  f"将来最大 {worst[1]['future_max']:.1f}）")

        payload["findings"].setdefault("unexplained", {})[dn] = unexplained_trend(
            X, target, yrs, hist_years)
        u = payload["findings"]["unexplained"][dn]
        print(f"  {dn}: 気温などで説明できない分 {u['perDecade']:+.3f}℃/10年 "
              f"t={u['t']:+.2f}（{'有意' if u['significant'] else '有意でない'}）")

        chosen = min(scores, key=lambda n: scores[n]["warm_holdout"]["rmse"]
                     + abs(scores[n]["warm_holdout"]["bias"]))
        fit, predict = ((ds.fit_linear, ds.predict_linear) if chosen == "linear"
                        else (_fit_gbm, lambda m, A: m.predict(A)))
        model = fit(X, target)
        print(f"  {dn}: 採用 {chosen}")

        by_pref = {str(c): [] for c in range(1, pref.N_PREF + 1)}
        national = []
        for yy in (fut_avail if offsets is not None else []):
            p = predict(model, fut_feats[yy])
            national.append(round(float(np.nanmean(p)), 3))
            for c in range(1, pref.N_PREF + 1):
                by_pref[str(c)].append(round(float(p[c - 1]), 2))

        payload["relation"][dn] = {
            "slope_per_air_degree": round(float(np.polyfit(X[:, 0], target, 1)[0]), 3),
            "r": round(float(np.corrcoef(X[:, 0], target)[0, 1]), 3),
            "mean_gap": round(float(np.nanmean(target) - np.nanmean(X[:, 0])), 2),
        }
        payload["climate"][dn] = {
            "model": chosen, "scores": scores, "coverage": cov,
            "national": national, "byPrefecture": by_pref,
            "observed": {
                "national": [round(float(np.nanmean(lst[dn][i])), 3) for i in y_idx],
                "byPrefecture": {str(c): [None if np.isnan(lst[dn][i][c - 1])
                                          else round(float(lst[dn][i][c - 1]), 2)
                                          for i in y_idx]
                                 for c in range(1, pref.N_PREF + 1)},
            },
        }

    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / "future.json"
    p.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                 encoding="utf-8")
    print(f"書き出し: {p} ({p.stat().st_size/1024:.0f}KB)")
    return payload


def indicators_block(hist_years, fut_years, offsets=None):
    """体感の指標。しきい値は基準期間の各県の分位点で決める。"""
    hist = {y: load_cached("hist", y) for y in hist_years}
    cat = lambda k: np.concatenate([hist[y][k] for y in hist_years])  # noqa: E731
    coef, r2, mae = ws.fit_apparent(cat("temperature_2m_max"), cat("temperature_2m_min"),
                                    cat("relative_humidity_2m_mean"),
                                    cat("apparent_temperature_mean"))
    usable = bool(r2 >= ws.APPARENT_MIN_R2)
    print(f"  体感温度の変換式: R2={r2:.4f} 平均絶対誤差={mae:.2f}℃ "
          f"{'将来にも使う' if usable else '将来には使わない'}")

    lo, hi = ws.BASELINE_YEARS
    base = [y for y in hist_years if lo <= y <= hi]
    th_n = ws.baseline_threshold([hist[y]["temperature_2m_min"] for y in base])
    th_d = ws.baseline_threshold([hist[y]["temperature_2m_max"] for y in base])

    keys = ("hot_nights", "hot_days", "t_min_mean", "t_max_mean", "apparent_mean",
            "tropical_nights")
    years_out, rows = [], {k: [] for k in keys}
    for y in hist_years + fut_years:
        d = hist.get(y) if y in hist_years else corrected_future(y, offsets)
        if d is None:
            continue
        st = ws.per_site_stats(
            d["temperature_2m_max"], d["temperature_2m_min"],
            d["relative_humidity_2m_mean"],
            apparent=d.get("apparent_temperature_mean") if y in hist_years else None,
            coef=None if y in hist_years else (coef if usable else None),
            hot_night_threshold=th_n, hot_day_threshold=th_d)
        years_out.append(y)
        for k in keys:
            rows[k].append(st[k])
    arr = {k: np.stack(v) for k, v in rows.items()}

    return {
        "years": years_out,
        "histYears": hist_years,
        "apparentFit": {"r2": round(r2, 4), "mae": round(mae, 3),
                        "usable_for_future": usable},
        "baseline": {"years": [lo, hi], "percentile": ws.HOT_PERCENTILE,
                     "nightThreshold": [round(float(v), 2) for v in th_n],
                     "dayThreshold": [round(float(v), 2) for v in th_d]},
        "national": {k: [round(float(np.nanmean(r)), 2) for r in arr[k]] for k in keys},
        "byPrefecture": {
            str(c): {k: [round(float(v), 2) for v in arr[k][:, c - 1]] for k in keys}
            for c in range(1, pref.N_PREF + 1)},
    }


def unexplained_trend(X, target, yrs, hist_years):
    """気温・湿度・都市率・緯度で説明したあとに残る、地表面温度の上がり方。

    5つの特徴量から線形で地表面温度を予測し、その残差（実測 − 予測）の
    年平均が年とともに動いているかを見る。傾きが 0 なら、地表面温度の
    上がり方は気温などの上がり方で説明しきれている。0 でなければ、
    与えた特徴量では説明できない変化が別にあることになる。

    線形で測るのは解釈のため。木は残差に構造を残さないよう当てにいくので、
    「何が説明できていないか」を見る道具には向かない。
    """
    m = ds.fit_linear(X, target)
    resid = target - ds.predict_linear(m, X)
    years = np.asarray(hist_years, dtype="float64")
    per_year = np.array([resid[yrs == y].mean() for y in hist_years])
    slope, _, t = ag.linear_trend(years, per_year)
    n = len(years)
    return {
        "perDecade": round(float(slope), 3),   # linear_trend は10年あたりで返す
        "t": round(float(t), 2),
        "n": n,
        # 自由度 n-2 の両側5%。25年なら 2.07。
        "significant": bool(abs(t) > 2.07),
        "firstYears": round(float(per_year[:5].mean()), 3),
        "lastYears": round(float(per_year[-5:].mean()), 3),
    }


def _corr(a, b):
    """相関と、トレンドを除いた相関の両方を返す。

    どちらも右肩上がりの量どうしは、中身に関係なく相関する。
    年で回帰した残差どうしの相関まで見ないと、見せかけかどうか分からない。
    """
    a = np.asarray(a, dtype="float64")
    b = np.asarray(b, dtype="float64")
    ok = ~np.isnan(a) & ~np.isnan(b)
    a, b = a[ok], b[ok]
    n = len(a)
    x = np.arange(n, dtype="float64")
    ra = a - np.polyval(np.polyfit(x, a, 1), x)
    rb = b - np.polyval(np.polyfit(x, b, 1), x)
    r = float(np.corrcoef(a, b)[0, 1])
    rd = float(np.corrcoef(ra, rb)[0, 1])
    t = float(rd * np.sqrt((n - 2) / max(1 - rd * rd, 1e-12)))
    return {"r": round(r, 3), "r_detrended": round(rd, 3), "t": round(t, 2),
            "n": n, "significant": bool(abs(t) > 2.16)}


def national_lst_series():
    """全国平均の地表面温度。陸画素の面積加重で、サイトの他の部分と同じ取り方。

    県平均をさらに平均すると小さい県が同じ重みを持ち、値がずれる。
    実際に県平均で計算して、熱中症との相関が 0.66 と 0.41 に食い違った。
    """
    codes, _ = pref.load()
    japan = codes > 0
    out = {}
    for dn in DAYNIGHTS:
        _years, stack_k = load_stack(dn)
        stack = np.where(japan[None], ag.to_celsius(stack_k), np.nan)
        out[dn] = ag.national_series(stack)
    return out


def findings_block(indicators, heat, lst, hist_years):
    """考察と実用のセクションが使う数字。画面に直書きしない。"""
    years = indicators["years"]
    nat = indicators["national"]
    hy = heat["years"]
    idx = [years.index(y) for y in hy if y in years]
    hs_years = [y for y in hy if y in years]
    hs_counts = [heat["national"][hy.index(y)] for y in hs_years]

    out = {"heatstrokeVs": {}}
    for key, label in (("hot_nights", "特に寝苦しい夜の日数"),
                       ("apparent_mean", "体感温度"),
                       ("t_min_mean", "夏の平均最低気温")):
        out["heatstrokeVs"][key] = {"label": label,
                                    **_corr([nat[key][i] for i in idx], hs_counts)}

    # 衛星の地表面温度も同じ土俵で比べる。ここが弱いことが分かるのが大事。
    all_years = list(wx.HIST_YEARS)
    nat_lst = national_lst_series()
    night = [float(nat_lst["nighttime"][all_years.index(y)]) for y in hs_years]
    out["heatstrokeVs"]["night_lst"] = {"label": "夜の地表面温度",
                                        **_corr(night, hs_counts)}

    # 地面と空気、どちらが速く暖まったか
    def slope(v, yrs):
        return float(np.polyfit(np.asarray(yrs, dtype="float64"), v, 1)[0] * 10)
    out["trendsPerDecade"] = {
        "night_lst": round(slope([float(nat_lst["nighttime"][all_years.index(y)])
                                  for y in hist_years], hist_years), 3),
        "day_lst": round(slope([float(nat_lst["daytime"][all_years.index(y)])
                                for y in hist_years], hist_years), 3),
        "t_min": round(slope([nat["t_min_mean"][years.index(y)] for y in hist_years],
                             hist_years), 3),
        "t_max": round(slope([nat["t_max_mean"][years.index(y)] for y in hist_years],
                             hist_years), 3),
        # 散布図の横軸に使っている「日最高と日最低の中間」。
        # 傾き（感度）と変化率（トレンド）は別物なので、同じ気温で揃えて比べられるようにする。
        "t_mean": round(slope([(nat["t_max_mean"][years.index(y)]
                                + nat["t_min_mean"][years.index(y)]) / 2
                               for y in hist_years], hist_years), 3),
        "hot_nights": round(slope([nat["hot_nights"][years.index(y)] for y in hist_years],
                                  hist_years), 2),
    }
    # 気温と地表面温度が、年ごとのブレまで一致しているか。
    # 折れ線を並べるとどちらも右肩上がりなので連動して見えるが、
    # それだけでは見せかけと区別がつかない。トレンドを除いた相関まで出す。
    air = [(nat["t_max_mean"][years.index(y)] + nat["t_min_mean"][years.index(y)]) / 2
           for y in hist_years]
    out["airVsLst"] = {}
    for dn in DAYNIGHTS:
        lst_series = [float(np.nanmean(lst[dn][all_years.index(y)])) for y in hist_years]
        out["airVsLst"][dn] = _corr(air, lst_series)

    return out


def heatstroke_block():
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


if __name__ == "__main__":
    build()
