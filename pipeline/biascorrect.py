"""気候モデルと再解析の系統差を打ち消す（差分法）。

## なぜ要るか
  将来の気温は気候モデル（MRI_AGCM3_2_S、約20km格子）から、
  過去の気温は再解析（ERA5）から取っている。両者は別のデータで、
  同じ場所でも系統的にずれる。実測すると、都市ほどずれが大きかった。

    東京の夏の平均最低気温  2024年 ERA5 23.07℃ → 2025年 MRI 22.24℃

  気候変動で上がるはずのところが、境界で 0.83℃ 下がる。
  20km格子のモデルは東京のヒートアイランドを ERA5 ほど解像しないためで、
  これは将来が涼しいのではなく、物差しが違うだけ。
  補正せずに出せば「2025年から涼しくなる」という嘘の絵になる。

## やること
  モデルの絶対値は使わず、モデル自身の基準期間からの変化量だけを使う。

    補正後(年) = 実測の基準値 + ( モデル(年) − モデルの基準値 )

  同じことだが実装は「モデルの値から、モデルと実測の差を引く」。
  地点ごと・変数ごとに1つのずれを求めて、日次の全部から引く。

## 前提
  ずれが期間を通じて一定であること。気温の差分法では標準的な仮定だが、
  分布の形まで合わせるわけではない（分位マッピングならそこまでやる）。
  日数の指標はしきい値をまたぐ回数なので、分布の形にも影響される。
  そこまで踏み込まないことは限界として書き出す。
"""

import numpy as np


def offsets(model_baseline, obs_baseline):
    """地点ごとのずれ（モデル − 実測）を返す。

    どちらも (年, 地点, 日) か (地点, 日) の配列の並び。
    戻り値は (地点,)。
    """
    m = np.concatenate([np.asarray(a) for a in model_baseline], axis=-1)
    o = np.concatenate([np.asarray(a) for a in obs_baseline], axis=-1)
    if m.shape[0] != o.shape[0]:
        raise ValueError(f"地点数が合わない ({m.shape[0]} != {o.shape[0]})")
    return np.nanmean(m, axis=-1) - np.nanmean(o, axis=-1)


def apply(daily, offset):
    """モデルの日次データからずれを引く。offset は (地点,)。"""
    d = np.asarray(daily, dtype="float64")
    off = np.asarray(offset, dtype="float64")
    if off.shape[0] != d.shape[0]:
        raise ValueError(f"地点数が合わない ({off.shape[0]} != {d.shape[0]})")
    return d - off[:, None]


def report(offset, names=None, top=5):
    """ずれの大きい地点を並べる。補正の効き具合を人の目で見るため。"""
    order = np.argsort(-np.abs(offset))[:top]
    rows = []
    for i in order:
        rows.append({
            "index": int(i),
            "name": names[i] if names is not None else str(i),
            "offset": round(float(offset[i]), 3),
        })
    return {
        "mean": round(float(np.nanmean(offset)), 3),
        "abs_mean": round(float(np.nanmean(np.abs(offset))), 3),
        "max_abs": round(float(np.nanmax(np.abs(offset))), 3),
        "largest": rows,
    }
