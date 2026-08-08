"use client";

import { useEffect, useRef, useState } from "react";

import {
  AirVsSurface,
  FeelSection,
  ForecastSection,
  HeatstrokeSection,
  UseSection,
  WhySection,
} from "@/components/ClimateSections";
import DiffMaps from "@/components/DiffMaps";
import FutureMap from "@/components/FutureMap";
import Explainer from "@/components/Explainer";
import Source, { SOURCES } from "@/components/Source";
import MapCompare from "@/components/MapCompare";
import StickySelection from "@/components/StickySelection";
import TrendChart from "@/components/TrendChart";
import UrbanBreakdown from "@/components/UrbanBreakdown";
import { heatCss } from "@/lib/colormap";
import type { FuturePayload, GridFuturePayload } from "@/lib/future-types";
import type { DayNight, Payload } from "@/lib/types";

interface Props {
  data: Payload;
  future: FuturePayload;
  gridFuture: GridFuturePayload;
}

function useColorMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const stamped = document.documentElement.dataset.theme;
      setMode(stamped === "dark" || (stamped !== "light" && mq.matches) ? "dark" : "light");
    };
    read();
    mq.addEventListener("change", read);
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", read);
      obs.disconnect();
    };
  }, []);
  return mode;
}

/**
 * 選んでいる県を URL に載せる。
 *
 * このページで人に見せたくなるのは「自分の県」だが、URL に乗っていなければ
 * それを渡せない。選んだ状態を共有できるかどうかは、読まれ方を左右する。
 *
 * pushState ではなく replaceState を使う。県を10回変えた人が戻るボタンを
 * 10回押さないとページを離れられないのは、履歴の使い方として正しくない。
 */
function usePrefectureUrl(isValid: (code: number) => boolean) {
  const [selected, setSelected] = useState<number | null>(null);
  const restored = useRef(false);

  // 静的書き出しなので、URL を読めるのは描画後だけ。初回に一度だけ復元する。
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("pref");
    const code = Number(raw);
    if (raw && Number.isInteger(code) && isValid(code)) setSelected(code);
    restored.current = true;
    // isValid は data から作られて毎回別の関数になる。初回だけ動かしたい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 復元より先に書き込むと、URL の県を自分で消してしまう。
  useEffect(() => {
    if (!restored.current) return;
    const url = new URL(window.location.href);
    if (selected === null) url.searchParams.delete("pref");
    else url.searchParams.set("pref", String(selected));
    window.history.replaceState(null, "", url);
  }, [selected]);

  return [selected, setSelected] as const;
}

/**
 * 共有したときに本文へ入る一文。
 *
 * 数字は画面と同じ作り方（5年平均）で出す。共有先だけ単年の大きい方を
 * 使うようなことをすると、外向きにだけ話を盛ったことになる。
 */
function buildShareText(future: FuturePayload, selected: number | null) {
  const ind = future.indicators;
  const s = selected ? ind.byPrefecture[String(selected)] : ind.national;
  const name = selected ? future.prefectures[String(selected)] : "日本";
  const years = ind.years;
  const lastObs = ind.histYears[ind.histYears.length - 1];
  const first = ind.histYears[0];
  const mean = (from: number, to: number) => {
    const v = years
      .map((y, i) => (y >= from && y <= to ? s.hot_nights[i] : null))
      .filter((x): x is number => x != null);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const before = mean(first, first + 4);
  const now = mean(lastObs - 4, lastObs);
  return `${name}の「特に寝苦しい夜」は、${first}〜${first + 4}年の年${before.toFixed(0)}日から`
    + `${lastObs - 4}〜${lastObs}年は年${now.toFixed(0)}日になりました`
    + `（人工衛星が測った25年ぶんの夏）`;
}

export default function HeatApp({ data, future, gridFuture }: Props) {
  const [daynight, setDaynight] = useState<DayNight>("nighttime");
  const [selected, setSelected] = usePrefectureUrl(
    (code) => String(code) in data.prefectures,
  );
  const [showTable, setShowTable] = useState(false);
  const mode = useColorMode();

  const day = data.stats.daytime;
  const night = data.stats.nighttime;
  const [absLo, absHi] = data.absRange;
  const absTicks = [absLo, (absLo + absHi) / 2, absHi];
  const shareText = buildShareText(future, selected);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <StickySelection
        prefectures={data.prefectures}
        selected={selected}
        onSelect={setSelected}
        anchorId="pref-picker"
        shareText={shareText}
      />

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          日本の夏は、夜が暑くなった
        </h1>
        <p className="mt-3 text-[var(--text-secondary)]">
          人工衛星が {data.years[0]}年から {data.years[data.years.length - 1]}年まで
          25年間にわたって測り続けた、日本の夏の地表面温度。
          昼のデータは年ごとのばらつきが大きく、25年かけても傾向をはっきり取り出せません。
          確かに上がっていたのは、夜の方でした。
        </p>
        {/* Explainer は details を描くのでブロック要素。p の中には置けない。 */}
        <div className="mt-2 text-sm text-[var(--text-secondary)]">
          地図は実測の
          <Explainer term="地表面温度">
            衛星が測っているのは「地面そのものの温度」です。天気予報の気温は
            地上1.5mの空気の温度なので、別の量になります。
            夏のアスファルトが60℃を超えるように、昼の地表面温度は気温よりずっと高く出ます。
            このページの数字を「気温」として読まないでください。
          </Explainer>
          をそのまま塗っています。25年前と今を並べても、
          ぱっと見ではほとんど変わりません。それが正直な見え方です。
          変化の中身は、その下の差分地図と折れ線で見てください。
        </div>
      </header>

      {/* 話の芯は2つの数字なので、グラフではなく数字そのものを置く。 */}
      <section className="mb-8 grid grid-cols-2 gap-3">
        {(
          [
            ["昼", day, "daytime"],
            ["夜", night, "nighttime"],
          ] as const
        ).map(([label, s, key]) => (
          <div
            key={key}
            className={`rounded-lg border p-4 ${
              daynight === key ? "border-[var(--text-primary)]" : "border-[var(--rule)]"
            }`}
          >
            <div className="text-sm text-[var(--text-secondary)]">{label}の地表面温度</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">
              {s.difference > 0 ? "+" : ""}
              {s.difference.toFixed(2)}℃
            </div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              {data.early[0]}–{data.early[1]}年 → {data.late[0]}–{data.late[1]}年
            </div>
            <div className="mt-2 text-xs text-[var(--text-secondary)]">
              長期傾向 {s.trendPerDecade > 0 ? "+" : ""}
              {s.trendPerDecade.toFixed(2)}℃/10年
              <br />
              {s.significant ? (
                <span>統計的に有意（t={s.t.toFixed(2)}）</span>
              ) : (
                <span>
                  <strong>有意とは言えない</strong>（t={s.t.toFixed(2)}、判定には 2.07 が必要）
                </span>
              )}
              <br />
              年ごとのばらつき ±{s.yearlyStd.toFixed(2)}℃
            </div>
          </div>
        ))}
      </section>

      <div className="mb-8 text-sm text-[var(--text-secondary)]">
        <Explainer term="「統計的に有意」とは？">
          観測された差が、偶然のばらつきだけでは説明しにくいほど大きい、という意味です。
          ここでは t値 という指標を使い、25年分のデータでは 2.07 を超えれば有意と判定します。
          超えなかった場合は「差がない」ことが証明されたわけではなく、
          「あるとは言い切れない」だけです。昼の t=
          {day.t.toFixed(2)} はまさにその状態で、判定の境界のすぐ手前にあります。
        </Explainer>
      </div>

      <section className="mb-6">
        <div
          className="mb-4 inline-flex rounded-lg border border-[var(--rule)] p-1"
          role="group"
          aria-label="昼と夜の切り替え"
        >
          {(
            [
              ["daytime", "☀ 昼"],
              ["nighttime", "🌙 夜"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setDaynight(key)}
              aria-pressed={daynight === key}
              className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                daynight === key
                  ? "bg-[var(--text-primary)] text-[var(--surface-1)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <MapCompare
          data={data}
          daynight={daynight}
          mode={mode}
          selected={selected}
          onSelect={setSelected}
        />

        <div className="mt-4">
          <div className="h-3 w-full rounded-full" style={{ background: heatCss() }} aria-hidden />
          <div className="mt-1 flex justify-between text-xs tabular-nums text-[var(--text-secondary)]">
            {absTicks.map((v) => (
              <span key={v}>{v.toFixed(0)}℃</span>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            左右のパネルも、昼と夜も、すべてこの1本の物差しで塗っています。
            前期と後期の見た目がほとんど変わらないのは、
            <strong className="text-[var(--text-primary)]">
              1枚の地図の中の地域差（{Math.round(night.spatialSpread)}〜
              {Math.round(day.spatialSpread)}℃）に対して、25年の変化が
              {day.difference.toFixed(1)}〜{night.difference.toFixed(1)}℃ と小さいから
            </strong>
            です。変化そのものは下の差分地図で見てください。
          </p>
          <Source>
            {SOURCES.lst}／{SOURCES.prefectures}
          </Source>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold">この25年で何度上がったか</h2>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          {data.late[0]}–{data.late[1]}年の平均から {data.early[0]}–{data.early[1]}
          年の平均を引いた値。上の地図と違い、ゼロを中心にした変化量そのものです。
          昼と夜を同じ物差しで並べてあります。
        </p>
        <DiffMaps data={data} mode={mode} />
        <Source>{SOURCES.lst}</Source>
      </section>

      <section className="mb-8 rounded-lg border border-[var(--rule)] p-4">
        <div id="pref-picker" className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={`rounded-md border px-3 py-1 text-xs ${
              selected === null ? "border-[var(--text-primary)]" : "border-[var(--rule)]"
            }`}
          >
            全国
          </button>
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)}
            aria-label="都道府県を選ぶ"
            className="rounded-md border border-[var(--rule)] bg-[var(--surface-1)] px-2 py-1 text-xs"
          >
            <option value="">都道府県を選ぶ…</option>
            {Object.entries(data.prefectures).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <TrendChart data={data} selected={selected} />

        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="mt-3 text-xs underline underline-offset-2"
          aria-expanded={showTable}
        >
          {showTable ? "表を閉じる" : "数値を表で見る"}
        </button>

        {showTable && (
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="w-full text-xs tabular-nums">
              <caption className="sr-only">
                {selected ? data.prefectures[String(selected)] : "全国"}の夏の地表面温度
              </caption>
              <thead className="sticky top-0 bg-[var(--surface-1)]">
                <tr className="text-left">
                  <th scope="col" className="py-1 pr-4">年</th>
                  <th scope="col" className="py-1 pr-4">昼</th>
                  <th scope="col" className="py-1">夜</th>
                </tr>
              </thead>
              <tbody>
                {data.years.map((year, i) => {
                  const pick = (dn: DayNight) =>
                    selected
                      ? data.series[dn].prefecture[String(selected)]?.[i]
                      : data.series[dn].national[i];
                  const d = pick("daytime");
                  const n = pick("nighttime");
                  return (
                    <tr key={year} className="border-t border-[var(--rule)]">
                      <th scope="row" className="py-1 pr-4 text-left font-normal">{year}</th>
                      <td className="py-1 pr-4">{d == null ? "—" : `${d.toFixed(1)}℃`}</td>
                      <td className="py-1">{n == null ? "—" : `${n.toFixed(1)}℃`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold">都市が暑いから上がったのか？</h2>
        <div className="mb-3 text-sm text-[var(--text-secondary)]">
          夜の上昇は
          <Explainer term="ヒートアイランド現象">
            都市が周りより暑くなる現象のことです。
            地面がアスファルトやコンクリートに覆われ、緑や水辺が少ないと、
            昼のあいだに受けた熱が地面にたまり、夜になっても冷めにくくなります。
            エアコンの排熱や自動車も熱を足します。
            「街の真ん中が、熱の島のように周囲から浮き上がって見える」ことから
            こう呼ばれます。
            このページのデータでも、夜の地表面温度は市街地の方が
            そうでない場所より {data.urban.by.nighttime.heatIslandGap.toFixed(2)}℃ 高く出ます。
          </Explainer>
          のせいではないか、という疑いは当然あります。 そこで衛星の土地被覆図（
          {data.urban.landcoverYear}年）で 5kmセルごとの
          <Explainer term="市街地率">
            5km四方のマスひとつの中で、建物や道路に覆われた土地が占める割合です。
            衛星から作られた10m解像度の土地被覆図で、マスの中の細かい区画を
            ひとつずつ数えて求めました。0%なら森や田畑ばかり、
            100%なら市街地で埋まっている、という意味になります。
          </Explainer>
          を求め、都市の度合いで分けて比べました。
          下の2つのグラフは目盛が違います。重ねて比べないでください。
        </div>

        <UrbanBreakdown data={data} />

        <div className="mt-4 rounded-lg border border-[var(--rule)] p-4 text-sm">
          <p>
            <strong>ヒートアイランドは確かにあります。</strong>
            高度市街地は非市街地より、夜で{" "}
            <strong className="tabular-nums">
              {data.urban.by.nighttime.heatIslandGap.toFixed(2)}℃
            </strong>
            、昼で{" "}
            <strong className="tabular-nums">
              {data.urban.by.daytime.heatIslandGap.toFixed(2)}℃
            </strong>{" "}
            も暑い。
          </p>
          <p className="mt-2">
            <strong>でも、上がった量はほとんど変わりません。</strong>
            夜の25年間の上昇は、非市街地でも高度市街地でもほぼ同じで、差は{" "}
            <strong className="tabular-nums">
              {data.urban.by.nighttime.changeGap > 0 ? "+" : ""}
              {data.urban.by.nighttime.changeGap.toFixed(2)}℃
            </strong>{" "}
            しかありません。
            <strong className="text-[var(--text-primary)]">
              つまり夜の温暖化の大部分は、都市ではない場所で起きています。
            </strong>
            ヒートアイランドは「どこが暑いか」を決めていますが、
            「なぜ上がったか」の主役ではありません。
          </p>
          <p className="mt-2 text-[var(--text-secondary)]">
            ただし土地被覆図は {data.urban.landcoverYear}年時点のものなので、
            分かるのは「いま都市かどうか」だけです。
            この25年のあいだに新しく都市になった場所は切り分けられていません。
            とはいえ、都市化していない場所が同じだけ上がっている以上、
            都市化が主因でないことは言えます。
          </p>
        </div>
        <Source>
          {SOURCES.landcover}／{SOURCES.lst}
        </Source>
      </section>

      <AirVsSurface data={future} />
      <FeelSection data={future} selected={selected} />
      <HeatstrokeSection data={future} selected={selected} />
      <ForecastSection data={future} selected={selected} />
      {gridFuture.assets?.abs_nighttime_future && (
        <section className="mb-10">
          <h2 className="mb-1 text-lg font-semibold">2050年の夏を、地図で見る</h2>
          <p className="mb-4 text-sm text-[var(--text-secondary)]">
            上の折れ線は県ごとの平均でしたが、ここは5km格子です。
            県の中の都市や地形の違いが出ます。
            右側は観測ではなく予測で、単年ではなく
            {gridFuture.futureWindow[0]}〜{gridFuture.futureWindow[1]}年の平均です。
          </p>
          <FutureMap data={data} grid={gridFuture} daynight={daynight} mode={mode} />
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">
              細かい模様は、気候モデルが解いたものではありません。
            </strong>
            気候モデルの気温は約56km間隔でしか出ておらず、この地図の5kmの細かさは
            「市街地の多さと緯度から地表面温度がどう決まるか」を過去25年の観測で学ばせ、
            それを将来の気温に当てはめて描いたものです。
            全体がどれだけ暑くなるかはモデルの気温が決めていますが、
            どこが周りより濃いかは土地の性質が決めています。
          </p>
          <Source>
            {SOURCES.cmip6}／{SOURCES.lst}／{SOURCES.landcover}
          </Source>
        </section>
      )}

      <WhySection data={future} />
      <UseSection data={future} selected={selected} />

      <section className="mb-8 space-y-3 rounded-lg border border-[var(--rule)] p-4 text-sm text-[var(--text-secondary)]">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          この地図を読むときの注意
        </h2>
        <p>
          <strong className="text-[var(--text-primary)]">これは気温ではありません。</strong>
          衛星が測っているのは地面そのものの温度（地表面温度）で、
          天気予報の気温（地上1.5mの空気の温度）とは別の量です。
          夏のアスファルトが60℃を超えるように、昼の地表面温度は気温よりずっと高く出ます。
        </p>
        <p>
          <strong className="text-[var(--text-primary)]">晴れた日しか測れません。</strong>
          赤外線で地面を見ているため、雲があると観測できません。
          月平均は「その月にたまたま晴れた日」の寄せ集めになります。
          梅雨の長い年と短い年ではサンプリングが変わり、これが昼のデータの
          年ごとのばらつき（±{day.yearlyStd.toFixed(2)}℃）を大きくしています。
          25年かけても昼の変化が有意にならないのは、主にこのためだと考えられます。
        </p>
        <p>
          <strong className="text-[var(--text-primary)]">観測衛星の軌道はずれています。</strong>
          Terra は25年のあいだに軌道がわずかに変化しており、
          観測時刻のずれがトレンドに系統的な影響を与えている可能性があります。
          この影響はここでは補正していません。
        </p>
        <p>
          都市化の寄与については上の節で切り分けました。
          ヒートアイランドは実在しますが、上昇量の差は
          {data.urban.by.nighttime.changeGap.toFixed(2)}℃ にとどまります。
        </p>
        <p>
          <strong className="text-[var(--text-primary)]">地図の色は差を強調していません。</strong>
          初期版では両方のパネルを「25年平均からの差」で塗っていましたが、その塗り方だと
          前期は定義上ほぼ必ず平均より低く、後期は高くなるため、実際の差が
          {day.difference.toFixed(1)}℃ でも {night.difference.toFixed(1)}℃ でも
          同じ青→赤のフルスイングに見えてしまいます。
          いまは実測温度を1本の物差しで塗り、変化量は別枠に分けています。
        </p>
        <p>
          昼のデータをあえて残してあるのは、
          「夜だけが上がった」と言うためには「昼は上がっていない」を見せる必要があるからです。
          有意にならなかったという結果も、結果です。
        </p>
      </section>

      <footer className="space-y-2 border-t border-[var(--rule)] pt-4 text-xs text-[var(--text-secondary)]">
        <p>
          地表面温度: NASA MODIS/Terra MOD11C3 v061（Wan, Z., Hook, S., Hulley, G. 2021,
          NASA EOSDIS LP DAAC,{" "}
          <a className="underline" href="https://doi.org/10.5067/MODIS/MOD11C3.061">
            doi:10.5067/MODIS/MOD11C3.061
          </a>
          ）を{" "}
          <a className="underline" href="https://data.earth.jaxa.jp/">
            JAXA Earth API
          </a>{" "}
          経由で取得。
        </p>
        <p>
          都道府県境: 地球地図日本（国土地理院）。
          <a className="underline" href="https://earth.jaxa.jp/en/data/policy/">
            JAXA データ利用ポリシー
          </a>
        </p>
        <p>
          夏は6〜8月の平均。値は日本の陸地のみ（海と国外は集計から除外）。
          衛星の観測が{data.years[data.years.length - 1]}年までなのは、
          {data.years[data.years.length - 1] + 1}年の夏がまだ配信されていないためです
          （それ以降は観測ではなく予測）。
        </p>
      </footer>
    </main>
  );
}
