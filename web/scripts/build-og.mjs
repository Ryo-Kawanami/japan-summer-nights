/**
 * X やリンク共有で出るカード画像（1200×630）を作る。
 *
 * ## なぜブラウザで作るのか
 *   地図の色は lib/colormap.ts にしかない。画像生成のために同じ配色を
 *   Python 側にもう一組持つと、片方だけ直したときに黙ってずれる。
 *   ビルド済みのサイトを開いて、サイト自身が描いた地図をそのまま撮れば
 *   配色の定義は1か所のままで済む。
 *
 * ## 数字の出どころ
 *   future.json から読む。画面に出している数字と同じ作り方（5年平均）で
 *   出す。カードだけ単年の大きい方を使えば、外向きにだけ話を盛ったことになる。
 *
 * 使い方: npm run build してから node scripts/build-og.mjs
 *         そのあともう一度 npm run build（public/og.png を out/ に入れるため）
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const OUT = new URL("../out/", import.meta.url).pathname;
const PUBLIC = new URL("../public/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const body = await readFile(join(root, p));
      res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, () => ok([server, server.address().port])));
}

/** from〜to 年（両端を含む）の平均。画面側の windowMean と同じ数え方。 */
function windowMean(values, years, from, to) {
  const hit = years.map((y, i) => (y >= from && y <= to ? values[i] : null))
                   .filter((v) => v != null);
  return hit.reduce((a, b) => a + b, 0) / hit.length;
}

const [server, port] = await serve(OUT);
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();

// --- 1. サイトが描いた夜の地図（いま）を撮る -------------------------------
const map = await browser.newPage({ viewport: { width: 900, height: 1400 },
                                    deviceScaleFactor: 2 });
await map.goto(`${base}/`);
await map.waitForTimeout(1500);

// 仕切りを左端に寄せると、canvas 全体が「いま」の側で埋まる。
const slider = map.locator('[role="slider"]').first();
await slider.focus();
for (let i = 0; i < 12; i++) await slider.press("Shift+ArrowLeft");
// 撮る前に操作用の飾りを消す。カードの中で動かせない操作子が写っていても意味がない。
// 仕切りのつまみと、地図に重ねている期間ラベルの両方が対象。
await map.addStyleTag({
  content: '[role="slider"], .absolute.pointer-events-none { display: none !important; }',
});
await map.waitForTimeout(400);
const canvas = map.locator("canvas").first();
const shot = (await canvas.screenshot()).toString("base64");
await map.close();

// --- 2. 数字を読む ---------------------------------------------------------
const future = JSON.parse(await readFile(join(PUBLIC, "data/future.json"), "utf8"));
const ind = future.indicators;
const years = ind.years;
const first = ind.histYears[0];
const last = ind.histYears[ind.histYears.length - 1];
const before = windowMean(ind.national.hot_nights, years, first, first + 4);
const now = windowMean(ind.national.hot_nights, years, last - 4, last);

// --- 3. カードを組んで撮る -------------------------------------------------
const card = await browser.newPage({ viewport: { width: 1200, height: 630 },
                                     deviceScaleFactor: 1 });
await card.setContent(`
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; align-items: stretch; gap: 40px;
    padding: 52px 60px; background: #fbfaf8; color: #17161a;
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .left { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .eyebrow { font-size: 22px; color: #5d5b63; letter-spacing: .04em; }
  h1 { font-size: 66px; font-weight: 700; line-height: 1.16; letter-spacing: -.01em;
       margin-top: 16px; }
  .stat { margin-top: auto; padding-top: 30px; border-top: 2px solid #e2e0dc; }
  .stat-label { font-size: 23px; color: #5d5b63; }
  .row { display: flex; align-items: baseline; gap: 20px; margin-top: 12px; }
  .num { font-size: 76px; font-weight: 700; line-height: 1;
         font-variant-numeric: tabular-nums; }
  .arrow { font-size: 38px; color: #8b8892; }
  .accent { color: #eb6834; }
  .period { margin-top: 14px; font-size: 21px; color: #5d5b63; }
  /* カードだけ切り取って貼られたときに、出どころが残るようにしておく。 */
  .foot { margin-top: 20px; font-size: 17px; color: #8b8892; white-space: nowrap; }
  .right { width: 330px; display: flex; flex-direction: column; align-items: center;
           justify-content: center; gap: 16px; }
  .right img { width: 100%; image-rendering: pixelated; border-radius: 10px;
               filter: drop-shadow(0 6px 20px rgba(0,0,0,.14)); }
  .caption { font-size: 18px; color: #5d5b63; text-align: center; }
</style>
<div class="left">
  <div class="eyebrow">人工衛星が測った ${first}–${last} 年の夏</div>
  <h1>日本の夏は、<br>夜が暑くなった</h1>
  <div class="stat">
    <div class="stat-label">特に寝苦しい夜（夏92日のうち）</div>
    <div class="row">
      <span class="num">${before.toFixed(0)}日</span>
      <span class="arrow">→</span>
      <span class="num accent">${now.toFixed(0)}日</span>
    </div>
    <div class="period">${first}–${first + 4}年の平均　→　${last - 4}–${last}年の平均</div>
    <div class="foot">NASA MODIS / JAXA Earth API　—　japan-summer-nights.mdo4nt6n.workers.dev</div>
  </div>
</div>
<div class="right">
  <img src="data:image/png;base64,${shot}" alt="">
  <div class="caption">夏の夜の地表面温度<br>${last - 4}–${last}年</div>
</div>
`);
await card.waitForTimeout(600);
const png = await card.screenshot();
await writeFile(join(PUBLIC, "og.png"), png);
console.log(`書き出し: public/og.png (${(png.length / 1024).toFixed(0)}KB) ` +
            `特に寝苦しい夜 ${before.toFixed(1)}日 → ${now.toFixed(1)}日`);

await browser.close();
server.close();
