// SNS用画像づくり(正方形・ストーリー下地)。managerの square.js / story.js を使う
import { analyzeColors, composeSquare, toHex } from './square.js?v=50';
import { composeStory, storyDefaults, defaultDim, colorsFromSquare, LAYOUTS, BACKGROUNDS } from './story.js?v=78';
import * as R from './rules.js?v=81';

const loadImg = (src) => new Promise((ok, ng) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => ng(new Error('画像を読み込めませんでした')); i.src = src; });
const hexToRgb = (s) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
const toFile = (cv, name) => new Promise(ok => cv.toBlob(b => ok(new File([b], name, { type: 'image/jpeg' })), 'image/jpeg', 0.92));

export async function loadAssets(flyerUrl) { return Promise.all([loadImg(flyerUrl), loadImg('square-pattern.jpg')]); }
export { loadImg, colorsFromSquare, R };

/** 正方形づくり。ui = { h, modal, toast } 。onSave(file) は保存処理 */
export async function squareMaker(ui, flyerUrl, name, onSave) {
  const { h, modal, toast } = ui;
  let flyer, pattern;
  try { [flyer, pattern] = await loadAssets(flyerUrl); } catch (e) { toast(e.message, 'err'); return; }
  const cands = analyzeColors(flyer);
  let cur = cands[0]?.colors || [[0, 0, 0], [255, 255, 255]];
  const prev = h('canvas', { style: 'width:100%;max-width:340px;border-radius:12px;display:block;margin:0 auto' });
  const ca = h('input', { type: 'color' }), cb = h('input', { type: 'color' });
  const draw = () => {
    ca.value = toHex(cur[0]); cb.value = toHex(cur[1]);
    prev.width = prev.height = 540; prev.getContext('2d').drawImage(composeSquare(flyer, pattern, cur, 1080), 0, 0, 540, 540);
  };
  ca.oninput = () => { cur = [hexToRgb(ca.value), cur[1]]; draw(); };
  cb.oninput = () => { cur = [cur[0], hexToRgb(cb.value)]; draw(); };
  const cbox = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin:10px 0' },
    ...cands.map(c => h('button', { type: 'button', class: 'btn ghost small', style: 'padding:6px', onclick: () => { cur = c.colors; draw(); } },
      h('span', { style: `display:block;height:22px;border-radius:6px;background:linear-gradient(90deg,${toHex(c.colors[0])} 50%,${toHex(c.colors[1])} 50%)` }), h('span', { style: 'font-size:11px' }, c.label))));
  const ok = h('button', { class: 'btn big', onclick: async () => {
    ok.disabled = true; ok.textContent = '保存中…';
    try { const f = await toFile(composeSquare(flyer, pattern, cur, 1080), name); await onSave(f, cur); m.close(); } catch (e) { toast(e.message || '保存できませんでした', 'err'); ok.disabled = false; ok.textContent = 'この画像を保存'; }
  } }, 'この画像を保存');
  const dl = h('button', { class: 'btn ghost', onclick: async () => { const f = await toFile(composeSquare(flyer, pattern, cur, 1080), name); const a = h('a', { href: URL.createObjectURL(f), download: name }); document.body.append(a); a.click(); a.remove(); } }, 'ダウンロード');
  const m = modal([h('h3', {}, '🟦 正方形のSNS用画像'), h('p', { class: 'hint' }, 'フライヤーの色から柄の色を選びました。候補を選ぶか、下で色を直せます。'), prev, cbox,
    h('div', { class: 'with-btn', style: 'gap:12px;margin-bottom:10px' }, h('label', { class: 'small' }, '暗い部分 ', ca), h('label', { class: 'small' }, '明るい部分 ', cb)),
    h('div', { class: 'row' }, dl, ok)]);
  draw();
}

/** ストーリー下地づくり */
export async function storyMaker(ui, flyerUrl, squareUrl, d0, name, onSave) {
  const { h, modal, toast } = ui;
  let flyer, pattern, sq = null;
  try { [flyer, pattern] = await loadAssets(flyerUrl); if (squareUrl) sq = await loadImg(squareUrl).catch(() => null); } catch (e) { toast(e.message, 'err'); return; }
  const squareColors = sq ? colorsFromSquare(sq) : null;
  const colors = analyzeColors(flyer)[0]?.colors || [[0, 0, 0], [255, 255, 255]];
  const d = storyDefaults(d0.def);
  const p = R.parseYmd(d0.ymd || '');
  const WEEK_EN = { 日: 'SUN', 月: 'MON', 火: 'TUE', 水: 'WED', 木: 'THU', 金: 'FRI', 土: 'SAT' };
  const bigDate = p ? { main: `${p.mo}.${p.d}`, sub: `${WEEK_EN[p.w] || ''}${d0.def.venue ? `  📍${d0.def.venue}` : ''}`, dateText: d0.def.date } : null;
  let layout = String(d.left || '').split('\n').filter(Boolean).length > 9 ? 'many' : 'standard', bg = squareColors ? 'patternSame' : 'blur', dim = Math.round(defaultDim(bg) * 100), soft = bg === 'blur' ? 24 : 0, mode = d.bottomMode;
  const txt = (v, rows) => { const t = h('textarea', { rows, class: 'area', autocomplete: 'off' }); t.value = v; return t; };
  const top = txt(d.top, 4), left = txt(d.left, 5), right = txt(d.right, 5), msg = txt(d.message, 2);
  const prev = h('canvas', { style: 'width:100%;max-width:300px;border-radius:12px;display:block;margin:0 auto' });
  const opts = (extra = {}) => ({ layout, bg, flyer, pattern, colors, squareColors, bigDate, dim: dim / 100, soften: soft, panels: false, top: top.value, bottomMode: mode, left: left.value, right: right.value, message: msg.value, ...extra });
  const colsBox = h('div', { class: 'grid two' }, h('label', { class: 'field' }, '左(ACT)', left), h('label', { class: 'field' }, '右(TICKET)', right));
  const msgBox = h('label', { class: 'field' }, 'ひとこと', msg);
  const dimIn = h('input', { type: 'range', min: 0, max: 80, step: 5, value: dim }), softIn = h('input', { type: 'range', min: 0, max: 30, step: 2, value: soft });
  const draw = () => {
    colsBox.hidden = mode !== 'columns'; msgBox.hidden = mode !== 'message';
    prev.width = 540; prev.height = 960; prev.getContext('2d').drawImage(composeStory(opts({ guides: true })), 0, 0, 540, 960);
  };
  const lay = h('div', { class: 'chips' });
  const drawLay = () => lay.replaceChildren(...Object.entries(LAYOUTS).filter(([k]) => k !== 'bigdate' || bigDate).map(([k, L]) =>
    h('button', { type: 'button', class: 'chip' + (k === layout ? ' on' : ''), onclick: () => { layout = k; drawLay(); draw(); } }, h('span', { class: 'chip-main' }, L.label), h('span', { class: 'chip-sub' }, L.desc))));
  const bgSel = h('select', {}); const drawBg = () => { bgSel.replaceChildren(...Object.entries(BACKGROUNDS).filter(([k]) => squareColors || !['patternSame', 'patternInvert'].includes(k)).map(([k, l]) => h('option', { value: k, selected: k === bg ? '' : null }, l))); bgSel.value = bg; };
  bgSel.onchange = () => { bg = bgSel.value; dim = Math.round(defaultDim(bg) * 100); dimIn.value = dim; soft = bg === 'blur' ? 24 : 0; softIn.value = soft; draw(); };
  dimIn.oninput = () => { dim = +dimIn.value; draw(); }; softIn.oninput = () => { soft = +softIn.value; draw(); };
  [top, left, right, msg].forEach(t => t.addEventListener('input', draw));
  const modeSel = h('select', {}, h('option', { value: 'columns' }, '下:ACT と TICKET'), h('option', { value: 'message' }, '下:ひとこと')); modeSel.value = mode; modeSel.onchange = () => { mode = modeSel.value; draw(); };
  const blob = () => toFile(composeStory(opts({ guides: false })), name);
  const ok = h('button', { class: 'btn big', onclick: async () => { ok.disabled = true; ok.textContent = '保存中…'; try { await onSave(await blob()); m.close(); } catch (e) { toast(e.message || '保存できませんでした', 'err'); ok.disabled = false; ok.textContent = 'この画像を保存'; } } }, 'この画像を保存');
  const dl = h('button', { class: 'btn ghost', onclick: async () => { const f = await blob(); const a = h('a', { href: URL.createObjectURL(f), download: name }); document.body.append(a); a.click(); a.remove(); } }, 'ダウンロード');
  const m = modal([h('h3', {}, '📱 ストーリーの下地'), h('p', { class: 'hint' }, '投稿(正方形)とリンクスタンプはInstagramアプリで上に乗せます。点線はプレビューだけで、保存する画像には入りません。'),
    lay, prev, h('label', { class: 'field' }, '背景', bgSel), h('label', { class: 'field' }, '背景の暗さ', dimIn), h('label', { class: 'field' }, '背景のぼかし', softIn),
    h('label', { class: 'field' }, '上の文章(1行目は見出し)', top), modeSel, colsBox, msgBox, h('div', { class: 'row', style: 'margin-top:10px' }, dl, ok)]);
  drawLay(); drawBg(); (document.fonts?.ready || Promise.resolve()).then(draw);
}
