"use client";

import type { ReactNode } from "react";

interface Props {
  term: string;
  children: ReactNode;
}

/**
 * 専門用語のその場解説。
 *
 * 知っている人の読みを止めず、知らない人には手が届く形にしたいので、
 * 本文に注釈を挟み込まずに折りたたむ。details/summary を使うのは
 * キーボード操作とスクリーンリーダー対応が最初から付いてくるため。
 * 自前の開閉ボタンにすると、そこを作り直すことになる。
 */
export default function Explainer({ term, children }: Props) {
  return (
    <details className="group inline-block align-baseline">
      <summary className="inline cursor-pointer list-none decoration-dotted underline-offset-4 [&::-webkit-details-marker]:hidden">
        <span className="underline decoration-dotted underline-offset-4">{term}</span>
        <span
          aria-hidden
          className="ml-1 inline-flex h-4 w-4 translate-y-[1px] items-center justify-center rounded-full border border-current text-[10px] leading-none opacity-70 group-open:opacity-100"
        >
          ?
        </span>
      </summary>
      <span className="mt-2 block rounded-lg border border-[var(--rule)] bg-[var(--surface-1)] p-3 text-xs font-normal leading-relaxed text-[var(--text-secondary)]">
        {children}
      </span>
    </details>
  );
}
