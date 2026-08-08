"""気温・湿度を Open-Meteo から取得する。過去は再解析、将来は気候予測。

衛星が測るのは地表面温度で、人が感じる気温とは別の量。両者を並べるために
同じ夏（6〜8月）で気象データを揃える。

## 過去 — ERA5 再解析（archive-api）
  観測を物理モデルに同化した格子データ。観測点のない場所でも値がある。

## 将来 — CMIP6 / MRI_AGCM3_2_S（climate-api）
  気象庁気象研究所の全球モデル（約20km）。2050年まで。日本が対象なので
  日本のモデルを選んだ。

  注意: 将来側の API は apparent_temperature（体感温度）が null を返す。
  体感の指標は自前で計算し、過去期間で ERA5 の値と突き合わせて検証する。

## 取得コストの設計（ここが一番の制約）
  Open-Meteo の利用枠は「地点数 × 変数 × 日数」で重み付けされる。
  最初に 912地点 × 7変数 × 92日 で取りに行って毎時上限に当たった。
  用途ごとに必要最小限まで削る。

  - grid: ML のダウンスケーリング用。夏平均さえあればよいので変数は2つ。
          気温は空間的になだらかなので 0.5 度刻みで足りる。
          細かい構造は市街地率や土地被覆が担う
  - pref: 熱帯夜・猛暑日・体感温度用。日別の最高最低が要るが、
          都道府県ごとに1点あればよい（搬送者数の集計単位と揃う）
"""

import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np

import prefectures as pref
from fetch import BBOX, PPU

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
CLIMATE_URL = "https://climate-api.open-meteo.com/v1/climate"
CLIMATE_MODEL = "MRI_AGCM3_2_S"

GRID_STEP = 0.5             # 度。ML の入力にする気温場のサンプリング間隔
BATCH = 100
CONCURRENCY = 3             # 毎時上限に当たったので絞る
HIST_YEARS = range(2000, 2025)
FUTURE_YEARS = range(2025, 2051)
SUMMER = ("06-01", "08-31")

# 用途ごとに変数を絞る。1変数増やすと取得コストがそのぶん増える。
GRID_VARS = ["temperature_2m_mean", "relative_humidity_2m_mean"]
PREF_VARS = ["temperature_2m_max", "temperature_2m_min", "relative_humidity_2m_mean"]
PREF_HIST_EXTRA = ["apparent_temperature_mean"]   # 自前の体感式を検算するため

CACHE = pathlib.Path(__file__).resolve().parent / "cache" / "weather"


def grid_points():
    """日本の陸地を含む GRID_STEP 度格子の代表点。順序は固定。"""
    codes, _ = pref.load()
    japan = codes > 0
    lon0, lat0, lon1, lat1 = BBOX
    H, W = codes.shape
    half = int(GRID_STEP * PPU / 2)

    lats, lons = [], []
    for la in np.arange(lat0 + GRID_STEP / 2, lat1, GRID_STEP):
        for lo in np.arange(lon0 + GRID_STEP / 2, lon1, GRID_STEP):
            r = int((lat1 - la) / (lat1 - lat0) * H)
            c = int((lo - lon0) / (lon1 - lon0) * W)
            rr = slice(max(0, r - half), min(H, r + half + 1))
            cc = slice(max(0, c - half), min(W, c + half + 1))
            if japan[rr, cc].any():
                lats.append(round(float(la), 4))
                lons.append(round(float(lo), 4))
    return np.array(lats), np.array(lons)


# 県庁所在地の座標（コード順）。県の重心を使うと、島嶼部を持つ県で
# 人の住まない場所が代表点になる（東京都の重心は伊豆諸島に落ちた）。
# 熱中症搬送者数と突き合わせる以上、人口が集まる場所を代表にする。
CAPITALS = [
    ("札幌", 43.064, 141.347), ("青森", 40.824, 140.740), ("盛岡", 39.704, 141.153),
    ("仙台", 38.269, 140.872), ("秋田", 39.719, 140.102), ("山形", 38.240, 140.364),
    ("福島", 37.750, 140.468), ("水戸", 36.342, 140.447), ("宇都宮", 36.566, 139.884),
    ("前橋", 36.391, 139.061), ("さいたま", 35.857, 139.649), ("千葉", 35.605, 140.123),
    ("新宿", 35.690, 139.692), ("横浜", 35.448, 139.643), ("新潟", 37.902, 139.023),
    ("富山", 36.695, 137.211), ("金沢", 36.595, 136.626), ("福井", 36.065, 136.222),
    ("甲府", 35.664, 138.568), ("長野", 36.651, 138.181), ("岐阜", 35.391, 136.722),
    ("静岡", 34.977, 138.383), ("名古屋", 35.180, 136.907), ("津", 34.730, 136.509),
    ("大津", 35.005, 135.869), ("京都", 35.021, 135.756), ("大阪", 34.686, 135.520),
    ("神戸", 34.691, 135.183), ("奈良", 34.685, 135.833), ("和歌山", 34.226, 135.167),
    ("鳥取", 35.504, 134.238), ("松江", 35.472, 133.051), ("岡山", 34.662, 133.935),
    ("広島", 34.397, 132.460), ("山口", 34.186, 131.471), ("徳島", 34.066, 134.559),
    ("高松", 34.340, 134.043), ("松山", 33.842, 132.766), ("高知", 33.560, 133.531),
    ("福岡", 33.607, 130.418), ("佐賀", 33.249, 130.300), ("長崎", 32.745, 129.874),
    ("熊本", 32.790, 130.742), ("大分", 33.238, 131.613), ("宮崎", 31.911, 131.424),
    ("鹿児島", 31.560, 130.558), ("那覇", 26.212, 127.681),
]


def prefecture_points(verbose=False):
    """県庁所在地の座標をコード順（1〜47）で返す。

    5km 格子では海岸の都市が隣県や海のセルに落ちることがある。
    その場合だけ、その県の陸画素で最も近いものへ寄せる。
    """
    codes, names = pref.load()
    lon0, lat0, lon1, lat1 = BBOX
    H, W = codes.shape
    if len(CAPITALS) != pref.N_PREF:
        raise RuntimeError(f"県庁所在地の表が {len(CAPITALS)} 件しかない")

    lats, lons, moved = [], [], []
    for code, (city, la, lo) in enumerate(CAPITALS, start=1):
        r = int((lat1 - la) / (lat1 - lat0) * H)
        c = int((lo - lon0) / (lon1 - lon0) * W)
        if not (0 <= r < H and 0 <= c < W) or codes[r, c] != code:
            rr, cc = np.nonzero(codes == code)
            k = np.argmin((rr - r) ** 2 + (cc - c) ** 2)
            r, c = int(rr[k]), int(cc[k])
            la = lat1 - (r + 0.5) / H * (lat1 - lat0)
            lo = lon0 + (c + 0.5) / W * (lon1 - lon0)
            moved.append(city)
        lats.append(round(float(la), 4))
        lons.append(round(float(lo), 4))
    if verbose and moved:
        print(f"  5km格子の都合で寄せた地点: {'、'.join(moved)}")
    return np.array(lats), np.array(lons)


def _get(url, params, retries=6):
    """GET してJSONを返す。毎時上限に当たったら次の時間帯まで待つ。"""
    query = urllib.parse.urlencode(params, safe=",")
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(f"{url}?{query}", timeout=300) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == retries - 1:
                raise
            body = e.read().decode("utf-8", "ignore")
            low = body.lower()
            # 日次上限はその日のうちには明けない。待っても無駄に叩くだけなので
            # 即座に上げる。1分待ちで回し続けて相手に負荷をかけたことがある。
            if "daily" in low:
                raise RuntimeError(
                    "Open-Meteo の日次上限に達した。明日まで取得できない: "
                    + body[:120]) from e
            # 「毎時」の上限は数十秒待っても明けない。素直に長く寝る。
            wait = 15 * 60 if "hourly" in low else 60
            print(f"    上限に当たった。{wait//60}分待つ: {body[:90]}", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
            time.sleep(20 * (attempt + 1))
    raise RuntimeError("到達しない")


def _fetch_batch(url, hist, daily, year, lats, lons):
    params = {
        "latitude": ",".join(f"{v:g}" for v in lats),
        "longitude": ",".join(f"{v:g}" for v in lons),
        "start_date": f"{year}-{SUMMER[0]}",
        "end_date": f"{year}-{SUMMER[1]}",
        "daily": ",".join(daily),
    }
    if hist:
        params["timezone"] = "Asia/Tokyo"
    else:
        params["models"] = CLIMATE_MODEL
    res = _get(url, params)
    return [res] if isinstance(res, dict) else res


def variables(target, hist):
    if target == "grid":
        return list(GRID_VARS)
    # 気候モデルの過去（model_hist）は将来と同じ変数構成にする。
    # 体感温度は気候モデル側に無いので、hist（ERA5）のときだけ足す。
    return PREF_VARS + (PREF_HIST_EXTRA if hist else [])


def is_reanalysis(kind):
    """ERA5（再解析）か、気候モデルか。

    kind="model_hist" は気候モデルの過去期間。再解析と同じ年を、
    モデル自身の値で押さえるために取る。これが無いと差分法が使えない。
    """
    return kind == "hist"


def cache_path(target, kind, year):
    return CACHE / target / kind / f"{year}.npz"


def fetch_year(target, kind, year, lats, lons, verbose=True):
    hist = is_reanalysis(kind)
    daily = variables(target, hist)
    url = ARCHIVE_URL if hist else CLIMATE_URL
    chunks = [(i, lats[i:i + BATCH], lons[i:i + BATCH])
              for i in range(0, len(lats), BATCH)]

    results = {}
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(_fetch_batch, url, hist, daily, year, la, lo): i
                   for i, la, lo in chunks}
        for f in as_completed(futures):
            results[futures[f]] = f.result()

    # 地点の順序がキャッシュの意味を決めるので、必ず投入順に並べ直す。
    per_var = {v: [] for v in daily}
    for i, _, _ in chunks:
        for site in results[i]:
            d = site["daily"]
            for v in daily:
                key = v if v in d else f"{v}_{CLIMATE_MODEL}"
                per_var[v].append(np.array(d[key], dtype="float32"))

    arrs = {v: np.stack(per_var[v]) for v in daily}
    n = arrs[daily[0]].shape[0]
    if n != len(lats):
        raise RuntimeError(f"{target}/{kind} {year}: 地点数が合わない ({n} != {len(lats)})")
    if verbose:
        v0 = arrs[daily[0]]
        print(f"  {target}/{kind} {year}: 地点{n} 日{v0.shape[1]} "
              f"{daily[0]}平均 {np.nanmean(v0):.2f}", flush=True)
    return arrs


def load_or_fetch(target, kind, year, lats, lons, verbose=True):
    p = cache_path(target, kind, year)
    if p.exists():
        z = np.load(p)
        return {k: z[k] for k in z.files}
    p.parent.mkdir(parents=True, exist_ok=True)
    arrs = fetch_year(target, kind, year, lats, lons, verbose)
    np.savez_compressed(p, **arrs)
    return arrs


def load_points(target):
    z = np.load(CACHE / f"points_{target}.npz")
    return z["lats"], z["lons"]


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    points = {"grid": grid_points(), "pref": prefecture_points()}
    for target, (la, lo) in points.items():
        np.savez_compressed(CACHE / f"points_{target}.npz", lats=la, lons=lo)
        print(f"{target}: {len(la)} 地点", flush=True)

    # 都道府県点を先に片づける。軽いうえ、体感・熱帯夜の分析がすぐ始められる。
    # model_hist は気候モデルの過去期間。再解析との系統差を測って差分法で
    # 打ち消すために要る。これが無いと将来の絶対値をそのまま出すことになり、
    # 都市部で「翌年から涼しくなる」という嘘の絵になる。
    for target in ("pref", "grid"):
        la, lo = points[target]
        kinds = (("hist", HIST_YEARS), ("model_hist", HIST_YEARS), ("future", FUTURE_YEARS))
        if target == "grid":
            kinds = (("hist", HIST_YEARS), ("future", FUTURE_YEARS))
        for kind, years in kinds:
            print(f"=== {target} / {kind} ===", flush=True)
            for year in years:
                try:
                    load_or_fetch(target, kind, year, la, lo)
                except Exception as e:
                    print(f"  失敗 {target}/{kind} {year}: {type(e).__name__}: {e}",
                          flush=True)


if __name__ == "__main__":
    main()
