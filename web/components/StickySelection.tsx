"use client";

import { useEffect, useState } from "react";

interface Props {
  prefectures: Record<string, string>;
  selected: number | null;
  onSelect: (code: number | null) => void;
  /** この要素が画面内にある間は出さない。同じ操作が2つ並ぶのを避ける。 */
  anchorId: string;
  /** 共有したときに本文へ入る一文。 */
  shareText: string;
}

/**
 * いま選んでいる県を、ページのどこにいても分かるようにする帯。
 *
 * ## 考えたこと
 *   このページは縦に長く、県を選ぶと下の図表がすべてその県に切り替わる。
 *   スクロールして地図が見えなくなると「いま何県の数字を見ているのか」が
 *   分からなくなる。表示の文脈が失われる状態は、読み違いに直結する。
 *
 *   一方で、常に帯が出ていると本文の邪魔になる。
 *   元の選択欄が画面内にある間は出さない。役割が重複するし、
 *   同じ操作が2つ並ぶとどちらを触ればいいのか迷う。
 *
 *   帯には状態だけでなく操作も置く。「東京都を見ている」と分かった直後に
 *   「では大阪は」と思うのが自然で、そこで地図まで戻らせるのは無駄な往復になる。
 *
 *   色は使わない。本文と同じ地の色に薄い境界だけを引く。
 *   ここは主役ではなく、必要なときに目を上げれば分かる程度でよい。
 */
export default function StickySelection({
  prefectures,
  selected,
  onSelect,
  anchorId,
  shareText,
}: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // IntersectionObserver は交差の状態が変わったときしか発火しない。
    // アンカーを一気に飛び越えると「画面外→画面外」で状態が変わらず、
    // 発火しないまま帯が出ないことがある（素早いスクロールで実際に起きた）。
    // 位置を直接見る方が確実で、rAF で間引けば負荷も問題にならない。
    let raf = 0;
    const update = () => {
      raf = 0;
      const anchor = document.getElementById(anchorId);
      if (!anchor) return;
      setShow(anchor.getBoundingClientRect().bottom < 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [anchorId]);

  const name = selected ? prefectures[String(selected)] : "全国";

  // 共有先には、いま見ている県が乗ったそのままの URL を渡す。
  const share = () => {
    const u = new URL("https://x.com/intent/post");
    u.searchParams.set("text", shareText);
    u.searchParams.set("url", window.location.href);
    window.open(u.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className={`fixed inset-x-0 top-0 z-30 border-b border-[var(--rule)] bg-[var(--surface-1)]/95 backdrop-blur transition-all duration-200 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0"
      }`}
      aria-hidden={!show}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-5 py-3">
        {/* 名前を一番大きくする。ここに目を上げる理由は「どこを見ているか」だから。 */}
        <span aria-hidden className="text-base leading-none">📍</span>
        <span className="hidden text-xs text-[var(--text-secondary)] sm:inline">表示中</span>
        <strong className="truncate text-lg font-semibold leading-tight">{name}</strong>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <label className="sr-only" htmlFor="sticky-pref">
            都道府県を変える
          </label>
          <select
            id="sticky-pref"
            value={selected ?? ""}
            onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}
            className="rounded-md border border-[var(--rule)] bg-[var(--surface-1)] px-2 py-1.5 text-sm"
            tabIndex={show ? 0 : -1}
          >
            <option value="">全国</option>
            {Object.entries(prefectures).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          {/* 狭い画面では出さない。セレクトに「全国」があるので機能は失われない。 */}
          {selected !== null && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              tabIndex={show ? 0 : -1}
              className="hidden rounded-md border border-[var(--rule)] px-2.5 py-1.5 text-sm text-[var(--text-secondary)] sm:inline"
            >
              全国に戻す
            </button>
          )}

          {/* 「どこを見ているか」が分かった直後が、人に見せたくなる瞬間。
              いま見ている県が URL に乗っているので、渡した先でも同じ画面が開く。 */}
          <button
            type="button"
            onClick={share}
            tabIndex={show ? 0 : -1}
            aria-label="いま見ている県をXで共有する"
            className="flex items-center gap-1.5 rounded-md border border-[var(--rule)] px-2.5 py-1.5 text-sm text-[var(--text-secondary)]"
          >
            <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 fill-current">
              <path d="M18.9 1.6h3.5l-7.6 8.7 8.9 11.8h-7l-5.5-7.2-6.3 7.2H1.4l8.1-9.3L1 1.6h7.2l5 6.6zm-1.2 18.4h1.9L6.4 3.5H4.3z" />
            </svg>
            共有
          </button>
        </div>
      </div>
    </div>
  );
}
