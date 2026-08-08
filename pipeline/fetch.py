"""JAXA Earth API から夏（6-8月）平均の地表面温度グリッドを取得する。

1年あたり数十秒かかるので、取得済みの年はキャッシュから読んで再取得しない。
途中で落ちても再実行すれば続きから進む。

検証済みの API の癖:
  - 配列は d.raster.img にある。d.img は存在しない
  - 形状は (時間, 緯度, 経度, バンド)。row 0 は北
  - filter_date の終端は含む。06-01〜08-01 で 6・7・8月の3枚が返る
  - 2025-06 以降を渡すと Exception: Error! No date list found! で落ちる
  - 戻り値の cinfo は ColorInfo の ndarray。numpy 関数をかけると TypeError
"""

import pathlib
import sys

import numpy as np

COLLECTION = ("NASA.EOSDIS_Terra.MODIS_MOD11C3-LST."
              "{daynight}.v061_global_monthly")

# 沖縄（26N, 127E）と与那国（122.9E）を含む。小笠原・南鳥島は 5km 画素では
# ほぼ捉えられず、含めると地図がほぼ海になるので範囲外にする。
BBOX = [122.0, 24.0, 146.0, 46.0]
PPU = 20                      # 1度あたりの画素数 → 0.05度 ≒ 5km
YEARS = range(2000, 2025)     # 2025年の夏は未配信
SUMMER = ("06-01", "08-01")   # 終端を含むので 6・7・8月

CACHE = pathlib.Path(__file__).resolve().parent / "cache"


def cache_path(year, daynight):
    lo, la0, hi, la1 = BBOX
    tag = f"{lo:g}_{la0:g}_{hi:g}_{la1:g}_ppu{PPU}"
    return CACHE / tag / daynight / f"{year}.npy"


def fetch_year(year, daynight):
    """1年分の夏平均グリッド (緯度, 経度) をケルビンで返す。"""
    from jaxa.earth import je

    start, end = SUMMER
    d = (je.ImageCollection(collection=COLLECTION.format(daynight=daynight))
           .filter_date([f"{year}-{start}T00:00:00", f"{year}-{end}T00:00:00"])
           .filter_resolution(ppu=PPU)
           .filter_bounds(bbox=BBOX)
           .select("LST")
           .get_images())
    img = np.array(d.raster.img, dtype="float32")[..., 0]   # (月, 緯度, 経度)
    if img.shape[0] != 3:
        raise RuntimeError(f"{year}/{daynight}: 3ヶ月そろっていない ({img.shape[0]}ヶ月)")
    return np.nanmean(img, axis=0)


def load_or_fetch(year, daynight, verbose=True):
    p = cache_path(year, daynight)
    if p.exists():
        return np.load(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    grid = fetch_year(year, daynight)
    np.save(p, grid)
    if verbose:
        land = int(np.sum(~np.isnan(grid)))
        print(f"  取得 {year}/{daynight}: shape={grid.shape} 陸画素={land} "
              f"平均={np.nanmean(grid) - 273.15:.2f}℃", flush=True)
    return grid


def load_stack(daynight):
    """全年のグリッドを (年数, 緯度, 経度) に積んで、年配列とともに返す。"""
    years = np.array(list(YEARS))
    stack = np.stack([load_or_fetch(y, daynight, verbose=False) for y in years])
    return years, stack


def main():
    targets = sys.argv[1:] or ["daytime", "nighttime"]
    for daynight in targets:
        print(f"=== {daynight} ===", flush=True)
        done = 0
        for year in YEARS:
            try:
                load_or_fetch(year, daynight)
                done += 1
            except Exception as e:
                print(f"  失敗 {year}/{daynight}: {type(e).__name__}: {e}", flush=True)
        print(f"  {done}/{len(list(YEARS))} 年ぶん用意できた", flush=True)


if __name__ == "__main__":
    main()
