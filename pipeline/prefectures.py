"""都道府県ポリゴンを解析グリッドと同じ形のコードラスタに焼く。

出典: 地球地図日本（国土地理院）を dataofjapan/land が GeoJSON に変換したもの。
      非営利利用は出典明記のみで可。アプリ内に必ずクレジットを出すこと。

出力は (緯度, 経度) の uint8。値は都道府県コード 1-47、0 は「日本の陸地でない」。
これが日本以外（韓国・ロシア・中国大陸）を地図から落とすマスクも兼ねる。

5km 画素なのでポリゴンの穴（飛地の内側など）は無視する。表示に影響しない。
"""

import json
import pathlib
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

from fetch import BBOX, PPU

GEOJSON_URL = "https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson"
GEO_DIR = pathlib.Path(__file__).resolve().parent / "geo"
GEOJSON = GEO_DIR / "japan.geojson"
RASTER = GEO_DIR / "prefecture_codes.npy"
NAMES = GEO_DIR / "prefecture_names.json"

N_PREF = 47
# 解像度を上げて焼いてから縮小すると、5km 画素より細い島（南西諸島など）が
# 消えずに残る。等倍で焼くと与那国や宮古が丸ごと落ちる。
OVERSAMPLE = 4


def grid_shape():
    lon0, lat0, lon1, lat1 = BBOX
    return int(round((lat1 - lat0) * PPU)), int(round((lon1 - lon0) * PPU))


def download():
    if GEOJSON.exists():
        return GEOJSON
    GEO_DIR.mkdir(parents=True, exist_ok=True)
    print(f"地球地図日本の GeoJSON を取得中 ... {GEOJSON_URL}")
    urllib.request.urlretrieve(GEOJSON_URL, GEOJSON)
    return GEOJSON


def _rings(geometry):
    """Polygon / MultiPolygon から外周リングだけを取り出す。"""
    kind = geometry["type"]
    coords = geometry["coordinates"]
    if kind == "Polygon":
        yield coords[0]
    elif kind == "MultiPolygon":
        for poly in coords:
            yield poly[0]
    else:
        raise ValueError(f"未対応のジオメトリ: {kind}")


def build():
    download()
    data = json.loads(GEOJSON.read_text())
    H, W = grid_shape()
    lon0, lat0, lon1, lat1 = BBOX
    S = OVERSAMPLE

    canvas = Image.new("L", (W * S, H * S), 0)
    draw = ImageDraw.Draw(canvas)
    names = {}

    for feat in data["features"]:
        code = int(feat["properties"]["id"])
        if not 1 <= code <= N_PREF:
            raise ValueError(f"都道府県コードが範囲外: {code}")
        names[code] = feat["properties"]["nam_ja"]
        for ring in _rings(feat["geometry"]):
            pts = [(((lon - lon0) / (lon1 - lon0)) * W * S,
                    ((lat1 - lat) / (lat1 - lat0)) * H * S)     # row 0 が北
                   for lon, lat in ring]
            if len(pts) >= 3:
                draw.polygon(pts, fill=code)

    # 縮小は最近傍で。平均するとコードが混ざって存在しない県番号ができる。
    small = np.array(canvas.resize((W, H), Image.NEAREST), dtype="uint8")

    GEO_DIR.mkdir(parents=True, exist_ok=True)
    np.save(RASTER, small)
    NAMES.write_text(json.dumps(names, ensure_ascii=False, indent=1), encoding="utf-8")

    found = sorted(set(np.unique(small)) - {0})
    missing = [c for c in range(1, N_PREF + 1) if c not in found]
    print(f"ラスタ {small.shape}  陸画素={int((small > 0).sum())}  "
          f"県数={len(found)}/{N_PREF}")
    if missing:
        print(f"  ⚠ 画素が1つも割り当たらなかった県: "
              f"{[names.get(c, c) for c in missing]}")
    return small, names


def load():
    if not RASTER.exists():
        return build()
    return np.load(RASTER), json.loads(NAMES.read_text(encoding="utf-8"))


if __name__ == "__main__":
    build()
