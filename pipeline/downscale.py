"""気象から地表面温度を推定する変換関数を学習し、2050年まで年ごとに予測する。

## なぜ「時系列の外挿」ではないのか
  地表面温度そのものを年で外挿すると、学習点が25個しかない直線当てはめに
  もっともらしい名前を付けただけになる。ここでやるのはダウンスケーリングで、
  「その年の気温・湿度と、その土地の性質から、地表面温度がいくらになるか」
  という関係を学ぶ。年は説明変数に入れない。
  将来は気候モデルの気温・湿度を入れて、同じ関係を適用する。

  この形なら、予測の当否は「関係が将来も成り立つか」に絞られる。
  年で外挿する場合の「25年の傾きが26年先まで続くか」より検証しやすい。

## 木モデルの落とし穴
  勾配ブースティングは学習データの範囲外を外挿できない。入力が学習時の最大を
  超えると、予測は頭打ちになる。2050年の気温が過去に一度も無い値なら、
  暑さを過小評価する。

  ただし今回は空間の広がりが効く可能性がある。いまの九州の暑さが2050年の
  関東に相当するなら、モデルにとっては「見たことのある値」になる。
  これは思い込みで判断せず coverage_report() で実際に数える。
  範囲外が多ければ線形モデルに寄せる。

## 検証
  - 年をまたいだ交差検証（年で分割。同じ年のセル同士は似ているので、
    セル単位でランダム分割すると精度を過大評価する）
  - 暖かい年の抜き取り（2000-2019で学習し2020-2024を当てる）。
    これは「見たことのない暖かさ」への転移そのもので、将来予測の予行になる
"""

import numpy as np

# 説明変数の順序。ここを変えたら学習済み係数は使えない。
FEATURES = [
    "air_temp",        # 夏平均気温 ℃
    "humidity",        # 夏平均相対湿度 %
    "urban",           # 市街地率 0-1
    "lat",             # 緯度。日射の入り方が変わる
    "vapor",           # 水蒸気圧 hPa。蒸し暑さは湿度そのものより水の量で効く
]


def vapor_pressure(temp_c, rh_percent):
    """Magnus 式。気温と相対湿度から水蒸気圧(hPa)を出す。"""
    e_sat = 6.105 * np.exp(17.27 * temp_c / (237.7 + temp_c))
    return rh_percent / 100.0 * e_sat


def build_features(air_temp, humidity, urban, lat):
    """(N, 特徴量数) の行列を作る。入力はすべて同じ形の配列。"""
    return np.column_stack([
        np.ravel(air_temp),
        np.ravel(humidity),
        np.ravel(urban),
        np.ravel(lat),
        np.ravel(vapor_pressure(np.asarray(air_temp), np.asarray(humidity))),
    ])


def coverage_report(X_train, X_future):
    """将来の入力が学習範囲に収まっているかを特徴量ごとに数える。

    木モデルは範囲外を外挿できないので、ここが予測の信頼性を決める。
    戻り値: 特徴量名 → {"below": 割合, "above": 割合, "train_min", "train_max"}
    """
    report = {}
    for i, name in enumerate(FEATURES):
        lo, hi = np.nanmin(X_train[:, i]), np.nanmax(X_train[:, i])
        col = X_future[:, i]
        ok = ~np.isnan(col)
        n = max(ok.sum(), 1)
        report[name] = {
            "below": float((col[ok] < lo).sum() / n),
            "above": float((col[ok] > hi).sum() / n),
            "train_min": float(lo),
            "train_max": float(hi),
            "future_min": float(np.nanmin(col)),
            "future_max": float(np.nanmax(col)),
        }
    return report


def fit_linear(X, y):
    """線形回帰。範囲外でも素直に伸びるので、外挿の基準線として置く。"""
    A = np.column_stack([X, np.ones(len(X))])
    ok = ~np.isnan(A).any(axis=1) & ~np.isnan(y)
    coef, *_ = np.linalg.lstsq(A[ok], y[ok], rcond=None)
    return coef


def predict_linear(coef, X):
    return np.column_stack([X, np.ones(len(X))]) @ coef


def _scores(y_true, y_pred):
    ok = ~np.isnan(y_true) & ~np.isnan(y_pred)
    yt, yp = y_true[ok], y_pred[ok]
    ss_res = ((yt - yp) ** 2).sum()
    ss_tot = ((yt - yt.mean()) ** 2).sum()
    return {
        "r2": float(1 - ss_res / ss_tot),
        "rmse": float(np.sqrt((( yt - yp) ** 2).mean())),
        "mae": float(np.abs(yt - yp).mean()),
        "bias": float((yp - yt).mean()),
        "n": int(ok.sum()),
    }


def year_block_cv(X, y, years, fit, predict, n_blocks=5):
    """年をまとめて抜く交差検証。

    同じ年のセル同士は強く似ているので、セル単位でランダムに分けると
    「ほぼ同じ行が学習側にもある」状態になり、精度を過大評価する。
    """
    uniq = np.unique(years)
    blocks = np.array_split(uniq, n_blocks)
    out = []
    for held in blocks:
        te = np.isin(years, held)
        tr = ~te
        model = fit(X[tr], y[tr])
        out.append({"years": [int(v) for v in held], **_scores(y[te], predict(model, X[te]))})
    return out


def warm_year_holdout(X, y, years, fit, predict, split_year=2020):
    """暖かい年を抜き取り、見たことのない暖かさへ転移できるかを見る。

    将来予測の予行。ここで大きく外すなら、2050年の値は信用できない。
    """
    tr = years < split_year
    te = years >= split_year
    if not te.any() or not tr.any():
        raise ValueError(f"{split_year} で分けると片側が空になる")
    model = fit(X[tr], y[tr])
    return {
        "train_years": [int(years[tr].min()), int(years[tr].max())],
        "test_years": [int(years[te].min()), int(years[te].max())],
        **_scores(y[te], predict(model, X[te])),
    }
