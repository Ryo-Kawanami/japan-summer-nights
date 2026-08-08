/**
 * グレースケール PNG を「格子1つ＝数値1つ」の配列として読み戻す。
 *
 * 都道府県コードは値そのものが意味を持つので、canvas が値を書き換えないことが
 * 前提になる。ICC プロファイルを持たない L モード PNG なら等価変換になるが、
 * 前提が崩れると県の取り違えという静かな誤りになるので checkCodes で検証する。
 */

export interface Grid {
  width: number;
  height: number;
  data: Uint8Array;
}

export async function loadGrid(url: string): Promise<Grid> {
  const img = new Image();
  img.src = url;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D コンテキストを取得できない");
  ctx.drawImage(img, 0, 0);

  const { data: rgba } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
  return { width: canvas.width, height: canvas.height, data };
}

/**
 * 県コードラスタが壊れていないか確認する。
 * 想定外の値が出たら canvas が色変換をかけている。黙って間違えるより落とす。
 */
export function checkCodes(grid: Grid, maxCode: number): void {
  const seen = new Set<number>();
  for (const v of grid.data) seen.add(v);
  const bad = [...seen].filter((v) => v > maxCode);
  if (bad.length) {
    throw new Error(
      `県コードラスタに範囲外の値がある: ${bad.slice(0, 8).join(",")}。` +
        `PNG の読み戻しで色変換が入っている可能性がある。`,
    );
  }
}

/** グリッドを LUT で着色した ImageData にする。 */
export function paint(grid: Grid, lut: Uint8ClampedArray): ImageData {
  const out = new ImageData(grid.width, grid.height);
  const px = out.data;
  for (let i = 0; i < grid.data.length; i++) {
    const v = grid.data[i] * 4;
    px[i * 4] = lut[v];
    px[i * 4 + 1] = lut[v + 1];
    px[i * 4 + 2] = lut[v + 2];
    px[i * 4 + 3] = lut[v + 3];
  }
  return out;
}

/** ImageData をそのまま貼れるオフスクリーン canvas にする。 */
export function toCanvas(image: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  c.getContext("2d")!.putImageData(image, 0, 0);
  return c;
}
