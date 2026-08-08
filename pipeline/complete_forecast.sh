#!/usr/bin/env bash
# 2050年予測を完成させる。Open-Meteo の日次上限が明けてから実行する。
#
# 足りないのは「気候モデルの過去期間（model_hist）」だけ。
# これが無いと気候モデルと再解析の系統差を測れず、差分法の補正ができない。
# 補正しないと都市部で「翌年から涼しくなる」という嘘の絵になるため、
# build_pref_future.py は将来の数字を出さないようになっている。
#
# 取得量は 47地点 × 25年 = 25リクエストと小さい。
# 走らせる前に、他の取得プロセスが動いていないことを確認すること。
# 並行して走らせると利用枠を食い合う（一度やった）。
set -euo pipefail
cd "$(dirname "$0")/.."

# 自動実行から毎日呼ばれるので、済んでいたら何もしない。
# 完了後も枠を叩き続けるのは相手にも自分にも無駄。
if [ -f web/public/data/future.json ] && \
   grep -q '"biasCorrected":true' web/public/data/future.json; then
  echo "すでに補正済み。やることはない。"
  echo "やり直すなら pipeline/cache/weather/pref/model_hist を消してから実行する。"
  exit 0
fi

echo "=== 走っている取得プロセスの確認 ==="
if pgrep -f "pipeline/weather" > /dev/null; then
  echo "⚠ 取得プロセスが動いている。止めてから実行すること"; exit 1
fi
echo "なし"

echo "=== 枠の確認 ==="
# 1地点の軽いリクエストは上限中でも通ることがある。本番と同じ規模で確かめないと
# 「OK」と言った直後に落ちる。実際にそうなった。
uv run python - <<'PY' || exit 1
import sys
sys.path.insert(0, "pipeline")
import weather as wx

lats, lons = wx.load_points("pref")
try:
    wx.fetch_year("pref", "model_hist", 2000, lats, lons, verbose=False)
except Exception as e:
    print(f"⚠ まだ取得できない: {str(e)[:150]}")
    print("時間を置いて再実行すること（日次上限は翌日まで明けない）")
    sys.exit(1)
print("OK（本番と同じ47地点で確認）")
PY

echo "=== 気候モデルの過去期間を取得（25リクエスト）==="
uv run python - <<'PY'
import sys
sys.path.insert(0, "pipeline")
import weather as wx

lats, lons = wx.load_points("pref")
todo = [("model_hist", y) for y in wx.HIST_YEARS
        if not wx.cache_path("pref", "model_hist", y).exists()]
todo += [("future", y) for y in wx.FUTURE_YEARS
         if not wx.cache_path("pref", "future", y).exists()]
print(f"取得対象 {len(todo)} 件", flush=True)
for kind, year in todo:
    try:
        wx.load_or_fetch("pref", kind, year, lats, lons)
    except Exception as e:
        print(f"  中断 {kind} {year}: {str(e)[:150]}", flush=True)
        print("  途中まではキャッシュに残る。時間を置いて再実行すれば続きから進む。",
              flush=True)
        sys.exit(1)
print("取得完了", flush=True)
PY

echo "=== 学習・検証・予測 ==="
uv run python pipeline/build_pref_future.py

echo "=== 差分法が効いているかの確認 ==="
uv run python - <<'PY'
import sys
sys.path.insert(0, "pipeline")
import json

import numpy as np

import biascorrect as bc
import build_pref_future as bf
import prefectures as pref
import weather as wx
import weather_stats as ws

d = json.load(open("web/public/data/future.json"))
assert d["biasCorrected"], "補正できていない"

# 気候モデルは実際の年の並びを再現しない。統計を合わせるだけで、
# どの年が暑かったかは一致しない。だから 2024年と2025年をつないで
# 連続性を求めるのは誤り（実際に一度それで落とした）。
# 差分法が保証するのは「基準期間の平均が観測と一致すること」なので、そこを見る。
hist = list(wx.HIST_YEARS)
_codes, names = pref.load()
off = bf.bias_offsets(hist, [names[str(c)] for c in range(1, 48)])
assert off is not None, "ずれを計算できていない"

for v in bf.CORRECT_VARS:
    obs = np.concatenate([ws.summer_mean(bf.load_cached("hist", y)[v]) for y in hist])
    cor = np.concatenate([
        ws.summer_mean(bc.apply(bf.load_cached("model_hist", y)[v], off[v])) for y in hist])
    gap = float(cor.mean() - obs.mean())
    print(f"  {v}: 基準期間の平均 観測 {obs.mean():.3f}℃ / 補正後モデル {cor.mean():.3f}℃ "
          f"（差 {gap:+.4f}℃）")
    assert abs(gap) < 0.01, f"{v} の平均が合っていない ({gap:+.3f}℃)"

# 期間どうしで見て、将来が暖かくなっているか。単年の比較はしない。
ind = d["indicators"]; yy = ind["years"]; nat = ind["national"]
def mean_of(lo, hi, key):
    v = [nat[key][yy.index(y)] for y in range(lo, hi + 1) if y in yy]
    return float(np.mean(v))
obs_late = mean_of(2020, 2024, "t_min_mean")
fut_early = mean_of(2025, 2029, "t_min_mean")
fut_late = mean_of(2046, 2050, "t_min_mean")
print(f"  最低気温 観測2020-24 {obs_late:.2f}℃ → 予測2025-29 {fut_early:.2f}℃ "
      f"→ 予測2046-50 {fut_late:.2f}℃")
assert fut_late > obs_late, "将来の方が涼しくなっている"
print("  差分法は効いており、将来は観測期間より暖かい")
PY

echo "=== フロントのビルドと確認 ==="
cd web && npm run build

cat <<'MSG'

ここまで自動。以下は目で見てから。

  1. npm run dev で 2050年予測のセクションを確認する
     数字が現実的か（寝苦しい夜が減っていないか、極端でないか）
  2. 問題なければ npx wrangler deploy

予測の数字が初めて公開される変更なので、中身を見てから出すこと。
MSG
