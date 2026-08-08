"""5km格子分の気象を取得する。build_grid_future.py の前段。

pref（県庁所在地47地点）と違い、格子は311地点なので取得量が3倍以上になる。
Open-Meteo の日次上限に当たったら中断するが、年ごとにキャッシュするので
再実行すれば続きから進む。

取る順は学習に要る順。途中で枠が尽きても、揃った系統だけで先へ進められる。
  hist       ML の学習（ERA5）
  future     予測の入力（CMIP6）
  model_hist 差分法の補正（CMIP6 の過去期間）
"""

import sys, time
sys.path.insert(0, "pipeline")
import weather as wx

lats, lons = wx.load_points("grid")
print(f"grid {len(lats)} 地点", flush=True)

# 学習に要る順に取る。途中で枠が尽きても、前の系統だけで先に進める。
plan = ([("hist", y) for y in wx.HIST_YEARS]
        + [("future", y) for y in wx.FUTURE_YEARS]
        + [("model_hist", y) for y in wx.HIST_YEARS])
todo = [(k, y) for k, y in plan if not wx.cache_path("grid", k, y).exists()]
print(f"取得対象 {len(todo)} 件", flush=True)

t0 = time.time()
done = 0
for kind, year in todo:
    try:
        wx.load_or_fetch("grid", kind, year, lats, lons)
        done += 1
    except Exception as e:
        print(f"  中断 {kind} {year}: {str(e)[:130]}", flush=True)
        print(f"  ここまで {done}/{len(todo)} 件。再実行すれば続きから進む。", flush=True)
        break
print(f"完了 {done}/{len(todo)} 件 {(time.time()-t0)/60:.0f}分", flush=True)
