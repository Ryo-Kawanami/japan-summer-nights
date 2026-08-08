"""aggregate と encode の単体テスト。

数字の正しさがこのアプリの価値の全部なので、ここは厚めに守る。
特に「海の NaN が平均に混入しない」は検証中に一度間違えた箇所。
"""

import pathlib
import sys

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import aggregate as ag  # noqa: E402
import encode as enc  # noqa: E402


def test_to_celsius():
    assert ag.to_celsius(np.array([273.15, 300.0]))[0] == pytest.approx(0.0)
    assert ag.to_celsius(np.array([273.15, 300.0]))[1] == pytest.approx(26.85)


def test_to_celsius_keeps_nan():
    assert np.isnan(ag.to_celsius(np.array([np.nan]))[0])


def test_period_mean_includes_both_ends():
    years = np.array([2000, 2001, 2002, 2003])
    stack = np.array([np.full((2, 2), float(i)) for i in range(4)])
    got = ag.period_mean(years, stack, 2001, 2002)
    assert got == pytest.approx(np.full((2, 2), 1.5))


def test_period_mean_raises_when_empty():
    years = np.array([2000, 2001])
    stack = np.zeros((2, 2, 2))
    with pytest.raises(ValueError):
        ag.period_mean(years, stack, 2010, 2020)


def test_national_mean_excludes_nan():
    """海の NaN を 0 として数えてはいけない。"""
    grid = np.array([[10.0, np.nan], [20.0, np.nan]])
    assert ag.national_mean(grid) == pytest.approx(15.0)


def test_national_series_excludes_nan():
    stack = np.array([[[10.0, np.nan]], [[20.0, np.nan]]])
    assert ag.national_series(stack) == pytest.approx([10.0, 20.0])


def test_linear_trend_recovers_known_slope():
    years = np.arange(2000, 2025)
    values = 15.0 + 0.05 * (years - 2000)          # 0.5℃/10年 ちょうど
    slope, r, t = ag.linear_trend(years, values)
    assert slope == pytest.approx(0.5)
    assert r == pytest.approx(1.0)


def test_linear_trend_flat_series_has_no_trend():
    years = np.arange(2000, 2025)
    slope, r, t = ag.linear_trend(years, np.full(25, 20.0))
    assert slope == pytest.approx(0.0, abs=1e-9)
    assert abs(t) < 2.07                            # 有意でない


def test_pixel_trends_matches_scalar_trend():
    years = np.arange(2000, 2025)
    ramp = 15.0 + 0.05 * (years - 2000)
    stack = np.repeat(ramp[:, None, None], 3, axis=1).repeat(4, axis=2)
    got = ag.pixel_trends(years, stack)
    assert got.shape == (3, 4)
    assert got == pytest.approx(np.full((3, 4), 0.5))


def test_pixel_trends_keeps_nan_pixels_nan():
    years = np.arange(2000, 2025)
    stack = np.zeros((25, 2, 2))
    stack[:, 0, 0] = np.nan
    got = ag.pixel_trends(years, stack)
    assert np.isnan(got[0, 0])
    assert not np.isnan(got[1, 1])


def test_land_fraction_ignores_ocean():
    """NaN を分母に含めない。検証時に一度ここを間違えた。"""
    trend = np.array([[1.0, -1.0], [np.nan, np.nan]])
    assert ag.land_fraction_warming(trend) == pytest.approx(0.5)


def test_bin_stats_groups_by_key():
    values = np.array([[10.0, 20.0, 30.0, 40.0]])
    keys = np.array([[0.0, 0.1, 0.5, 0.9]])
    got = ag.bin_stats(values, keys, [(0.0, 0.5, "低"), (0.5, 1.01, "高")])
    assert [b["label"] for b in got] == ["低", "高"]
    assert got[0]["n"] == 2 and got[0]["mean"] == pytest.approx(15.0)
    assert got[1]["n"] == 2 and got[1]["mean"] == pytest.approx(35.0)


def test_bin_stats_excludes_nan_values():
    """欠測が1つ混じるだけで区分全体の平均が NaN になる罠を防ぐ。"""
    values = np.array([[10.0, np.nan, 30.0]])
    keys = np.array([[0.1, 0.2, 0.3]])
    got = ag.bin_stats(values, keys, [(0.0, 1.0, "全部")])
    assert got[0]["n"] == 2
    assert got[0]["mean"] == pytest.approx(20.0)


def test_bin_stats_empty_bin_reports_none():
    got = ag.bin_stats(np.array([[1.0]]), np.array([[0.1]]), [(0.5, 1.0, "空")])
    assert got[0]["n"] == 0 and got[0]["mean"] is None


def test_bin_stats_upper_bound_is_exclusive():
    values = np.array([[1.0, 2.0]])
    keys = np.array([[0.5, 0.5]])
    got = ag.bin_stats(values, keys, [(0.0, 0.5, "下"), (0.5, 1.0, "上")])
    assert got[0]["n"] == 0
    assert got[1]["n"] == 2


def test_zonal_means():
    grid = np.array([[10.0, 20.0], [30.0, np.nan]])
    codes = np.array([[1, 1], [2, 2]], dtype="uint8")
    got = ag.zonal_means(grid, codes, 2)
    assert np.isnan(got[0])                 # index 0 は未使用
    assert got[1] == pytest.approx(15.0)
    assert got[2] == pytest.approx(30.0)    # NaN は除外される


def test_zonal_means_all_nan_region_is_nan():
    grid = np.array([[np.nan, np.nan]])
    codes = np.array([[1, 1]], dtype="uint8")
    assert np.isnan(ag.zonal_means(grid, codes, 1)[1])


def test_quantize_roundtrip_absolute_within_tolerance():
    """実測温度レンジでの量子化誤差が 0.15℃ 未満に収まること。

    レンジが 35℃ 幅で 254 段なので刻みは 0.138℃。表示上は問題にならない。
    """
    lo, hi = enc.ABS_RANGE
    arr = np.linspace(lo, hi, 1000).reshape(20, 50)
    back = enc.dequantize(enc.quantize(arr, lo, hi), lo, hi)
    assert np.nanmax(np.abs(back - arr)) < 0.15


def test_quantize_roundtrip_diff_within_tolerance():
    r = enc.DIFF_RANGE
    arr = np.linspace(-r, r, 1000).reshape(20, 50)
    back = enc.dequantize(enc.quantize(arr, -r, r), -r, r)
    assert np.nanmax(np.abs(back - arr)) < 0.05


def test_quantize_marks_nan_as_nodata():
    q = enc.quantize(np.array([[np.nan, 20.0]]), *enc.ABS_RANGE)
    assert q[0, 0] == enc.NODATA
    assert q[0, 1] != enc.NODATA


def test_quantize_clips_out_of_range():
    q = enc.quantize(np.array([[-99.0, 99.0]]), *enc.ABS_RANGE)
    assert q[0, 0] == 1
    assert q[0, 1] == 255


def test_absolute_scale_holds_the_bulk_of_the_data():
    """実測の大部分がスケールに収まっていること。

    極端な画素まで含めると、レンジが広がりすぎて地図の中の濃淡が読めなくなる。
    そこで 1〜99 パーセンタイルに寄せてある。ここでは「本体が入っていること」と
    「詰めすぎていないこと」の両方を守る。
    実測: 昼 1%=18.2 / 99%=35.1、夜 1%=9.7 / 99%=23.2℃
    """
    lo, hi = enc.ABS_RANGE
    assert lo <= 9.7, "夜の低温側の本体が切り捨てられている"
    assert hi >= 35.1, "昼の高温側の本体が切り捨てられている"
    assert hi - lo <= 30.0, "レンジが広すぎて地図の濃淡が潰れる"


# --- weather_stats ---

import weather_stats as ws  # noqa: E402


def test_count_days_counts_only_threshold_crossings():
    t_min = np.array([[24.9, 25.0, 25.1, 30.0]])
    assert ws.count_days(t_min, ws.TROPICAL_NIGHT)[0] == 3


def test_count_days_ignores_nan():
    """欠測を「しきい値未満」と数えると、雲の多い年の日数が不当に減る。"""
    t_max = np.array([[36.0, np.nan, 34.0]])
    assert ws.count_days(t_max, ws.EXTREME_DAY)[0] == 1


def test_summer_mean_ignores_nan():
    assert ws.summer_mean(np.array([[10.0, np.nan, 20.0]]))[0] == pytest.approx(15.0)


def test_apparent_fit_recovers_a_linear_relationship():
    """既知の線形関係を作って、当てはめが係数を取り戻せることを確認する。"""
    rng = np.random.default_rng(0)
    t_max = rng.uniform(25, 38, (40, 92))
    t_min = t_max - rng.uniform(5, 12, (40, 92))
    rh = rng.uniform(50, 95, (40, 92))
    X = ws.apparent_features(t_max, t_min, rh)
    truth = np.array([0.8, 0.2, 0.35, -3.0])
    apparent = X @ truth
    coef, r2, mae = ws.fit_apparent(t_max, t_min, rh, apparent)
    assert r2 > 0.999
    assert mae < 0.01
    assert np.allclose(coef, truth, atol=1e-6)


def test_apply_apparent_matches_fit():
    rng = np.random.default_rng(1)
    t_max = rng.uniform(25, 38, (10, 92))
    t_min = t_max - 8
    rh = rng.uniform(50, 95, (10, 92))
    coef = np.array([0.8, 0.2, 0.35, -3.0])
    got = ws.apply_apparent(coef, t_max, t_min, rh)
    assert got.shape == t_max.shape


def test_per_site_stats_uses_era5_when_available():
    t_max = np.array([[36.0, 31.0]])
    t_min = np.array([[26.0, 24.0]])
    rh = np.array([[80.0, 70.0]])
    apparent = np.array([[40.0, 33.0]])
    s = ws.per_site_stats(t_max, t_min, rh, apparent=apparent)
    assert s["tropical_nights"][0] == 1
    assert s["extreme_days"][0] == 1
    assert s["midsummer_days"][0] == 2
    assert s["apparent_source"] == "era5"
    assert s["apparent_mean"][0] == pytest.approx(36.5)


# --- downscale ---

import downscale as ds  # noqa: E402


def test_vapor_pressure_increases_with_temperature():
    """同じ湿度なら、暑いほど空気が含む水の量は増える。"""
    assert ds.vapor_pressure(30.0, 80.0) > ds.vapor_pressure(20.0, 80.0)


def test_vapor_pressure_zero_humidity_is_zero():
    assert ds.vapor_pressure(30.0, 0.0) == pytest.approx(0.0)


def test_build_features_shape_and_order():
    X = ds.build_features([25.0, 30.0], [70.0, 80.0], [0.1, 0.9], [35.0, 33.0])
    assert X.shape == (2, len(ds.FEATURES))
    assert X[0, 0] == pytest.approx(25.0)     # air_temp
    assert X[1, 2] == pytest.approx(0.9)      # urban


def test_linear_fit_recovers_known_coefficients():
    rng = np.random.default_rng(3)
    X = rng.normal(size=(500, len(ds.FEATURES)))
    truth = np.array([1.5, -0.2, 4.0, 0.1, 0.3, 7.0])
    y = np.column_stack([X, np.ones(len(X))]) @ truth
    coef = ds.fit_linear(X, y)
    assert np.allclose(coef, truth, atol=1e-8)


def test_coverage_report_detects_out_of_range_future():
    """将来が学習範囲を超えたら検出できること。木モデルの信頼性の要。"""
    X_train = np.zeros((10, len(ds.FEATURES)))
    X_future = np.zeros((10, len(ds.FEATURES)))
    X_future[:, 0] = 5.0                      # 気温だけ範囲外へ
    rep = ds.coverage_report(X_train, X_future)
    assert rep["air_temp"]["above"] == pytest.approx(1.0)
    assert rep["humidity"]["above"] == pytest.approx(0.0)


def test_year_block_cv_never_trains_on_the_tested_year():
    """年で分けていることを、学習側に混ざっていないかで確かめる。"""
    years = np.repeat(np.arange(2000, 2010), 5)
    X = np.column_stack([years.astype(float)] + [np.zeros_like(years, dtype=float)] * 4)
    y = years.astype(float)
    seen = []

    def fit(Xtr, ytr):
        seen.append(set(np.unique(Xtr[:, 0]).astype(int)))
        return ds.fit_linear(Xtr, ytr)

    folds = ds.year_block_cv(X, y, years, fit, ds.predict_linear, n_blocks=5)
    assert len(folds) == 5
    for fold, train_years in zip(folds, seen):
        assert not (set(fold["years"]) & train_years)


def test_warm_year_holdout_splits_by_year():
    years = np.repeat(np.arange(2000, 2025), 4)
    X = np.column_stack([years.astype(float)] + [np.zeros_like(years, dtype=float)] * 4)
    y = years.astype(float) * 0.1
    res = ds.warm_year_holdout(X, y, years, ds.fit_linear, ds.predict_linear, split_year=2020)
    assert res["train_years"] == [2000, 2019]
    assert res["test_years"] == [2020, 2024]


def test_warm_year_holdout_rejects_empty_split():
    years = np.repeat(np.arange(2000, 2010), 2)
    X = np.zeros((len(years), len(ds.FEATURES)))
    with pytest.raises(ValueError):
        ds.warm_year_holdout(X, years.astype(float), years,
                             ds.fit_linear, ds.predict_linear, split_year=2020)


# --- interp ---

import interp as ip  # noqa: E402

BBOX_T = (120.0, 20.0, 140.0, 40.0)


def test_interp_reproduces_a_constant_field():
    """どこも同じ値なら、補間しても同じ値になること。"""
    lats = np.array([25.0, 30.0, 35.0])
    lons = np.array([125.0, 130.0, 135.0])
    got = ip.to_grid(np.array([7.0, 7.0, 7.0]), (10, 10), BBOX_T, lats, lons)
    assert np.allclose(got, 7.0)


def test_interp_is_bounded_by_the_inputs():
    """重み付き平均なので、入力の最小と最大の外には出ない。"""
    lats = np.array([25.0, 35.0])
    lons = np.array([125.0, 135.0])
    got = ip.to_grid(np.array([10.0, 20.0]), (12, 12), BBOX_T, lats, lons)
    assert got.min() >= 10.0 - 1e-9
    assert got.max() <= 20.0 + 1e-9


def test_interp_favours_the_nearest_site():
    """観測点の近くのセルは、その点の値に寄ること。"""
    lats = np.array([22.0, 38.0])
    lons = np.array([122.0, 138.0])
    grid = ip.to_grid(np.array([0.0, 100.0]), (20, 20), BBOX_T, lats, lons)
    assert grid[-1, 0] < 50.0     # 南西の隅は 0 側の点に近い
    assert grid[0, -1] > 50.0     # 北東の隅は 100 側


def test_grid_row_zero_is_north():
    """row 0 が北という前提を固定する。ここを逆にすると地図が上下反転する。"""
    lats, lons = ip._grid_coords((4, 4), BBOX_T)
    assert lats[0] > lats[-1]
    assert lons[0] < lons[-1]


def test_weights_sum_to_one():
    lats = np.array([25.0, 30.0, 35.0])
    lons = np.array([125.0, 130.0, 135.0])
    idx, w = ip.build_weights((8, 8), BBOX_T, lats, lons)
    assert np.allclose(w.sum(axis=1), 1.0)
    assert idx.shape == w.shape


def test_apply_weights_rejects_wrong_shape():
    lats = np.array([25.0, 35.0])
    lons = np.array([125.0, 135.0])
    idx, w = ip.build_weights((5, 5), BBOX_T, lats, lons)
    with pytest.raises(ValueError):
        ip.apply_weights(np.zeros((2, 2)), idx, w, (5, 5))


def test_baseline_threshold_uses_the_baseline_years_only():
    """しきい値は基準期間だけから決まること。"""
    cool = [np.full((2, 10), 20.0), np.full((2, 10), 22.0)]
    th = ws.baseline_threshold(cool, percentile=50.0)
    assert th.shape == (2,)
    assert th[0] == pytest.approx(21.0)


def test_count_above_baseline_is_per_site():
    daily = np.array([[10.0, 30.0, 40.0], [10.0, 30.0, 40.0]])
    th = np.array([25.0, 35.0])
    got = ws.count_above_baseline(daily, th)
    assert got[0] == 2       # 30 と 40
    assert got[1] == 1       # 40 のみ


def test_count_above_baseline_rejects_mismatched_sites():
    with pytest.raises(ValueError):
        ws.count_above_baseline(np.zeros((3, 5)), np.zeros(2))


def test_baseline_percentile_gives_expected_day_count():
    """基準期間では、90パーセンタイル超えは夏の約1割の日数になること。"""
    rng = np.random.default_rng(7)
    base = [rng.normal(24, 3, (5, 92)) for _ in range(5)]
    th = ws.baseline_threshold(base, percentile=90.0)
    counts = [ws.count_above_baseline(y, th) for y in base]
    mean_days = float(np.mean(counts))
    assert 7.0 < mean_days < 12.0     # 92日の1割前後


# --- biascorrect ---

import biascorrect as bc  # noqa: E402


def test_offsets_measures_model_minus_observation():
    model = [np.full((3, 10), 25.0)]
    obs = [np.full((3, 10), 23.0)]
    assert bc.offsets(model, obs) == pytest.approx(np.full(3, 2.0))


def test_offsets_is_per_site():
    model = [np.array([[10.0, 12.0], [20.0, 22.0]])]
    obs = [np.array([[9.0, 11.0], [30.0, 32.0]])]
    got = bc.offsets(model, obs)
    assert got[0] == pytest.approx(1.0)
    assert got[1] == pytest.approx(-10.0)


def test_offsets_rejects_mismatched_sites():
    with pytest.raises(ValueError):
        bc.offsets([np.zeros((3, 5))], [np.zeros((2, 5))])


def test_apply_removes_the_offset():
    """補正後のモデルは、基準期間で実測と同じ平均になること。"""
    obs = [np.full((2, 20), 21.0)]
    model = [np.full((2, 20), 23.5)]
    off = bc.offsets(model, obs)
    corrected = bc.apply(model[0], off)
    assert np.allclose(corrected, 21.0)


def test_apply_keeps_the_model_trend():
    """変化量は保たれること。差分法の肝。"""
    off = np.array([2.0, 2.0])
    base = np.full((2, 10), 25.0)
    later = np.full((2, 10), 27.0)
    assert np.allclose(bc.apply(later, off) - bc.apply(base, off), 2.0)


def test_apply_rejects_mismatched_sites():
    with pytest.raises(ValueError):
        bc.apply(np.zeros((3, 5)), np.zeros(2))


def test_report_lists_the_largest_offsets():
    off = np.array([0.1, -2.5, 0.3])
    rep = bc.report(off, names=["あ", "い", "う"], top=2)
    assert rep["largest"][0]["name"] == "い"
    assert rep["max_abs"] == pytest.approx(2.5)
