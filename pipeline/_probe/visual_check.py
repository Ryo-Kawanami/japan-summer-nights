"""数値の再確認と、地図の目視用画像の生成。

UI に手を入れる前にここを見る。フロントと同じ配色規則で描くので、
ここで見た印象がそのままサイトの印象になる。

検証済みの前提:
  - 配列の row 0 は北。上下反転は不要
  - 地理の健全性は「緯度と夜間温度の相関が負」で判定する。
    地点ごとの厳密な単調性は成り立たない（東京は都市の影響で鹿児島より夜が暑い）

出力:
  _probe/visual_check.png          実測温度(前期/後期) と 変化量 を昼夜で並べた確認用
  docs/images/change-day-night.png README 用。昼と夜の変化量を同一スケールで並べる

文字は画像に焼かない。日本語フォントの有無に依存させないため、
説明は貼り先の Markdown 側で書く。
"""

import pathlib
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import aggregate as ag  # noqa: E402
import prefectures as pref  # noqa: E402
from encode import ABS_RANGE, DIFF_RANGE  # noqa: E402
from fetch import BBOX, load_stack  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[1]
OCEAN = np.array([255, 255, 255], dtype="uint8")
SCALE = 2

# フロント（web/lib/colormap.ts）と同じ配色。ここがずれると確認の意味がなくなる。
HEAT = np.array([[255, 251, 224], [255, 217, 125], [247, 154, 60],
                 [217, 79, 40], [140, 29, 24]], dtype="float64")
DIV_MID = np.array([240.0, 239.0, 236.0])
DIV_COOL = (np.array([42.0, 120.0, 214.0]), np.array([13.0, 54.0, 107.0]))
DIV_WARM = (np.array([227.0, 73.0, 72.0]), np.array([122.0, 17.0, 19.0]))


def paint_heat(x):
    """0..1 の順序尺度を淡黄→深紅で塗る。NaN は海色。"""
    t = np.clip(np.nan_to_num(x), 0, 1) * (len(HEAT) - 1)
    i = np.clip(np.floor(t).astype(int), 0, len(HEAT) - 2)
    f = (t - i)[..., None]
    rgb = HEAT[i] * (1 - f) + HEAT[i + 1] * f
    out = rgb.astype("uint8")
    out[np.isnan(x)] = OCEAN
    return out


def paint_div(x):
    """-1..+1 の極性を青←無彩→赤で塗る。NaN は海色。"""
    v = np.clip(np.nan_to_num(x), -1, 1)
    t = np.abs(v)[..., None]
    mid_c, end_c = DIV_COOL
    mid_w, end_w = DIV_WARM
    near = np.where(v[..., None] < 0, mid_c, mid_w)
    far = np.where(v[..., None] < 0, end_c, end_w)
    brk = 0.6
    rgb = np.where(t <= brk,
                   DIV_MID * (1 - t / brk) + near * (t / brk),
                   near * (1 - (t - brk) / (1 - brk)) + far * ((t - brk) / (1 - brk)))
    out = rgb.astype("uint8")
    out[np.isnan(x)] = OCEAN
    return out


def compose(rows, gap=8):
    """2次元に並べた RGB 配列群を1枚に合成する。"""
    h, w = rows[0][0].shape[:2]
    ncol = max(len(r) for r in rows)
    W = (w * SCALE) * ncol + gap * (ncol - 1)
    H = (h * SCALE) * len(rows) + gap * (len(rows) - 1)
    canvas = Image.new("RGB", (W, H), (255, 255, 255))
    for ri, row in enumerate(rows):
        for ci, arr in enumerate(row):
            img = Image.fromarray(arr, "RGB").resize((w * SCALE, h * SCALE), Image.NEAREST)
            canvas.paste(img, (ci * (w * SCALE + gap), ri * (h * SCALE + gap)))
    return canvas


codes, _ = pref.load()
japan = codes > 0

data = {}
for daynight in ("daytime", "nighttime"):
    years, raw = load_stack(daynight)
    stack = np.where(japan[None], ag.to_celsius(raw), np.nan)
    data[daynight] = (years, stack)

# --- 地理の健全性 ---
years, night = data["nighttime"]
late_n = ag.period_mean(years, night, *ag.LATE)
lon0, lat0, lon1, lat1 = BBOX
H, W = late_n.shape
print("=== 地理の健全性チェック（夜・2020-2024 の実測温度）===")
for name, lon, lat in [("那覇", 127.7, 26.2), ("鹿児島", 130.5, 31.6), ("東京", 139.7, 35.7),
                       ("札幌", 141.35, 43.06), ("稚内", 141.7, 45.4)]:
    r = min(int((lat1 - lat) / (lat1 - lat0) * H), H - 1)
    c = min(int((lon - lon0) / (lon1 - lon0) * W), W - 1)
    print(f"  {name:6s} {late_n[r, c]:5.1f}℃")
rr, _cc = np.mgrid[0:H, 0:W]
lat_grid = lat1 - (rr + 0.5) / H * (lat1 - lat0)
valid = ~np.isnan(late_n)
corr = float(np.corrcoef(lat_grid[valid], late_n[valid])[0, 1])
south = float(np.nanmean(late_n[lat_grid < 33]))
north = float(np.nanmean(late_n[lat_grid > 40]))
print(f"  緯度との相関 r={corr:+.2f}  北緯33度以南 {south:.1f}℃ / 40度以北 {north:.1f}℃")
print("  → 向きは正しい" if corr < -0.5 and south > north
      else "  ⚠ 南北の関係が壊れている。配列の向きを疑うこと")

# --- 数値と画像 ---
lo, hi = ABS_RANGE
rows, diffs = [], {}
for daynight, label in (("daytime", "昼"), ("nighttime", "夜")):
    years, stack = data[daynight]
    early = ag.period_mean(years, stack, *ag.EARLY)
    late = ag.period_mean(years, stack, *ag.LATE)
    diff = late - early
    diffs[daynight] = diff

    slope, r_, t_ = ag.linear_trend(years, ag.national_series(stack))
    land = diff[~np.isnan(diff)]
    print(f"\n=== {label} ===")
    print(f"  実測 {ag.national_mean(early):5.2f}℃ → {ag.national_mean(late):5.2f}℃ "
          f"（{ag.national_mean(diff):+.2f}℃）")
    print(f"  地図内の空間差（1〜99%タイル）{np.nanpercentile(late, 99) - np.nanpercentile(late, 1):.1f}℃"
          f"  ← 時間変化 {ag.national_mean(diff):+.2f}℃ と比べること")
    print(f"  トレンド {slope:+.3f}℃/10年  t={t_:+.2f} "
          f"{'有意' if abs(t_) > 2.07 else '有意でない'}  上昇した陸地 {100*(land > 0).mean():.1f}%")

    rows.append([paint_heat((early - lo) / (hi - lo)),
                 paint_heat((late - lo) / (hi - lo)),
                 paint_div(diff / DIFF_RANGE)])

out = ROOT / "visual_check.png"
compose(rows).save(out)
print(f"\nsaved {out}")
print("  1段目=昼 / 2段目=夜、左から 前期の実測・後期の実測・変化量")

fig_dir = REPO / "docs" / "images"
fig_dir.mkdir(parents=True, exist_ok=True)
fig = fig_dir / "change-day-night.png"
compose([[paint_div(diffs["daytime"] / DIFF_RANGE),
          paint_div(diffs["nighttime"] / DIFF_RANGE)]], gap=16).save(fig)
print(f"saved {fig}  （README 用。左=昼の変化量、右=夜の変化量、同一スケール ±{DIFF_RANGE}℃）")
