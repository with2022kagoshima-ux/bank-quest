// Instagramストーリーの「下地」画像（1080×1920）を作る（すべてブラウザ内で処理）
// 投稿（正方形のフライヤー）はInstagramアプリで「投稿をシェア」して上に乗せ、リンクスタンプも手で付ける。
// そのため、この画像には ①投稿を乗せる場所 ②リンクスタンプの場所 を必ず空けておく。
// プレビューでは空ける場所を点線で表示（保存する画像には入れない）

export const STORY_W = 1080, STORY_H = 1920;
const SERIF = '"Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", "YuMincho", "Noto Serif JP", "Times New Roman", serif';
const SANS = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif';
const font = (size, family = SERIF, weight = 700) => `${weight} ${size}px ${family}`;

// リンクスタンプの場所（返信欄に隠れない高さ）
const LINK = { x: 240, y: 1650, w: 600, h: 130 };

/**
 * 構図。post = 投稿（正方形）を乗せる場所。投稿の下にはアカウント名が出るので、その分も空ける
 * top / bottom = 文章の入る範囲
 */
export const LAYOUTS = {
  standard: {
    label: '定番',
    desc: 'いつもの形。上に情報、中央に投稿、下にACT・チケット',
    post: { x: 130, y: 490, size: 820 },
    top: { y0: 160, y1: 465 },
    bottom: { y0: 1400, y1: 1625 },
  },
  info: {
    label: '情報しっかり',
    desc: '投稿を少し小さくして、ACT・チケットを大きく見やすく',
    post: { x: 170, y: 420, size: 740 },
    top: { y0: 160, y1: 395 },
    bottom: { y0: 1240, y1: 1625 },
  },
  bigdate: {
    label: '日付ドーン',
    desc: '日付を大きく。いつのライブかが一瞬で分かる',
    post: { x: 160, y: 640, size: 760 },
    top: { y0: 150, y1: 610 },
    bottom: { y0: 1490, y1: 1625 },
  },
  simple: {
    label: 'シンプル',
    desc: '見出しとひとことだけ。投稿を一番大きく',
    post: { x: 60, y: 420, size: 960 },
    top: { y0: 180, y1: 390 },
    bottom: { y0: 1460, y1: 1625 },
  },
};
export const BACKGROUNDS = {
  blur: 'フライヤーをぼかす',
  patternSame: 'いつもの柄（正方形と同じ色）',
  patternInvert: 'いつもの柄（正方形の反転色）',
  pattern: 'いつもの柄（フライヤーの色）',
  color: 'フライヤーの色のグラデーション',
};

// ---- 背景 ----
function cover(ctx, img, scale = 1) {
  const s = Math.max(STORY_W / img.width, STORY_H / img.height) * scale;
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, (STORY_W - w) / 2, (STORY_H - h) / 2, w, h);
}
// 端末によらず効くぼかし（縮小→拡大。ctx.filterがiPhoneで効かないため）
function softCanvas(src, r) {
  let w = STORY_W, cur = src;
  const target = Math.max(6, Math.round(STORY_W / Math.max(1, r)));
  while (w > target) {
    w = Math.max(target, Math.round(w / 2));
    const c = document.createElement('canvas'); c.width = w; c.height = Math.max(1, Math.round(STORY_H * w / STORY_W));
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, c.width, c.height); cur = c;
  }
  return cur;
}
function drawSoft(ctx, r) {
  if (!(r > 0)) return;
  const tmp = document.createElement('canvas'); tmp.width = STORY_W; tmp.height = STORY_H;
  tmp.getContext('2d').drawImage(ctx.canvas, 0, 0);
  let cur = softCanvas(tmp, r);
  // 少しずつ拡大して、カクカクしないようにする
  while (cur.width * 1.6 < STORY_W) {
    const c = document.createElement('canvas'); c.width = Math.round(cur.width * 1.6); c.height = Math.round(cur.height * 1.6);
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, c.width, c.height); cur = c;
  }
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const m = Math.min(40, r); ctx.drawImage(cur, -m, -m, STORY_W + m * 2, STORY_H + m * 2); ctx.restore();
}
function drawBackground(ctx, o) {
  const sq = o.squareColors || o.colors;
  const [a, b] = o.bg === 'patternSame' ? sq : o.bg === 'patternInvert' ? [sq[1], sq[0]] : (o.colors || [[20, 20, 20], [90, 90, 90]]);
  if (String(o.bg).startsWith('pattern') && o.pattern) {
    // 白黒の柄を2色で染めて画面いっぱいに
    if (o.bg === 'pattern') cover(ctx, o.pattern);
    else {
      // 正方形の画像と同じ柄の大きさ（横1080）で上から並べる（つなぎ目が目立たないよう2枚目は上下反転）
      ctx.drawImage(o.pattern, 0, 0, STORY_W, STORY_W);
      ctx.save(); ctx.translate(0, STORY_W * 2); ctx.scale(1, -1); ctx.drawImage(o.pattern, 0, 0, STORY_W, STORY_W); ctx.restore();
    }
    const id = ctx.getImageData(0, 0, STORY_W, STORY_H), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const t = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      d[i] = a[0] + (b[0] - a[0]) * t; d[i + 1] = a[1] + (b[1] - a[1]) * t; d[i + 2] = a[2] + (b[2] - a[2]) * t;
    }
    ctx.putImageData(id, 0, 0);
    // 柄をぼかす（0なら、くっきりのまま）
    drawSoft(ctx, o.soften);
  } else if (o.bg === 'color') {
    const g = ctx.createLinearGradient(0, 0, STORY_W * 0.3, STORY_H);
    const dark = (c, k) => `rgb(${c.map((v) => Math.round(v * k)).join(',')})`;
    g.addColorStop(0, dark(a, 0.55));
    g.addColorStop(0.55, dark(b, 0.45));
    g.addColorStop(1, dark(a, 0.3));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STORY_W, STORY_H);
  } else {
    cover(ctx, o.flyer, 1.25);
    drawSoft(ctx, Number.isFinite(o.soften) ? o.soften * 1.5 : 36);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 0, STORY_W, STORY_H);
  }
  // 上下を少し暗く（文字を読みやすく）
  const g = ctx.createLinearGradient(0, 0, 0, STORY_H);
  g.addColorStop(0, 'rgba(0,0,0,0.3)');
  g.addColorStop(0.3, 'rgba(0,0,0,0.05)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  // 背景を黒で暗くする（不透明度。指定がなければ背景の種類ごとの初期値）
  const dim = Number.isFinite(o.dim) ? o.dim : defaultDim(o.bg);
  if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, STORY_W, STORY_H); }
}
/** 背景の種類ごとの「暗さ」の初期値 */
export function defaultDim(bg) {
  return bg === 'pattern' ? 0.5 : (bg === 'patternSame' || bg === 'patternInvert') ? 0.35 : 0;
}
/** 文字の後ろに敷く半透明の帯 */
function textPanel(ctx, y0, y1) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  roundRectPath(ctx, 36, y0 - 24, STORY_W - 72, y1 - y0 + 48, 32);
  ctx.fill();
  ctx.restore();
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- 文字 ----
function textLine(ctx, text, cx, y, size, { family = SERIF, align = 'center', alpha = 1 } = {}) {
  ctx.save();
  ctx.font = font(size, family);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fillText(text, cx, y);
  ctx.restore();
}
/** 幅と高さに収まる大きさを決める（長い行は個別に、全体が入らなければ全体を縮める） */
function layoutBlock(ctx, lines, maxW, maxH, family = SERIF) {
  const items = lines.filter((l) => String(l.text || '').trim());
  if (!items.length) return [];
  for (let scale = 1; scale >= 0.4; scale -= 0.05) {
    const placed = items.map((l) => {
      let size = Math.round(l.size * scale);
      ctx.font = font(size, family);
      const w = ctx.measureText(l.text).width;
      if (w > maxW) size = Math.floor(size * maxW / w);
      return { text: l.text, size, h: Math.round(size * 1.28) };
    });
    if (placed.reduce((a, p) => a + p.h, 0) <= maxH) return placed;
  }
  return items.map((l) => ({ text: l.text, size: Math.round(l.size * 0.4), h: Math.round(l.size * 0.4 * 1.28) }));
}
function drawBlock(ctx, placed, cx, y0, y1, valign = 'center') {
  const total = placed.reduce((a, p) => a + p.h, 0);
  let y = valign === 'top' ? y0 : valign === 'bottom' ? y1 - total : y0 + (y1 - y0 - total) / 2;
  for (const p of placed) { textLine(ctx, p.text, cx, y, p.size); y += p.h; }
}
const lines = (txt, first, rest) => String(txt || '').split('\n').map((t, i) => ({ text: t.trim(), size: i === 0 ? first : rest }));

function drawBottom(ctx, o, area) {
  const { y0, y1 } = area;
  if (o.bottomMode === 'columns' && y1 - y0 < 200) {
    // 場所が狭い構図では、ACT と TICKET を1行ずつにまとめる
    const one = (txt) => { const [h, ...r] = String(txt || '').split('\n').map((t) => t.trim()).filter(Boolean); return r.length ? `${h.replace(/^-+|-+$/g, '')}：${r.join(' / ')}` : ''; };
    drawBlock(ctx, layoutBlock(ctx, [{ text: one(o.left), size: 42 }, { text: one(o.right), size: 42 }], 980, y1 - y0), STORY_W / 2, y0, y1, 'center');
  } else if (o.bottomMode === 'columns') {
    const big = y1 - y0 > 300; // 「情報しっかり」は大きく
    const sz = big ? 54 : 44;
    const L = layoutBlock(ctx, lines(o.left, sz, sz), 490, y1 - y0);
    const R = layoutBlock(ctx, lines(o.right, sz, sz), 490, y1 - y0);
    const size = Math.min(...[...L, ...R].map((p) => p.size));
    const even = (arr) => arr.map((p) => ({ ...p, size, h: Math.round(size * 1.3) }));
    drawBlock(ctx, even(L), STORY_W * 0.27, y0, y1, big ? 'center' : 'top');
    drawBlock(ctx, even(R), STORY_W * 0.73, y0, y1, big ? 'center' : 'top');
    // 2列の間の細い線
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(STORY_W / 2, y0 + 10); ctx.lineTo(STORY_W / 2, y1 - 10); ctx.stroke();
    ctx.restore();
  } else {
    drawBlock(ctx, layoutBlock(ctx, lines(o.message, 50, 50), 960, y1 - y0), STORY_W / 2, y0, y1, 'center');
  }
}

// ---- 空ける場所の目安（プレビューだけ） ----
function guide(ctx, x, y, w, h, label) {
  ctx.save();
  ctx.setLineDash([18, 12]);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 4;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
  textLine(ctx, label, x + w / 2, y + h / 2 - 22, 40, { family: SANS, alpha: 0.9 });
}

/**
 * opts: layout, bg, flyer（背景用）, pattern, colors, top, bottomMode, message, left, right,
 *       bigDate {main, sub}（日付ドーン用）, guides（true ならプレビュー用の点線を描く）
 */
export function composeStory(o) {
  const L = LAYOUTS[o.layout] || LAYOUTS.standard;
  const c = document.createElement('canvas');
  c.width = STORY_W; c.height = STORY_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  drawBackground(ctx, o);
  if (o.panels) { textPanel(ctx, L.top.y0, L.top.y1); textPanel(ctx, L.bottom.y0, L.bottom.y1); }

  // 上の文章
  if (o.layout === 'bigdate' && o.bigDate?.main) {
    const head = String(o.top || '').split('\n')[0];
    // 日付の行は大きな日付と重なるので省く
    const restTop = String(o.top || '').split('\n').slice(1).filter((t) => !(o.bigDate.dateText && t.includes(o.bigDate.dateText))).join('\n');
    textLine(ctx, head, STORY_W / 2, L.top.y0, 52);
    // 大きな日付
    ctx.save();
    let size = 250;
    ctx.font = font(size, SERIF, 800);
    while (ctx.measureText(o.bigDate.main).width > 960 && size > 120) { size -= 10; ctx.font = font(size, SERIF, 800); }
    ctx.restore();
    textLine(ctx, o.bigDate.main, STORY_W / 2, L.top.y0 + 70, size);
    textLine(ctx, o.bigDate.sub || '', STORY_W / 2, L.top.y0 + 70 + size * 1.02, 56);
    drawBlock(ctx, layoutBlock(ctx, lines(restTop, 44, 44), 960, L.top.y1 - (L.top.y0 + 150 + size * 1.02)), STORY_W / 2, L.top.y0 + 140 + size * 1.02, L.top.y1, 'top');
  } else {
    drawBlock(ctx, layoutBlock(ctx, lines(o.top, 60, 50), 960, L.top.y1 - L.top.y0), STORY_W / 2, L.top.y0, L.top.y1, 'bottom');
  }
  drawBottom(ctx, o, L.bottom);

  if (o.guides) {
    const p = L.post;
    guide(ctx, p.x, p.y, p.size, p.size + 70, 'ここに投稿をシェア（正方形）');
    guide(ctx, LINK.x, LINK.y, LINK.w, LINK.h, 'リンクスタンプ');
  }
  return c;
}

/** ライブ情報から、文章の初期値を作る */
export function storyDefaults({ head = '【LIVE INFO】', title = '', date = '', venue = '', performers = [], ticket = '', drink = '', message = '', extra = '' }) {
  const dateLine = [date, venue ? `📍${venue}` : ''].filter(Boolean).join(' ');
  const top = [head, title, dateLine, extra].filter(Boolean).join('\n');
  const tickets = String(ticket || '').split(/\s*[\/／、]\s*|\n/).map((t) => t.trim()).filter(Boolean).map((t) => (drink && !/\+\s*1?D/i.test(t) ? `${t}${drink.startsWith('+') ? drink : ' ' + drink}` : t));
  const left = performers.length ? ['-ACT-', ...performers].join('\n') : '';
  const right = tickets.length ? ['-TICKET-', ...tickets].join('\n') : '';
  return { top, left, right, message: message || 'チケット予約は下のリンクから！', bottomMode: left && right ? 'columns' : 'message' };
}

/** 作った正方形画像から、柄の2色（暗い色・明るい色）を読み取る（色が記録されていない以前の画像用） */
export function colorsFromSquare(img) {
  const n = 200;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, n, n);
  // 左右の端（フライヤーがかからない柄の部分）
  const px = [];
  for (const x0 of [0, n - 12]) {
    const d = ctx.getImageData(x0, 0, 12, n).data;
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
  }
  const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
  px.sort((p, q) => lum(p) - lum(q));
  const avg = (arr) => [0, 1, 2].map((k) => Math.round(arr.reduce((s, p) => s + p[k], 0) / arr.length));
  const k = Math.max(1, Math.floor(px.length * 0.08));
  return [avg(px.slice(0, k)), avg(px.slice(-k))];
}
