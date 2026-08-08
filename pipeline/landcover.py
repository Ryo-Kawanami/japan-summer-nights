"""土地被覆から、解析グリッドの各セルの「市街地率」を作る。

夜間の気温上昇には都市化（ヒートアイランド）の寄与が混ざっている。
それを切り分けるための説明変数として、5km セルごとに市街地が占める割合を求める。

データ: JAXA.EORC_ALOS_HRLULC.v25.04_japan（10m 解像度の日本の土地被覆図）
        年は 2020 / 2022 / 2024 の3時点しかないので、
        「25年でどれだけ都市化したか」は測れない。測れるのは
        「いま都市であるかどうか」だけ。この限界は結論の書き方に効く。

クラス定義（JAXA EORC 公開の凡例）:
  1 Water  2 Built-up  3 Paddy  4 Cropland  5 Grassland
  6 DBF  7 DNF  8 EBF  9 ENF  10 Bare  11 Bamboo  12 Solar panel
  0 はデータなし。

土地被覆は分類値なので、粗いグリッドへ落とすときに平均してはいけない。
（クラス2とクラス4の平均はクラス3で、意味が変わる。）
細かい画素を数えて「市街地の割合」という連続量に変換する。
"""

import pathlib

import numpy as np

from fetch import BBOX, PPU

BUILT_UP = 2
WATER = 1
NODATA = 0

COLLECTION = "JAXA.EORC_ALOS_HRLULC.v25.04_japan"
YEAR = 2024
FINE_PPU = 90          # 要求 100 に対し配信側が返す実効解像度。約 1.2km

CACHE = pathlib.Path(__file__).resolve().parent / "cache"
OUT = CACHE / f"urban_fraction_ppu{PPU}_from{FINE_PPU}.npy"


def _fetch_fine():
    from jaxa.earth import je

    d = (je.ImageCollection(collection=COLLECTION)
           .filter_date([f"{YEAR}-01-01T00:00:00", f"{YEAR}-12-31T00:00:00"])
           .filter_resolution(ppu=FINE_PPU)
           .filter_bounds(bbox=BBOX)
           .select("HRLULC")
           .get_images())
    return np.array(d.raster.img)[0, :, :, 0]


def build(verbose=True):
    """(緯度, 経度) の市街地率 [0,1] を返す。陸の画素が無いセルは NaN。"""
    fine = _fetch_fine()
    fh, fw = fine.shape
    lon0, lat0, lon1, lat1 = BBOX
    ch = int(round((lat1 - lat0) * PPU))
    cw = int(round((lon1 - lon0) * PPU))

    # 細かい画素それぞれが属する粗いセルを座標から決める。
    # 解像度比が整数とは限らないので、ブロック分割ではなく添字計算で寄せる。
    rows = np.minimum((np.arange(fh) * ch // fh), ch - 1)
    cols = np.minimum((np.arange(fw) * cw // fw), cw - 1)
    cell = rows[:, None] * cw + cols[None, :]

    land = (fine != NODATA) & (fine != WATER)   # 水域は分母から外す
    built = land & (fine == BUILT_UP)

    n_land = np.bincount(cell[land], minlength=ch * cw).astype("float64")
    n_built = np.bincount(cell[built], minlength=ch * cw).astype("float64")

    with np.errstate(invalid="ignore", divide="ignore"):
        frac = np.where(n_land > 0, n_built / n_land, np.nan)
    frac = frac.reshape(ch, cw)

    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(OUT, frac)
    if verbose:
        v = frac[~np.isnan(frac)]
        print(f"市街地率 {frac.shape}  有効セル {v.size}  "
              f"中央値 {np.median(v):.3f}  90%タイル {np.percentile(v, 90):.3f}  "
              f"最大 {v.max():.3f}")
    return frac


def load():
    if OUT.exists():
        return np.load(OUT)
    return build()


if __name__ == "__main__":
    build()
