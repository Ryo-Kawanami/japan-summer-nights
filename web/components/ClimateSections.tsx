"use client";

import { useMemo, useState } from "react";

import AirLstScatter from "@/components/AirLstScatter";
import Explainer from "@/components/Explainer";
import FutureChart, { rollingMean } from "@/components/FutureChart";
import Source, { SOURCES } from "@/components/Source";
import { MODEL_LABEL, type FuturePayload } from "@/lib/future-types";

interface Props {
  data: FuturePayload;
  /** 上の地図と同じ県選択を共有する。null なら全国。 */
  selected: number | null;
}

const NIGHT = "var(--night)";
const DAY = "var(--day)";
// 体感温度と熱中症は「人にとっての暑さ」で、昼夜の区分とは別の意味なので別色。
const HUMAN = "var(--human)";

function pick(data: FuturePayload, selected: number | null) {
  return selected ? data.indicators.byPrefecture[String(selected)] : data.indicators.national;
}

function label(data: FuturePayload, selected: number | null) {
  return selected ? data.prefectures[String(selected)] : "全国";
}

/** from〜to 年（両端を含む）の平均。欠けている年は無視する。 */
function windowMean(values: number[], years: number[], from: number, to: number) {
  const hit = years
    .map((y, i) => (y >= from && y <= to ? values[i] : null))
    .filter((v): v is number => v != null && Number.isFinite(v));
  return hit.reduce((a, b) => a + b, 0) / hit.length;
}

/** 気温と地表面温度は別の量。その関係を数字で示す。 */
export function AirVsSurface({ data }: { data: FuturePayload }) {
  const night = data.relation.nighttime;
  const day = data.relation.daytime;
  const t = data.findings.trendsPerDecade;
  const f = data.findings.airVsLst;
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-semibold">気温と地表面温度は、どう違うのか</h2>
      <div className="mb-4 text-sm text-[var(--text-secondary)]">
        このサイトの地図は
        <Explainer term="地表面温度">
          衛星が赤外線で測る「地面そのものの温度」です。天気予報の気温は地上1.5mの
          空気の温度なので別の量になります。同じ場所・同じ日でも数℃ずれます。
        </Explainer>
        で、天気予報の気温とは別の量です。
        両者がどれだけ連動しているかを、25年分の実データで確かめました。
      </div>

      {/* 並びはページ全体で昼→夜に揃える。ここだけ逆にすると読者が
          比較する順番を切り替えることになり、無駄に負荷がかかる。 */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["昼", day, DAY],
            ["夜", night, NIGHT],
          ] as const
        ).map(([name, r, color]) => (
          <div key={name} className="rounded-lg border border-[var(--rule)] p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
              {name}
            </div>
            <p className="text-sm">
              気温が1℃上がると、地表面温度は{" "}
              <strong className="tabular-nums">{r.slope_per_air_degree.toFixed(2)}℃</strong> 上がる
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              相関 r={r.r.toFixed(2)}／ 地表面は日平均気温より{" "}
              {Math.abs(r.mean_gap).toFixed(1)}℃ {r.mean_gap < 0 ? "低い" : "高い"}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <FutureChart
          years={data.years}
          lastObservedYear={data.years[data.years.length - 1]}
          unit="℃"
          caption="25年の推移（全国平均）"
          series={[
            {
              key: "day_lst",
              label: "地表面温度（昼）",
              color: DAY,
              values: data.climate.daytime.observed.national,
            },
            {
              key: "night_lst",
              label: "地表面温度（夜）",
              color: NIGHT,
              values: data.climate.nighttime.observed.national,
            },
            {
              key: "air",
              label: "気温（比較の基準）",
              color: "var(--text-secondary)",
              reference: true,
              values: data.indicators.years.map((y, i) => {
                if (!data.years.includes(y)) return null;
                const n = data.indicators.national;
                return (n.t_max_mean[i] + n.t_min_mean[i]) / 2;
              }),
            },
          ]}
        />
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          3本とも同じ目盛です。どれも右肩上がりなので、並べるだけでは
          「連動している」ように見えて当然です。そこで年ごとのブレだけを取り出して
          確かめると、気温との一致は
          <strong className="text-[var(--text-primary)]">
            夜が r={f.nighttime.r_detrended.toFixed(2)}
          </strong>
          、昼が r={f.daytime.r_detrended.toFixed(2)} でした（どちらも統計的に有意）。
          暑い年は地面も暑い、涼しい年は地面も涼しい、が実際に成り立っています。
        </p>
      </div>

      <div className="mt-8">
        <AirLstScatter data={data} />
      </div>

      <div className="mt-4 space-y-3 text-sm text-[var(--text-secondary)]">
        <p>
          横軸は昼夜とも同じ「日最高と日最低の中間の気温」です。
          夜の地表面温度も、夜の最低気温ではなくこの日平均と比べています。
        </p>
        <p>
          <strong className="text-[var(--text-primary)]">
            夜の地面は、気温の変化を1℃以上の幅で受け取ります。
          </strong>
          気温が1℃高い年・場所では、夜の地表面温度は{" "}
          {night.slope_per_air_degree.toFixed(2)}℃ 高くなります（昼は{" "}
          {day.slope_per_air_degree.toFixed(2)}℃）。
          これは<strong>変化の速さではなく、気温に対する応答の大きさ</strong>です。
        </p>
        <p>
          実際の25年の変化率で見ても向きは同じです。夜は地表面温度が
          {t.night_lst > 0 ? "+" : ""}{t.night_lst.toFixed(2)}℃/10年 と、
          気温の {t.t_mean > 0 ? "+" : ""}{t.t_mean.toFixed(2)}℃/10年 をわずかに上回ります。
          昼は地表面温度が {t.day_lst > 0 ? "+" : ""}{t.day_lst.toFixed(2)}℃/10年 で、
          気温を大きく下回ります。
        </p>
        <p>
          昼の地面は日射と土壌の乾湿に振り回されて気温との連動が弱く（r={day.r.toFixed(2)}）、
          夜はよく連動します（r={night.r.toFixed(2)}）。
          このサイトが夜のデータでだけ明確な変化を捉えられた理由の一つがここにあります。
        </p>
      </div>
      <Source>
        {SOURCES.lst}／{SOURCES.era5}
      </Source>
    </section>
  );
}

/** 体感に結びつく指標。数字を「寝苦しい夜が何日」に翻訳する。 */
export function FeelSection({ data, selected }: Props) {
  const [showTable, setShowTable] = useState(false);
  const ind = data.indicators;
  const all = pick(data, selected);
  const name = label(data, selected);
  const [lo, hi] = ind.baseline.years;
  const lastObserved = ind.histYears[ind.histYears.length - 1];
  const th = selected ? ind.baseline.nightThreshold[selected - 1] : null;

  // ここは「その夏どうだったか」の節なので実測だけを見せる。
  // 将来は「2050年まで、どうなりそうか」の担当で、同じ図を2度出すと
  // それぞれの節が何を言いたいのか分からなくなる。
  const nObs = ind.histYears.length;
  const years = ind.years.slice(0, nObs);
  const s = {
    hot_nights: all.hot_nights.slice(0, nObs),
    apparent_mean: all.apparent_mean.slice(0, nObs),
    t_min_mean: all.t_min_mean.slice(0, nObs),
  };

  const first = s.hot_nights[0];
  const last = s.hot_nights[nObs - 1];

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-semibold">その夏、人はどれだけ暑いと感じたか</h2>
      <div className="mb-4 text-sm text-[var(--text-secondary)]">
        温度の平均値は正確ですが、体には結びつきません。
        「寝苦しい夜が年に何日あったか」なら結びつきます。
        ここでは
        <Explainer term="特に寝苦しい夜">
          その土地の {lo}〜{hi}年の夏で、最低気温が上位
          {(100 - ind.baseline.percentile).toFixed(0)}%に入る暑さだった夜のことです。
          92日の夏なら、基準期間には年およそ9日ありました。
          {th != null && (
            <>
              {" "}
              {name}では「最低気温 {th.toFixed(1)}℃ 以上の夜」がこれに当たります。
            </>
          )}
          <br />
          <br />
          全国一律の「熱帯夜（25℃以上）」を使わないのは、
          使っている再解析データが10〜30km格子の平均値で、都市の実測より低く出るからです。
          実測で猛暑日が13日あった2010年の東京が、このデータでは0日になります。
          各地点の過去を基準にすれば、その偏りは分子と分母の両方に同じようにかかって
          打ち消し合います。
          <br />
          <br />
          <strong className="text-[var(--text-primary)]">
            これは人の申告ではなく、観測を物理モデルに取り込んで計算した気温の値です。
          </strong>
          「寝苦しかった」と答えた人の数ではないので、
          携帯電話の普及や言葉の浸透といった、報告のしやすさの変化には影響されません。
          実際この日数は単調に増えておらず、
          冷夏だった2003年は{" "}
          {ind.national.hot_nights[ind.years.indexOf(2003)]?.toFixed(0) ?? "—"}日、
          記録的な猛暑だった2010年は{" "}
          {ind.national.hot_nights[ind.years.indexOf(2010)]?.toFixed(0) ?? "—"}日 と、
          その年の天候どおりに上下します。観測体制の変更が原因なら、
          こういう振れ方ではなく一度きりの段差が出ます。
          <br />
          <br />
          ただし無傷ではありません。この再解析が取り込む観測網（衛星の数など）は
          年々変わっており、その影響はゼロではありません。
        </Explainer>
        の日数で見ます。
      </div>

      <div className="mb-4 rounded-lg border border-[var(--rule)] p-4">
        <div className="text-sm text-[var(--text-secondary)]">{name}・特に寝苦しい夜</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">{first.toFixed(0)}日</span>
          <span className="text-[var(--text-secondary)]">→</span>
          <span className="text-3xl font-semibold tabular-nums">{last.toFixed(0)}日</span>
          <span className="text-sm text-[var(--text-secondary)]">
            （{ind.years[0]}年 → {lastObserved}年）
          </span>
        </div>
      </div>

      <FutureChart
        years={years}
        lastObservedYear={lastObserved}
        unit="日"
        zeroBased
        caption={`${name}・特に寝苦しい夜の日数（実測・夏92日のうち）`}
        series={[{ key: "hot_nights", label: "特に寝苦しい夜", color: NIGHT, values: s.hot_nights }]}
      />

      <div className="mt-6">
        <FutureChart
          years={years}
          lastObservedYear={lastObserved}
          unit="℃"
          caption={`${name}・夏の体感温度と最低気温`}
          series={[
            { key: "apparent", label: "体感温度", color: HUMAN, values: s.apparent_mean },
            { key: "tmin", label: "最低気温", color: NIGHT, values: s.t_min_mean },
          ]}
        />
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          体感温度は気温・湿度・風・日射から計算される指標です。
          ここは実測のみで、将来の見通しは下の「2050年まで、どうなりそうか」にあります。
        </p>
      </div>

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
            <caption className="sr-only">{name}の体感に関する指標</caption>
            <thead className="sticky top-0 bg-[var(--surface-1)]">
              <tr className="text-left">
                <th scope="col" className="py-1 pr-4">年</th>
                <th scope="col" className="py-1 pr-4">寝苦しい夜</th>
                <th scope="col" className="py-1 pr-4">体感温度</th>
                <th scope="col" className="py-1">最低気温</th>
              </tr>
            </thead>
            <tbody>
              {years.map((year, i) => (
                <tr key={year} className="border-t border-[var(--rule)]">
                  <th scope="row" className="py-1 pr-4 text-left font-normal">{year}</th>
                  <td className="py-1 pr-4">{s.hot_nights[i].toFixed(0)}日</td>
                  <td className="py-1 pr-4">{s.apparent_mean[i].toFixed(1)}℃</td>
                  <td className="py-1">{s.t_min_mean[i].toFixed(1)}℃</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Source>{SOURCES.era5}</Source>
    </section>
  );
}

/** 実際に人が倒れた数。暑さが人にとって何を意味したかの直接の記録。 */
export function HeatstrokeSection({ data, selected }: Props) {
  const hs = data.heatstroke;
  const ind = data.indicators;
  const name = label(data, selected);
  const counts = selected ? hs.byPrefecture[String(selected)] : hs.national;

  // 熱中症の年に合わせて、寝苦しい夜の日数を並べる
  const s = pick(data, selected);
  const nights = useMemo(
    () => hs.years.map((y) => {
      const i = ind.years.indexOf(y);
      return i >= 0 ? s.hot_nights[i] : null;
    }),
    [hs.years, ind.years, s],
  );

  const [showTable, setShowTable] = useState(false);

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-semibold">実際に、人が倒れた数</h2>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        温度は「何度だった」しか言いません。
        救急搬送された人の数は、その暑さが人にとって何を意味したかを直接示します。
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        <FutureChart
          years={hs.years}
          lastObservedYear={hs.years[hs.years.length - 1]}
          unit="人"
          zeroBased
          caption={`${name}・夏の熱中症搬送者数`}
          series={[{ key: "hs", label: "搬送者数", color: HUMAN, values: counts }]}
        />
        <FutureChart
          years={hs.years}
          lastObservedYear={hs.years[hs.years.length - 1]}
          unit="日"
          zeroBased
          caption={`${name}・同じ年の特に寝苦しい夜`}
          series={[{ key: "n", label: "寝苦しい夜", color: NIGHT, values: nights }]}
        />
      </div>

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
            <caption className="sr-only">{name}の熱中症搬送者数と寝苦しい夜の日数</caption>
            <thead className="sticky top-0 bg-[var(--surface-1)]">
              <tr className="text-left">
                <th scope="col" className="py-1 pr-4">年</th>
                <th scope="col" className="py-1 pr-4">搬送者数</th>
                <th scope="col" className="py-1">寝苦しい夜</th>
              </tr>
            </thead>
            <tbody>
              {hs.years.map((y, i) => (
                <tr key={y} className="border-t border-[var(--rule)]">
                  <th scope="row" className="py-1 pr-4 text-left font-normal">{y}</th>
                  <td className="py-1 pr-4">{counts[i].toLocaleString()}人</td>
                  <td className="py-1">{nights[i] == null ? "—" : `${nights[i]!.toFixed(0)}日`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 space-y-2 text-xs text-[var(--text-secondary)]">
        <p>
          <strong className="text-[var(--text-primary)]">
            この数字は、上のグラフと違って人の行動が挟まっています。
          </strong>
          携帯電話が普及して通報しやすくなったこと、「熱中症」という言葉が
          広く知られるようになったこと、高齢化が進んだこと、消防庁の集計体制が
          変わったこと——どれも搬送者数を押し上げる方向に働き、しかも
          どれも年々進んでいます。
          だから「年とともに増えた」という相関だけでは、暑さのせいと言い切れません。
        </p>
        <p>
          このページで暑さとの関係を判断するときに、生の相関ではなく
          <strong className="text-[var(--text-primary)]">
            年ごとの増加傾向を取り除いた相関
          </strong>
          を使っているのはそのためです。
          「両方とも右肩上がり」という理由だけの見せかけを外しています。
        </p>
        <p>2008・2009年は6月分の集計が無く、他の年と揃わないため除いています。</p>
      </div>
      <Source>
        {SOURCES.heatstroke}（{hs.years[0]}〜{hs.years[hs.years.length - 1]}年）／{SOURCES.era5}
      </Source>
    </section>
  );
}

/** データから言えることと、言えないことを分けて書く。 */
export function WhySection({ data }: { data: FuturePayload }) {
  const t = data.findings.trendsPerDecade;
  const f = data.findings.airVsLst;
  const night = data.relation.nighttime;
  const day = data.relation.daytime;
  const u = data.findings.unexplained;
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold">なぜ、夜の地面が暑くなっているのか</h2>

      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-[var(--rule)] p-4">
          <h3 className="mb-2 font-semibold">分かっていること</h3>
          <ul className="space-y-2 text-[var(--text-secondary)]">
            <li>
              <strong className="text-[var(--text-primary)]">都市化は主因ではありません。</strong>
              市街地率で分けて比べたところ、夜の25年間の上昇は非市街地でも高度市街地でも
              ほぼ同じでした。ヒートアイランドは「どこが暑いか」を決めていますが、
              「なぜ上がったか」の主役ではありません。
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">気温も同時に上がっています。</strong>
              夏の平均最低気温は {t.t_min > 0 ? "+" : ""}{t.t_min.toFixed(2)}℃/10年、
              最高気温は {t.t_max > 0 ? "+" : ""}{t.t_max.toFixed(2)}℃/10年 で上昇しています
              （どちらも統計的に有意）。地面だけが勝手に暖まっているのではなく、
              大気ごと暖まっています。
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">
                昼が見えないのは、暑くなっていないからではありません。
              </strong>
              気温で見ると、<strong>昼の方が夜より速く上がっています</strong>
              （最高気温 {t.t_max.toFixed(2)}℃/10年 に対し最低気温は {t.t_min.toFixed(2)}℃/10年）。
              気温のデータは天気に関わらず値があるので、晴れの日に偏りません。
              それでも衛星が測る昼の地表面温度は
              {t.day_lst > 0 ? "+" : ""}{t.day_lst.toFixed(2)}℃/10年 にとどまり、
              統計的に有意になりません。
              これは「昼は暑くなっていない」のではなく、
              <strong>晴れた日しか測れない観測の側に原因がある</strong>ことを示しています。
              日本の夏は雲が多く、月平均は「その月にたまたま晴れた日」の寄せ集めになります。
              梅雨の長短でサンプリングが変わり、年ごとのばらつきが大きくなります。
              加えて昼の地面は日射と土壌の乾湿に振り回されるため、気温との連動も
              弱くなります（相関 r={day.r.toFixed(2)}、夜は {night.r.toFixed(2)}）。
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">
                夜は、地面の方が空気よりわずかに速く暖まっています。
              </strong>
              同じ日平均気温で比べると、25年の変化率は地表面温度が
              {t.night_lst > 0 ? "+" : ""}{t.night_lst.toFixed(2)}℃/10年、
              気温が {t.t_mean > 0 ? "+" : ""}{t.t_mean.toFixed(2)}℃/10年 です。
              気温に対する応答も1を超えます（気温1℃あたり
              {night.slope_per_air_degree.toFixed(2)}℃）。
              夜の地面は日射を受けず、昼にためた熱を赤外線で逃がして冷えます。
              空気が暖かく湿っているほどその放熱が妨げられるので、
              気温の上昇が地表面温度に増幅されて現れます。
            </li>
            {u.nighttime.significant && (
              <li>
                <strong className="text-[var(--text-primary)]">
                  それでもまだ、説明しきれない上がり方が残ります。
                </strong>
                気温・湿度・市街地率・緯度の4つから夜の地表面温度を予測し、
                外れた分（実測 − 予測）だけを取り出して並べると、
                その外れ方が年々大きくなっていきます。
                10年あたり {u.nighttime.perDecade > 0 ? "+" : ""}
                {u.nighttime.perDecade.toFixed(2)}℃（統計的に有意）。
                外れ方の平均は、最初の5年が {u.nighttime.firstYears > 0 ? "+" : ""}
                {u.nighttime.firstYears.toFixed(2)}℃、最後の5年が{" "}
                {u.nighttime.lastYears > 0 ? "+" : ""}
                {u.nighttime.lastYears.toFixed(2)}℃ です。
                つまり<strong>その年の気温がどうだったかを正しく教えても、
                近年の夜の地面はそれ以上に暑い</strong>ということです。
                昼にこの残りはありません（{u.daytime.perDecade > 0 ? "+" : ""}
                {u.daytime.perDecade.toFixed(2)}℃/10年、有意でない）。
                夜だけに起きています。
              </li>
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-[var(--rule)] p-4">
          <h3 className="mb-2 font-semibold">言えないこと</h3>
          <ul className="space-y-2 text-[var(--text-secondary)]">
            <li>
              <strong className="text-[var(--text-primary)]">
                このデータだけでは原因を特定できません。
              </strong>
              温室効果ガスの寄与を分離するには、気候モデルで「人間活動があった場合」と
              「なかった場合」を比べる実験（検出と要因特定）が要ります。
              ここでできたのは「都市化では説明できない」ところまでです。
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">観測衛星の軌道がずれています。</strong>
              Terra は25年のあいだに軌道が変化しており、観測時刻のずれが
              トレンドに系統的な影響を与えている可能性があります。補正していません。
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">25年は気候の物差しでは短い期間です。</strong>
              1回の火山噴火や数年周期の海洋変動でも、この程度の変化は起こりえます。
            </li>
            {u.nighttime.significant && (
              <li>
                <strong className="text-[var(--text-primary)]">
                  説明しきれない分が何なのかは分かりません。
                </strong>
                大気そのものの変化（雲や水蒸気）かもしれず、地面の側の変化かもしれず、
                衛星の観測条件が25年のあいだに変わったせいかもしれません。
                区別できていません。そして正体が分からない以上、
                この上がり方が今後も続くとして先まで足すこともできません。
                <strong>
                  そのため、このページの夜の地表面温度の予測は下限になっています。
                </strong>
                予測は「気温と地面の関係が将来も変わらない」ことを前提にしていますが、
                その前提はすでに崩れていて、崩れた分は予測に入っていません。
                足りないと分かったまま出しています。
                <br />
                <br />
                同じ理由で、5km格子で作った2050年の地図は公開していません。
                そちらは足りない分が予測値と同じ大きさになり、
                注釈を付けても地図の方が信じられてしまうためです。
              </li>
            )}
          </ul>
        </div>
      </div>
      <Source>
        {SOURCES.lst}／{SOURCES.era5}／{SOURCES.landcover}
      </Source>
    </section>
  );
}

/** 「このサイトは何の役に立つのか」に答える。 */
export function UseSection({ data, selected }: Props) {
  const f = data.findings.heatstrokeVs;
  const ind = data.indicators;
  const s = pick(data, selected);
  const name = label(data, selected);
  const lastObserved = ind.histYears[ind.histYears.length - 1];
  const first = s.hot_nights[0];
  const last = s.hot_nights[ind.years.indexOf(lastObserved)];
  const ratio = first > 0 ? last / first : null;

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold">これは何の役に立つのか</h2>

      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-[var(--rule)] p-4">
          <p>
            <strong>危ないのは昼より夜だ、と数字が言っています。</strong>
            熱中症で運ばれた人の数を一番よく説明するのは、
            <strong>{f.hot_nights.label}</strong>です（相関 r=
            {f.hot_nights.r_detrended.toFixed(2)}、
            年ごとの増加傾向を取り除いてもこの関係は残ります）。
            一方、衛星が測る夜の地表面温度そのものは、同じ土俵で比べると
            説明しきれません（r={f.night_lst.r_detrended.toFixed(2)}、
            {f.night_lst.significant ? "有意" : "統計的に有意とは言えない"}）。
            人が倒れるのは地面の温度ではなく、空気の温度と湿度だからです。
          </p>
          <p className="mt-2 text-[var(--text-secondary)]">
            日中の最高気温だけを見て「今日は35℃に届かないから大丈夫」と判断するのは、
            この数字の上では的を外しています。前の晩に体が冷えたかどうかの方が効きます。
          </p>
        </div>

        <div className="rounded-lg border border-[var(--rule)] p-4">
          <p>
            <strong>{name}では、寝苦しい夜が{ind.years[0]}年の{first.toFixed(0)}日から
            {lastObserved}年には{last.toFixed(0)}日になりました。</strong>
            {ratio != null && ratio >= 1.5 && (
              <>約{ratio.toFixed(1)}倍です。</>
            )}
            エアコンを夜つけるかどうかの判断、寝室の断熱、高齢の家族の見守りは、
            25年前の感覚のままでは足りない、というのがこのデータの示すところです。
          </p>
        </div>

        <div className="rounded-lg border border-[var(--rule)] p-4">
          <p>
            <strong>「昔より暑い気がする」を、数字で確かめられます。</strong>
            上の地図とグラフは都道府県ごとに切り替えられます。
            自分の住む場所で、実際に何がどれだけ変わったのかを、
            体感ではなく観測記録として見られる——それがこのページの用途です。
          </p>
        </div>
      </div>
      <Source>
        {SOURCES.heatstroke}／{SOURCES.era5}／{SOURCES.lst}
      </Source>
    </section>
  );
}

/**
 * 2050年までの予測。
 *
 * 気候モデルと再解析の系統差を打ち消せていないときは何も出さない。
 * 補正なしの絶対値を並べると、都市部で「翌年から涼しくなる」という嘘の絵になる。
 */
export function ForecastSection({ data, selected }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  if (!data.biasCorrected || data.futureYears.length === 0) return null;

  const ind = data.indicators;
  const s = pick(data, selected);
  const name = label(data, selected);
  const lastObserved = ind.histYears[ind.histYears.length - 1];
  const night = data.climate.nighttime;
  const scores = night.scores[night.model];
  const w = scores.warm_holdout;

  const obs = night.observed.byPrefecture;
  const fut = night.byPrefecture;
  const lstYears = [...data.years, ...data.futureYears];
  const lstValues = selected
    ? [...(obs[String(selected)] ?? []), ...(fut[String(selected)] ?? [])]
    : [...night.observed.national, ...night.national];

  const lastYear = ind.years[ind.years.length - 1];
  // 単年どうしを比べない。気候モデルは「どの年が暑いか」を当てるものではなく、
  // 平年の暑さを出すものなので、単年の差は当たり外れを比べたことになってしまう。
  // 5km格子の地図を5年平均で作ったのと同じ理由で、ここも5年の窓で揃える。
  const WINDOW = 5;
  const nowFrom = lastObserved - WINDOW + 1;
  const endFrom = lastYear - WINDOW + 1;
  const nowNights = windowMean(s.hot_nights, ind.years, nowFrom, lastObserved);
  const endNights = windowMean(s.hot_nights, ind.years, endFrom, lastYear);
  // 「実測の最後が最も暑い年だった」は県によって成り立たない
  // （北海道は2000年の方が多い）。断言する前にその県で確かめる。
  const observedNights = ind.histYears.map((y) => s.hot_nights[ind.years.indexOf(y)]);
  const lastObservedIsRecord =
    s.hot_nights[ind.years.indexOf(lastObserved)] >= Math.max(...observedNights);
  // 気温では説明できない上がり方が、予測の期間にどれだけたまるか。
  const u = data.findings.unexplained.nighttime;
  const unexplainedGap = (u.perDecade * (lastYear - lastObserved)) / 10;

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-semibold">2050年まで、どうなりそうか</h2>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        気候モデルが出す将来の気温・湿度を、過去25年で学んだ関係に通して求めます。
        地表面温度そのものを年で外挿しているのではありません。
      </p>

      <div className="mb-4 rounded-lg border border-[var(--rule)] p-4">
        <div className="text-sm text-[var(--text-secondary)]">
          {name}・特に寝苦しい夜（予測）
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">{nowNights.toFixed(0)}日</span>
          <span className="text-[var(--text-secondary)]">→</span>
          <span className="text-3xl font-semibold tabular-nums">{endNights.toFixed(0)}日</span>
          <span className="text-sm text-[var(--text-secondary)]">
            （{nowFrom}〜{lastObserved}年の平均 → {endFrom}〜{lastYear}年の平均）
          </span>
        </div>
        {/* 各県が自分の過去を基準にした相対指標なので、県をまたいだ大小比較は
            意味を持たない。折りたたみの中だけに書いても読まれないため、
            数字のすぐ下に常に出しておく。 */}
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {selected
            ? `この日数は${name}の${ind.baseline.years[0]}〜${ind.baseline.years[1]}年を基準に数えたものです。県ごとに基準が違うので、他の県の日数と大小を比べる意味はありません。`
            : `各県が自分の${ind.baseline.years[0]}〜${ind.baseline.years[1]}年を基準に数えた日数の平均です。県ごとに基準が違うので、県どうしで大小を比べる意味はありません。`}
        </p>
      </div>

      <FutureChart
        years={ind.years}
        lastObservedYear={lastObserved}
        unit="日"
        zeroBased
        caption={`${name}・特に寝苦しい夜の日数（実測と予測・夏92日のうち）`}
        series={[
          { key: "hot_raw", label: "年ごと", color: NIGHT, values: s.hot_nights, faint: true },
          { key: "hot", label: "5年平均", color: NIGHT, values: rollingMean(s.hot_nights) },
        ]}
      />

      <p className="mt-3 text-sm text-[var(--text-secondary)]">
        <strong className="text-[var(--text-primary)]">
          予測の年ごとの上下は、その年を当てたものではありません。
        </strong>
        気候モデルが再現するのは「どの年が暑いか」ではなく、暑さの統計です。
        {lastObservedIsRecord
          ? `${name}では${lastObserved}年が観測${ind.histYears.length}年のうち最も多く、その年を狙って再現しているわけではありません。`
          : `実測の終わりがたまたま暑い年に当たると、そこだけ高く飛び出します。`}
        翌年の予測がそれより低いことは「涼しくなる」を意味しません。
        傾きを読むための線として、5年平均を重ねてあります。
      </p>

      <div className="mt-6">
        <FutureChart
          years={lstYears}
          lastObservedYear={lastObserved}
          unit="℃"
          caption={`${name}・夏の夜の地表面温度`}
          series={[
            { key: "lst_raw", label: "年ごと", color: NIGHT, values: lstValues, faint: true },
            { key: "lst", label: "5年平均", color: NIGHT, values: rollingMean(lstValues) },
          ]}
        />
        {/* この予測は暖年抜き取りの検証を通っているが、別の検証で「気温では
            説明できない上がり方」が有意に残ることが分かっている。方向が
            分かっている過小評価を黙って出すわけにはいかないので、
            どれだけ足りないかを数字で書く。 */}
        {u.significant && (
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">
              この線は下限です。実際はこれより高くなる可能性が高い。
            </strong>
            この予測は「気温と地面の関係が将来も変わらない」ことを前提にしていますが、
            その前提は過去25年の中で既に崩れています。
            気温・湿度・市街地率・緯度で説明したあとに残る上がり方が、
            夜だけ10年あたり {u.perDecade > 0 ? "+" : ""}
            {u.perDecade.toFixed(2)}℃ で増えていました（統計的に有意）。
            この分が{lastObserved}年から{lastYear}年までに
            およそ {unexplainedGap.toFixed(1)}℃ たまりますが、予測には入っていません。
            なぜそうなるのかが分からない以上、足して出すこともできないので、
            足りないと分かったまま出しています。
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        className="mt-4 text-xs underline underline-offset-2"
        aria-expanded={showDetail}
      >
        {showDetail ? "予測の作り方を閉じる" : "この予測はどれだけ当たるのか"}
      </button>

      {showDetail && (
        <div className="mt-3 space-y-3 rounded-lg border border-[var(--rule)] p-4 text-sm text-[var(--text-secondary)]">
          <p>
            <strong className="text-[var(--text-primary)]">検証のやり方。</strong>
            {w.train_years[0]}〜{w.train_years[1]}年だけで学習し、
            一度も見せていない{w.test_years[0]}〜{w.test_years[1]}年を当てさせました。
            これは「見たことのない暖かさに耐えるか」を問う試験で、将来予測の予行になります。
            結果は R²={w.r2.toFixed(3)}、平均的な誤差 {w.rmse.toFixed(2)}℃、
            偏り {w.bias > 0 ? "+" : ""}{w.bias.toFixed(2)}℃ でした。
            採用したのは{MODEL_LABEL[night.model]}です。
          </p>
          <p>
            <strong className="text-[var(--text-primary)]">物差しを合わせています。</strong>
            気候モデルと観測データには系統的なずれがあり、そのまま並べると
            都市部で「翌年から涼しくなる」という誤った絵になります。
            モデルの絶対値は使わず、モデル自身の過去からの変化量だけを観測値に足しています。
          </p>
          <p>
            <strong className="text-[var(--text-primary)]">当たらない可能性。</strong>
            使っているのは1つの気候モデルの1つのシナリオです。
            排出量の前提が変われば結果も変わります。
            また地表面温度の予測は、学習した「気温と地面の関係」が将来も成り立つことを
            前提にしています。植生や土地利用が大きく変われば、その前提は崩れます。
          </p>
        </div>
      )}
      <Source>
        {SOURCES.cmip6}／{SOURCES.era5}／{SOURCES.lst}／{SOURCES.landcover}
      </Source>
    </section>
  );
}
