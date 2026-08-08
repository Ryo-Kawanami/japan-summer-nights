"""まばらな観測点の値を解析グリッドに広げる。

気象データは 0.5 度刻みの 311 地点でしか持っていない。
地表面温度は 0.05 度の格子なので、そのままでは突き合わせられない。

気温は空間的になだらかなので、近い点ほど強く効く重み付き平均で十分。
凝った補間にしても、元の 0.5 度サンプリングより細かい情報は増えない。
地表面温度側の細かい構造は市街地率や土地被覆が担う。
"""

import numpy as np

# 参照する近傍点の数。多すぎると平滑化されすぎ、少なすぎると継ぎ目が出る。
K_NEIGHBORS = 4
# 逆距離の指数。2 だと近い点に寄りすぎて格子模様が出るので 1 にする。
POWER = 1.0


def _grid_coords(shape, bbox):
    h, w = shape
    lon0, lat0, lon1, lat1 = bbox
    lats = lat1 - (np.arange(h) + 0.5) / h * (lat1 - lat0)     # row 0 が北
    lons = lon0 + (np.arange(w) + 0.5) / w * (lon1 - lon0)
    return lats, lons


def build_weights(shape, bbox, site_lats, site_lons, k=K_NEIGHBORS, power=POWER):
    """格子セルごとに、どの観測点をどれだけ使うかを先に決めておく。

    年ごとに同じ計算を繰り返さないよう、重みは1回だけ作って使い回す。
    戻り値: (idx, w) いずれも (セル数, k)。w は行ごとに合計 1。
    """
    lats, lons = _grid_coords(shape, bbox)
    LA, LO = np.meshgrid(lats, lons, indexing="ij")
    cell = np.column_stack([LA.ravel(), LO.ravel()])

    # 緯度1度と経度1度の距離は違う。経度側を緯度で縮めないと東西に偏る。
    coslat = np.cos(np.deg2rad(cell[:, 0]))[:, None]
    d_lat = cell[:, 0][:, None] - site_lats[None, :]
    d_lon = (cell[:, 1][:, None] - site_lons[None, :]) * coslat
    dist = np.sqrt(d_lat ** 2 + d_lon ** 2)

    k = min(k, dist.shape[1])
    idx = np.argpartition(dist, k - 1, axis=1)[:, :k]
    near = np.take_along_axis(dist, idx, axis=1)

    # 観測点にぴったり重なるセルで 0 割りになるのを避ける
    w = 1.0 / np.maximum(near, 1e-6) ** power
    w /= w.sum(axis=1, keepdims=True)
    return idx, w


def apply_weights(values, idx, w, shape):
    """観測点の値 (地点数,) を格子 (h, w) に広げる。"""
    v = np.asarray(values, dtype="float64")
    if v.ndim != 1:
        raise ValueError(f"1次元の配列を渡すこと（今は {v.shape}）")
    out = (v[idx] * w).sum(axis=1)
    return out.reshape(shape)


def to_grid(values, shape, bbox, site_lats, site_lons):
    """重みを都度作って広げる。1回きりの用途向け。"""
    idx, w = build_weights(shape, bbox, site_lats, site_lons)
    return apply_weights(values, idx, w, shape)
