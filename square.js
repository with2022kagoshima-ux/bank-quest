// フライヤーを正方形の柄（白黒）の上に乗せた SNS 用画像を作る（すべてブラウザ内で処理）
// 1) フライヤーから色を取り出す  2) 白黒の柄をその2色で染める（暗部→色A、明部→色B）
// 3) フライヤーを高さいっぱい・中央に配置

const rgbToHsv = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, max ? d / max : 0, max];
};
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const hueDist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 1 - d); };
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function pixelsOf(img, size = 120) {
  const w = size, h = Math.max(1, Math.round(size * img.height / img.width));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const px = [];
  for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
  return px;
}

/** フライヤーの色を分析して、背景の柄に使う色の組み合わせ候補を返す */
export function analyzeColors(img) {
  const px = pixelsOf(img);
  const n = px.length;
  const hsv = px.map((p) => rgbToHsv(...p));
  // 色相ごとの「鮮やかな色」の量
  const BINS = 24;
  const bins = Array.from({ length: BINS }, () => []);
  hsv.forEach(([h, s, v], i) => { if (s > 0.4 && v > 0.3) bins[Math.floor(h * BINS) % BINS].push(i); });
  const merged = bins.map((b, i) => ({ i, idx: [...b, ...bins[(i + 1) % BINS]] }))
    .sort((a, b) => b.idx.length - a.idx.length);
  const vividColor = (idx) => {
    // その色相の中で、鮮やかさ・明るさが高めの代表色
    const s = idx.map((i) => hsv[i][1]), v = idx.map((i) => hsv[i][2]);
    const sT = pct(s, 0.5), vT = pct(v, 0.5);
    const pick = idx.filter((i) => hsv[i][1] >= sT && hsv[i][2] >= vT * 0.9);
    const use = pick.length ? pick : idx;
    return [0, 1, 2].map((k) => median(use.map((i) => px[i][k])));
  };
  // デザイナーがテーマ色に選びやすい「面積がある程度あって、鮮やかで明るい色」を優先する
  const scored = merged.filter((m) => m.idx.length / n >= 0.01).map((m) => {
    const col = vividColor(m.idx);
    const [h, s2, v] = rgbToHsv(...col);
    const share = m.idx.length / n;
    return { col, h, share, score: Math.sqrt(share) * s2 * s2 * Math.pow(v, 1.5) };
  }).sort((x, y) => y.score - x.score);
  const hues = [];
  for (const c of scored) {
    if (hues.every((x) => hueDist(x.h, c.h) > 0.08)) hues.push(c);
    if (hues.length >= 3) break;
  }
  // 暗い色・明るい色（無彩色も含む）の代表
  const dark = px.filter((p) => lum(p) < 0.25), light = px.filter((p) => lum(p) > 0.8);
  const avg = (arr) => [0, 1, 2].map((k) => median(arr.map((p) => p[k])));
  const darkCol = dark.length / n > 0.08 ? avg(dark) : [0, 0, 0];
  const lightCol = light.length / n > 0.08 ? avg(light) : [255, 255, 255];

  const base = hues[0]?.col || avg(px);
  const out = [];
  const add = (a, b, label) => {
    if (Math.abs(lum(a) - lum(b)) < 0.18 && hueDist(rgbToHsv(...a)[0], rgbToHsv(...b)[0]) < 0.1) return;
    if (out.some((o) => hex(o.colors[0]) === hex(a) && hex(o.colors[1]) === hex(b))) return;
    out.push({ colors: [a, b], label });
  };
  // 基本：メインの色 × 明暗で一番目立つ相手（白か黒、またはフライヤー内の濃い色）
  const partner = lum(base) > 0.55 ? darkCol : lightCol;
  add(base, partner, 'メインの色');
  add(partner, base, 'メインの色（反転）');
  if (hues[1]) add(base, hues[1].col, 'メイン＋差し色');
  if (hues[1]) add(hues[1].col, base, '差し色＋メイン');
  add(base, lum(base) > 0.55 ? [255, 255, 255] : [0, 0, 0], lum(base) > 0.55 ? 'メイン＋白' : 'メイン＋黒');
  if (hues[2]) add(base, hues[2].col, 'メイン＋もう1色');
  return out.slice(0, 5).map((o) => ({ ...o, hex: o.colors.map(hex) }));
}

/** 白黒の柄を2色で染めた正方形にフライヤーを乗せる。colors=[柄の黒い部分の色, 白い部分の色] */
export function composeSquare(flyer, pattern, colors, size = 1080) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // 柄（正方形いっぱいに）
  ctx.drawImage(pattern, 0, 0, size, size);
  const id = ctx.getImageData(0, 0, size, size);
  const d = id.data;
  const [a, b] = colors;
  for (let i = 0; i < d.length; i += 4) {
    const t = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    d[i] = a[0] + (b[0] - a[0]) * t;
    d[i + 1] = a[1] + (b[1] - a[1]) * t;
    d[i + 2] = a[2] + (b[2] - a[2]) * t;
    d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  // フライヤー（高さいっぱい・中央。横長なら幅いっぱい）
  let h = size, w = Math.round(flyer.width * size / flyer.height);
  if (w > size) { w = size; h = Math.round(flyer.height * size / flyer.width); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(flyer, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  return c;
}

export const toHex = hex;
