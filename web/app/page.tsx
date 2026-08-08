import HeatApp from "@/components/HeatApp";
import type { FuturePayload, GridFuturePayload } from "@/lib/future-types";
import type { Payload } from "@/lib/types";

// pipeline の出力をビルド時に取り込む。実行時 fetch にする意味がなく、
// 初回描画で数字が空になる時間も作らずに済む。
import payload from "../public/data/series.json";
import futurePayload from "../public/data/future.json";
import gridFuturePayload from "../public/data/grid_future.json";

export default function Home() {
  return (
    <HeatApp
      data={payload as unknown as Payload}
      future={futurePayload as unknown as FuturePayload}
      gridFuture={gridFuturePayload as unknown as GridFuturePayload}
    />
  );
}
