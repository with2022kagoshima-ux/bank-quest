// Wiθ MONEY — 画面
import { api, DEMO, ApiError, ymd, queued, flushQueue } from './api.js?v=89';
import * as R from './rules.js?v=92';
import { squareMaker, storyMaker } from './snsmk.js?v=92';
import { decodeCsv, sha256, parseAir, keyOf, autoMatch, isOvernight } from './air.js?v=89';

// replaceChildren は null を文字の「null」にしてしまうため、空の要素は取り除く
const _rc = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...k) { return _rc.apply(this, k.filter(x => x != null && x !== false)); };
const $app = document.getElementById('app');
const yen = n => (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
const state = { people: [], cats: [], by: localStorage.getItem('withi_by') || '' };
let renderId = 0;

// ---------- 小さなDOM組み立て(文字は常にテキストとして入れる) ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---------- 通知・演出 ----------
function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}
function getFx(text, sub) {
  const el = h('div', { class: 'getfx' }, h('div', { class: 'getfx-big' }, text), h('div', { class: 'getfx-sub' }, sub));
  document.body.append(el);
  setTimeout(() => el.remove(), 1400);
}
function modal(content) {
  const back = h('div', { class: 'modal-back' });
  const box = h('div', { class: 'modal', role: 'dialog' }, content);
  back.append(box);
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  document.body.append(back);
  return { close: () => back.remove() };
}
function confirmBox(title, body, okLabel) {
  return new Promise(res => {
    const m = modal([
      h('h3', {}, title), h('p', { class: 'muted', style: 'max-height:55dvh;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y' }, body),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => { m.close(); res(false); } }, 'やめる'),
        h('button', { class: 'btn danger', onclick: () => { m.close(); res(true); } }, okLabel)),
    ]);
  });
}
function errMsg(e) { return e instanceof ApiError || e instanceof Error ? e.message : '不明なエラー'; }

// ---------- 部品 ----------
function chips(items, selected, onPick, opt = {}) {
  const wrap = h('div', { class: 'chips' });
  const draw = sel => {
    wrap.replaceChildren(...items.map(it => h('button', {
      type: 'button', class: 'chip' + (it.id === sel ? ' on' : '') + (it.disabled ? ' dis' : ''), disabled: it.disabled,
      onclick: () => { if (it.disabled) return; draw(it.id); onPick(it.id, it); },
    }, h('span', { class: 'chip-main' }, it.label), it.sub ? h('span', { class: 'chip-sub' }, it.sub) : null)));
  };
  draw(selected);
  wrap.select = draw;
  return wrap;
}
function amountField(init) {
  const input = h('input', { class: 'amount', inputmode: 'numeric', autocomplete: 'off', placeholder: '0', 'aria-label': '金額(円)' });
  const fmt = () => { const d = input.value.replace(/[^0-9]/g, ''); input.value = d ? Number(d).toLocaleString('ja-JP') : ''; };
  input.addEventListener('input', fmt);
  if (init) { input.value = String(init); fmt(); }
  return { el: h('div', { class: 'amount-wrap' }, h('span', { class: 'yen' }, '¥'), input), raw: () => input.value, get: () => Number(input.value.replace(/[^0-9]/g, '')), set: v => { input.value = String(v); fmt(); } };
}
let fieldSeq = 0;
// ボタン(チップ)を含む欄を <label> で包むと、どのボタンを押しても先頭のボタンが押されたことになる。
// そのため枠は div にし、入力欄(input)があるときだけ for= で結びつける。
function field(label, el, hint) {
  const input = el.tagName === 'INPUT' ? el : el.querySelector && el.querySelector('input');
  let id = '';
  if (input) { id = 'f' + (++fieldSeq); input.id = id; }
  return h('div', { class: 'field' }, h(input ? 'label' : 'span', { class: 'field-label', for: input ? id : null }, label), el, hint ? h('span', { class: 'hint' }, hint) : null);
}
const nameOf = id => (state.people.find(p => p.id === id) || {}).name || '';

// ---------- 枠 ----------
function shell(title, content, back = '#/home') {
  const by = nameOf(state.by);
  return h('div', { class: 'screen' },
    h('header', { class: 'top' },
      back ? h('a', { class: 'back', href: back, 'aria-label': '戻る' }, '‹') : h('span', { class: 'back-sp' }),
      h('div', { class: 'title' }, title),
      h('button', { class: 'bychip', onclick: openMenu, 'aria-label': '入力者を変更' }, '👤 ', by || '選ぶ')),
    h('main', {}, content));
}
// 商品写真(AIRレジの画像)。読み込めない時や写真が無い時は絵文字にもどす
function thumb(p, big) {
  const fb = () => h('span', { class: 'lico' }, '👕');
  if (!p.image_url) return big ? null : fb();
  const img = h('img', { class: big ? 'pimg big' : 'pimg', src: String(p.image_url).split('?')[0], alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => { if (img.parentNode) img.replaceWith(...(big ? [] : [fb()])); });
  return img;
}
// ---------- 領収書(撮影・アップロード) ----------
async function shrinkImage(file, MAX = 1600, Q = 0.72) {
  if (file.type === 'application/pdf') return file;
  if (!/^image\//.test(file.type)) throw new Error('画像かPDFを選んでください');
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', Q));
    if (blob) return new File([blob], 'receipt.jpg', { type: 'image/jpeg' });
  } catch { /* 縮小できない形式は、そのまま送る */ }
  if (file.size > (MAX > 1600 ? 10 : 5) * 1024 * 1024) throw new Error('ファイルが大きすぎます(' + (MAX > 1600 ? 10 : 5) + 'MBまで)');
  return file;
}
function receiptPicker() {
  const files = [];
  const strip = h('div', { class: 'rthumbs' });
  const draw = () => strip.replaceChildren(...files.map((f, i) => h('div', { class: 'rthumb' },
    f.type === 'application/pdf' ? h('span', { class: 'rpdf' }, 'PDF') : h('img', { src: URL.createObjectURL(f), alt: '' }),
    h('button', { type: 'button', class: 'rx', 'aria-label': '外す', onclick: () => { files.splice(i, 1); draw(); } }, '✕'))));
  const mk = (label, attrs) => {
    const inp = h('input', { type: 'file', style: 'display:none', ...attrs });
    inp.addEventListener('change', async () => {
      for (const f of [...inp.files]) { try { files.push(await shrinkImage(f)); } catch (e) { toast(e.message || '読み込めませんでした', 'err'); } }
      inp.value = ''; draw();
    });
    return h('span', {}, inp, h('button', { type: 'button', class: 'btn ghost small', onclick: () => inp.click() }, label));
  };
  const el = h('div', { class: 'field' }, h('span', { class: 'field-label' }, '🧾 領収書(あとからでもOK)'),
    h('div', { class: 'with-btn', style: 'gap:8px;flex-wrap:wrap' }, mk('📷 撮影する', { accept: 'image/*', capture: 'environment' }), mk('🖼 写真・PDFを選ぶ', { accept: 'image/*,application/pdf', multiple: true })), strip);
  return { el, files: () => files.slice() };
}
async function uploadReceipts(entryId, files) {
  let fail = 0;
  for (const f of files) { try { await api.addReceipt(entryId, f, state.by); } catch (e) { fail++; } }
  if (fail) toast(`領収書${fail}枚を保存できませんでした。履歴の🧾からもう一度追加できます`, 'err');
}
async function receiptModal(entry, done) {
  const list = h('div', { class: 'rthumbs' }, loading());
  const picker = receiptPicker();
  const m = modal([h('h3', {}, '🧾 領収書'), h('p', { class: 'muted' }, `${String(entry.occurred_on).slice(5).replace('-', '/')}  ${entry.memo || entry.category_name || ''}  ${yen(entry.amount)}`),
    list, picker.el,
    h('button', { class: 'btn big out', onclick: async e => {
      const fs = picker.files(); if (!fs.length) { m.close(); done(); return; }
      e.target.disabled = true; await uploadReceipts(entry.id, fs); m.close(); toast('領収書を保存しました', 'ok'); done();
    } }, '保存して閉じる')]);
  const draw = async () => {
    try {
      const rs = await api.receiptsOf(entry.id);
      const urls = await Promise.all(rs.map(r => api.receiptUrl(r.path).catch(() => null)));
      list.replaceChildren(...(rs.length ? rs.map((r, i) => h('div', { class: 'rthumb big' },
        r.mime === 'application/pdf' ? h('a', { class: 'rpdf', href: urls[i] || '#', target: '_blank', rel: 'noopener' }, 'PDF') : h('a', { href: urls[i] || '#', target: '_blank', rel: 'noopener' }, h('img', { src: urls[i] || '', alt: '領収書' })),
        h('button', { type: 'button', class: 'rx', 'aria-label': '削除', onclick: async () => {
          if (!(await confirmBox('この領収書を削除する？', '写真は完全に消えます。', '削除する'))) return;
          try { await api.removeReceipt(r); await draw(); } catch (er) { toast(errMsg(er), 'err'); }
        } }, '🗑'))) : [h('p', { class: 'hint' }, 'まだ領収書がありません。')]));
    } catch (e) { list.replaceChildren(h('p', { class: 'form-err' }, errMsg(e))); }
  };
  draw();
}
const receiptBtn = (r, counts, done) => (['expense_fund', 'expense_advanced'].includes(r.kind) && !r.reverses_id)
  ? h('button', { class: 'undo', 'aria-label': '領収書', onclick: () => receiptModal(r, done) }, '🧾' + ((counts.get(r.id) || 0) ? ' ' + counts.get(r.id) : '')) : null;
const countMap = rows => { const m = new Map(); for (const x of rows) m.set(x.entry_id, (m.get(x.entry_id) || 0) + 1); return m; };

// 定期費用: 期限の何日前からお知らせするか(ルールごと)
const dayDiff = (due, today) => Math.round((new Date(String(due).slice(0, 10) + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
const dueText = d => (d < 0 ? `${-d}日すぎています` : d === 0 ? '今日が支払日' : `あと${d}日`);
const isNoticeTime = (r, today) => r.is_active && dayDiff(r.next_due, today) <= (r.notice_days == null ? 0 : r.notice_days);
function loading() { return h('div', { class: 'loading' }, h('div', { class: 'spin' }), '読み込み中…'); }
function errorBox(e, retry) {
  return h('div', { class: 'errbox' }, h('p', {}, '⚠️ ' + errMsg(e)),
    e && e.code === 'auth' ? h('a', { class: 'btn', href: '#/login' }, 'ログイン画面へ') : h('button', { class: 'btn', onclick: retry }, 'もう一度読み込む'));
}

// ---------- 入力者の選択 ----------
function pickBy(force) {
  const cands = state.people.filter(p => p.can_input);
  return new Promise(res => {
    const m = modal([
      h('h3', {}, '今日は誰が入力する？'),
      h('p', { class: 'muted' }, '記録に「誰が入力したか」が残ります。'),
      chips(cands.map(p => ({ id: p.id, label: p.name })), state.by, id => {
        state.by = id; localStorage.setItem('withi_by', id); m.close(); res(id); route();
      }),
      force ? null : h('button', { class: 'btn ghost', onclick: () => { m.close(); res(null); } }, '閉じる'),
    ]);
  });
}
function legalLinks() {
  return h('div', { class: 'legal' },
    h('p', {}, 'このアプリは YouTube API サービスを利用して、動画を YouTube にアップロードします。'),
    h('p', {}, h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'プライバシーポリシー'), ' ・ ',
      h('a', { href: 'terms.html', target: '_blank', rel: 'noopener' }, '利用規約'), ' ・ ',
      h('a', { href: 'https://www.youtube.com/t/terms', target: '_blank', rel: 'noopener' }, 'YouTube利用規約'), ' ・ ',
      h('a', { href: 'https://policies.google.com/privacy', target: '_blank', rel: 'noopener' }, 'Googleプライバシーポリシー')));
}
function openMenu() {
  const m = modal([
    h('h3', {}, 'メニュー'),
    h('p', { class: 'muted' }, '入力者: ' + (nameOf(state.by) || '未選択')),
    h('button', { class: 'btn', onclick: () => { m.close(); pickBy(false); } }, '入力者を変える'),
    DEMO ? h('p', { class: 'muted' }, 'デモ表示中（架空のデータ・保存されません）') :
      h('button', { class: 'btn ghost', onclick: () => { api.logout(); m.close(); location.hash = '#/login'; } }, 'ログアウト'),
    legalLinks(),
    h('p', { class: 'ver' }, 'Wiθ BANK QUEST  ・ 版 11/27-92'),
  ]);
}

// ---------- ログイン ----------
function loginView() {
  const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'メールアドレス', value: localStorage.getItem('withi_email') || '' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'パスコード' });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const btn = h('button', { class: 'btn big', type: 'submit' }, 'ゲームスタート');
  const form = h('form', { class: 'login', onsubmit: async ev => {
    ev.preventDefault(); msg.textContent = ''; btn.disabled = true;
    try { await api.login(email.value.trim(), pass.value); localStorage.setItem('withi_email', email.value.trim()); await boot(); location.hash = '#/home'; }
    catch (e) { msg.textContent = errMsg(e); btn.disabled = false; }
  } }, h('div', { class: 'logo' }, 'Wiθ', h('span', {}, 'BANK QUEST')), field('メール', email), field('パスコード', pass), msg, btn, legalLinks());
  $app.replaceChildren(h('div', { class: 'screen center' }, form));
}

// ---------- HOME ----------
async function homeView() {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('', body, null));
  try {
    const d = await api.home();
    if (my !== renderId) return;
    const rules = await api.recurring().catch(() => []);
    const dueRules = rules.filter(r => isNoticeTime(r, ymd())).sort((x, y) => String(x.next_due).localeCompare(String(y.next_due)));
    const pend = queued();
    const claims = await api.claims().catch(() => []);
    const bd = DEMO ? 0 : daysSince(lastBackup());
    const payable = d.balances.reduce((s, b) => s + b.withi_owes, 0);
    const recv = d.balances.reduce((s, b) => s + b.owes_withi, 0);
    const btn = (cls, ico, label, href, sub) => h(href ? 'a' : 'div', { class: 'qa ' + cls + (href ? '' : ' soon'), href }, h('span', { class: 'qa-ico' }, ico), h('span', { class: 'qa-label' }, label), sub ? h('span', { class: 'qa-sub' }, sub) : null);
    body.replaceChildren(
      pend.length ? h('section', { class: 'card', style: 'border-color:var(--yellow)' }, h('div', { class: 'cap' }, `⏳ 未送信の記録 ${pend.length}件`),
        h('p', { class: 'hint' }, '電波がなかったため、スマホに一時保存しています。つながると自動で送ります。'),
        h('button', { class: 'btn small', onclick: async () => { const r = await flushQueue(); toast(r.left ? `${r.sent}件送りました。残り${r.left}件` : '送りました', r.left ? 'err' : 'ok'); homeView(); } }, '今すぐ送る')) : null,
      claims.length ? h('section', { class: 'card', style: 'border-color:var(--yellow)' }, h('div', { class: 'cap' }, `🕓 審査中の請求(${claims.length}件 ${yen(claims.reduce((x, c) => x + c.amount, 0))})`),
        h('p', { class: 'hint' }, '承認するまで、利益・未払い・精算には入りません。'),
        ...claims.map(c => claimRow(c, homeView))) : null,
      dueRules.length ? h('section', { class: 'card', style: 'border-color:var(--pink)' }, h('div', { class: 'cap' }, `🔁 定期費用のお知らせ(${dueRules.length}件)`),
        ...dueRules.slice(0, 5).map(r => h('div', { class: 'brow due' }, h('span', {}, `${r.name} ${yen(r.amount)}`, h('small', { style: 'display:block;color:var(--muted)' }, dshow(r.next_due) + ' ・' + dueText(dayDiff(r.next_due, ymd())) + (r.payer ? ' ・' + r.payer.name + 'が立替' : ''))),
          h('span', {}, h('button', { class: 'undo', onclick: async () => { if (!state.by) { await pickBy(true); if (!state.by) return; } try { await api.postRecurring({ rule: r.id, date: (String(r.next_due).slice(0, 10) > ymd() ? ymd() : String(r.next_due).slice(0, 10)), skip: false, by: state.by }); getFx('−' + yen(r.amount), r.payer ? '立替を記録' : 'PAID'); homeView(); } catch (e) { toast(errMsg(e), 'err'); } } }, '記録する'),
            h('button', { class: 'undo', onclick: async () => { if (await confirmBox('今回はとばす？', `${r.name} ${dshow(r.next_due)} 分は記録せず、次の回に進めます。`, 'とばす')) { try { await api.postRecurring({ rule: r.id, date: String(r.next_due).slice(0, 10), skip: true, by: state.by }); homeView(); } catch (e) { toast(errMsg(e), 'err'); } } } }, 'とばす'))))) : null,
      !DEMO && (bd == null || bd >= 30) ? h('a', { class: 'card', href: '#/backup', style: 'display:block' }, h('div', { class: 'cap' }, '💾 バックアップ'), h('p', { class: 'hint' }, bd == null ? 'まだバックアップを作っていません。タップして作る' : `最後のバックアップから${bd}日たっています。タップして作る`)) : null,
      h('section', { class: 'card fund' }, h('div', { class: 'cap' }, '💰 現在のWiθ資金'), h('div', { class: 'big' + (d.fund < 0 ? ' neg' : '') }, yen(d.fund))),
      h('section', { class: 'card' }, h('div', { class: 'cap' }, '📈 THIS MONTH'),
        h('div', { class: 'trio' },
          h('div', {}, h('small', {}, '売上'), h('b', { class: 'pos' }, yen(d.month.income))),
          h('div', {}, h('small', {}, '出費'), h('b', { class: 'neg' }, yen(d.month.expense))),
          h('div', {}, h('small', {}, '利益'), h('b', { class: d.month.profit < 0 ? 'neg' : 'pos' }, yen(d.month.profit)))),
        payable > 0 ? h('p', { class: 'note' }, `利益には、まだ払っていない立替 ${yen(payable)} が含まれています（資金はまだ減っていません）。`) : null),
      h('section', { class: 'duo' },
        h('div', { class: 'card mini' }, h('div', { class: 'cap' }, 'Wiθ → メンバー'), h('b', {}, yen(payable)), h('small', {}, '未払い（返す）')),
        h('div', { class: 'card mini' }, h('div', { class: 'cap' }, 'メンバー → Wiθ'), h('b', {}, yen(recv)), h('small', {}, '借入（返してもらう）'))),
      h('div', { class: 'cap sec' }, '⚡ QUICK ACTION'),
      h('div', { class: 'qa-grid' },
        btn('in', '💰', 'お金が入った', '#/in'), btn('out', '💸', 'お金を使った', '#/out'),
        btn('loan', '👤', 'メンバーがWiθのお金を借りた', '#/loan?mode=loan'), btn('repay', '💵', 'メンバーが返済した', '#/loan?mode=repay'),
        btn('reim', '🔁', '立替を返す・相殺', '#/loan?mode=reimburse'), btn('hist', '📜', '履歴・取消', '#/history'),
        btn('live', '🎸', 'ライブ', '#/live-list'), btn('merch', '👕', '商品・在庫', '#/merch'), btn('manage', '🛠️', '管理', '#/manage', '定期費用・テンプレ・バックアップ'), btn('analysis', '📊', '分析', '#/analysis', '月別・カテゴリ別・ライブ別・売れ筋')),
      d.balances.some(b => b.owes_withi || b.withi_owes) ? h('section', { class: 'card' }, h('div', { class: 'cap' }, '👥 メンバーごと'),
        d.balances.filter(b => b.owes_withi || b.withi_owes).map(b => h('div', { class: 'brow' }, h('span', {}, b.name),
          h('span', {}, b.owes_withi ? h('i', { class: 'tag recv' }, '借入 ' + yen(b.owes_withi)) : null, b.withi_owes ? h('i', { class: 'tag pay' }, '未払い ' + yen(b.withi_owes)) : null)))) : null);
  } catch (e) {
    if (my !== renderId) return;
    if (e && e.code === 'net') {
      const q = (cls, ico, label, href) => h('a', { class: 'qa ' + cls, href }, h('span', { class: 'qa-ico' }, ico), h('span', { class: 'qa-label' }, label));
      body.replaceChildren(h('section', { class: 'card', style: 'border-color:var(--yellow)' }, h('div', { class: 'cap' }, '📴 いまは電波がありません'),
        h('p', { class: 'hint' }, '残高は表示できませんが、収入・支出は記録できます。スマホに保存し、つながると自動で送ります。' + (queued().length ? `(未送信 ${queued().length}件)` : ''))),
        h('div', { class: 'qa-grid' }, q('in', '💰', 'お金が入った', '#/in'), q('out', '💸', 'お金を使った', '#/out')),
        h('button', { class: 'btn ghost', style: 'width:100%;margin-top:12px', onclick: homeView }, 'もう一度読み込む'));
    } else body.replaceChildren(errorBox(e, homeView));
  }
}

// ---------- 審査中の請求 ----------
function claimToggle() {
  const cb = h('input', { type: 'checkbox' });
  const el = h('label', { class: 'claimtog', style: 'display:none' }, cb, h('span', {}, ' 🕓 審査中として記録する'),
    h('small', { class: 'hint', style: 'display:block' }, 'まだ「返す約束」にしません。承認するまで、利益・未払い・精算に入りません。'));
  return { el, show: v => { el.style.display = v ? '' : 'none'; if (!v) cb.checked = false; }, get: () => cb.checked };
}
async function claimAct(r, ok, after) {
  if (!state.by) { await pickBy(true); if (!state.by) return; }
  const t = `${r.payer_name || ''} ${r.memo || r.category_name || ''}  ${yen(r.amount)}`;
  if (!ok) {
    if (!(await confirmBox('この請求を却下する？', `${t}\n却下すると、この請求は消えます(操作の記録は残ります)。`, '却下する'))) return;
    try { await api.rejectClaim(r.id); toast('却下しました', 'ok'); after(); } catch (e) { toast(errMsg(e), 'err'); }
    return;
  }
  const amt = amountField(r.amount); const f = { keep: false }; const msg = h('p', { class: 'form-err', role: 'alert' });
  const go = h('button', { class: 'btn big in', onclick: async () => {
    msg.textContent = ''; const a = amt.get();
    if (!(a > 0)) { msg.textContent = '承認する金額を入れてください(全部却下するなら、閉じて「却下」を押してください)'; return; }
    if (a > r.amount) { msg.textContent = `請求額 ${yen(r.amount)} を超えています`; return; }
    go.disabled = true;
    try { await api.approveClaim(r.id, { amount: a, keep: f.keep }); m.close(); toast(a < r.amount ? `${yen(a)}を承認しました` + (f.keep ? `。残り${yen(r.amount - a)}は審査中です` : `。残りは却下しました`) : '承認しました。未払いに入りました', 'ok'); after(); }
    catch (e) { msg.textContent = errMsg(e); go.disabled = false; }
  } }, '承認する');
  const restBox = h('div', { class: 'field' }, h('span', { class: 'field-label' }, '承認しない残りは？'),
    chips([{ id: '', label: '却下する' }, { id: 'k', label: '審査中のまま' }], '', id => { f.keep = id === 'k'; }));
  const upd = () => { restBox.style.display = amt.get() > 0 && amt.get() < r.amount ? '' : 'none'; };
  amt.el.addEventListener('input', upd); upd();
  const m = modal([h('h3', {}, '✅ 承認する金額'), h('p', { class: 'muted' }, t + '\n全額なら、そのまま「承認する」。一部だけなら金額を減らしてください。'),
    field('承認する金額', amt.el), restBox,
    h('p', { class: 'hint' }, '承認した分は、' + (r.payer_name || '') + 'への未払い(未精算)になり、利益にも入ります。'), msg, go]);
}
const claimRow = (r, after) => h('div', { class: 'brow due' },
  h('span', {}, `${r.payer_name || ''} ${yen(r.amount)}`, h('small', { style: 'display:block;color:var(--muted)' }, [dshow(r.occurred_on), r.live_name, r.category_name, r.memo].filter(Boolean).join(' ・'))),
  h('span', {}, h('button', { class: 'undo', onclick: () => claimAct(r, true, after) }, '承認'), h('button', { class: 'undo', onclick: () => claimAct(r, false, after) }, '却下')));

// ---------- お金が入った / 使った ----------
function moneyView(isIn, plain) {
  ++renderId;
  const cats = state.cats.filter(c => c.group_name === 'general' && c.flow === (isIn ? 'income' : 'expense') && c.name !== 'STS取り分');
  const f = { cat: '', payer: '' };
  const amt = amountField();
  const memo = h('input', { type: 'text', placeholder: isIn ? '例: ジミーさん 物販売上金' : '例: 駐車場代 ライブ後', autocomplete: 'off' });
  const date = h('input', { type: 'date', value: ymd() });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const payerHint = h('span', { class: 'hint' }, '');
  const ct = claimToggle();
  const payers = [{ id: '', label: 'Wiθ資金' }, ...state.people.filter(p => p.can_pay).map(p => ({ id: p.id, label: p.name }))];
  const setHint = () => { ct.show(!isIn && !!f.payer); payerHint.textContent = f.payer ? `立替: Wiθの資金は減らず、${nameOf(f.payer)}への未払い（返す義務）になります。精算ステータスは「未精算」から始まります。` : 'Wiθの資金から支払います。資金が減ります。'; };
  setHint();
  const submit = h('button', { class: 'btn big ' + (isIn ? 'in' : 'out'), type: 'submit' }, isIn ? '💰 記録する' : '💸 記録する');
  let usedTpl = null;
  const catChips = chips(cats.map(c => ({ id: c.id, label: c.name })), '', id => {
    const nm = (cats.find(c => c.id === id) || {}).name;
    if (isIn && !plain && (nm === 'BASE' || nm === '物販(個別販売)')) { location.hash = '#/sale?ch=' + (nm === 'BASE' ? 'base' : 'direct'); return; }
    f.cat = id;
  });
  const payerChips = chips(payers, '', id => { f.payer = id; setHint(); });
  const tplBox = h('div', {});
  api.templates().then(ts => {
    const mine = ts.filter(t => t.kind === (isIn ? 'income' : 'expense'));
    if (!mine.length) return;
    tplBox.replaceChildren(h('div', { class: 'field' }, h('span', { class: 'field-label' }, '⭐ よく使う'), h('div', { class: 'chips' }, mine.map(t => h('button', { type: 'button', class: 'chip', onclick: () => {
      usedTpl = t;
      if (t.category_id && cats.some(c => c.id === t.category_id)) { f.cat = t.category_id; catChips.select(t.category_id); }
      if (t.amount) amt.set(t.amount);
      memo.value = t.memo || '';
      if (!isIn) { f.payer = t.payer_id || ''; payerChips.select(f.payer); setHint(); }
    } }, t.label)))));
  }).catch(() => {});
  const rcp = isIn ? null : receiptPicker();
  const form = h('form', { class: 'form', onsubmit: async ev => {
    ev.preventDefault(); msg.textContent = '';
    const a = amt.get();
    if (!f.cat) { msg.textContent = 'カテゴリを選んでください'; return; }
    if (!(a > 0)) { msg.textContent = '金額を入れてください'; return; }
    if (!state.by) { await pickBy(true); if (!state.by) return; }
    submit.disabled = true;
    try {
      const res = await api.addEntry({ date: date.value, kind: isIn ? 'income' : (f.payer ? 'expense_advanced' : 'expense_fund'), amount: a, category_id: f.cat, memo: memo.value.trim(), payer_id: isIn ? null : (f.payer || null), posting: !isIn && f.payer && ct.get() ? 'draft' : 'posted', by: state.by });
      const isDraft = !isIn && f.payer && ct.get();
      if (usedTpl) api.useTemplate(usedTpl.id, usedTpl.use_count || 0);
      const rf = rcp ? rcp.files() : [];
      if (res && res.queued) toast(rf.length ? '電波がないため保存待ちにしました。領収書は、つながってから履歴の🧾で追加してください' : '電波がないため、保存待ちにしました。つながると自動で送ります', 'ok');
      else if (rf.length && res && res.id) { await uploadReceipts(res.id, rf); getFx(isIn ? `+${yen(a)}` : `−${yen(a)}`, isIn ? 'MONEY GET!' : (isDraft ? '審査中で記録' : f.payer ? '立替を記録' : 'PAID')); }
      else getFx(isIn ? `+${yen(a)}` : `−${yen(a)}`, isIn ? 'MONEY GET!' : (isDraft ? '審査中で記録' : f.payer ? '立替を記録' : 'PAID'));
      location.hash = '#/home';
    } catch (e) { msg.textContent = errMsg(e); submit.disabled = false; }
  } },
  tplBox,
  field(isIn ? 'どこから？' : 'なにに？', catChips),
  isIn && !plain ? h('p', { class: 'hint' }, 'BASE・物販(個別販売)を選ぶと、商品と在庫つきで記録する画面に進みます。') : null,
  field('金額', amt.el), field('内容', memo), field('日付', date),
  isIn ? null : h('div', { class: 'field' }, h('span', { class: 'field-label' }, '誰が払った？'), payerChips, payerHint, ct.el),
  rcp ? rcp.el : null,
  msg, submit,
  h('button', { type: 'button', class: 'btn ghost', style: 'width:100%', onclick: () => saveTplModal({ kind: isIn ? 'income' : 'expense', category_id: f.cat, amount: amt.get(), memo: memo.value.trim(), payer_id: f.payer }) }, '⭐ この内容をテンプレートに保存'));
  $app.replaceChildren(shell(isIn ? '💰 お金が入った' : '💸 お金を使った', form));
}

// ---------- 貸借 ----------
const LOAN_HIDE = ['STS', '晴']; // 「借りた」の相手には出さない(STSは共同物販の精算用、晴は対象外)
const MODES = {
  loan:      { label: '借りた', title: 'メンバーがWiθのお金を借りた', eff: '資金 −／メンバーの借入 ＋', pick: b => true, sub: b => (b.owes_withi ? '借入 ' + yen(b.owes_withi) : ''), max: null },
  repay:     { label: '返済された', title: 'メンバーが返済した', eff: '資金 ＋／メンバーの借入 −', pick: b => b.owes_withi > 0, sub: b => '借入 ' + yen(b.owes_withi), max: b => b.owes_withi },
  reimburse: { label: '立替を返す', title: 'Wiθが立替を返す', eff: '資金 −／Wiθの未払い −', pick: b => b.withi_owes > 0, sub: b => '未払い ' + yen(b.withi_owes), max: b => b.withi_owes },
  offset:    { label: '相殺', title: '借入と未払いを相殺', eff: '現金は動かさず、借入と未払いを同額ずつ消す', pick: b => b.owes_withi > 0 && b.withi_owes > 0, sub: b => `借入 ${yen(b.owes_withi)} ↔ 未払い ${yen(b.withi_owes)}`, max: b => Math.min(b.owes_withi, b.withi_owes) },
};
async function loanView(mode) {
  const my = ++renderId;
  if (!MODES[mode]) mode = 'loan';
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('👤 メンバー貸借', body));
  let d;
  try { d = await api.home(); } catch (e) { body.replaceChildren(errorBox(e, () => loanView(mode))); return; }
  if (my !== renderId) return;
  const M = MODES[mode];
  const f = { party: '' };
  const cand = d.balances.filter(b => M.pick(b) && !(mode === 'loan' && LOAN_HIDE.includes(b.name)));
  const amt = amountField();
  const memo = h('input', { type: 'text', placeholder: '例: キャビ修理代', autocomplete: 'off' });
  const date = h('input', { type: 'date', value: ymd() });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const submit = h('button', { class: 'btn big', type: 'submit' }, '記録する');
  const maxBtn = h('button', { type: 'button', class: 'btn ghost small', onclick: () => { const b = d.balances.find(x => x.person_id === f.party); if (b && M.max) amt.set(M.max(b)); } }, '全額');
  const form = h('form', { class: 'form', onsubmit: async ev => {
    ev.preventDefault(); msg.textContent = '';
    const a = amt.get(); const b = d.balances.find(x => x.person_id === f.party);
    if (!f.party) { msg.textContent = '相手を選んでください'; return; }
    if (!(a > 0)) { msg.textContent = '金額を入れてください'; return; }
    if (M.max && a > M.max(b)) { msg.textContent = `上限は ${yen(M.max(b))} です`; return; }
    if (!state.by) { await pickBy(true); if (!state.by) return; }
    submit.disabled = true;
    const p = { date: date.value, amount: a, party_id: f.party, memo: memo.value.trim(), by: state.by };
    try {
      if (mode === 'loan') await api.addEntry({ ...p, kind: 'loan' });
      else if (mode === 'repay') await api.addEntry({ ...p, kind: 'loan_repay' });
      else if (mode === 'reimburse') await api.reimburse(p);
      else await api.offset(p);
      getFx(yen(a), M.label); location.hash = '#/home';
    } catch (e) { msg.textContent = errMsg(e); submit.disabled = false; }
  } },
  h('div', { class: 'tabs' }, Object.entries(MODES).map(([k, v]) => h('a', { class: 'tab' + (k === mode ? ' on' : ''), href: '#/loan?mode=' + k }, v.label))),
  h('p', { class: 'effect' }, M.title + '：' + M.eff),
  cand.length ? field('相手', chips(cand.map(b => ({ id: b.person_id, label: b.name, sub: M.sub(b) })), '', id => { f.party = id; if (f.onParty) f.onParty(); }))
    : h('p', { class: 'empty' }, mode === 'offset' ? '借入と未払いの両方がある人がいません。' : '対象の人がいません。'),
  field('金額', h('div', { class: 'with-btn' }, amt.el, M.max ? maxBtn : null)), field('内容', memo), field('日付', date), msg, submit);
  const hist = h('div', { class: 'advhist' });
  body.replaceChildren(form, hist);
  {
    const isLoan = mode === 'loan' || mode === 'repay';
    const kinds = isLoan ? ['loan', 'loan_repay', 'opening_receivable', 'offset'] : ['expense_advanced', 'reimburse', 'offset'];
    let rows = null;
    const draw = () => {
      if (!rows) return;
      const mine = rows.filter(r => !r.reverses_id && !r.reversed && (f.party ? (r.kind === 'expense_advanced' ? r.payer_id === f.party : r.party_id === f.party) : true));
      const who = f.party ? (d.balances.find(b => b.person_id === f.party) || {}).name : '';
      const list = mine.map(r => {
        const [ico, label, sg] = KIND[r.kind] || ['•', r.kind, 0];
        const adv = r.kind === 'expense_advanced';
        const inc = r.kind === 'loan_repay';
        const name = adv ? r.payer_name : r.party_name;
        return h('div', { class: 'lrow' },
          h('span', { class: 'lico' }, ico),
          h('div', { class: 'lmain' },
            h('div', { class: 'lmemo' }, r.memo || r.category_name || label),
            h('div', { class: 'lsub' }, [r.occurred_on.replaceAll('-', '/'), !f.party && name, adv ? '立替' : label].filter(Boolean).join(' · ')),
            adv && r.adv ? h('div', { class: 'ltags' }, h('i', { class: 'tag ' + (r.adv.status === '精算済み' ? 'ok' : r.adv.status === '一部精算' ? 'mid' : 'pay') }, r.adv.status + (r.adv.status === '精算済み' ? '' : '・残り ' + yen(r.adv.remaining)))) : null),
          h('div', { class: 'lamt ' + (isLoan ? (inc ? 'pos' : 'neg') : (adv ? 'neg' : 'pos')) }, yen(r.amount).replace('−', '')));
      });
      hist.replaceChildren(h('h3', { class: 'advhist-title' }, (isLoan ? '👤 ' : '🧾 ') + (who ? who + (isLoan ? 'の借入・返済履歴' : 'の立替履歴') : (isLoan ? '借入・返済の履歴(全員)' : '立替・返済の履歴(全員)'))),
        list.length ? h('div', { class: 'ledger' }, list) : h('p', { class: 'empty' }, isLoan ? '借入・返済の記録はまだありません。' : '立替の記録はまだありません。'));
    };
    f.onParty = draw;
    api.ledger(500).then(r => { rows = r.filter(x => x.posting !== 'draft' && kinds.includes(x.kind)); draw(); }).catch(() => {});
  }
}

// ---------- 履歴 ----------
const KIND = {
  income: ['💰', '収入', 1], expense_fund: ['💸', '支出', -1], expense_advanced: ['🧾', '立替', -1], loan: ['👤', '貸した', -1], loan_repay: ['💵', '返済', 1],
  reimburse: ['🔁', '立替を返した', -1], offset: ['⚖️', '相殺', 0], opening_fund: ['🏁', '初期残高', 1], opening_receivable: ['🏁', '初期の借入', 0], opening_payable: ['🏁', '初期の未払い', 0],
};
const timeJst = iso => { try { return new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }); } catch { return ''; } };
async function historyView(limit = 80) {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('📜 履歴・取消', body));
  try {
    const [rows, rcs] = await Promise.all([api.ledger(limit), api.receipts().catch(() => [])]);
    if (my !== renderId) return;
    const rcm = countMap(rcs);
    if (!rows.length) { body.replaceChildren(h('p', { class: 'empty' }, 'まだ記録がありません。')); return; }
    const list = h('div', { class: 'ledger' });
    let last = '';
    for (const r of rows) {
      if (r.occurred_on !== last) { list.append(h('div', { class: 'dayhead' }, r.occurred_on.replaceAll('-', '/'))); last = r.occurred_on; }
      const [ico, label, sg] = KIND[r.kind] || ['•', r.kind, 0];
      const who = r.kind === 'expense_advanced' ? r.payer_name : r.party_name;
      const isRev = !!r.reverses_id;
      const canRev = r.posting === 'posted' && !isRev && !r.reversed;
      list.append(h('div', { class: 'lrow' + (r.reversed || isRev ? ' dead' : '') },
        h('span', { class: 'lico' }, ico),
        h('div', { class: 'lmain' },
          h('div', { class: 'lmemo' }, r.memo || r.category_name || label),
          h('div', { class: 'lsub' }, [r.is_historical ? '' : timeJst(r.created_at), r.category_name, who && (r.kind === 'expense_advanced' ? who + 'が立替' : who), (r.memo || r.category_name) ? label : ''].filter(Boolean).join(' · ') || ' '),
          h('div', { class: 'ltags' },
            r.adv ? h('i', { class: 'tag ' + (r.adv.status === '精算済み' ? 'ok' : r.adv.status === '一部精算' ? 'mid' : 'pay') }, r.adv.status) : null,
            r.posting === 'draft' ? h('i', { class: 'tag mid' }, '🕓 審査中') : null,
            r.is_historical ? h('i', { class: 'tag dead' }, '過去データ') : null,
            r.review_flag ? h('i', { class: 'tag mid' }, '要確認') : null,
            r.reversed ? h('i', { class: 'tag dead' }, '取消済み') : null, isRev ? h('i', { class: 'tag dead' }, '取消の行') : null)),
        h('div', { class: 'lamt ' + (sg > 0 ? 'pos' : sg < 0 ? 'neg' : '') }, (sg > 0 ? '+' : sg < 0 ? '−' : '') + yen(r.amount).replace('−', '')),
        canRev ? h('button', { class: 'undo', 'aria-label': 'この記録を取り消す', onclick: async () => {
          const ok = await confirmBox('この記録を取り消す？', `${r.occurred_on.replaceAll('-', '/')}  ${r.memo || label}  ${yen(r.amount)}\n` + (r.merch_order_id ? 'この売上に関する記録(売上・手数料・STS取り分)と在庫が、まとめて元に戻ります。' : r.is_historical ? '過去データの取り消しです。元の行は消さず、打ち消しの行が追加されます。資金や貸借には影響しません(損益の集計だけが戻ります)。' : '元の行は消さず、打ち消しの行が追加されます。'), '取り消す');
          if (!ok) return;
          try { await api.reverse(r.id, state.by); toast('取り消しました', 'ok'); historyView(); } catch (e) { toast(errMsg(e), 'err'); }
        } }, '取消') : null,
        receiptBtn(r, rcm, () => historyView(limit))));
    }
    body.replaceChildren(list, rows.length >= limit ? h('button', { class: 'btn ghost', style: 'width:100%', onclick: () => historyView(limit + 100) }, 'もっと見る') : h('p', { class: 'hint center' }, 'ここまでです。'));
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, historyView)); }
}


// ---------- 商品・在庫 ----------
const vLabel = v => [v.color, v.size].filter(Boolean).join(' ') || '(ひとつだけ)';
const totalStock = p => p.variants.reduce((s, v) => s + (v.is_active ? v.stock : 0), 0);
const intField = (init, ph) => h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: ph || '0', value: init == null ? '' : String(init) });
const numOrNull = el => { const d = el.value.replace(/[^0-9]/g, ''); return d === '' ? null : Number(d); };

async function merchView() {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('👕 商品・在庫', body));
  try {
    const list = await api.products();
    if (my !== renderId) return;
    const q = h('input', { type: 'text', placeholder: '商品名で絞り込む', autocomplete: 'off' });
    const box = h('div', {});
    let showOld = false; let sort = localStorage.getItem('withi_merch_sort') || 'name';
    const SORTS = { name: '名前順', low: '在庫が少ない順', high: '在庫が多い順', cat: 'カテゴリ順' };
    const sorter = { name: (a, b) => a.name.localeCompare(b.name, 'ja'), low: (a, b) => totalStock(a) - totalStock(b) || a.name.localeCompare(b.name, 'ja'),
      high: (a, b) => totalStock(b) - totalStock(a) || a.name.localeCompare(b.name, 'ja'), cat: (a, b) => String(a.category || '').localeCompare(String(b.category || ''), 'ja') || a.name.localeCompare(b.name, 'ja') };
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      const rows = list.filter(p => (showOld || p.is_active) && (!t || p.name.toLowerCase().includes(t))).sort(sorter[sort] || sorter.name);
      box.replaceChildren(...(rows.length ? rows.map(p => {
        const tot = totalStock(p);
        return h('a', { class: 'lrow', href: '#/product?id=' + p.id },
          thumb(p),
          h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, p.name),
            h('div', { class: 'lsub' }, [p.category, p.variants.length > 1 ? p.variants.length + '種類' : ''].filter(Boolean).join(' · ') || ' '),
            h('div', { class: 'ltags' }, !p.is_active ? h('i', { class: 'tag dead' }, '販売終了') : null, p.co_share ? h('i', { class: 'tag mid' }, '共同 ' + Math.round(p.co_share * 100) + '%') : null)),
          h('div', { class: 'lamt ' + (tot <= 0 ? 'neg' : '') }, tot + '点'));
      }) : [h('p', { class: 'empty' }, '該当する商品がありません。')]));
    };
    q.addEventListener('input', draw);
    const total = list.filter(p => p.is_active).reduce((s, p) => s + totalStock(p), 0);
    body.replaceChildren(
      h('section', { class: 'card mini' }, h('div', { class: 'cap' }, '📦 販売中の在庫 合計'), h('b', {}, total + '点')),
      h('div', { class: 'with-btn' }, q, h('button', { class: 'btn small', onclick: () => newProductModal() }, '＋商品')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, '並び順'), chips(Object.entries(SORTS).map(([id, label]) => ({ id, label })), sort, id => { sort = id; try { localStorage.setItem('withi_merch_sort', id); } catch { /* 保存できなくても動く */ } draw(); })),
      h('label', { class: 'hint' }, h('input', { type: 'checkbox', onchange: e => { showOld = e.target.checked; draw(); } }), ' 販売終了も表示'),
      box);
    draw();
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, merchView)); }
}

function newProductModal() {
  const name = h('input', { type: 'text', placeholder: '例: ステッカー', autocomplete: 'off' });
  const cat = h('input', { type: 'text', placeholder: '例: ステッカー', autocomplete: 'off' });
  const color = h('input', { type: 'text', placeholder: '色(なければ空)', autocomplete: 'off' });
  const size = h('input', { type: 'text', placeholder: 'サイズ(なければ空)', autocomplete: 'off' });
  const price = intField(null, '売価'); const cost = intField(null, '原価(わかれば)');
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const ok = h('button', { class: 'btn big', onclick: async () => {
    msg.textContent = '';
    if (!name.value.trim()) { msg.textContent = '商品名を入れてください'; return; }
    if (numOrNull(price) == null) { msg.textContent = '売価を入れてください'; return; }
    ok.disabled = true;
    try { await api.addProduct({ name: name.value.trim(), category: cat.value.trim(), color: color.value.trim(), size: size.value.trim(), price: numOrNull(price), cost: numOrNull(cost) }); m.close(); toast('商品を追加しました', 'ok'); merchView(); }
    catch (e) { msg.textContent = /duplicate|unique/i.test(errMsg(e)) ? '同じ名前の商品がすでにあります' : errMsg(e); ok.disabled = false; }
  } }, '追加する');
  const m = modal([h('h3', {}, '新しい商品'), field('商品名', name), field('カテゴリ', cat), field('色', color), field('サイズ', size), field('売価(円)', price), field('原価(円)', cost, '空のままなら「未設定」になります'), msg, ok]);
}

async function productView(pid) {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('👕 商品', body, '#/merch'));
  try {
    const p = (await api.products()).find(x => x.id === pid);
    if (my !== renderId) return;
    if (!p) { body.replaceChildren(h('p', { class: 'empty' }, '商品が見つかりません。')); return; }
    const reload = () => productView(pid);
    const head = h('section', { class: 'card' },
      thumb(p, true),
      h('div', { class: 'lmemo' }, p.name), h('div', { class: 'lsub' }, p.category || '(カテゴリなし)'),
      h('div', { class: 'ltags' }, !p.is_active ? h('i', { class: 'tag dead' }, '販売終了') : null, p.co_share ? h('i', { class: 'tag mid' }, '共同 ' + Math.round(p.co_share * 100) + '%') : null),
      h('button', { class: 'btn small', style: 'margin-top:10px', onclick: () => editProductModal(p, reload) }, '商品名・販売状態を変える'));
    const vrows = p.variants.map(v => {
      const profit = v.price != null && v.cost != null ? v.price - v.cost : null;
      return h('div', { class: 'lrow' + (v.is_active ? '' : ' dead') },
        h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, vLabel(v)),
          h('div', { class: 'lsub' }, `売価 ${v.price == null ? '未設定' : yen(v.price)} ／ 原価 ${v.cost == null ? '未設定' : yen(v.cost)}` + (profit == null ? '' : ` ／ 粗利 ${yen(profit)}`)),
          h('div', { class: 'ltags' }, !v.is_active ? h('i', { class: 'tag dead' }, '販売終了') : null)),
        h('div', { class: 'lamt ' + (v.stock <= 0 ? 'neg' : '') }, v.stock + '点'),
        h('button', { class: 'undo', onclick: () => stockModal(p, v, reload) }, '在庫'),
        h('button', { class: 'undo', onclick: () => editVariantModal(p, v, reload) }, '編集'));
    });
    body.replaceChildren(head, h('div', { class: 'cap sec' }, 'バリエーション(色・サイズ)'), ...vrows,
      h('button', { class: 'btn ghost', style: 'width:100%;margin-top:8px', onclick: () => addVariantModal(p, reload) }, '＋ 色・サイズを追加'),
      h('p', { class: 'hint' }, '売価や原価を変えても、過去の売上の記録は変わりません(売った時点の値を記録します)。'));
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, () => productView(pid))); }
}

function editProductModal(p, done) {
  const name = h('input', { type: 'text', value: p.name, autocomplete: 'off' });
  const cat = h('input', { type: 'text', value: p.category || '', autocomplete: 'off' });
  let active = p.is_active;
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const ok = h('button', { class: 'btn big', onclick: async () => {
    msg.textContent = ''; if (!name.value.trim()) { msg.textContent = '商品名を入れてください'; return; }
    ok.disabled = true;
    try { await api.saveProduct(p.id, { name: name.value.trim(), category: cat.value.trim(), is_active: active }); m.close(); toast('保存しました', 'ok'); done(); }
    catch (e) { msg.textContent = /duplicate|unique/i.test(errMsg(e)) ? '同じ名前の商品がすでにあります' : errMsg(e); ok.disabled = false; }
  } }, '保存する');
  const m = modal([h('h3', {}, '商品を編集'), field('商品名', name), field('カテゴリ', cat),
    field('販売状態', chips([{ id: 'on', label: '販売中' }, { id: 'off', label: '販売終了' }], active ? 'on' : 'off', id => { active = id === 'on'; }), '販売終了にしても、過去の売上・在庫の記録は残ります。'), msg, ok]);
}

function editVariantModal(p, v, done) {
  const price = intField(v.price, '売価'); const cost = intField(v.cost, '原価');
  let active = v.is_active;
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const ok = h('button', { class: 'btn big', onclick: async () => {
    msg.textContent = ''; if (numOrNull(price) == null) { msg.textContent = '売価を入れてください'; return; }
    ok.disabled = true;
    try { await api.saveVariant(v.id, { price: numOrNull(price), cost: numOrNull(cost), is_active: active }); m.close(); toast('保存しました', 'ok'); done(); }
    catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '保存する');
  const m = modal([h('h3', {}, p.name + '  ' + vLabel(v)), field('売価(円)', price), field('原価(円)', cost, '空にすると「未設定」になります'),
    field('販売状態', chips([{ id: 'on', label: '販売中' }, { id: 'off', label: '販売終了' }], active ? 'on' : 'off', id => { active = id === 'on'; })), msg, ok]);
}

function addVariantModal(p, done) {
  const color = h('input', { type: 'text', placeholder: '色(なければ空)', autocomplete: 'off' });
  const size = h('input', { type: 'text', placeholder: 'サイズ(なければ空)', autocomplete: 'off' });
  const base = p.variants[0] || {};
  const price = intField(base.price, '売価'); const cost = intField(base.cost, '原価');
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const ok = h('button', { class: 'btn big', onclick: async () => {
    msg.textContent = ''; if (numOrNull(price) == null) { msg.textContent = '売価を入れてください'; return; }
    ok.disabled = true;
    try { await api.addVariant(p.id, { color: color.value.trim(), size: size.value.trim(), price: numOrNull(price), cost: numOrNull(cost) }); m.close(); toast('追加しました', 'ok'); done(); }
    catch (e) { msg.textContent = /duplicate|unique/i.test(errMsg(e)) ? '同じ色・サイズがすでにあります' : errMsg(e); ok.disabled = false; }
  } }, '追加する');
  const m = modal([h('h3', {}, p.name + ' に追加'), field('色', color), field('サイズ', size), field('売価(円)', price), field('原価(円)', cost), msg, ok]);
}

const STOCK_MODES = { receive: '入荷(増やす)', count: '棚卸し(実数)', less: '減らす' };
async function stockModal(p, v, done) {
  let mode = 'receive'; let why = 'sold'; let money = 'off'; let up = 'in';
  const n = intField(null, '0'); const memo = h('input', { type: 'text', placeholder: '例: 追加納品 / 数え直し', autocomplete: 'off' });
  const date = h('input', { type: 'date', value: ymd() });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const eff = h('p', { class: 'effect' }, '');
  const calc = () => {
    const x = numOrNull(n); if (x == null) return null;
    return mode === 'receive' ? x : mode === 'less' ? -x : x - v.stock;
  };
  const sts = p.co_share ? h('p', { class: 'hint' }, '共同物販(STS)の商品です。売上のお金も記録すると、STSの取り分も一緒に記録されます。「分析だけ」では、STSの取り分は記録されません。') : null;
  const moneyHint = h('p', { class: 'hint' }, '');
  const whyChips = chips([{ id: 'sold', label: '物販で売れた' }, { id: 'lost', label: '紛失・破損・その他' }], why, id => { why = id; upd(); });
  const moneyChips = chips([{ id: 'off', label: '分析だけ(お金は記録しない)' }, { id: 'on', label: '売上のお金も記録する' }], money, id => { money = id; upd(); });
  const upChips = chips([{ id: 'in', label: '入荷' }, { id: 'undo', label: '売れたのを取り消す' }], up, id => { up = id; upd(); });
  const decBox = h('div', { class: 'form', style: 'display:none' }, field('減る理由', whyChips), h('div', { class: 'moneybox' }, field('売上のお金', moneyChips), moneyHint, sts));
  const incBox = h('div', { style: 'display:none' }, field('増える理由', upChips));
  const upd = () => {
    const d = calc();
    eff.textContent = `いまの在庫 ${v.stock}点` + (d == null ? '' : ` → ${v.stock + d}点(${d >= 0 ? '+' : ''}${d})`);
    const dec = d != null && d < 0;
    decBox.style.display = dec ? '' : 'none';
    decBox.querySelector('.moneybox').style.display = dec && why === 'sold' ? '' : 'none';
    incBox.style.display = mode === 'receive' ? '' : 'none';
    moneyHint.textContent = dec && why === 'sold' ? (money === 'on' ? `売値 ${v.price == null ? '未設定' : yen(v.price)} × ${-d}点 = ${v.price == null ? '—' : yen(v.price * -d)} を物販の売上として記録します。` : 'お金は記録せず、「売れた」として売れ筋・利益の分析にだけ入れます(売値と原価は、いまの設定で計算)。Airレジの取り込みや手入力で記録済みの分には使わないでください(二重になります)。') : '';
  };
  n.addEventListener('input', upd);
  const ok = h('button', { class: 'btn big', onclick: async () => {
    msg.textContent = ''; const d = calc();
    if (d == null) { msg.textContent = '数を入れてください'; return; }
    if (d === 0) { msg.textContent = '変わる数がありません'; return; }
    if (v.stock + d < 0) { msg.textContent = '在庫がマイナスになります。数を確認してください'; return; }
    if (!state.by) { await pickBy(true); if (!state.by) return; }
    const sold = d < 0 && why === 'sold';
    if (sold && money === 'on' && v.price == null) { msg.textContent = '売値が未設定です。先に売値を入れてください'; return; }
    ok.disabled = true;
    try {
      if (sold && money === 'on') {
        await api.merchSale({ channel: 'direct', date: date.value, lines: [{ variant_id: v.id, qty: -d, unit_price: v.price }], received: v.price * -d, memo: memo.value.trim() || '在庫の画面から記録', by: state.by });
      } else {
        const reason = d > 0 ? (mode === 'receive' ? (up === 'undo' ? 'reversal' : 'receive') : 'adjust') : (sold ? 'sale_manual' : 'adjust');
        const defMemo = reason === 'sale_manual' ? '売れた(分析のみ)' : reason === 'reversal' ? '売れたのを取り消し' : (mode === 'count' ? '棚卸し' : '');
        await api.stockMove({ variant_id: v.id, qty: d, reason, date: date.value, memo: memo.value.trim() || defMemo, by: state.by });
      }
      m.close(); toast(sold ? '売れたことにして、在庫を更新しました' : '在庫を更新しました', 'ok'); done();
    }
    catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '記録する');
  const hist = h('div', { class: 'hint' }, '');
  api.stockHistory(v.id).then(rows => { if (rows.length) hist.textContent = '最近: ' + rows.slice(0, 4).map(r => `${r.occurred_on.slice(5).replace('-', '/')} ${r.qty > 0 ? '+' : ''}${r.qty}`).join(' / '); }).catch(() => {});
  const m = modal([h('h3', {}, p.name + '  ' + vLabel(v)),
    chips(Object.entries(STOCK_MODES).map(([id, label]) => ({ id, label })), mode, id => { mode = id; upd(); }),
    eff, field(mode === 'count' ? '数えた数' : '数', n), incBox, decBox, field('メモ', memo), field('日付', date), hist, msg, ok]);
  upd();
}


// ---------- 物販の売上(BASE・個別販売) ----------
async function saleView(channel, liveId) {
  const my = ++renderId;
  const isBase = channel === 'base';
  const isLive = channel === 'live';
  const body = h('div', {}, loading());
  $app.replaceChildren(shell(isBase ? '🛒 BASEの売上' : isLive ? '📦 ライブの物販売上' : '🤝 物販(個別販売)', body, isLive ? '#/live?id=' + liveId : '#/in'));
  let products; let live = null;
  try {
    products = (await api.products()).filter(p => p.is_active);
    if (isLive) { live = (await api.lives()).find(x => x.id === liveId); if (!live) throw new ApiError('ライブが見つかりません'); }
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, () => saleView(channel, liveId))); return; }
  if (my !== renderId) return;
  const lines = []; // {v, p, qty, price}
  let receivedTouched = false;
  const received = amountField();
  const memo = h('input', { type: 'text', placeholder: isBase ? '例: 10/5入金分' : isLive ? '例: 物販 手売り分' : '例: ジミーさん 手売り', autocomplete: 'off' });
  const date = h('input', { type: 'date', value: isLive ? String(live.live_date).slice(0, 10) : ymd() });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const linesBox = h('div', {}); const sumBox = h('div', { class: 'card mini' });
  const total = () => lines.reduce((s, l) => s + l.qty * l.price, 0);
  const note = h('p', { class: 'hint' }, '');
  const submit = h('button', { class: 'btn big in', type: 'button' }, '💰 記録する');
  const redraw = () => {
    const t = total();
    if (!receivedTouched) received.set(t || '');
    linesBox.replaceChildren(...(lines.length ? lines.map((l, i) => {
      const pr = intField(l.price, '0');
      pr.addEventListener('input', () => { l.price = numOrNull(pr) || 0; upSum(); });
      const over = l.qty > l.v.stock;
      return h('div', { class: 'saleline' },
        h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, l.p.name), h('div', { class: 'lsub' }, vLabel(l.v) + ` ・在庫${l.v.stock}点`),
          over ? h('div', { class: 'ltags' }, h('i', { class: 'tag mid' }, '在庫より多い')) : null),
        h('div', { class: 'stepper' },
          h('button', { type: 'button', class: 'chip', 'aria-label': '減らす', onclick: () => { l.qty = Math.max(1, l.qty - 1); redraw(); } }, '−'),
          h('b', {}, l.qty),
          h('button', { type: 'button', class: 'chip', 'aria-label': '増やす', onclick: () => { l.qty += 1; redraw(); } }, '＋')),
        h('div', { class: 'amount-wrap small' }, h('span', { class: 'yen' }, '¥'), pr),
        h('button', { type: 'button', class: 'undo', 'aria-label': '外す', onclick: () => { lines.splice(i, 1); redraw(); } }, '外す'));
    }) : [h('p', { class: 'empty' }, '下から商品を選んでください。')]));
    upSum();
  };
  const upSum = () => {
    const t = total(); const r = received.get();
    const fee = isBase ? t - r : 0;
    const disc = !isBase && t > 0 && received.get() >= 0 && received.raw() !== '' ? t - r : 0;
    sumBox.replaceChildren(h('div', { class: 'cap' }, isBase ? '売上 合計' : '定価の合計'), h('b', {}, yen(t)),
      disc > 0 ? h('div', { class: 'hint' }, r === 0 ? 'タダ(0円)で渡す → 売上は記録せず、在庫だけ減らします' : `値引き ${yen(disc)}（${Math.round(disc / t * 100)}%）`) : null,
      isBase && t > 0 && r > 0 ? h('div', { class: fee < 0 ? 'form-err' : 'hint' }, fee < 0 ? '入金額が売上より大きくなっています' : `手数料 ${yen(fee)}（売上 − 入金）を自動で記録します`) : null);
    const sts = lines.filter(l => l.p.co_share).reduce((s, l) => s + l.qty * l.price * l.p.co_share, 0);
    note.textContent = sts > 0 ? `共同物販(STS)の取り分 ${yen(Math.round(sts))} を、STSへの未払いとして自動で記録します。` : '';
  };
  received.el.querySelector('input').addEventListener('input', () => { receivedTouched = true; upSum(); });
  const addLine = (p, v) => {
    const ex = lines.find(l => l.v.id === v.id);
    if (ex) ex.qty += 1; else lines.push({ v, p, qty: 1, price: v.price });
    redraw();
  };
  const q = h('input', { type: 'text', placeholder: '商品名で探す', autocomplete: 'off' });
  const list = h('div', { class: 'chips' });
  const drawList = () => {
    const t = q.value.trim().toLowerCase();
    const rows = products.filter(p => !t || p.name.toLowerCase().includes(t)).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    list.replaceChildren(...(rows.length ? rows.map(p => h('button', { type: 'button', class: 'chip', onclick: () => {
      const vs = p.variants.filter(v => v.is_active);
      if (vs.length === 1) { addLine(p, vs[0]); return; }
      const m = modal([h('h3', {}, p.name), h('p', { class: 'muted' }, '種類を選んでください'),
        h('div', { class: 'chips' }, vs.map(v => h('button', { type: 'button', class: 'chip' + (v.stock <= 0 ? ' dis' : ''), onclick: () => { m.close(); addLine(p, v); } },
          h('span', { class: 'chip-main' }, vLabel(v)), h('span', { class: 'chip-sub' }, `在庫${v.stock}・${yen(v.price)}`))))]);
    } }, p.name)) : [h('p', { class: 'empty' }, '該当する商品がありません。')]));
  };
  q.addEventListener('input', drawList); drawList();
  submit.addEventListener('click', async () => {
    msg.textContent = '';
    if (!lines.length) { msg.textContent = '商品を1つ以上選んでください'; return; }
    const t = total(); const r = received.get();
    if (isBase ? !(r > 0) : received.raw() === '') { msg.textContent = isBase ? '入金された金額を入れてください' : '受け取った金額を入れてください(タダなら0)'; return; }
    if (!isBase && r > t) { msg.textContent = '受け取った額が定価の合計より大きくなっています。売価を直してください'; return; }
    if (isBase && r > t) { msg.textContent = '入金額が売上より大きくなっています。確認してください'; return; }
    if (!state.by) { await pickBy(true); if (!state.by) return; }
    submit.disabled = true;
    try {
      const ln = lines.map(l => ({ variant_id: l.v.id, qty: l.qty, unit_price: l.price }));
      if (isLive) await api.liveMerchSale({ live: liveId, date: date.value, lines: ln, received: r, memo: memo.value.trim(), by: state.by });
      else await api.merchSale({ channel, date: date.value, lines: ln, received: r, memo: memo.value.trim(), by: state.by });
      getFx(r > 0 ? `+${yen(r)}` : '0円', r > 0 ? 'MONEY GET!' : 'GIFT');
      location.hash = isLive ? '#/live?id=' + liveId : '#/home';
    } catch (e) { msg.textContent = errMsg(e); submit.disabled = false; }
  });
  body.replaceChildren(h('div', { class: 'form' },
    isLive ? h('p', { class: 'hint' }, `${live.event_name}(${dshow(live.live_date)})の物販です。Airレジの売上CSVから取り込む分は、ここで入れると二重になります。Airレジを使わなかった分だけ入れてください。`) : null,
    field('売った商品', h('div', {}, linesBox)), sumBox, note,
    field('商品を追加', q), list,
    field(isBase ? 'BASEから入金された金額' : '受け取った金額', received.el, isBase ? '売上との差が手数料になります' : '値引きしたときは、受け取った額に直してください'),
    isBase ? null : h('div', { class: 'chips' },
      h('button', { type: 'button', class: 'chip', onclick: () => { receivedTouched = false; redraw(); } }, '定価どおり'),
      h('button', { type: 'button', class: 'chip', onclick: () => {
        if (lines.some(l => l.v.cost == null)) { toast('原価が未設定の商品があります', 'err'); return; }
        receivedTouched = true; received.set(lines.reduce((x, l) => x + l.qty * l.v.cost, 0)); upSum(); } }, '原価で売る'),
      h('button', { type: 'button', class: 'chip', onclick: () => { receivedTouched = true; received.set(0); upSum(); } }, 'タダであげる')),
    field('内容(メモ)', memo), field('日付', date),
    isLive ? h('a', { class: 'hint', href: '#/live?id=' + liveId }, '商品を選ばず金額だけ記録するときは、ライブの「収入を追加」から') : h('a', { class: 'hint', href: '#/in?plain=1' }, '商品を選ばず金額だけ記録する'),
    msg, submit));
  redraw();
}

// ---------- ライブ ----------
const rating = p => { const t = state.rating || { great: 20000, good: 5000, draw: 0 }; return p >= t.great ? ['🔥', '大成功'] : p >= t.good ? ['😄', 'いい感じ'] : p >= t.draw ? ['😐', 'トントン'] : ['💧', '赤字']; };
const liveKind = k => (k === 'host' ? '主催' : '出演');
const dshow = d => String(d).slice(0, 10).replaceAll('-', '/');

async function liveListView() {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('🎸 ライブ', body));
  try {
    const list = await api.lives();
    if (my !== renderId) return;
    const conf = list.filter(l => l.status === 'confirmed');
    const tot = conf.reduce((s, l) => s + l.profit, 0);
    const rows = list.map(l => {
      const [ico] = rating(l.profit);
      return h('a', { class: 'lrow', href: '#/live?id=' + l.id },
        h('span', { class: 'lico' }, l.status === 'confirmed' ? ico : '📝'),
        h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, l.event_name),
          h('div', { class: 'lsub' }, [dshow(l.live_date), l.venue_name, l.prefecture].filter(Boolean).join(' · ')),
          h('div', { class: 'ltags' }, h('i', { class: 'tag ' + (l.kind === 'host' ? 'pay' : 'recv') }, liveKind(l.kind)), l.status === 'confirmed' ? h('i', { class: 'tag ok' }, '確定') : h('i', { class: 'tag mid' }, '下書き'))),
        h('div', { class: 'lamt ' + (l.profit < 0 ? 'neg' : l.profit > 0 ? 'pos' : '') }, yen(l.profit)));
    });
    body.replaceChildren(
      h('section', { class: 'card mini' }, h('div', { class: 'cap' }, '🎸 確定したライブ ' + conf.length + '本 の利益'), h('b', { class: tot < 0 ? 'neg' : 'pos' }, yen(tot))),
      h('button', { class: 'btn big in', style: 'width:100%', onclick: () => { location.hash = '#/live-form'; } }, '＋ ライブを登録'),
      h('a', { class: 'btn ghost', style: 'display:block;text-align:center;text-decoration:none;margin-top:8px', href: '#/songs' }, '🎵 曲マスター(演奏回数・初披露)'),
      h('div', { class: 'cap sec' }, 'ライブ一覧'),
      ...(rows.length ? rows : [h('p', { class: 'empty' }, 'まだライブがありません。上のボタンから登録してください。')]),
      h('p', { class: 'hint' }, '過去の記録(取り込み済みのデータ)は、ライブとは結びついていません。これから登録するライブの収支がここに集まります。'));
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, liveListView)); }
}

async function liveModal(live, done) {
  const f = { kind: live ? live.kind : 'attend' };
  const name = h('input', { type: 'text', placeholder: '例: ○○ presents △△', autocomplete: 'off', value: live ? live.event_name : '' });
  const date = h('input', { type: 'date', value: live ? String(live.live_date).slice(0, 10) : ymd() });
  const venue = h('input', { type: 'text', placeholder: '例: CAPARVO HALL', autocomplete: 'off', list: 'venue-list', value: live ? live.venue_name : '' });
  const dl = h('datalist', { id: 'venue-list' });
  const pref = h('input', { type: 'text', placeholder: '例: 鹿児島', autocomplete: 'off', value: live && live.prefecture || '' });
  const memo = h('input', { type: 'text', placeholder: 'メモ(任意)', autocomplete: 'off', value: live && live.memo || '' });
  api.venues().then(vs => { dl.replaceChildren(...vs.map(v => h('option', { value: v.name }))); venue.addEventListener('change', () => { const x = vs.find(v => v.name === venue.value.trim()); if (x && x.prefecture && !pref.value) pref.value = x.prefecture; }); }).catch(() => {});
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const ok = h('button', { class: 'btn big', onclick: async () => {
    msg.textContent = '';
    if (!name.value.trim()) { msg.textContent = 'ライブの名前を入れてください'; return; }
    if (!date.value) { msg.textContent = '日付を入れてください'; return; }
    if (!state.by) { await pickBy(true); if (!state.by) return; }
    ok.disabled = true;
    const o = { name: name.value.trim(), date: date.value, kind: f.kind, venue: venue.value.trim(), prefecture: pref.value.trim(), memo: memo.value.trim(), by: state.by };
    try { let id = live && live.id; if (live) await api.saveLive(id, o); else id = await api.addLive(o); m.close(); toast(live ? '更新しました' : 'ライブを登録しました', 'ok'); done(id); }
    catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, live ? '保存する' : '登録する');
  const m = modal([h('h3', {}, live ? 'ライブを編集' : 'ライブを登録'),
    field('出演？主催？', chips([{ id: 'attend', label: '出演(呼ばれた)' }, { id: 'host', label: '主催(自分たちで開催)' }], f.kind, id => { f.kind = id; })),
    field('ライブ名', name), field('日付', date), field('会場', venue), dl, field('都道府県', pref), field('メモ', memo), msg, ok]);
}

// ---- ライブ登録・編集ページ(旧マネージャーの「ライブを登録」に近い、1ページ+SNS文章プレビュー)
/** 主催者から届いたメール／LINEの告知文から、日付・会場・料金・出演者などを読み取る（AIは使わない）。 */
function parseOrganizerMail(raw) {
  const nf = (s) => String(s || '').normalize('NFKC');
  const lines = String(raw || '').replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
  const out = { name: '', date: '', open: '', start: '', end: '', venue: '', price: '', drink: '', performers: [], rest: [] };
  const used = new Set();
  const strip = (s) => s.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s■□◆◇●○▼▽▶▷★☆※・\-*]+/u, '').trim();
  const val = (s) => strip(s).replace(/^(日時|日程|日にち|開催日|DATE|会場|場所|会場名|VENUE|PLACE|チケット(?:代|料金)?|チケ代|料金|TICKET|時間|TIME)\s*[:：]?\s*/i, '').trim();
  // 日付
  const dRe = /(20\d\d)\s*[\/.\-年]\s*(\d{1,2})\s*[\/.\-月]\s*(\d{1,2})/;
  const dRe2 = /(?:^|[^\d])(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*(?:日|\(|（|$|\s)/;
  let di = -1;
  lines.forEach((ln, i) => {
    if (di >= 0) return; const t = nf(ln);
    let m = dRe.exec(t);
    if (m) { out.date = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'); di = i; used.add(i); return; }
    if (/^[^\w]*(?:日時|日程|DATE|🗓|📅)/iu.test(ln) || /\p{Extended_Pictographic}/u.test(ln.slice(0, 3))) {
      m = dRe2.exec(t);
      if (m) { const now = new Date(); let y = now.getFullYear(); const dt = new Date(y, +m[1] - 1, +m[2]); if (dt < new Date(now.getTime() - 86400000)) y++; out.date = y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); di = i; used.add(i); }
    }
  });
  // 会場・チケット・時間（行の頭の絵文字／ラベルで判断）
  lines.forEach((ln, i) => {
    if (used.has(i)) return; const t = nf(ln); const head = t.slice(0, 12);
    if (!out.venue && (/^[^\w]*(?:📍|会場|場所|VENUE|PLACE)/iu.test(ln) || /📍/.test(ln.slice(0, 3)))) {
      out.venue = val(ln).replace(/\s*[（(]\s*\d+\s*会場\s*[）)]\s*$/, '').trim(); { const mm = /[（(]\s*(\d+)\s*会場\s*[）)]/.exec(nf(ln)); if (mm) out.rest.push('※' + mm[1] + '会場での開催です'); } used.add(i); return;
    }
    if (!out.price && (/(チケ|ticket|料金|ADV|前売|当日|DOOR)/i.test(head) || /💸|🎫|💴/.test(ln.slice(0, 3)))) {
      const body = nf(val(ln));
      const amt = (x) => '¥' + Number(String(x).replace(/,/g, '')).toLocaleString('en-US');
      const adv = /(?:ADV|前売り?)\s*[:：]?\s*[¥￥]?\s*([\d,]{3,6})/i.exec(body), door = /(?:DOOR|当日)\s*[:：]?\s*[¥￥]?\s*([\d,]{3,6})/i.exec(body);
      if (adv || door) out.price = [adv ? 'ADV ' + amt(adv[1]) : '', door ? 'DOOR ' + amt(door[1]) : ''].filter(Boolean).join(' / ');
      else { const one = /[¥￥]\s*([\d,]{3,6})|([\d,]{3,6})\s*円/.exec(body); if (one) out.price = amt(one[1] || one[2]); }
      if (/ドリンク|1D|\+\s*1\s*drink|drink/i.test(body)) {
        const dm = /(?:ドリンク代?|1D|drink)\s*[:：]?\s*[¥￥]?\s*([\d,]{3,5})\s*円?/i.exec(body);
        out.drink = dm ? '+1D ' + amt(dm[1]) : '+1D';
      }
      used.add(i); return;
    }
    if (!out.open && !out.start && (/OPEN|START|開場|開演|⏱|⏰|🕐/i.test(ln.slice(0, 14)))) {
      const tm = [...t.matchAll(/(\d{1,2})[:：](\d{2})/g)].map(m => m[1].padStart(2, '0') + ':' + m[2]);
      if (/OPEN|開場/i.test(t) && /START|開演/i.test(t)) { out.open = tm[0] || ''; out.start = tm[1] || ''; if (!tm[1] && tm[0]) { /* 片方だけ */ } }
      else if (tm.length >= 2) { out.open = tm[0]; out.start = tm[1]; }
      else if (tm.length === 1) { if (/START|開演/i.test(t)) out.start = tm[0]; else out.open = tm[0]; }
      used.add(i); return;
    }
  });
  // 公演名：日付より前の、ラベルのない最初の行
  const nameIdx = lines.findIndex((ln, i) => !used.has(i) && (di < 0 || i < di) && !/^(お世話|お疲れ|こんにちは|いつも|拝啓)/.test(ln) && !/\p{Extended_Pictographic}/u.test(ln.slice(0, 2)) && ln.length <= 60);
  if (nameIdx >= 0) { out.name = strip(lines[nameIdx]); { const mm = /^[「『【\[](.*)[」』】\]]$/.exec(out.name); if (mm) out.name = mm[1]; } used.add(nameIdx); }
  // 出演者：残りの行（見出し・URL・文章っぽい行を除く）
  lines.forEach((ln, i) => {
    if (used.has(i)) return; const t = nf(ln);
    if (/^(出演|ACT|LINE\s*UP|LINEUP|出演者|and\s*more|ほか|他)\s*[:：]?$/i.test(t)) return;
    if (/https?:\/\//i.test(t) || /^[※*＊]/.test(ln) || t.length > 50 || /[。！!？?]$/.test(t) || /(よろしく|お願い|ご連絡|です|ます)/.test(t)) { out.rest.push(ln); return; }
    out.performers.push(strip(ln).replace(/\s+$/, ''));
  });
  return out;
}

async function liveFormView(id) {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell(id ? '✏️ ライブを編集' : '🎸 ライブを登録', body, id ? '#/live?id=' + id : '#/live-list'));
  try {
    let l = null; let info = {};
    if (id) {
      const [lives, inf] = await Promise.all([api.lives(), api.liveInfo(id)]);
      l = lives.find(x => x.id === id); info = inf || {};
      if (!l) { body.replaceChildren(h('p', { class: 'empty' }, 'ライブが見つかりません。')); return; }
    }
    if (my !== renderId) return;
    const a = info.ann || {};
    const venues = await api.venues().catch(() => []);
    const venueAddrs = await api.venueAddresses().catch(() => ({}));
    const st = { kind: l ? l.kind : 'attend', head: typeof a.snsHead === 'string' ? a.snsHead : null, dest: 'instagram' };
    const txt = (v, ph, extra = {}) => h('input', { type: 'text', autocomplete: 'off', placeholder: ph || '', value: v || '', ...extra });
    const area = (v, ph, rows = 4) => { const e = h('textarea', { rows, class: 'area', autocomplete: 'off', placeholder: ph || '' }); e.value = v || ''; return e; };
    const E = {
      name: txt(l && l.event_name, '例: 焼肉丼十番30周年記念【十勝負】'), official: txt(info.official_title, '正式なライブ名(空欄なら上の名前)'),
      date: h('input', { type: 'date', value: l ? String(l.live_date).slice(0, 10) : ymd() }),
      open: txt(info.open_time, '18:00'), start: txt(info.start_time, '18:30'), end: txt(info.end_time, '22:00'),
      venue: txt(l && l.venue_name, '例: 神戸 太陽と虎(@taitora_kobe)', { list: 'lf-venues' }), pref: txt(l && l.prefecture, '例: 神戸'), address: txt(a.venueAddress, '例: 兵庫県神戸市中央区…'), bitVenue: txt(a.bitVenue, '空欄なら上の会場名を使います'), bitAddress: txt(a.bitAddress, '空欄なら上の住所を使います'),
      actLabel: txt(l ? a.actLabel : 'ACT', 'ACT'), shopLabel: txt(a.shopLabel, 'SHOP'),
      performers: area(info.performers, '1行に1組ずつ。「ほか」と書くと and more... になります', 5), shops: area(a.shops, '1行に1店ずつ。「FOOD:」のように最後に「:」を付けた行は小見出し', 4),
      price: txt(info.ticket_price, '例: ADV ¥3,500 / DOOR ¥4,000'), drink: txt(l ? a.drinkFee : '+1D', '例: +1D ¥600'),
      sales: area(a.salesMethod, '例: Wiθからも購入可能。DMまたは予約ページへ', 2), reserve: txt(info.reserve_url || 'https://forms.gle/hKYC9m8TMacuauNs5', 'https://forms.gle/…'), playguide: txt(a.playguideUrl, 'https://…'),
      bonus: txt(a.bonus, '入場特典'), notes: area(a.notes, '注意事項', 3), announce: area(a.announcement, '各SNSの文章に共通で入ります', 3),
      memo: txt(l && l.memo, '内部メモ(公開されません)'),
    };
    const dl = h('datalist', { id: 'lf-venues' }, ...venues.map(v => h('option', { value: v.name })));
    E.venue.addEventListener('change', () => { const x = venues.find(v => v.name === E.venue.value.trim()); if (x && x.prefecture && !E.pref.value.trim()) { E.pref.value = x.prefecture; refresh(); } const ad = venueAddrs[E.venue.value.trim()]; if (ad && !E.address.value.trim()) { E.address.value = ad; toast('前回入れた会場の住所を入れました', 'ok'); refresh(); } });
    const addrCand = h('div', { class: 'lsub', style: 'margin:4px 0 8px' });
    const addrBtn = h('button', { class: 'btn small ghost', type: 'button', style: 'margin-top:6px', onclick: async () => {
      const nm = E.venue.value.trim(); if (!nm) { toast('先に会場名を入れてください', 'err'); return; }
      addrBtn.disabled = true; addrCand.textContent = '調べています…';
      try {
        const j = await api.igpost({ action: 'venueAddress', name: nm, region: E.pref.value.trim() });
        if (!j.ok) { addrCand.textContent = ''; toast(j.message || '調べられませんでした', 'err'); }
        else if (!j.candidates.length) addrCand.textContent = '住所の候補が見つかりませんでした。手で入れてください。';
        else addrCand.replaceChildren('候補（タップで入ります。必ず会場の公式情報とあわせて確認してください）', ...j.candidates.map(c => h('button', { class: 'btn small ghost', type: 'button', style: 'display:block;margin-top:4px;text-align:left', onclick: () => { E.address.value = c.address.replace(/^〒\s*\d{3}-?\d{4}\s*/, ''); addrCand.textContent = ''; refresh(); } }, c.address + (c.source ? '（' + c.source + '）' : ''))));
      } catch (e) { addrCand.textContent = ''; toast(errMsg(e), 'err'); }
      addrBtn.disabled = false;
    } }, '🔎 住所を調べる');
    const pr = h('input', { type: 'checkbox' }); pr.checked = a.profileReserve !== false;
    const flyer = h('input', { type: 'file', accept: 'image/*' });
    const headIn = txt(st.head === null ? '' : st.head, '【LIVE INFO】(空欄で見出しなし)');
    const headChips = h('div', { class: 'chips' });
    const drawHead = () => headChips.replaceChildren(...[...R.HEAD_PRESETS, 'なし'].map(p => h('button', { type: 'button', class: 'chip' + ((p === 'なし' ? st.head === '' : st.head === p) ? ' on' : ''), onclick: () => { st.head = p === 'なし' ? '' : p; headIn.value = st.head; drawHead(); refresh(); } }, h('span', { class: 'chip-main' }, p))));
    headIn.addEventListener('input', () => { st.head = headIn.value; drawHead(); refresh(); });
    drawHead();
    const pv = h('pre', { class: 'pre', style: 'white-space:pre-wrap;word-break:break-word;margin:6px 0' });
    const pvInfo = h('div', { class: 'lsub' });
    const tabs = h('div', { class: 'chips' });
    const PV = [['instagram', 'Instagram'], ['x', 'X'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['googleForm', 'フォーム'], ['bandsintown', 'Bandsintown'], ['wordpress', '公式サイト']];
    const build = () => {
      const nl = { id: id || '', kind: st.kind, event_name: E.name.value.trim(), live_date: E.date.value, venue_name: E.venue.value.trim(), prefecture: E.pref.value.trim() };
      const ni = { official_title: E.official.value.trim() || null, open_time: E.open.value.trim(), start_time: E.start.value.trim(), end_time: E.end.value.trim(), ticket_price: E.price.value.trim(), performers: E.performers.value, reserve_url: E.reserve.value.trim(),
        ann: { ...(E.address.value.trim() ? { venueAddress: E.address.value.trim() } : {}), ...(E.bitVenue.value.trim() ? { bitVenue: E.bitVenue.value.trim() } : {}), ...(E.bitAddress.value.trim() ? { bitAddress: E.bitAddress.value.trim() } : {}), ...(E.drink.value.trim() ? { drinkFee: E.drink.value.trim() } : {}), ...(E.bonus.value.trim() ? { bonus: E.bonus.value.trim() } : {}), ...(E.sales.value.trim() ? { salesMethod: E.sales.value.trim() } : {}), ...(E.shops.value.trim() ? { shops: E.shops.value } : {}),
          ...(E.notes.value.trim() ? { notes: E.notes.value.trim() } : {}), ...(E.announce.value.trim() ? { announcement: E.announce.value.trim() } : {}), ...(E.playguide.value.trim() ? { playguideUrl: E.playguide.value.trim() } : {}),
          ...(st.head !== null ? { snsHead: st.head === '' ? ' ' : st.head } : {}), ...(E.actLabel.value.trim() ? { actLabel: E.actLabel.value.trim() } : {}), ...(E.shopLabel.value.trim() ? { shopLabel: E.shopLabel.value.trim() } : {}), ...(pr.checked ? {} : { profileReserve: false }) } };
      return { nl, ni };
    };
    function refresh() {
      const { nl, ni } = build();
      try {
        const ml = mkAnnLive(nl, ni); const k = st.dest;
        const c = R.generateContent(ml, k); const chk = R.checkText(k, c);
        pv.textContent = R.composeText(k, c);
        pvInfo.replaceChildren(h('span', {}, chk.counters.map(x => `${x.label} ${x.value}/${x.max}`).join(' ・ ')), ...chk.issues.map(i => h('div', { style: i.level === 'error' ? 'color:#c0392b' : '' }, (i.level === 'error' ? '⚠️ ' : 'ℹ️ ') + i.msg)));
      } catch (e) { pv.textContent = '(文章を作れませんでした)'; }
    }
    const drawTabs = () => tabs.replaceChildren(...PV.map(([k, n]) => h('button', { type: 'button', class: 'chip' + (st.dest === k ? ' on' : ''), onclick: () => { st.dest = k; drawTabs(); refresh(); } }, h('span', { class: 'chip-main' }, n))));
    drawTabs();
    for (const el of [...Object.values(E), pr]) { el.addEventListener('input', refresh); el.addEventListener('change', refresh); }
    const sec = (title, ...els) => h('section', { class: 'card' }, h('div', { class: 'cap' }, title), ...els);
    const two = (...els) => h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, ...els);
    const msg = h('p', { class: 'form-err', role: 'alert' });
    const ok = h('button', { class: 'btn big', onclick: async () => {
      msg.textContent = '';
      if (!E.name.value.trim()) { msg.textContent = 'ライブの名前を入れてください'; E.name.focus(); return; }
      if (!E.date.value) { msg.textContent = '日付を入れてください'; return; }
      if (!state.by) { await pickBy(true); if (!state.by) return; }
      ok.disabled = true;
      try {
        const o = { name: E.name.value.trim(), date: E.date.value, kind: st.kind, venue: E.venue.value.trim(), prefecture: E.pref.value.trim(), memo: E.memo.value.trim(), by: state.by };
        let lid = id; if (id) await api.saveLive(id, o); else lid = await api.addLive(o);
        const { ni } = build();
        const ann = { ...ni.ann }; if (ann.snsHead === ' ') ann.snsHead = ' ';
        await api.saveLiveInfo(lid, { official_title: ni.official_title, open_time: ni.open_time || null, start_time: ni.start_time || null, end_time: ni.end_time || null, ticket_price: ni.ticket_price || null, performers: ni.performers.trim() || null, reserve_url: ni.reserve_url || null, ann: Object.keys(ann).length ? ann : null });
        if (flyer.files && flyer.files[0]) { try { await api.addLiveFile(lid, 'flyer', flyer.files[0], state.by); } catch (e) { toast('フライヤー画像だけ保存できませんでした: ' + errMsg(e), 'err'); } }
        toast(id ? '保存しました' : 'ライブを登録しました', 'ok'); location.hash = '#/live?id=' + lid;
      } catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
    } }, id ? '保存する' : '登録する');
    const mailBtn = h('button', { type: 'button', class: 'btn', onclick: () => {
      const ta = h('textarea', { rows: 9, class: 'area', autocomplete: 'off', placeholder: '主催者から届いたメールやLINEの告知文を、そのまま貼り付けてください' });
      const sum = h('div', { class: 'muted', style: 'max-height:36dvh;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;font-size:13px' });
      let got = null;
      const fieldsOf = (g) => [['公演名', g.name], ['日付', g.date], ['開場', g.open], ['開演', g.start], ['会場', g.venue], ['チケット料金', g.price], ['ドリンク代', g.drink], ['出演者', g.performers.length ? g.performers.length + '組：' + g.performers.join('、') : '']].filter(x => x[1]);
      const readBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => {
        got = parseOrganizerMail(ta.value);
        const fl = fieldsOf(got);
        sum.replaceChildren(...(fl.length ? [h('div', {}, '読み取れた内容（足りない所は、あとで直せます）：'), ...fl.map(([k, v]) => h('div', {}, '・' + k + '：' + v))] : [h('div', {}, '読み取れる内容が見つかりませんでした')]), ...(got.rest.length ? [h('div', { style: 'margin-top:6px' }, '上の項目に当てはまらなかった行（注意事項の欄に入れます。不要なら消してください）：'), ...got.rest.map(x => h('div', {}, '・' + x))] : []));
        applyBtn.disabled = !fl.length;
      } }, '読み取る');
      const applyBtn = h('button', { type: 'button', class: 'btn', disabled: true, onclick: () => {
        const g = got; if (!g) return;
        const put = (el, v) => { if (v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
        if (!E.reserve.value.trim()) put(E.reserve, 'https://forms.gle/hKYC9m8TMacuauNs5');
        put(E.name, g.name); put(E.date, g.date); put(E.open, g.open); put(E.start, g.start); put(E.venue, g.venue); put(E.price, g.price); put(E.drink, g.drink);
        if (g.performers.length) put(E.performers, g.performers.join('\n'));
        if (g.rest.length) { const note = g.rest.join('\n'); put(E.notes, E.notes.value.trim() ? E.notes.value.trim() + '\n' + note : note); }
        mm.close(); refresh(); toast('フォームに入れました。内容を確認してください', 'ok');
      } }, 'フォームに入れる');
      const mm = modal([h('h3', {}, '📩 主催者の連絡から自動入力'), h('p', { class: 'muted' }, '貼り付けた文章から、日付・会場・料金・時間・出演者を読み取ります。AIではなく文字の並びから判断するので、結果を確認してから入れてください。'), ta, readBtn, sum, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => mm.close() }, 'やめる'), applyBtn)]);
    } }, '📩 主催者のメールから自動入力');
    body.replaceChildren(
      h('p', { class: 'hint' }, '分からない項目は空欄のままで大丈夫です。保存すると、各SNS向けの文章が自動で作られます(あとから個別に直せます)。'),
      sec('📩 かんたん入力', mailBtn),
      sec('基本情報', field('出演？主催？', chips([{ id: 'attend', label: '出演(呼ばれた)' }, { id: 'host', label: '主催(自分たちで開催)' }], st.kind, k => { st.kind = k; refresh(); })),
        field('公演名', E.name), field('正式なライブ名(任意)', E.official), field('SNSの本文の見出し(1行目)', headChips), headIn, field('日付', E.date)),
      sec('時間', two(field('開場', E.open), field('開演', E.start)), field('終演', E.end)),
      sec('会場', field('会場名', E.venue, '会場のSNSアカウントは「(@○○)」で書くと、Instagramで使えます'), dl, field('地域', E.pref), field('会場の住所', E.address, 'Bandsintown用CSVの住所欄に入ります（任意）'), addrBtn, addrCand, field('Bandsintown用の会場名（サーキットなど、会場が複数のとき）', E.bitVenue, 'Wiθが出る会場が決まったら入れてください。決まるまでは、CSVは作れません'), field('Bandsintown用の住所', E.bitAddress)),
      sec('出演者・出店', two(field('出演者の見出し', E.actLabel), field('出店の見出し', E.shopLabel)), field('出演者', E.performers), field('出店', E.shops)),
      sec('チケット', two(field('チケット料金', E.price), field('ドリンク代', E.drink)), field('販売方法・予約方法', E.sales), field('予約フォームのURL', E.reserve), field('プレイガイドのURL', E.playguide)),
      sec('特典・注意事項・告知文', field('入場特典', E.bonus), field('注意事項', E.notes), field('告知文(追加のひとこと)', E.announce)),
      sec('メモ', field('内部メモ', E.memo)),
      sec('素材(フライヤー画像)', field('フライヤー画像', flyer, '保存すると、画像が公演に追加されます。正方形・ストーリー画像は、保存後の画面から作れます')),
      sec('オプション', h('label', { class: 'chk' }, pr, ' SNSの最後に「チケット予約は、プロフィールのリンク or DMから！」を入れる')),
      sec('投稿される文章のプレビュー', h('p', { class: 'hint' }, '上の入力から自動で作った文章です。入力を変えるとすぐ変わります。保存後、公演の「告知」から個別に直せます。'), tabs, pv, pvInfo),
      msg, h('div', { class: 'row', style: 'gap:8px;margin:12px 0 40px' }, h('a', { class: 'btn big ghost', style: 'text-decoration:none;text-align:center;flex:1', href: id ? '#/live?id=' + id : '#/live-list' }, 'キャンセル'), ok));
    refresh();
  } catch (e) { body.replaceChildren(errorBox(e, () => liveFormView(id))); }
}

function liveEntryModal(live, isIn, done, entry) {
  const cats = state.cats.filter(c => c.group_name === live.kind && c.flow === (isIn ? 'income' : 'expense'));
  const f = { cat: entry ? entry.category_id || '' : '', payer: entry && entry.kind === 'expense_advanced' ? entry.payer_id || '' : '' };
  const amt = amountField(entry ? entry.amount : 0); const memo = h('input', { type: 'text', placeholder: isIn ? '例: ギャラ' : '例: 駐車場代', autocomplete: 'off', value: entry ? entry.memo || '' : '' });
  const date = h('input', { type: 'date', value: String(entry ? entry.occurred_on : live.live_date).slice(0, 10) });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const payers = [{ id: '', label: 'Wiθ資金' }, ...state.people.filter(p => p.can_pay).map(p => ({ id: p.id, label: p.name }))];
  const hint = h('span', { class: 'hint' }, f.payer ? `立替: 資金は減らず、${nameOf(f.payer)}への未払いになります。` : 'Wiθの資金から支払います。資金が減ります。');
  const rcp = isIn || entry ? null : receiptPicker();
  const ct = claimToggle();
  const prodBox = isIn && !entry ? h('div', { class: 'card mini', style: 'display:none' },
    h('p', { class: 'hint' }, '商品を選んで記録すると、在庫・STS取り分・売上がまとめて記録されます(金額だけの入力なら、下の欄に入れてください)。'),
    h('a', { class: 'btn big in', style: 'display:block;text-align:center;text-decoration:none', href: '#/live-sale?id=' + live.id, onclick: () => { try { m.close(); } catch {} } }, '📦 商品を選んで記録する')) : null;
  const ok = h('button', { class: 'btn big ' + (isIn ? 'in' : 'out'), onclick: async () => {
    msg.textContent = ''; const a = amt.get();
    if (!f.cat) { msg.textContent = 'カテゴリを選んでください'; return; }
    if (!(a > 0)) { msg.textContent = '金額を入れてください'; return; }
    if (!state.by) { await pickBy(true); if (!state.by) return; }
    ok.disabled = true;
    try {
      if (entry) {
        await api.editEntry(entry.id, { date: date.value, amount: a, category_id: f.cat, memo: memo.value.trim(), payer_id: isIn ? null : (f.payer || null), by: state.by });
        m.close(); toast('修正しました', 'ok'); done(); return;
      }
      const res = await api.addEntry({ date: date.value, kind: isIn ? 'income' : (f.payer ? 'expense_advanced' : 'expense_fund'), amount: a, category_id: f.cat, memo: memo.value.trim(), payer_id: isIn ? null : (f.payer || null), live_id: live.id, posting: !isIn && f.payer && ct.get() ? 'draft' : 'posted', by: state.by });
      const isDraft = !isIn && f.payer && ct.get();
      const rf = rcp ? rcp.files() : [];
      if (rf.length && res && res.id) await uploadReceipts(res.id, rf);
      m.close(); getFx(isIn ? `+${yen(a)}` : `−${yen(a)}`, isIn ? 'MONEY GET!' : (isDraft ? '審査中で記録' : f.payer ? '立替を記録' : 'PAID')); done();
    } catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '記録する');
  const m = modal([h('h3', {}, (entry ? '✏️ 修正: ' : '') + (isIn ? '💰 収入 ' : '💸 支出 ') + '— ' + live.event_name),
    entry ? h('p', { class: 'muted' }, '元の記録は「取消済み」として残り、直した内容が新しく追加されます。') : null,
    field(isIn ? 'どこから？' : 'なにに？', chips(cats.map(c => ({ id: c.id, label: c.name })), f.cat, id => { f.cat = id; if (prodBox) prodBox.style.display = isIn && !entry && (cats.find(c => c.id === id) || {}).name === '物販売上' ? '' : 'none'; })),
    prodBox,
    field('金額', amt.el), field('内容', memo), field('日付', date),
    isIn ? null : h('div', { class: 'field' }, h('span', { class: 'field-label' }, '誰が払った？'), chips(payers, f.payer, id => { f.payer = id; ct.show(!entry && !!id); hint.textContent = id ? `立替: 資金は減らず、${nameOf(id)}への未払いになります。` : 'Wiθの資金から支払います。資金が減ります。'; }), hint, ct.el),
    rcp ? rcp.el : null,
    msg, ok]);
}

function liveFileBlock(live, files, furl, kind, conf, done) {
  const mine = files.filter(f => f.kind === kind);
  const list = h('div', { class: 'rthumbs' }, ...mine.map(f => h('div', { class: 'rthumb big' },
    f.mime === 'application/pdf' ? h('a', { class: 'rpdf', href: furl.get(f.id) || '#', target: '_blank', rel: 'noopener' }, 'PDF') : h('a', { href: furl.get(f.id) || '#', target: '_blank', rel: 'noopener' }, h('img', { src: furl.get(f.id) || '', alt: '' })),
    conf ? null : h('button', { type: 'button', class: 'rx', 'aria-label': '削除', onclick: async () => {
      if (!(await confirmBox('このファイルを削除する？', '完全に消えます。', '削除する'))) return;
      try { await api.removeLiveFile(f); toast('削除しました', 'ok'); done(); } catch (er) { toast(errMsg(er), 'err'); }
    } }, '🗑'))));
  const mk = (label, attrs) => {
    const inp = h('input', { type: 'file', style: 'display:none', ...attrs });
    inp.addEventListener('change', async () => {
      if (!state.by) { await pickBy(true); if (!state.by) { inp.value = ''; return; } }
      let n = 0;
      for (const f of [...inp.files]) { try { await api.addLiveFile(live.id, kind, await shrinkImage(f, 2400, 0.85), state.by); n++; } catch (e) { toast(errMsg(e), 'err'); } }
      inp.value = ''; if (n) { toast(n + '件 保存しました', 'ok'); done(); }
    });
    return h('span', {}, inp, h('button', { type: 'button', class: 'btn ghost small', onclick: () => inp.click() }, label));
  };
  return h('div', {}, mine.length ? list : null, conf ? null : h('div', { class: 'with-btn', style: 'gap:8px;flex-wrap:wrap;margin-top:8px' }, mk('📷 撮影する', { accept: 'image/*', capture: 'environment' }), mk('🖼 画像・PDFを追加', { accept: 'image/*,application/pdf', multiple: true })));
}
function venueEmailModal(live, done) {
  const em = h('input', { type: 'email', autocomplete: 'off', placeholder: '例: info@livehouse.jp', value: live.venue_email || '' });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const ok = h('button', { class: 'btn big', onclick: async () => {
    ok.disabled = true; msg.textContent = '';
    try { await api.saveVenueEmail(live.venue_id, em.value.trim() || null); m.close(); toast('保存しました', 'ok'); done(); } catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '保存する');
  const m = modal([h('h3', {}, '✉️ ' + (live.venue_name || '会場') + ' の連絡先'), h('p', { class: 'hint' }, 'セット図などを送るメールアドレスです。会場ごとに1度入れれば、次回からも使えます。'), field('メールアドレス', em), msg, ok]);
}
function stagePlotMail(live, info, links) {
  const ds = String(live.live_date).slice(0, 10); const [y, m, d] = ds.split('-').map(Number);
  const wd = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  const ev = info.official_title || live.event_name;
  const subj = `【セット図提出】${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}「${ev}」/ Wiθ`;
  const line = '----------------------------------------';
  const sent = links && links.length ? '当日のセット図の方、完成いたしましたので、\n下記のリンクから提出いたします。(7日間有効)\n' + links.join('\n') : '当日のセット図の方、完成いたしましたので、\n本メールに添付して提出いたします。';
  const body = `お世話になっております。\n${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}の${ev}に出演させていただきます、\n鹿児島の「Wiθ」のVo/Gt の夏樹です。\n\n${sent}\nご確認のほどよろしくお願いいたします。\n\n${line}\n【出演情報】\n・日程：${y}年${m}月${d}日(${wd})\n・イベント名：${ev}\n・出演名：Wiθ\n${line}\n\nご不明な点や、会場の常設機材との兼ね合いで調整が必要な箇所がございましたら、\nお手数ですがご連絡いただけますと幸いです。\n\n当日はどうぞよろしくお願いいたします！！\n\n${line}\n榎木 夏樹 Wiθ Vo/Gt\n080-3992-2056\n${line}`;
  return { subj, body };
}
async function sendStagePlot(live, info, files) {
  const plots = files.filter(f => f.kind === 'stageplot');
  const links = (await Promise.all(plots.map(f => api.liveFileUrl(f.path, 604800).catch(() => null)))).filter(Boolean);
  const { subj, body } = stagePlotMail(live, info, links);
  // スマホのメールアプリは CRLF(%0D%0A) でないと改行が消えることがあるため
  const crlf = body.replace(/\r?\n/g, '\r\n');
  location.href = `mailto:${live.venue_email || ''}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(crlf)}`;
}
async function shareStagePlot(live, info, files) {
  const plots = files.filter(f => f.kind === 'stageplot');
  if (!plots.length) { toast('先にセット図を追加してください', 'err'); return; }
  try {
    const fs = await Promise.all(plots.map(async (f, i) => { const url = await api.liveFileUrl(f.path); const b = await (await fetch(url)).blob(); return new File([b], `セット図${plots.length > 1 ? i + 1 : ''}.${f.mime === 'application/pdf' ? 'pdf' : f.mime === 'image/png' ? 'png' : 'jpg'}`, { type: f.mime }); }));
    if (!navigator.canShare || !navigator.canShare({ files: fs })) { toast('この端末では添付つき共有に未対応です。メール本文のリンクをお使いください', 'err'); return; }
    const mail = stagePlotMail(live, info, null);
    await navigator.share({ files: fs, title: mail.subj, text: mail.body });
  } catch (e) { if (e && e.name !== 'AbortError') toast('共有できませんでした', 'err'); }
}
// ---------- 告知(managerの文面生成・進行管理を移したもの) ----------
const ANN_FIELDS = [
  ['venueAddress', '会場の住所(Bandsintownに入ります)', 'text'], ['bitVenue', 'Bandsintown用の会場名(会場が複数のとき、Wiθが出る会場)', 'text'], ['bitAddress', 'Bandsintown用の住所', 'text'], ['drinkFee', 'ドリンク代(例 +1D ¥600)', 'text'], ['bonus', '入場特典', 'text'], ['salesMethod', '販売方法・予約方法', 'area'],
  ['shops', '出店(1行に1店。「FOOD:」のように:で終わる行は小見出し)', 'area'], ['notes', '注意事項など', 'area'], ['announcement', '追加の一言(SNSの本文に入ります)', 'area'],
  ['playguideUrl', 'プレイガイドのURL', 'text'], ['snsHead', 'SNS本文の見出し(空欄で見出しなし。未設定は【LIVE INFO】)', 'text'],
  ['actLabel', '出演者の見出し(未設定はACT)', 'text'], ['shopLabel', '出店の見出し(未設定はSHOP)', 'text'],
];
const ANN_DESTS = ['instagram', 'x', 'tiktok', 'youtube', 'wordpress', 'googleForm', 'bandsintown'];
const ANN_STATUS = ['notStarted', 'draft', 'manualPending', 'manualDone', 'success', 'skipped'];
function mkAnnLive(l, info) {
  const a = info.ann || {};
  const o = {
    title: info.official_title || l.event_name || '', date: String(l.live_date || '').slice(0, 10), openTime: info.open_time || '', startTime: info.start_time || '', endTime: info.end_time || '',
    venue: l.venue_name || '', region: l.prefecture || '', performers: info.performers || '', ticketPrice: info.ticket_price || '', reserveFormUrl: info.reserve_url || '', isSample: false,
    profileReserve: a.profileReserve !== false,
  };
  for (const [k] of ANN_FIELDS) if (a[k] != null && a[k] !== '') o[k] = a[k];
  if (a.snsHead === '' || a.snsHead === ' ') o.snsHead = '';
  return o;
}
function annModal(l, info, done) {
  const a = info.ann || {};
  const els = ANN_FIELDS.map(([k, label, type]) => { const el = type === 'area' ? h('textarea', { rows: 4, class: 'area', autocomplete: 'off' }) : h('input', { type: 'text', autocomplete: 'off' }); el.value = a[k] || ''; return [k, el, label]; });
  const pr = h('input', { type: 'checkbox' }); pr.checked = a.profileReserve !== false;
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const ok = h('button', { class: 'btn big', onclick: async () => {
    ok.disabled = true; msg.textContent = '';
    try {
      const n = {}; for (const [k, el] of els) { const v = el.value.trim(); if (v) n[k] = v; }
      if (pr.checked === false) n.profileReserve = false;
      await api.saveLiveInfo(l.id, { ann: Object.keys(n).length ? n : null }); m.close(); toast('保存しました', 'ok'); done();
    } catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '保存する');
  const m = modal([h('h3', {}, '✏️ 告知の追加情報'), h('p', { class: 'hint' }, '正式名・時間・料金・出演者・予約URLは、上の「告知の情報」にあります。'), ...els.map(([k, el, label]) => field(label, el)),
    h('label', { class: 'chk' }, pr, ' 本文に「予約はプロフィールのリンク or DMから」を入れる'), msg, ok]);
}
function snsImageSec(l, info, conf, files, furl, reload) {
  const fl = files.find(f => f.kind === 'flyer' && /^image\//.test(f.mime || ''));
  const sqf = [...files].reverse().find(f => f.kind === 'square');
  const ui = { h, modal, toast };
  const ml = mkAnnLive(l, info);
  const ensureBy = async () => { if (!state.by) await pickBy(true); return !!state.by; };
  const save = (kind, nm) => async (f) => { if (!(await ensureBy())) throw new Error('だれの操作か選んでください'); await api.addLiveFile(l.id, kind, f, state.by); toast('保存しました', 'ok'); reload(); };
  const btn = (label, fn) => h('button', { type: 'button', class: 'btn ghost small', onclick: fn }, label);
  const date = String(l.live_date || '').slice(0, 10);
  const sec = (title, ...els) => h('section', { class: 'card' }, h('div', { class: 'cap' }, title), ...els);
  return sec('🎨 SNS用の画像',
    fl ? null : h('p', { class: 'empty' }, '先にフライヤー画像を追加すると、ここから正方形やストーリーの画像を作れます。'),
    fl && !conf ? h('div', { class: 'with-btn', style: 'gap:8px;flex-wrap:wrap' },
      btn('🟦 正方形を作る', () => squareMaker(ui, furl.get(fl.id), '正方形.jpg', save('square'))),
      btn('📱 ストーリー下地を作る', () => storyMaker(ui, furl.get(fl.id), sqf ? furl.get(sqf.id) : null, {
        ymd: date,
        def: { head: R.snsHeadOf(ml) || '【LIVE INFO】', title: ml.title, date: R.fmtDateShort(date), venue: R.venuePlainName(ml), performers: R.performersOf(ml), ticket: ml.ticketPrice || '', drink: ml.drinkFee || '' },
      }, 'ストーリー.jpg', save('story')))) : null,
    files.some(f => f.kind === 'square') ? h('div', {}, h('div', { class: 'cap sec' }, '正方形'), liveFileBlock(l, files, furl, 'square', true, reload)) : null,
    files.some(f => f.kind === 'story') ? h('div', {}, h('div', { class: 'cap sec' }, 'ストーリー'), liveFileBlock(l, files, furl, 'story', true, reload)) : null);
}

const TS = (() => {
  const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
function normName(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/^[・･\-*\s◆◇●○■□★☆▶▷►♦◉※]+/, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}
/** 名前の表示用（先頭の「・」や（地域）を外す） */
function displayName(s) {
  return String(s || '').normalize('NFKC').replace(/^[・･\-*\s◆◇●○■□★☆▶▷►♦◉※]+/, '').replace(/\s*[（(][^）)]*[）)]\s*/g, ' ').trim();
}
const cleanHandle = (h) => {
  const v = String(h || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram\.com|x\.com|twitter\.com)\//i, '').replace(/[/?#].*$/, '');
  return HANDLE_RE.test(v) ? v : '';
};

// ---- 名前とアカウントの一致度（候補の並べ替え・絞り込み用） ----
const KANA = { きゃ:'kya',きゅ:'kyu',きょ:'kyo',しゃ:'sha',しゅ:'shu',しょ:'sho',ちゃ:'cha',ちゅ:'chu',ちょ:'cho',にゃ:'nya',にゅ:'nyu',にょ:'nyo',ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',みゃ:'mya',みゅ:'myu',みょ:'myo',りゃ:'rya',りゅ:'ryu',りょ:'ryo',ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',じゃ:'ja',じゅ:'ju',じょ:'jo',びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',てぃ:'ti',でぃ:'di',ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo',うぃ:'wi',うぇ:'we',うぉ:'wo',ゔぁ:'va',ゔぃ:'vi',ゔ:'vu',しぇ:'she',じぇ:'je',ちぇ:'che',
  あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',を:'o',ん:'n',が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',ぁ:'a',ぃ:'i',ぅ:'u',ぇ:'e',ぉ:'o',ゃ:'ya',ゅ:'yu',ょ:'yo' };
/** かな → ローマ字（ざっくり。「ザ ○○」は the ○○ とみなす） */
function kanaToRomaji(s) {
  let t = String(s || '').normalize('NFKC').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  t = t.replace(/^ざ[\s　]+/, 'the ');
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const two = t.slice(i, i + 2);
    if (t[i] === 'っ') { const nx = KANA[t.slice(i + 1, i + 3)] || KANA[t[i + 1]] || ''; out += nx[0] || ''; continue; }
    if (t[i] === 'ー') { out += out.slice(-1); continue; }
    if (KANA[two]) { out += KANA[two]; i++; continue; }
    out += KANA[t[i]] ?? t[i];
  }
  return out;
}
const latin = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
// アカウント名によく付く飾り（official・band・jp など）を外した芯
const AFFIX = /^(the|official|band|music|team)|(official|offical|band|music|jp|japan|staff|info|insta|ig|tokyo|osaka|net|com|tw|x|ofc|of|0+|1+)$/;
function coreHandle(u) {
  let c = latin(u);
  for (let k = 0; k < 4; k++) { const n = c.replace(AFFIX, ''); if (n === c || n.length < 2) break; c = n; }
  return c;
}
const skeleton = (s) => s.replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) || 0);
  return (2 * hit) / Math.max(1, a.length - 1 + b.length - 1);
}
/** 名前（例：◆BLAGGED（Manchester,UK）／ザ ニンクス）とアカウント（名前・表示名）の一致度 0〜100 */
function matchScore(name, username, display = '') {
  const key = normName(name);
  if (!key) return 0;
  const keyLat = latin(displayName(name)) || '';
  const keyRoma = latin(kanaToRomaji(displayName(name)));
  const keys = [...new Set([key, keyLat, keyRoma].filter((k) => k && k.length >= 2))];
  const u = latin(username), uc = coreHandle(username), dn = normName(display);
  let best = 0;
  for (const k of keys) {
    const kc = coreHandle(k) || k;
    // 表示名が同じでも、アカウント名が全然違うなら同名の別人のことが多い（例：MERRY と @ac_merry_ は別のお店）→ 80 止まり
    if (dn && dn === k) best = Math.max(best, uc && (uc.includes(kc) || kc.includes(uc)) && Math.min(uc.length, kc.length) / Math.max(uc.length, kc.length) >= 0.8 ? 100 : 80);
    if (u === k || uc === kc) best = Math.max(best, 98);
    else if (uc.length >= 3 && kc.length >= 3 && (uc.includes(kc) || kc.includes(uc))) best = Math.max(best, 70 + 25 * Math.min(uc.length, kc.length) / Math.max(uc.length, kc.length));
    if (dn && dn !== k && dn.length >= 2 && (dn.includes(k) || (k.length >= 3 && k.includes(dn)))) best = Math.max(best, 65 + 15 * Math.min(dn.length, k.length) / Math.max(dn.length, k.length));
    best = Math.max(best, 85 * dice(kc, uc), dn ? 85 * dice(k, dn) : 0);
    // かな名とローマ字のアカウント：子音の並びが同じなら近い（ニンクス nnks ⇔ the_ninks nnks）
    if (k === keyRoma && k !== keyLat && skeleton(kc).length >= 3 && skeleton(kc) === skeleton(uc)) best = Math.max(best, 90);
  }
  return Math.round(best);
}

function guessHandles(name) {
  const words = displayName(name).normalize('NFKC').toLowerCase().split(/[\s　]+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  // （英字の名前だけ。かなの名前は表記ゆれが大きいので、検索の結果と一致度で探す）
  if (!words.length || words.join('').length < 3) return [];
  const j = words.join(''), u = words.join('_'), d = words.join('.');
  return [...new Set([j, u, d, `${j}_official`, `${j}official`, `${j}_band`, `${j}band`, `${j}.official`, `${u}_official`, `${j}_jp`, `${j}jp`, `${j}_japan`, `${j}music`, `${j}_music`, `the${j}`, `the_${j}`, `${j}_info`, `${j}_staff`])].filter((h) => HANDLE_RE.test(h) && h.length <= 30);
}

  return { matchScore, guessHandles, displayName };
})();

// ---- タグ付け・メンション(Instagram・X)：名前→@アカウントを覚えて、本文に@・写真タグを付ける
// 「候補を探す」(Instagram)：過去の投稿の@・名前から考えたアカウントをInstagramで確認し、名前との一致度で並べる
const normName = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[（(][^）)]*[）)]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
let bookP = null;
const getBook = () => (bookP = bookP || api.accountBook().catch(() => ({})));
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fmtFol = (n) => n == null ? '' : n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(n);
const SRC_BASE = { 登録済み: 1000, 会場欄: 500, 過去の投稿: 40, 名前から: 30, Web検索: 0 };
function suggestFor(t, targets, d, saved) {
  const prof = d.profiles || {}; const raw = [];
  const push = (u, source, extra = {}) => {
    if (!u) return; const p = prof[u.toLowerCase()];
    if (p && p.exists === false) return;
    const dup = raw.find(c => c.username.toLowerCase() === u.toLowerCase());
    if (dup) { if ((SRC_BASE[source] || 0) > (SRC_BASE[dup.source] || 0)) dup.source = source; dup.web = Math.max(dup.web || 0, extra.web || 0); return; }
    raw.push({ username: (p && p.username) || u, name: (p && p.name) || extra.name || '', pic: (p && p.pic) || '', followers: p && p.followers != null ? p.followers : null, exists: p ? p.exists : null, source, web: extra.web || 0 });
  };
  if (saved) push(saved, '登録済み');
  if (t.venueHandle) push(t.venueHandle, '会場欄');
  for (const c of (d.web && d.web[t.name]) || []) push(c.username, 'Web検索', { name: c.name, web: Math.min(c.pts, 40) });
  for (const u of d.harvested || []) { const p = prof[u] || { exists: null, username: u, name: '' }; if (p.exists === false) continue; if (TS.matchScore(t.name, p.username || u, p.name) >= 70) push(p.username || u, '過去の投稿'); }
  for (const g of t.guesses || []) if (prof[g] && prof[g].exists) push(prof[g].username, '名前から');
  const otherBetter = (username, display, sim) => targets.some(o => o !== t && TS.matchScore(o.name, username, display) >= 85 && TS.matchScore(o.name, username, display) > sim);
  const out = [];
  for (const c of raw) {
    const sim = TS.matchScore(t.name, c.username, c.name);
    if (!(['登録済み', '会場欄'].includes(c.source) || (sim >= (c.source === 'Web検索' ? 20 : 45) && !otherBetter(c.username, c.name, sim)))) continue;
    out.push({ ...c, sim, score: (SRC_BASE[c.source] || 0) + sim * 3 + (c.web || 0) + (c.exists === true ? 20 : 0) + (c.followers ? Math.min(20, Math.log10(c.followers + 1) * 5) : 0) });
  }
  out.sort((a, b) => b.score - a.score);
  const cands = out.slice(0, 6);
  const byHandle = c => TS.matchScore(t.name, c.username, '') >= 95;
  const auto = !saved && !t.venueHandle && cands[0] && byHandle(cands[0]) && (cands[0].exists === true || (cands[0].exists === null && cands[0].web > 0)) && !cands.slice(1).some(byHandle) ? cands[0].username : '';
  return { cands, auto };
}
const TAGSTATE = new Map(); const ANN_OPEN = new Set();
function tagPanel(k, ml, bodyEl) {
  const isIg = k === 'instagram';
  const key = isIg ? 'ig' : 'x';
  const names = R.performersOf(ml).filter(n => !/and\s*more/i.test(n));
  const vn = R.venuePlainName(ml);
  const vparts = R.venueParts(ml);
  const items = [...names.map(n => ({ name: n, h: '', kind: 'act' })), ...(vn ? vparts.map(p => ({ name: p.plain || vn, h: p.handle || '', vh: p.handle || '', venue: true, kind: 'venue' })) : [])];
  const el = h('div', { class: 'tagpanel', style: 'margin:8px 0' }, h('div', { class: 'lsub' }, '👥 タグ付け・メンション(読み込み中…)'));
  const rows = [];
  const sk = k + '|' + items.map(i => i.name).join('|');
  if (!TAGSTATE.has(sk)) TAGSTATE.set(sk, { photo: new Set() });
  const st = TAGSTATE.get(sk);
  const hasM = (hd) => !!hd && new RegExp('@' + reEsc(hd) + '(?![A-Za-z0-9._])', 'i').test(bodyEl.value);
  const fire = () => bodyEl.dispatchEvent(new Event('change', { bubbles: true }));
  const addM = (it, hd) => {
    if (!hd || hasM(hd)) return;
    const lines = bodyEl.value.split('\n'); const kk = normName(it.name);
    // 会場は「📍 会場名」の行に付ける（公演名に会場名が入っていても、そちらには付けない）
    let i = it.venue ? lines.findIndex(l => /^\s*📍/.test(l) && kk && normName(l).includes(kk)) : -1;
    if (i < 0) i = lines.findIndex(l => normName(l) === kk);
    if (i < 0) i = lines.findIndex((l, n) => n > 0 && kk && !/^\s*📍/.test(l) === !it.venue && normName(l).includes(kk));
    if (i < 0 && it.venue) i = lines.findIndex((l, n) => n > 0 && kk && normName(l).includes(kk));
    if (i >= 0) lines[i] = lines[i].replace(/\s+$/, '') + ' @' + hd; else lines.push('@' + hd);
    bodyEl.value = lines.join('\n'); fire();
  };
  const delM = (hd) => { if (!hd) return; bodyEl.value = bodyEl.value.replace(new RegExp('[ \\t]?@' + reEsc(hd) + '(?![A-Za-z0-9._])', 'gi'), ''); fire(); };
  const setHandle = async (r, nh) => {
    const it = r.it;
    nh = String(nh || '').trim().replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
    if (it.h && hasM(it.h)) { delM(it.h); if (nh) addM(it, nh); }
    it.h = nh; r.inp.value = nh ? '@' + nh : ''; r.mc.checked = hasM(nh);
    const b = await getBook(); const kk = normName(it.name); b[kk] = { ...(b[kk] || {}), name: it.name, [key]: nh };
    if (!nh && !b[kk].ig && !b[kk].x) delete b[kk];
    api.saveAccountBook(b);
  };
  const checkOn = (r) => { if (!r.it.h) return; r.mc.checked = true; addM(r.it, r.it.h); if (r.pc) { r.pc.checked = true; st.photo.add(r.it.h.toLowerCase()); } };
  const drawCands = (r, cands) => {
    if (!cands.length) { r.cbox.replaceChildren(h('span', { class: 'lsub' }, '候補が見つかりませんでした(名前で探すか、手入力してください)')); return; }
    r.cbox.replaceChildren(...cands.map(c => h('button', { type: 'button', class: 'btn small ghost', style: 'display:flex;gap:6px;align-items:center;text-align:left;margin:2px 4px 2px 0', onclick: async () => { await setHandle(r, c.username); checkOn(r); drawCands(r, cands); } },
      c.pic ? h('img', { src: c.pic, alt: '', referrerpolicy: 'no-referrer', style: 'width:28px;height:28px;border-radius:50%;object-fit:cover' }) : h('span', {}, '@'),
      h('span', {}, h('b', {}, (r.it.h && c.username.toLowerCase() === r.it.h.toLowerCase() ? '✔ ' : '') + '@' + c.username), h('br'), h('span', { class: 'lsub' }, [c.name, c.followers != null ? fmtFol(c.followers) + '人' : '', c.source].filter(Boolean).join(' · '))))));
  };
  getBook().then(book => {
    el.replaceChildren(h('div', { class: 'lsub' }, '👥 タグ付け・メンション：名前のとなりに@アカウントを入れると覚えます。' + (isIg ? '「写真にタグ」は正方形・フライヤー投稿のときだけ付きます。' : '')));
    for (const it of items) {
      const rec = book[normName(it.name)] || {};
      it.h = it.h || rec[key] || '';
      const inp = h('input', { type: 'text', autocomplete: 'off', placeholder: '@アカウント名', value: it.h ? '@' + it.h : '', style: 'flex:1;min-width:120px' });
      const mc = h('input', { type: 'checkbox' }); mc.checked = hasM(it.h);
      const pc = isIg ? h('input', { type: 'checkbox' }) : null; if (pc) pc.checked = false;
      const cbox = h('div', { style: 'margin:0 0 6px' });
      const row = { it, inp, mc, pc, cbox };
      rows.push(row);
      inp.addEventListener('change', () => setHandle(row, inp.value));
      mc.addEventListener('change', () => { if (!it.h) { mc.checked = false; toast('先に@アカウントを入れてください', 'err'); return; } mc.checked ? addM(it, it.h) : delM(it.h); });
      if (pc) pc.addEventListener('change', () => { if (!it.h) { pc.checked = false; toast('先に@アカウントを入れてください', 'err'); return; } if (pc.checked) st.photo.add(it.h.toLowerCase()); else st.photo.delete(it.h.toLowerCase()); });
      el.append(h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0' },
        h('span', { style: 'min-width:90px' }, it.name), inp,
        h('label', { class: 'lsub' }, mc, ' 本文に@'), pc ? h('label', { class: 'lsub' }, pc, ' 写真にタグ') : null), cbox);
    }
    rows.forEach((r, i) => {
      if (r.pc && r.it.h && st.photo.has(r.it.h.toLowerCase())) r.pc.checked = true;
      if (st.d && st.targets[i]) drawCands(r, suggestFor(st.targets[i], st.targets, st.d, r.it.h).cands);
    });
    const find = h('button', { type: 'button', class: 'btn small', onclick: async () => {
      find.disabled = true; const old = find.textContent; find.textContent = '探しています…(少しかかります)';
      try {
        const targets = rows.map(r => ({ name: r.it.name, kind: r.it.kind, raw: r.it.name, venueHandle: r.it.venue ? (r.it.vh || '') : '', guesses: TS.guessHandles(r.it.name) }));
        const need = targets.filter((t, i) => !rows[i].it.h);
        const d = await api.igpost({ action: 'discover', targets: need.map(t => ({ name: t.name, kind: t.kind, raw: t.raw, guesses: t.guesses })) });
        st.d = d; st.targets = targets;
        const picked = [];
        for (const [i, r] of rows.entries()) {
          const t = targets[i];
          const { cands, auto } = suggestFor(t, targets, d, r.it.h);
          drawCands(r, cands);
          if (auto && !r.it.h) { await setHandle(r, auto); checkOn(r); drawCands(r, cands); picked.push('@' + auto); }
        }
        if (picked.length) toast('名前が一致したので自動で選びました：' + picked.join(' ') + '(違っていたら直してください)', 'ok');
        else toast('候補を探しました。当てはまるものをタップして選んでください', 'ok');
        for (const w of d.warn || []) toast(w, 'err');
        if (!d.webReady) { /* Web検索のキーが未設定でも、Instagramの情報から探せる */ }
      } catch (e) { toast(errMsg(e), 'err'); }
      find.disabled = false; find.textContent = old;
    } }, '🔎 候補を探す');
    el.append(h('div', { class: 'row', style: 'gap:8px;margin-top:4px;flex-wrap:wrap' }, isIg ? find : null, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { for (const r of rows) checkOn(r); } }, 'アカウントがある人を全部チェック'),
      h('a', { class: 'btn small ghost', href: (isIg ? 'https://www.google.com/search?q=' : 'https://x.com/search?f=user&q=') + encodeURIComponent((names[0] || '') + (isIg ? ' instagram' : '')), target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, '名前で探す ↗')));
  });
  return { el, getTags: () => rows.filter(r => r.pc && r.pc.checked && r.it.h).map(r => r.it.h) };
}
function announcePane(l, info, conf, posts, reload, files, furl) {
  const ml = mkAnnLive(l, info);
  const pm = new Map(posts.map(p => [p.dest, p]));
  const block = R.publishBlockReason(ml);
  const copy = async t => { try { await navigator.clipboard.writeText(t); toast('コピーしました', 'ok'); } catch { toast('コピーできませんでした。文章を長押ししてコピーしてください', 'err'); } };
  const save = async (k, patch) => { try { await api.saveLivePost(l.id, k, patch, state.by); reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  const flyerImage = async () => {
    const fl = (files || []).find(f => f.kind === 'flyer' && /^image\//.test(f.mime || ''));
    if (!fl) return undefined;
    const bl = await (await fetch(furl.get(fl.id))).blob();
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(bl); });
    const hx = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await bl.arrayBuffer()))).slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join('');
    return { name: 'flyer-' + hx + (fl.mime === 'image/png' ? '.png' : '.jpg'), mime: fl.mime, b64 };
  };
  const sendWp = async (c, p, publish, publishAt) => {
    if (block) { toast(block, 'err'); return; }
    const ok = await confirmBox(publishAt ? '公式サイトに予約公開しますか？' : publish ? '公式サイトに公開しますか？' : '公式サイトに下書きを送りますか？', (publishAt ? new Date(publishAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' に自動で公開されます。それまでは公式サイトに表示されません。' : publish ? '公開すると、すぐに公式サイトに表示されます。' : '下書きとして作成します(公開はされません)。同じタイトルの投稿があれば、その内容を更新します。') + '\nタイトル: ' + (c.title || ''), publishAt ? '予約する' : publish ? '公開する' : '下書きを送る');
    if (!ok) return;
    try {
      const pr = await api.wpPublish({ title: c.title, content: c.body, kind: 'live', probe: true });
      if (pr.exists && pr.status === 'publish' && !(await confirmBox('すでに公開されています', '公式サイトに同じライブのページが公開中です。このまま送ると、公開中のページの内容が書き換わります(下書きにはなりません)。', '上書きする'))) return;
    } catch (e) { toast(errMsg(e), 'err'); return; }
    try {
      const image = await flyerImage();
      const j = await api.wpPublish({ title: c.title, content: c.body, publish, publishAt, kind: 'live', image });
      const hist = [...(p?.history || []), { at: new Date().toISOString(), status: j.status === 'publish' ? 'success' : 'draft', url: j.url, id: j.id, by: state.by || null }].slice(-30);
      await api.saveLivePost(l.id, 'wordpress', { status: j.status === 'publish' ? 'success' : 'draft', history: hist }, state.by);
      toast(j.message, 'ok'); reload();
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  const schedWp = (c, p) => {
    if (block) { toast(block, 'err'); return; }
    const d0 = new Date(Date.now() + 86400000); const pad = n => String(n).padStart(2, '0');
    const when = h('input', { type: 'datetime-local', value: d0.getFullYear() + '-' + pad(d0.getMonth() + 1) + '-' + pad(d0.getDate()) + 'T19:00' });
    const m = modal([
      h('h3', {}, '公式サイトに予約公開'),
      h('p', { class: 'muted' }, '指定した日時に、WordPressが自動で公開します（このアプリを開いていなくても大丈夫です）。公開前は、WordPressの管理画面で日時の変更や取り消しができます。'),
      field('公開する日時', when),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'やめる'),
        h('button', { class: 'btn', onclick: () => {
          const at = new Date(when.value);
          if (!when.value || isNaN(at)) { toast('日時を入れてください', 'err'); return; }
          if (at.getTime() < Date.now() + 2 * 60000) { toast('2分以上先の日時にしてください', 'err'); return; }
          m.close(); sendWp(c, p, false, at.toISOString());
        } }, '予約する'))]);
  };
  const sendGf = async (c, p) => {
    if (block) { toast(block, 'err'); return; }
    if (!(await confirmBox('予約フォームに追加しますか？', 'チケット予約のGoogleフォームに、この公演の質問を日付順の位置に追加します。同じ公演がすでにあれば追加しません。', '追加する'))) return;
    try {
      let imageUrl = '';
      try { const im = await flyerImage(); if (im) { const m = await api.wpPublish({ mediaOnly: true, image: im }); imageUrl = (m && m.url) || ''; } } catch (e) { toast('フライヤー画像を用意できなかったため、画像なしで追加します', 'err'); }
      const j = await api.gforms({ action: 'add', imageUrl, title: c.title, body: c.body, options: c.options, required: !!c.required, dateKey: R.formDateKey(String(l.live_date || '').slice(0, 10)), venue: R.venuePlainName(ml) });
      const hist = [...(p?.history || []), { at: new Date().toISOString(), status: 'success', url: j.url, id: j.id || '', by: state.by || null }].slice(-30);
      await api.saveLivePost(l.id, 'googleForm', { status: 'success', history: hist }, state.by);
      toast(j.message, 'ok'); reload();
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  const ytBox = h('div', { class: 'lsub', style: 'margin-top:6px' });
  const ytPriv = h('select', { style: 'width:auto;display:inline-block;padding:4px 8px' }, h('option', { value: 'private' }, '非公開'), h('option', { value: 'unlisted' }, '限定公開（URLを知る人のみ）'), h('option', { value: 'public' }, '公開'));
  ytPriv.value = 'public';
  const PRIV = { private: '非公開', unlisted: '限定公開', public: '公開' };
  const sendYt = async (c, bodyEl, tagsEl) => {
    if (block) { toast(block, 'err'); return; }
    const inp = h('input', { type: 'file', accept: 'video/*', style: 'display:none' });
    document.body.append(inp);
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) return;
      const title = (c.title || '').trim();
      const desc = [bodyEl.value, tagsEl ? tagsEl.value : ''].filter(x => x && x.trim()).join('\n\n');
      const pv = ytPriv.value in PRIV ? ytPriv.value : 'private';
      if (!(await confirmBox('YouTubeに「' + PRIV[pv] + '」でアップロードしますか？', 'ファイル: ' + f.name + '（' + (f.size / 1048576).toFixed(1) + 'MB）\nタイトル: ' + title + '\n\n公開設定: ' + PRIV[pv] + (pv === 'public' ? '\n※アップロードが終わると、すぐ誰でも見られる状態になります。' : '\n公開の切り替えはYouTube Studioで行えます。') + '\nアップロード中はこの画面を閉じないでください。', 'アップロードする'))) return;
      try {
        ytBox.textContent = '準備中…';
        const init = await api.ytpost({ action: 'init', title, description: desc, size: f.size, mime: f.type || 'video/mp4', origin: location.origin, privacy: pv });
        const j = await new Promise((res, rej) => {
          const x = new XMLHttpRequest(); x.open('PUT', init.uploadUrl);
          x.setRequestHeader('Content-Type', f.type || 'video/mp4');
          x.upload.onprogress = e => { if (e.lengthComputable) ytBox.textContent = 'アップロード中… ' + Math.round(e.loaded / e.total * 100) + '%'; };
          x.onload = () => { try { const r = JSON.parse(x.responseText || '{}'); if (x.status >= 200 && x.status < 300 && r.id) res(r); else rej(new Error('YouTubeのエラー: ' + ((r.error && r.error.message) || x.status))); } catch { rej(new Error('アップロードの結果を読み取れませんでした')); } };
          x.onerror = () => rej(new Error('アップロードが途中で止まりました。電波のよい場所でもう一度お試しください'));
          x.send(f);
        });
        const url = 'https://studio.youtube.com/video/' + j.id + '/edit';
        ytBox.replaceChildren('アップロードできました（' + PRIV[pv] + '）。', h('a', { href: url, target: '_blank', rel: 'noopener' }, 'YouTube Studioで開く'));
        const hist = [...(pm.get('youtube')?.history || []), { at: new Date().toISOString(), status: 'success', url, id: j.id, by: state.by || null }].slice(-30);
        await api.saveLivePost(l.id, 'youtube', { status: 'success', history: hist }, state.by);
        toast('YouTubeに' + PRIV[pv] + 'でアップロードしました', 'ok');
      } catch (e) { ytBox.textContent = ''; toast(errMsg(e), 'err'); }
    };
    inp.click();
  };
  const gfBox = h('div', { class: 'lsub', style: 'margin-top:6px' });
  const loadGfSched = async () => {
    try {
      const rows = await api.gfSchedList(l.id);
      const shown = rows.filter(r => r.status === 'pending' || r.status === 'running' || Date.now() - new Date(r.done_at || r.run_at).getTime() < 3 * 86400000);
      gfBox.replaceChildren(...(shown.length ? [h('div', { class: 'cap' }, '🕒 予約追加')] : []), ...shown.map(r => h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap;margin:3px 0' },
        h('span', {}, new Date(r.run_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' にフォームへ追加'),
        h('i', { class: 'tag ' + (r.status === 'done' ? 'ok' : r.status === 'failed' || r.status === 'missed' ? 'dead' : 'mid') }, ({ pending: '予約中', running: '実行中', done: '追加済み', failed: '失敗', missed: '見送り' })[r.status] || r.status),
        r.status === 'pending' ? h('button', { class: 'btn small ghost', onclick: async () => { if (!(await confirmBox('この予約を取り消しますか？', '予約した追加は実行されなくなります。', '取り消す'))) return; try { await api.gfSchedDel(r.id); toast('予約を取り消しました', 'ok'); loadGfSched(); } catch (e) { toast(errMsg(e), 'err'); } } }, '取り消す') : null,
        r.status === 'done' && r.post_url ? h('a', { href: r.post_url, target: '_blank', rel: 'noopener' }, '開く') : null,
        r.result && (r.status === 'failed' || r.status === 'missed') ? h('span', { style: 'color:#c0392b' }, r.result) : null)));
    } catch (e) { /* 予約の表が使えない時は何も出さない */ }
  };
  const schedGf = (c, p) => {
    if (block) { toast(block, 'err'); return; }
    const d0 = new Date(Date.now() + 86400000); const pad = n => String(n).padStart(2, '0');
    const when = h('input', { type: 'datetime-local', value: d0.getFullYear() + '-' + pad(d0.getMonth() + 1) + '-' + pad(d0.getDate()) + 'T19:00' });
    const m = modal([
      h('h3', {}, 'Googleフォームに予約追加'),
      h('p', { class: 'muted' }, '指定した日時に、チケット予約のGoogleフォームへこの公演の質問を自動で追加します（予約受付の開始に使えます。1分ごとに確認するので、数分ずれることがあります）。追加される前なら、ここから取り消せます。'),
      field('追加する日時', when),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'やめる'),
        h('button', { class: 'btn', onclick: async () => {
          const at = new Date(when.value);
          if (!when.value || isNaN(at)) { toast('日時を入れてください', 'err'); return; }
          if (at.getTime() < Date.now() + 2 * 60000) { toast('2分以上先の日時にしてください', 'err'); return; }
          try {
            let imageUrl = '';
            try { const im = await flyerImage(); if (im) { const mm = await api.wpPublish({ mediaOnly: true, image: im }); imageUrl = (mm && mm.url) || ''; } } catch (e) { toast('フライヤー画像を用意できなかったため、画像なしで予約します', 'err'); }
            await api.gfSchedAdd({ live_id: l.id, run_at: at.toISOString(), created_by: state.by || null, payload: { imageUrl, title: c.title, body: c.body, options: c.options, required: !!c.required, dateKey: R.formDateKey(String(l.live_date || '').slice(0, 10)), venue: R.venuePlainName(ml) } });
            m.close(); toast('予約しました', 'ok'); loadGfSched();
          } catch (e) { toast(errMsg(e), 'err'); }
        } }, '予約する'))]);
  };
  loadGfSched();
  const sendX = async (c, p, bodyEl, tagsEl) => {
    if (block) { toast(block, 'err'); return; }
    const text = R.composeText('x', { ...c, body: bodyEl.value, hashtags: tagsEl ? tagsEl.value : c.hashtags });
    const fl = [...(files || [])].reverse().find(f => f.kind === 'square' && /^image\//.test(f.mime || '')) || (files || []).find(f => f.kind === 'flyer' && /^image\//.test(f.mime || ''));
    if (!(await confirmBox('Xに投稿しますか？', 'すぐに公開されます(取り消しはXで行います)。\n画像: ' + (fl ? (fl.name || (fl.kind === 'square' ? '正方形' : 'フライヤー')) : 'なし') + '\n\n' + text, '投稿する'))) return;
    try {
      let image;
      if (fl) {
        const bl = await (await fetch(furl.get(fl.id))).blob();
        const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(bl); });
        image = { name: fl.kind === 'square' ? 'square.jpg' : 'flyer.jpg', mime: fl.mime, b64 };
      }
      const j = await api.xpost({ action: 'post', text, image });
      const hist = [...(p?.history || []), { at: new Date().toISOString(), status: 'success', url: j.url, id: j.id || '', by: state.by || null }].slice(-30);
      await api.saveLivePost(l.id, 'x', { status: 'success', history: hist }, state.by);
      toast(j.message, 'ok'); reload();
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  const igFile = (isStory) => isStory
    ? [...(files || [])].reverse().find(f => f.kind === 'story' && /^image\//.test(f.mime || ''))
    : ([...(files || [])].reverse().find(f => f.kind === 'square' && /^image\//.test(f.mime || '')) || (files || []).find(f => f.kind === 'flyer' && /^image\//.test(f.mime || '')));
  const igUpload = async (fl) => {
    const bl = await (await fetch(furl.get(fl.id))).blob();
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(bl); });
    const hx = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await bl.arrayBuffer()))).slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join('');
    const m = await api.wpPublish({ mediaOnly: true, image: { name: 'ig-' + hx + '.jpg', mime: 'image/jpeg', b64 } });
    if (!m || !m.url) throw new Error('画像を公式サイトのメディアに置けませんでした');
    return m.url;
  };
  const SCHED_ST = { pending: '予約中', running: '投稿中', done: '投稿済み', failed: '失敗', missed: '見送り' };
  const schedBox = h('div', { class: 'lsub', style: 'margin-top:6px' });
  const loadSched = async () => {
    try {
      const rows = await api.igSchedList(l.id);
      const shown = rows.filter(r => r.status === 'pending' || r.status === 'running' || Date.now() - new Date(r.done_at || r.run_at).getTime() < 3 * 86400000);
      schedBox.replaceChildren(...(shown.length ? [h('div', { class: 'cap' }, '🕒 予約投稿')] : []), ...shown.map(r => h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap;margin:3px 0' },
        h('span', {}, new Date(r.run_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' ' + (r.format === 'story' ? 'ストーリー' : 'フィード')),
        h('i', { class: 'tag ' + (r.status === 'done' ? 'ok' : r.status === 'failed' || r.status === 'missed' ? 'dead' : 'mid') }, SCHED_ST[r.status] || r.status),
        r.status === 'pending' ? h('button', { class: 'btn small ghost', onclick: async () => { if (!(await confirmBox('この予約を取り消しますか？', '予約した投稿は公開されなくなります。', '取り消す'))) return; try { await api.igSchedDel(r.id); toast('予約を取り消しました', 'ok'); loadSched(); } catch (e) { toast(errMsg(e), 'err'); } } }, '取り消す') : null,
        r.status === 'done' && r.post_url ? h('a', { href: r.post_url, target: '_blank', rel: 'noopener' }, '開く') : null,
        r.result && (r.status === 'failed' || r.status === 'missed') ? h('span', { style: 'color:#c0392b' }, r.result) : null)));
    } catch (e) { /* 予約の表が使えない時は何も出さない */ }
  };
  const schedIg = async (c, p, bodyEl, tagsEl, getTags) => {
    if (block) { toast(block, 'err'); return; }
    const caption = R.composeText('instagram', { ...c, body: bodyEl.value, hashtags: tagsEl ? tagsEl.value : c.hashtags });
    const utags = getTags ? getTags() : [];
    const d0 = new Date(Date.now() + 86400000); const pad = n => String(n).padStart(2, '0');
    const fmt = h('select', { class: 'sel' }, h('option', { value: 'feed' }, 'フィード(正方形/フライヤー・文章・写真タグ)'), h('option', { value: 'story' }, 'ストーリー(画像のみ)'));
    const when = h('input', { type: 'datetime-local', value: d0.getFullYear() + '-' + pad(d0.getMonth() + 1) + '-' + pad(d0.getDate()) + 'T19:00' });
    const prev = h('p', { class: 'muted', style: 'max-height:40dvh;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y' });
    const draw = () => { const st = fmt.value === 'story'; const fl = igFile(st); prev.textContent = '画像: ' + (fl ? (fl.name || (st ? 'ストーリー' : '正方形/フライヤー')) : '（まだありません）') + (st ? '\n(ストーリーには文章は付きません)' : (utags.length ? '\n写真タグ: ' + utags.map(x => '@' + x).join(' ') : '') + '\n\n' + caption); };
    fmt.addEventListener('change', draw); draw();
    const m = modal([
      h('h3', {}, 'Instagramに予約投稿'),
      h('p', { class: 'muted' }, '指定した時刻に自動で公開します（1分ごとに確認するので、数分ずれることがあります）。公開されるまで、ここから取り消せます。'),
      field('投稿の種類', fmt), field('公開する日時', when), prev,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'やめる'),
        h('button', { class: 'btn', onclick: async () => {
          const isStory = fmt.value === 'story'; const fl = igFile(isStory);
          const at = new Date(when.value);
          if (!when.value || isNaN(at)) { toast('日時を入れてください', 'err'); return; }
          if (at.getTime() < Date.now() + 2 * 60000) { toast('2分以上先の日時にしてください', 'err'); return; }
          if (!fl) { toast(isStory ? '先に「ストーリー下地を作る」でストーリー画像を作ってください' : '先に正方形(またはフライヤー)の画像を用意してください', 'err'); return; }
          if (fl.mime !== 'image/jpeg') { toast('Instagramに送れるのはJPEG画像だけです', 'err'); return; }
          if (!isStory && !caption.trim()) { toast('投稿する文章が空です', 'err'); return; }
          m.close();
          try {
            const url = await igUpload(fl);
            await api.igSchedAdd({ live_id: l.id, format: isStory ? 'story' : 'feed', image_url: url, caption: isStory ? '' : caption, user_tags: isStory ? [] : utags, run_at: at.toISOString(), created_by: state.by || null });
            toast('予約しました：' + at.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), 'ok');
            loadSched();
          } catch (e) { toast(errMsg(e), 'err'); }
        } }, '予約する')),
    ]);
  };
  loadSched();
  const sendIg = async (c, p, bodyEl, tagsEl, format, getTags) => {
    if (block) { toast(block, 'err'); return; }
    const isStory = format === 'story';
    const fl = isStory
      ? [...(files || [])].reverse().find(f => f.kind === 'story' && /^image\//.test(f.mime || ''))
      : ([...(files || [])].reverse().find(f => f.kind === 'square' && /^image\//.test(f.mime || '')) || (files || []).find(f => f.kind === 'flyer' && /^image\//.test(f.mime || '')));
    if (!fl) { toast(isStory ? '先に「ストーリー下地を作る」でストーリー画像を作ってください' : '先に正方形(またはフライヤー)の画像を用意してください', 'err'); return; }
    if (fl.mime !== 'image/jpeg') { toast('Instagramに送れるのはJPEG画像だけです。この画像はJPEGではありません', 'err'); return; }
    const caption = R.composeText('instagram', { ...c, body: bodyEl.value, hashtags: tagsEl ? tagsEl.value : c.hashtags });
    const utags = isStory || !getTags ? [] : getTags();
    if (!(await confirmBox(isStory ? 'Instagramのストーリーに投稿しますか？' : 'Instagramのフィードに投稿しますか？', 'すぐに公開されます(取り消しはInstagramで行います)。\n画像: ' + (fl.name || (fl.kind === 'story' ? 'ストーリー' : fl.kind === 'square' ? '正方形' : 'フライヤー')) + (isStory ? '\n(ストーリーには文章は付きません)' : (utags.length ? '\n写真タグ: ' + utags.map(x => '@' + x).join(' ') : '') + '\n\n' + caption), '投稿する'))) return;
    try {
      const bl = await (await fetch(furl.get(fl.id))).blob();
      const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(bl); });
      const hx = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await bl.arrayBuffer()))).slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join('');
      const m = await api.wpPublish({ mediaOnly: true, image: { name: 'ig-' + hx + '.jpg', mime: 'image/jpeg', b64 } });
      if (!m || !m.url) throw new Error('画像を公式サイトのメディアに置けませんでした');
      const j = await api.igpost({ action: 'post', format: isStory ? 'story' : 'feed', imageUrl: m.url, caption, userTags: utags });
      const hist = [...(p?.history || []), { at: new Date().toISOString(), status: 'success', url: j.url, id: j.id || '', by: state.by || null }].slice(-30);
      await api.saveLivePost(l.id, 'instagram', { status: 'success', history: hist }, state.by);
      toast(j.message, 'ok'); reload();
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  const cards = ANN_DESTS.map(k => {
    const def = R.getDestination(k); const gen = R.generateContent(ml, k); const p = pm.get(k);
    const c = p && p.edited ? { ...gen, body: p.body ?? gen.body, hashtags: p.hashtags ?? gen.hashtags } : gen;
    const st = p?.status || 'notStarted'; const chk = R.checkText(k, c); const sns = ['instagram', 'x', 'tiktok', 'youtube'].includes(k);
    const full = R.composeText(k, c);
    const body = h('textarea', { rows: 9, class: 'area', autocomplete: 'off', readonly: sns ? null : true }); body.value = sns ? (c.body || '') : full;
    const tags = sns ? h('input', { type: 'text', autocomplete: 'off', value: c.hashtags || '' }) : null;
    const tp = k === 'instagram' || k === 'x' ? tagPanel(k, ml, body) : null;
    // 文章を直しただけでは画面を作り直さない（タグ付けのチェックなどが途切れるため）
    const quiet = async () => { try { await api.saveLivePost(l.id, k, { body: body.value, hashtags: tags.value, edited: true }, state.by); } catch (e) { toast(errMsg(e), 'err'); } };
    if (sns) body.addEventListener('change', quiet);
    if (tags) tags.addEventListener('change', quiet);
    const sel = h('select', { class: 'sel', onchange: e => save(k, { status: e.target.value, history: [...(p?.history || []), { at: new Date().toISOString(), status: e.target.value, by: state.by || null }].slice(-30) }) }, ANN_STATUS.map(s => h('option', { value: s, selected: s === st ? true : null }, R.STATUS[s].label)));
    const dk = l.id + '|' + k;
    const det = h('details', { class: 'card ann', open: ANN_OPEN.has(dk) ? true : null },
      h('summary', {}, h('b', {}, def.name), ' ', h('i', { class: 'tag ' + (st === 'manualDone' ? 'ok' : st === 'skipped' ? 'dead' : 'mid') }, R.STATUS[st].label), p?.edited ? h('i', { class: 'tag' }, '編集済み') : null),
      k === 'youtube' || k === 'wordpress' || k === 'googleForm' ? h('div', { class: 'lsub' }, 'タイトル: ' + (c.title || '')) : null,
      body, tags ? field('ハッシュタグ', tags) : null, tp ? tp.el : null,
      h('div', { class: 'lsub' }, chk.counters.map(x => `${x.label} ${x.value}/${x.max}`).join(' ・ ')),
      ...chk.issues.map(i => h('div', { class: 'lsub', style: i.level === 'error' ? 'color:#c0392b' : '' }, (i.level === 'error' ? '⚠️ ' : 'ℹ️ ') + i.msg)),
      h('div', { class: 'row', style: 'margin-top:8px;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn small', onclick: () => copy(full) }, '📋 コピー'),
        k === 'youtube' && c.title ? h('button', { class: 'btn small ghost', onclick: () => copy(c.title) }, 'タイトルをコピー') : null,
        def.openUrl ? h('a', { class: 'btn small ghost', href: def.openUrl, target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, '開く') : null,
        k === 'wordpress' && !conf ? h('button', { class: 'btn small', onclick: () => sendWp(c, p, false) }, '🌐 下書きを送る') : null,
        k === 'wordpress' && !conf ? h('button', { class: 'btn small ghost', onclick: () => sendWp(c, p, true) }, '公開して送る') : null,
        k === 'wordpress' && !conf ? h('button', { class: 'btn small ghost', onclick: () => schedWp(c, p) }, '🕒 予約公開') : null,
        k === 'wordpress' ? h('button', { class: 'btn small ghost', onclick: async () => { try { toast((await api.wpPublish({ check: true })).message, 'ok'); } catch (e) { toast(errMsg(e), 'err'); } } }, '接続テスト') : null,
        k === 'bandsintown' ? h('button', { class: 'btn small', onclick: () => {
          if (R.multiVenue(ml)) { toast('会場が2つ以上です。Wiθが出る会場が決まったら、ライブ編集の「Bandsintown用の会場名」に入れてから作ってください', 'err'); return; }
          try {
            const f = new File([R.bandsintownCsv(ml)], 'bandsintown-' + String(l.live_date || '').slice(0, 10) + '.csv', { type: 'text/csv' });
            const aEl = h('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(aEl); aEl.click(); aEl.remove();
            toast('CSVを作りました。Bandsintown for Artists の Events > Upload からアップロードしてください（下書きとして入ります）', 'ok');
          } catch (e) { toast(errMsg(e), 'err'); }
        } }, '📄 アップロード用CSV') : null,
        k === 'youtube' && !conf ? h('span', { class: 'lsub' }, '公開設定: ', ytPriv) : null,
        k === 'youtube' && !conf ? h('button', { class: 'btn small', onclick: () => sendYt(c, body, tags) }, '🎬 動画を選んでアップロード') : null,
        k === 'youtube' ? h('button', { class: 'btn small ghost', onclick: async () => { try { const j = await api.ytpost({ action: 'connect' }); location.href = j.url; } catch (e) { toast(errMsg(e), 'err'); } } }, '🔗 YouTubeと連携する') : null,
        k === 'youtube' ? h('button', { class: 'btn small ghost', onclick: async () => { try { toast((await api.ytpost({ action: 'check' })).message, 'ok'); } catch (e) { toast(errMsg(e), 'err'); } } }, '接続テスト') : null,
        k === 'googleForm' && !conf ? h('button', { class: 'btn small', onclick: () => sendGf(c, p) }, '📝 フォームに追加') : null,
        k === 'googleForm' && !conf ? h('button', { class: 'btn small ghost', onclick: () => schedGf(c, p) }, '🕒 予約して追加') : null,
        k === 'googleForm' ? h('button', { class: 'btn small ghost', onclick: async () => { try { const j = await api.gforms({ action: 'connect' }); location.href = j.url; } catch (e) { toast(errMsg(e), 'err'); } } }, '🔗 Googleと連携する') : null,
        k === 'googleForm' ? h('button', { class: 'btn small ghost', onclick: async () => { try { toast((await api.gforms({ action: 'check' })).message, 'ok'); } catch (e) { toast(errMsg(e), 'err'); } } }, '接続テスト') : null,
        k === 'instagram' && !conf ? h('button', { class: 'btn small', onclick: () => sendIg(c, p, body, tags, 'feed', tp && tp.getTags) }, '📷 フィードに投稿') : null,
        k === 'instagram' && !conf ? h('button', { class: 'btn small', onclick: () => sendIg(c, p, body, tags, 'story') }, '📱 ストーリーに投稿') : null,
        k === 'instagram' && !conf ? h('button', { class: 'btn small ghost', onclick: () => schedIg(c, p, body, tags, tp && tp.getTags) }, '🕒 予約投稿') : null,
        k === 'instagram' ? h('button', { class: 'btn small ghost', onclick: async () => { try { const j = await api.igpost({ action: 'connect' }); location.href = j.url; } catch (e) { toast(errMsg(e), 'err'); } } }, '🔗 Instagramと連携する') : null,
        k === 'instagram' ? h('button', { class: 'btn small ghost', onclick: async () => { try { toast((await api.igpost({ action: 'check' })).message, 'ok'); } catch (e) { toast(errMsg(e), 'err'); } } }, '接続テスト') : null,
        k === 'x' && !conf ? h('button', { class: 'btn small', onclick: () => sendX(c, p, body, tags) }, '𝕏 に投稿する') : null,
        k === 'x' ? h('button', { class: 'btn small ghost', onclick: async () => { try { const j = await api.xpost({ action: 'connect' }); location.href = j.url; } catch (e) { toast(errMsg(e), 'err'); } } }, '🔗 Xと連携する') : null,
        k === 'x' ? h('button', { class: 'btn small ghost', onclick: async () => { try { toast((await api.xpost({ action: 'check' })).message, 'ok'); } catch (e) { toast(errMsg(e), 'err'); } } }, '接続テスト') : null,
        p?.edited && sns ? h('button', { class: 'btn small ghost', onclick: () => save(k, { body: null, hashtags: null, edited: false }) }, '自動の文章に戻す') : null),
      k === 'instagram' ? schedBox : null,
      k === 'googleForm' ? gfBox : null,
      k === 'youtube' ? ytBox : null,
      (() => { const last = [...(p?.history || [])].reverse().find(x => x.url); return last && (k === 'wordpress' || k === 'googleForm' || k === 'x' || k === 'instagram' || k === 'youtube') ? h('div', { class: 'lsub' }, '最後に送った先: ', h('a', { href: last.url, target: '_blank', rel: 'noopener' }, '開く')) : null; })(),
      h('div', { style: 'margin-top:8px' }, sel));
    det.addEventListener('toggle', () => { if (det.open) ANN_OPEN.add(dk); else ANN_OPEN.delete(dk); });
    return det;
  });
  return h('section', { class: 'card' }, h('div', { class: 'cap' }, '📝 投稿先ごとの文章と進行'),
    h('p', { class: 'hint' }, '上の情報から、投稿先ごとの文章を自動で作ります。コピーして各サービスに貼り、投稿したら状態を「手動で完了」にしてください。'),
    block ? h('p', { class: 'hint', style: 'color:#c0392b' }, '⚠️ ' + block) : null, ...cards,
    conf ? null : h('button', { class: 'btn small ghost', style: 'margin-top:10px', onclick: () => { location.hash = '#/live-form?id=' + l.id; } }, '✏️ 告知の情報を編集(特典・出店・見出しなど)'));
}
const liveTabs = new Map();
const LIVE_FIELDS = {
  official_title: ['正式なライブ名', 'text'], open_time: ['開場(例 18:00)', 'text'], start_time: ['開演(例 18:30)', 'text'], end_time: ['終演(例 22:00)', 'text'],
  ticket_price: ['チケット料金', 'text'], performers: ['出演者(1行に1組)', 'area'], reserve_url: ['取り置き・予約フォームのURL', 'text'],
  set_time: ['演奏時間(例 40min (19:30〜20:10))', 'text'], timetable: ['タイムテーブル(例: 14:00 搬入 / 16:30 リハ / 18:50 本番)', 'area'], reflection: ['反省・振り返り', 'area'], video_url: ['映像のリンク(YouTube限定公開・ドライブなど)', 'text'],
};
function liveInfoModal(live, info, title, keys, done) {
  const els = keys.map(k => { const [label, type] = LIVE_FIELDS[k];
    const el = type === 'area' ? h('textarea', { rows: k === 'performers' ? 8 : 7, class: 'area', autocomplete: 'off' }) : h('input', { type: 'text', autocomplete: 'off' });
    el.value = info[k] || ''; return [k, el, label]; });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const ok = h('button', { class: 'btn big', onclick: async () => {
    msg.textContent = ''; ok.disabled = true;
    try { const patch = {}; for (const [k, el] of els) patch[k] = el.value.trim() || null; await api.saveLiveInfo(live.id, patch); m.close(); toast('保存しました', 'ok'); done(); }
    catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '保存する');
  const m = modal([h('h3', {}, '✏️ ' + title), ...els.map(([k, el, label]) => field(label, el)), msg, ok]);
}
async function liveView(id) {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('🎸 ライブ', body, '#/live-list'));
  try {
    const [lives, entries, abs, ast, rcs] = await Promise.all([api.lives(), api.liveEntries(id), api.airBaskets().catch(() => []), api.liveAirStatus(id).catch(() => null), api.receipts().catch(() => [])]);
    const rcm = countMap(rcs);
    if (my !== renderId) return;
    const l = lives.find(x => x.id === id);
    if (!l) { body.replaceChildren(h('p', { class: 'empty' }, 'ライブが見つかりません。')); return; }
    const reload = () => liveView(id);
    const conf = l.status === 'confirmed';
    const [ico, lab] = rating(l.profit);
    const rows = entries.map(r => {
      const isRev = !!r.reverses_id; const inc = r.kind === 'income';
      const sg = isRev ? (inc ? -1 : 1) : (inc ? 1 : -1);
      const draft = r.posting === 'draft';
      const canRev = !isRev && !r.reversed && !conf && !draft;
      const canEdit = canRev && !r.merch_order_id && ['income', 'expense_fund', 'expense_advanced'].includes(r.kind);
      return h('div', { class: 'lrow' + (r.reversed || isRev ? ' dead' : '') + (draft ? ' draft' : '') },
        h('span', { class: 'lico' }, draft ? '🕓' : inc ? '💰' : '💸'),
        h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, r.memo || r.category_name || ''),
          h('div', { class: 'lsub' }, [r.category_name, r.kind === 'expense_advanced' && r.payer_name ? r.payer_name + 'が立替' : ''].filter(Boolean).join(' · ') || ' '),
          h('div', { class: 'ltags' }, draft ? h('i', { class: 'tag mid' }, '審査中') : null, r.reversed ? h('i', { class: 'tag dead' }, '取消済み') : null, isRev ? h('i', { class: 'tag dead' }, '取消の行') : null)),
        h('div', { class: 'lamt ' + (draft ? '' : sg > 0 ? 'pos' : 'neg') }, (sg > 0 ? '+' : '−') + yen(r.amount).replace('−', '')),
        draft && !conf ? h('button', { class: 'undo', onclick: () => claimAct(r, true, reload) }, '承認') : null,
        draft && !conf ? h('button', { class: 'undo', onclick: () => claimAct(r, false, reload) }, '却下') : null,
        canEdit ? h('button', { class: 'undo', onclick: () => liveEntryModal(l, r.kind === 'income', reload, r) }, '編集') : null,
        receiptBtn(r, rcm, reload),
        canRev ? h('button', { class: 'undo', onclick: async () => {
          const ok = await confirmBox('この記録を取り消す？', `${r.memo || r.category_name}  ${yen(r.amount)}\n元の行は消さず、打ち消しの行が追加されます。`, '取り消す');
          if (!ok) return;
          try { await api.reverse(r.id, state.by); toast('取り消しました', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
        } }, '取消') : null);
    });
    const pendSum = entries.filter(r => r.posting === 'draft').reduce((x, r) => x + Number(r.amount), 0);
    const head = h('section', { class: 'card' },
      h('div', { class: 'lmemo' }, l.event_name),
      h('div', { class: 'lsub' }, [dshow(l.live_date), l.venue_name, l.prefecture].filter(Boolean).join(' · ')),
      h('div', { class: 'ltags' }, h('i', { class: 'tag ' + (l.kind === 'host' ? 'pay' : 'recv') }, liveKind(l.kind)), conf ? h('i', { class: 'tag ok' }, '確定') : h('i', { class: 'tag mid' }, '下書き')),
      h('div', { class: 'cap', style: 'margin-top:12px' }, '🎯 LIVE PROFIT'),
      h('div', { class: 'big' + (l.profit < 0 ? ' neg' : '') }, yen(l.profit)),
      h('div', { class: 'trio' }, h('div', {}, h('small', {}, '収入'), h('b', { class: 'pos' }, yen(l.income))), h('div', {}, h('small', {}, '支出'), h('b', { class: 'neg' }, yen(l.expense))), h('div', {}, h('small', {}, '評価'), h('b', {}, ico + ' ' + lab))),
      pendSum > 0 ? h('p', { class: 'note' }, `🕓 審査中の請求 ${yen(pendSum)}（利益には入っていません。承認すると支出になります）`) : null,
      l.memo ? h('p', { class: 'hint' }, l.memo) : null,
      conf ? null : h('button', { class: 'btn small', style: 'margin-top:10px', onclick: () => { location.hash = '#/live-form?id=' + l.id; } }, 'ライブの情報を編集'));
    const myAb = abs.filter(b => b.live_id === id); const airSales = ast ? Number(ast.sales) : myAb.reduce((x, b) => x + (Number(b.total) || 0), 0);
    const typed = ast ? Number(ast.typed) : 0;
    const diff = airSales - typed;
    const stsTotal = ast ? Number(ast.sts_total) : 0; const stsDone = ast ? Number(ast.sts_recorded) : 0; const stsDiff = stsTotal - stsDone;
    const canPost = ast && !conf && (diff > 0 || stsDiff > 0);
    const airCard = myAb.length ? h('section', { class: 'card' }, h('div', { class: 'cap' }, '🧾 Airレジの物販'),
      h('div', { class: 'trio' }, h('div', {}, h('small', {}, '売上'), h('b', { class: 'pos' }, yen(airSales))), h('div', {}, h('small', {}, '会計'), h('b', {}, myAb.length + '件')), h('div', {}, h('small', {}, '客単価'), h('b', {}, yen(Math.round(airSales / myAb.length))))),
      h('p', { class: 'hint' }, `入力済みの物販売上 ${yen(typed)} と Airレジ ${yen(airSales)} の差は ${yen(diff)} です。` + (diff === 0 ? '(一致)' : diff > 0 ? '(まだ記録していない分があります)' : '(入力のほうが多いので、数え違いがないか確認できます)')),
      stsTotal > 0 ? h('p', { class: 'hint' }, `共同物販(STS)の取り分は ${yen(stsTotal)}（売上の50%）。記録済み ${yen(stsDone)}。`) : null,
      ast && Number(ast.unmapped) > 0 ? h('p', { class: 'hint' }, `商品と対応づいていない品目が ${ast.unmapped} 行あります。STS商品が含まれていると、取り分に入っていません。`) : null,
      canPost ? h('button', { class: 'btn big in', style: 'width:100%', onclick: async () => {
        if (!state.by) { await pickBy(true); if (!state.by) return; }
        try { const r = await api.liveAirPost(l.id, state.by); getFx('+' + yen(Number(r.income) || 0), 'MONEY GET!'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
      } }, '💰 ' + [diff > 0 ? `物販売上 ${yen(diff)}` : '', stsDiff > 0 ? `STS取り分 ${yen(stsDiff)}` : ''].filter(Boolean).join(' と ') + ' を記録する')
        : (diff === 0 && stsDiff <= 0 ? h('p', { class: 'hint' }, '✅ 物販売上は記録済みです。') : null)) : null;
    const ld = String(l.live_date).slice(0, 10);
    const ovnAb = abs.filter(b => !b.live_id && isOvernight(b, ld));
    const ovnCard = !conf && ovnAb.length ? h('section', { class: 'card' }, h('div', { class: 'cap' }, '🌙 日またぎの会計'),
      h('p', { class: 'hint' }, `翌日の0〜6時に会計された ${ovnAb.length} 件(${yen(ovnAb.reduce((x, b) => x + (Number(b.total) || 0), 0))})が、まだどのライブにもひも付いていません。このライブの深夜の売れ分なら、ひも付けると売上・在庫・STS取り分に反映できます。`),
      h('button', { class: 'btn big in', style: 'width:100%', onclick: async () => {
        if (!state.by) { await pickBy(true); if (!state.by) return; }
        try { const c = await api.airLinkOvernight(l.id, state.by); toast(`${c}件をこのライブにひも付けました`, 'ok'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
      } }, 'このライブにひも付ける')) : null;
    const upBox = h('div', {}); const upIn = h('input', { type: 'file', accept: '.csv,text/csv', style: 'display:none' });
    upIn.addEventListener('change', async () => {
      const f = upIn.files[0]; if (!f) return; upBox.replaceChildren(loading());
      try { await airPreview(f, upBox, abs, reload, { date: String(l.live_date).slice(0, 10), liveId: l.id }); } catch (e) { upBox.replaceChildren(h('p', { class: 'form-err' }, errMsg(e))); }
      upIn.value = '';
    });
    const upCard = conf ? null : h('section', { class: 'card' }, h('div', { class: 'cap' }, '📥 Airレジの売上CSV'),
      h('p', { class: 'hint' }, `このライブの日(${dshow(l.live_date)})の物販売上を、AirレジのCSVから読み込みます。日をまたいだ深夜0〜6時の会計も、一緒に取り込めます。`),
      h('button', { class: 'btn' + (myAb.length ? ' ghost' : ' big'), style: 'width:100%', onclick: () => upIn.click() }, myAb.length ? '📂 CSVを選び直す' : '📂 CSVを選んで物販売上を出す'), upIn, upBox);
    const unsettled = entries.some(r => r.posting !== 'draft' && r.kind === 'expense_advanced' && !r.reversed && !r.reverses_id);
    const moneyEls = [
      conf ? h('p', { class: 'hint' }, '確定済みです。記録を足したり取り消したりするには、先に「確定を解除」してください。') : h('div', { class: 'duo' },
        h('button', { class: 'btn in', onclick: () => liveEntryModal(l, true, reload) }, '💰 収入を追加'),
        h('button', { class: 'btn out', onclick: () => liveEntryModal(l, false, reload) }, '💸 支出を追加')),
      upCard, ovnCard, airCard,
      h('section', { class: 'card' }, h('div', { class: 'cap' }, '🛒 BASEの在庫'),
        h('p', { class: 'hint' }, '物販の入力が終わったら押してください。前回の反映から増えた・減った数だけをBASEに足し引きします。'),
        h('button', { class: 'btn', style: 'width:100%', onclick: () => baseSyncModal(l.id, reload) }, '🛒 BASEの在庫に反映')),
      h('div', { class: 'cap sec' }, 'このライブのお金'),
      ...(rows.length ? rows : [h('p', { class: 'empty' }, 'まだ記録がありません。')]),
      unsettled ? h('p', { class: 'hint' }, '立替の返済は、ホームの「立替を返す・相殺」から行います。') : null,
      h('button', { class: 'btn ' + (conf ? 'ghost' : 'big'), style: 'width:100%;margin-top:14px', onclick: async () => {
        if (!state.by) { await pickBy(true); if (!state.by) return; }
        const okk = await confirmBox(conf ? '確定を解除する？' : 'このライブを確定する？', conf ? '記録を足したり取り消したりできるようになります。' : `LIVE PROFIT ${yen(l.profit)} で確定します。確定中は記録の追加・取消ができません(いつでも解除できます)。`, conf ? '解除する' : '確定する');
        if (!okk) return;
        try { await api.setLiveStatus(id, { confirm: !conf, by: state.by, score: { profit: l.profit, income: l.income, expense: l.expense, rating: lab, merch_sales: airSales, baskets: myAb.length, avg_basket: myAb.length ? Math.round(airSales / myAb.length) : 0 } }); toast(conf ? '確定を解除しました' : '確定しました', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
      } }, conf ? '確定を解除' : '✅ このライブを確定する')];
    const info = await api.liveInfo(id).catch(() => ({}));
    const posts = await api.livePosts(id).catch(() => []);
    const files = await api.liveFiles(id).catch(() => []);
    const [songs, slItems, slRows] = await Promise.all([api.songs().catch(() => []), api.setlist(id).catch(() => []), api.liveSetlists().catch(() => [])]);
    const furl = new Map(await Promise.all(files.map(async f => [f.id, await api.liveFileUrl(f.path).catch(() => null)])));
    const sec = (title, ...els) => h('section', { class: 'card' }, h('div', { class: 'cap' }, title), ...els);
    const lines = t => h('p', { class: 'pre' }, t);
    const editBtn = (label, fields) => conf ? null : h('button', { class: 'btn small ghost', style: 'margin-top:10px', onclick: () => liveInfoModal(l, info, label, fields, reload) }, '✏️ 編集');
    const timeText = [info.open_time && 'OPEN ' + info.open_time, info.start_time && 'START ' + info.start_time, info.end_time && 'END ' + info.end_time].filter(Boolean).join(' / ');
    const announce = () => ['【LIVE INFO】', '', info.official_title || l.event_name, `📅 ${String(l.live_date).slice(0, 10).replaceAll('-', '/')}`, `📍 ${[l.venue_name, l.prefecture].filter(Boolean).join(' ')}`, timeText && `🕐 ${timeText}`, info.ticket_price && `🎫 ${info.ticket_price}`, info.performers && '\n出演:\n' + info.performers, info.reserve_url && `\n▼取り置き・予約\n${info.reserve_url}`].filter(x => x !== '' ? x : true).filter(x => x !== null && x !== undefined && x !== false).join('\n');
    const panes = {
      info: () => [
        sec('📣 告知の情報', info.official_title ? h('div', { class: 'lmemo' }, info.official_title) : h('p', { class: 'empty' }, 'まだ入力されていません。'),
          timeText ? h('div', { class: 'lsub' }, '🕐 ' + timeText) : null,
          info.ticket_price ? h('div', { class: 'lsub' }, '🎫 ' + info.ticket_price) : null,
          info.performers ? h('div', {}, h('div', { class: 'cap sec' }, '出演者'), lines(info.performers)) : null,
          info.reserve_url ? h('a', { class: 'btn small ghost', style: 'display:inline-block;margin-top:8px', href: info.reserve_url, target: '_blank', rel: 'noopener' }, '取り置きフォームを開く') : null,
          conf ? null : h('button', { class: 'btn small ghost', style: 'margin-top:10px', onclick: () => { location.hash = '#/live-form?id=' + l.id; } }, '✏️ 告知の情報を編集')),
        sec('🖼 フライヤー画像', files.some(f => f.kind === 'flyer') ? null : h('p', { class: 'empty' }, 'フライヤーの画像を追加すると、公式サイトに送るときに本文と一緒に入ります。'),
          liveFileBlock(l, files, furl, 'flyer', conf, reload)),
        snsImageSec(l, info, conf, files, furl, reload),
        announcePane(l, info, conf, posts, reload, files, furl)],
      day: () => [
        sec('🕐 当日のタイムテーブル', timeText ? h('div', { class: 'lsub' }, timeText) : null,
          info.set_time ? h('div', { class: 'lsub' }, '🎸 演奏 ' + info.set_time) : null,
          info.timetable ? lines(info.timetable) : (files.some(f => f.kind === 'timetable') ? null : h('p', { class: 'empty' }, 'まだ入力されていません。文字で書くか、会場から届いたPDF・画像を追加してください。')),
          liveFileBlock(l, files, furl, 'timetable', conf, reload),
          editBtn('当日のタイムテーブル', ['set_time', 'timetable'])),
        sec('🎛 セット図', files.some(f => f.kind === 'stageplot') ? null : h('p', { class: 'empty' }, 'セット図の画像・PDFを追加してください。'),
          liveFileBlock(l, files, furl, 'stageplot', conf, reload)),
        sec('✉️ ライブハウスに提出', h('div', { class: 'lsub' }, (l.venue_name || '会場未設定') + (l.venue_email ? ' ・ ' + l.venue_email : ' ・ メールアドレス未登録')),
          h('button', { class: 'btn big', style: 'width:100%;margin-top:10px', onclick: () => {
            if (!l.venue_id) { toast('先にライブの会場を設定してください', 'err'); return; }
            if (!l.venue_email) { venueEmailModal(l, reload); return; }
            sendStagePlot(l, info, files);
          } }, '✉️ セット図のメールを作る'),
          h('button', { class: 'btn ghost small', style: 'margin-top:8px', onclick: () => shareStagePlot(l, info, files) }, '📎 ファイルを添付して送る(共有)'),
          l.venue_id ? h('button', { class: 'btn ghost small', style: 'margin:8px 0 0 8px', onclick: () => venueEmailModal(l, reload) }, '宛先を変更') : null,
          h('p', { class: 'hint' }, 'メールアプリが開き、宛先・件名・本文(いつもの文面)が入った状態になります。セット図は本文のリンク(7日間有効)で届きます。ファイルとして添付したいときは「添付して送る」を使ってください(件名と本文が一緒に渡されます)。'))],
      set: () => setlistPane(l, conf, songs, slItems, slRows, reload, info),
      refl: () => [
        sec('🔁 反省・振り返り', info.reflection ? lines(info.reflection) : h('p', { class: 'empty' }, 'まだ書かれていません。良かったこと・直したいこと・次への課題などを書いてください。'),
          editBtn('反省・振り返り', ['reflection'])),
        sec('🎥 全尺映像', info.video_url ? h('a', { class: 'btn big', style: 'display:block;text-align:center;text-decoration:none', href: info.video_url, target: '_blank', rel: 'noopener' }, '▶ 映像を開く') : h('p', { class: 'empty' }, 'リンクはまだありません。YouTubeの限定公開やGoogleドライブのリンクを貼ってください。'),
          editBtn('全尺映像', ['video_url']))],
      money: () => moneyEls,
    };
    const TABS = [['money', '💰 収支'], ['info', '📣 告知'], ['day', '🕐 当日'], ['set', '🎵 セトリ'], ['refl', '🔁 反省']];
    let tab = liveTabs.get(id) || 'money';
    const pane = h('div', {});
    const bar = h('div', { class: 'tabs' });
    const draw = () => {
      liveTabs.set(id, tab);
      bar.replaceChildren(...TABS.map(([k, label]) => h('button', { type: 'button', class: 'tab' + (k === tab ? ' on' : ''), onclick: () => { tab = k; draw(); } }, label)));
      pane.replaceChildren(...panes[tab]());
    };
    draw();
    body.replaceChildren(head, bar, pane);
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, () => liveView(id))); }
}

// ---------- 曲マスター・セットリスト ----------
const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
const parseDur = t => { const m = String(t || '').trim().match(/^(\d{1,3})[:：](\d{1,2})$/); if (m) return Number(m[1]) * 60 + Number(m[2]); const n = Number(String(t || '').trim()); return n > 0 ? Math.round(n * 60) : null; };
function computeSongStats(rows, today) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.live_id)) by.set(r.live_id, { date: String((r.lives && r.lives.live_date) || '').slice(0, 10), items: [] });
    by.get(r.live_id).items.push(r);
  }
  const st = new Map();
  const get = id => { if (!st.has(id)) st.set(id, { plays: 0, first: null, last: null, firstLive: null, opener: 0, closer: 0 }); return st.get(id); };
  for (const [lid, v] of by) {
    if (!v.date || v.date > today) continue;
    const songs = v.items.filter(x => x.type === 'song' && x.song_id).sort((a, b) => a.position - b.position);
    const seen = new Set();
    songs.forEach((x, i) => {
      const s = get(x.song_id);
      if (!seen.has(x.song_id)) { seen.add(x.song_id); s.plays++; if (!s.first || v.date < s.first) { s.first = v.date; s.firstLive = lid; } if (!s.last || v.date > s.last) s.last = v.date; }
      if (i === 0) s.opener++;
      if (i === songs.length - 1) s.closer++;
    });
  }
  return st;
}
const songMatch = (s, q) => { q = q.trim().toLowerCase(); return !q || [s.title, s.aliases, s.artist].some(t => t && String(t).toLowerCase().includes(q)); };

function songModal(song0, done) {
  const song = song0 && song0.id ? song0 : null;
  const pre = song0 || song;
  const f = { kind: song ? song.kind : 'original' };
  const title = h('input', { type: 'text', placeholder: '曲名', autocomplete: 'off', value: pre ? pre.title : '' });
  const artist = h('input', { type: 'text', placeholder: 'カバーの場合は原曲のアーティスト', autocomplete: 'off', value: (song && song.artist) || '' });
  const aliases = h('input', { type: 'text', placeholder: '別名・ローマ字など(検索用)', autocomplete: 'off', value: (song && song.aliases) || '' });
  const dur = h('input', { type: 'text', placeholder: '例: 3:45', inputmode: 'text', autocomplete: 'off', value: fmtDur(song && song.duration_sec) });
  const notes = h('input', { type: 'text', placeholder: 'メモ(任意)', autocomplete: 'off', value: (song && song.notes) || '' });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const kindChips = chips([{ id: 'original', label: 'オリジナル' }, { id: 'cover', label: 'カバー' }], f.kind, id => { f.kind = id; });
  const m = modal([
    h('h3', {}, song ? '曲を編集' : '曲を登録'),
    field('曲名', title), field('種類', kindChips), field('アーティスト', artist), field('別名', aliases), field('演奏時間(分:秒)', dur, '任意。入れるとセットリストの合計時間が出ます。'), field('メモ', notes), msg,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'やめる'),
      h('button', { class: 'btn', onclick: async () => {
        const t = title.value.trim();
        if (!t) { msg.textContent = '曲名を入れてください'; return; }
        const o = { title: t, kind: f.kind, artist: artist.value.trim() || null, aliases: aliases.value.trim() || null, notes: notes.value.trim() || null, duration_sec: parseDur(dur.value) };
        try { let r; if (song) { await api.saveSong(song.id, o); r = { ...song, ...o }; } else r = await api.addSong(o, state.by); m.close(); toast('保存しました', 'ok'); done && done(r); }
        catch (e) { msg.textContent = /duplicate|unique|23505/i.test(errMsg(e)) ? '同じ曲名がすでにあります' : errMsg(e); }
      } }, '保存')),
    song ? h('button', { class: 'btn ghost small', style: 'margin-top:10px', onclick: async () => {
      if (!await confirmBox('この曲を一覧から外す？', 'これまでのセットリストの記録は残ります。', '外す')) return;
      try { await api.saveSong(song.id, { is_active: false }); m.close(); toast('外しました', 'ok'); done && done(null); } catch (e) { toast(errMsg(e), 'err'); }
    } }, '🗑 一覧から外す') : null,
  ]);
}

async function songsView() {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('🎵 曲マスター', body, '#/live-list'));
  try {
    const [songs, rows] = await Promise.all([api.songs(), api.liveSetlists().catch(() => [])]);
    if (my !== renderId) return;
    const st = computeSongStats(rows, ymd());
    const q = h('input', { type: 'text', placeholder: '曲名で探す', autocomplete: 'off' });
    const list = h('div', {});
    const draw = () => {
      const xs = songs.filter(s => songMatch(s, q.value)).sort((a, b) => ((st.get(b.id) || {}).plays || 0) - ((st.get(a.id) || {}).plays || 0) || a.title.localeCompare(b.title));
      list.replaceChildren(...(xs.length ? xs.map(s => {
        const x = st.get(s.id);
        return h('button', { class: 'lrow', style: 'width:100%;text-align:left', onclick: () => songModal(s, () => songsView()) },
          h('span', { class: 'lico' }, s.kind === 'cover' ? '🎤' : '🎵'),
          h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, s.title),
            h('div', { class: 'lsub' }, x ? `${x.plays}回 ・ 初 ${dshow(x.first)} ・ 最後 ${dshow(x.last)}` : 'まだ演奏記録なし'),
            h('div', { class: 'ltags' }, s.kind === 'cover' ? h('i', { class: 'tag mid' }, 'カバー' + (s.artist ? ' / ' + s.artist : '')) : null, x && x.opener ? h('i', { class: 'tag ok' }, '1曲目 ' + x.opener) : null, x && x.closer ? h('i', { class: 'tag ok' }, 'ラスト ' + x.closer) : null, s.duration_sec ? h('i', { class: 'tag recv' }, fmtDur(s.duration_sec)) : null)));
      }) : [h('p', { class: 'empty' }, songs.length ? '見つかりません' : 'まだ曲がありません。')]));
    };
    q.addEventListener('input', draw);
    draw();
    body.replaceChildren(
      h('button', { class: 'btn big in', style: 'width:100%', onclick: () => songModal(null, () => songsView()) }, '＋ 曲を登録'),
      field('検索', q), list,
      h('p', { class: 'hint' }, '回数は、日付が今日までのライブのセットリストから数えています。'));
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, songsView)); }
}

// ---------- セットリストの書き出し(画像・PDF) ----------
const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function slHeaderDefault(l, info) {
  if (info && info.setlist_head) return info.setlist_head;
  const [y, m, d] = String(l.live_date).slice(0, 10).split('-').map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  const place = [l.prefecture, l.venue_name].filter(Boolean).join(' ');
  return [`${y}/${m}/${d} ${wd} @${place}`, (info && info.official_title) || l.event_name, info && info.set_time].filter(Boolean).join('\n');
}
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function wrapHead(g, text, maxW) {
  const w = t => g.measureText(t).width;
  if (w(text) <= maxW) return [text];
  const sp = []; for (let i = 0; i < text.length; i++) if (text[i] === ' ') sp.push(i);
  let cut = -1;
  const kw = /(pre\.|presents?)\s/ig; let m;
  while ((m = kw.exec(text))) { const i = m.index + m[1].length; if (w(text.slice(0, i)) <= maxW && i < text.length - 1) { cut = i; break; } }
  if (cut < 0) {
    let best = Infinity;
    for (const i of sp) { const l = w(text.slice(0, i)), r = w(text.slice(i + 1)); if (l <= maxW && Math.abs(l - r) < best) { best = Math.abs(l - r); cut = i; } }
  }
  if (cut < 0) { let i = 1; while (i < text.length && w(text.slice(0, i + 1)) <= maxW) i++; cut = i; return [text.slice(0, cut), ...wrapHead(g, text.slice(cut), maxW)]; }
  return [text.slice(0, cut).trim(), ...wrapHead(g, text.slice(cut).trim(), maxW)];
}
async function renderSetlist(headLines, entries) {
  const W = 1240, H = 1754, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
  const FONT = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic",Meiryo,sans-serif';
  let y = 80;
  try { const im = await loadImg('logo-wi.png?v=41'); const lw = 270, lh = lw * im.height / im.width; g.drawImage(im, (W - lw) / 2, y, lw, lh); y += lh + 30; } catch { y += 30; }
  g.textAlign = 'center'; g.font = `700 30px ${FONT}`;
  const lines = headLines.flatMap(t => wrapHead(g, t, W - 220));
  for (const t of lines) { y += 52; g.fillText(t, W / 2, y); }
  y += 50;
  let fs = 48;
  const lhOf = f => f * 1.55, gapOf = f => f * 1.2;
  const dOf = f => lhOf(f) * 0.95;
  const need = f => { let t = 0, carry = 0; for (const e of entries) { if (e.gap) { t += gapOf(f); carry = 0; continue; } t += carry || (e.tight ? dOf(f) : lhOf(f)); carry = 0; if (e.note) { t += dOf(f); carry = dOf(f); } if (e.tight) carry = dOf(f); } return t; };
  const avail = H - y - 110;
  const widest = f => { g.font = `700 ${f}px ${FONT}`; return Math.max(0, ...entries.map(e => Math.max(g.measureText(e.text || '').width, g.measureText(e.note || '').width))); };
  while ((need(fs) > avail || 250 + widest(fs) > W - 90) && fs > 24) fs -= 2;
  const lh = lhOf(fs), gap = gapOf(fs);
  const xn = 225, xt = 250;
  const d = dOf(fs); let carry = 0;
  for (const e of entries) {
    if (e.gap) { y += gap; carry = 0; continue; }
    y += carry || (e.tight ? d : lh); carry = 0;
    if (e.no != null) { g.textAlign = 'right'; g.font = `700 ${fs}px ${FONT}`; g.fillText(e.no + '.', xn, y); }
    g.textAlign = 'left'; g.font = `700 ${fs}px ${FONT}`; g.fillText(e.text, xt, y);
    if (e.note) { y += d; g.font = `700 ${fs}px ${FONT}`; g.fillText(e.note, xt, y); carry = d; }
    if (e.tight) carry = d;
  }
  return c;
}
function slEntries(items, byId) {
  const out = []; let no = 0;
  for (const it of items) {
    if (it.type === 'mc') { if (out.length && !out[out.length - 1].gap) out.push({ gap: true }); continue; }
    if (it.type === 'song') { const s = byId.get(it.song_id); if (!s) continue; out.push({ no: ++no, text: s.title, note: it.note }); }
    else out.push({ text: it.label || '', note: it.note, tight: /^〜.*〜$/.test(it.label || '') });
  }
  while (out.length && out[out.length - 1].gap) out.pop();
  return out;
}
function jpegToPdf(jpeg, w, h) {
  const enc = new TextEncoder(); const parts = []; let len = 0; const offs = [];
  const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'));
  obj(4, () => { push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); push(jpeg); push('\nendstream'); });
  const cs = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
  obj(5, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
  const xr = len; push('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`);
  const out = new Uint8Array(len); let p = 0; for (const u of parts) { out.set(u, p); p += u.length; }
  return out;
}
function saveBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function exportSetlistModal(l, info, items, byId) {
  const ta = h('textarea', { class: 'area', rows: 6 }); ta.value = slHeaderDefault(l, info);
  const prev = h('div', { class: 'hint' }, '');
  const fname = ext => `セトリ_${String(l.live_date).slice(0, 10)}_${(l.venue_name || '').replace(/[\\/:*?"<>|\s]/g, '')}.${ext}`;
  const build = async () => {
    if (ta.value.trim() !== (info.setlist_head || '').trim()) { info.setlist_head = ta.value.trim(); api.saveLiveInfo(l.id, { setlist_head: info.setlist_head || null }).catch(() => {}); }
    return renderSetlist(ta.value.split('\n').map(x => x.trim()).filter(Boolean), slEntries(items, byId));
  };
  const m = modal([
    h('h3', {}, '🖼 セトリを書き出す'),
    field('上に入れる文字(1行ずつ)', ta, '日付・会場・イベント名・持ち時間などを自由に直せます。'),
    h('button', { class: 'btn big', style: 'width:100%', onclick: async () => {
      try { const c = await build(); const blob = await new Promise(r => c.toBlob(r, 'image/png')); const f = new File([blob], fname('png'), { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: 'セットリスト' }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
        saveBlob(blob, fname('png')); toast('画像を保存しました', 'ok'); } catch (e) { toast(errMsg(e), 'err'); } } }, '🖼 画像(PNG)にする'),
    h('button', { class: 'btn ghost', style: 'width:100%;margin-top:8px', onclick: async () => {
      try { const c = await build(); const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)); const pdf = jpegToPdf(new Uint8Array(await blob.arrayBuffer()), c.width, c.height);
        const out = new Blob([pdf], { type: 'application/pdf' }); const f = new File([out], fname('pdf'), { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: 'セットリスト' }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
        saveBlob(out, fname('pdf')); toast('PDFを保存しました', 'ok'); } catch (e) { toast(errMsg(e), 'err'); } } }, '📄 PDFにする'),
    prev,
    h('button', { class: 'btn ghost small', style: 'margin-top:10px', onclick: () => m.close() }, '閉じる'),
  ]);
}

let slQueue = Promise.resolve();
function setlistPane(l, conf, songs, items, rows, reload, info) {
  const st = computeSongStats(rows, ymd());
  const byId = new Map(songs.map(s => [s.id, s]));
  const wrap = h('div', {});
  const save = () => { slQueue = slQueue.then(() => api.saveSetlist(l.id, items, state.by)).catch(e => toast(errMsg(e), 'err')); return slQueue; };
  const commit = () => { draw(); save(); };
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; commit(); };
  const addSongs = () => {
    const q = h('input', { type: 'text', placeholder: '曲名で探す', autocomplete: 'off' });
    const list = h('div', {});
    const m = modal([h('h3', {}, '曲を追加'), q, list]);
    const drawL = () => {
      const xs = songs.filter(s => songMatch(s, q.value));
      list.replaceChildren(
        ...xs.map(s => h('button', { class: 'lrow', style: 'width:100%;text-align:left', onclick: () => { items.push({ type: 'song', song_id: s.id }); m.close(); commit(); } },
          h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, s.title), h('div', { class: 'lsub' }, s.kind === 'cover' ? 'カバー' + (s.artist ? ' / ' + s.artist : '') : 'オリジナル')))),
        h('button', { class: 'btn ghost', style: 'width:100%;margin-top:8px', onclick: () => { const t = q.value.trim(); m.close(); songModal(t ? { id: null, title: t, kind: 'original' } : null, async r => { if (!r) return; songs.push(r); byId.set(r.id, r); items.push({ type: 'song', song_id: r.id }); commit(); }, true); } }, '＋ 新しい曲として登録' + (q.value.trim() ? '「' + q.value.trim() + '」' : '')));
    };
    q.addEventListener('input', drawL);
    drawL();
  };
  const addOther = (type, label) => { items.push({ type, label }); commit(); };
  const isMemo = it => it.type === 'other' && /^〜.*〜$/.test(it.label || '');
  const memoModal = it => {
    const inp = h('input', { type: 'text', autocomplete: 'off', placeholder: '例: ぶちあげ！！', value: it ? String(it.label).replace(/^〜|〜$/g, '') : '' });
    const m = modal([h('h3', {}, it ? 'メモを編集' : 'メモを追加'), inp, h('p', { class: 'hint' }, '書いた文字が「〜○○〜」の形でセトリに入ります。'),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'やめる'), h('button', { class: 'btn', onclick: () => {
        const t = inp.value.trim().replace(/^[〜~～]+|[〜~～]+$/g, '').trim();
        if (!t) { if (it) { items.splice(items.indexOf(it), 1); m.close(); commit(); } else m.close(); return; }
        if (it) it.label = '〜' + t + '〜'; else items.push({ type: 'other', label: '〜' + t + '〜' });
        m.close(); commit();
      } }, '保存')),
      it ? h('button', { class: 'btn ghost small', style: 'margin-top:8px', onclick: () => { items.splice(items.indexOf(it), 1); m.close(); commit(); } }, '🗑 削除') : null]);
    setTimeout(() => inp.focus(), 50);
  };
  const copyFrom = () => {
    const by = new Map();
    for (const r of rows) { if (r.live_id === l.id) continue; if (!by.has(r.live_id)) by.set(r.live_id, { d: String((r.lives && r.lives.live_date) || '').slice(0, 10), name: (r.lives && r.lives.event_name) || '', items: [] }); by.get(r.live_id).items.push(r); }
    const ls = [...by.entries()].sort((a, b) => b[1].d.localeCompare(a[1].d));
    const m = modal([h('h3', {}, '過去のセットリストをコピー'), ...(ls.length ? ls.map(([lid, v]) => h('button', { class: 'lrow', style: 'width:100%;text-align:left', onclick: async () => {
      if (items.length && !await confirmBox('今のセットリストを置き換える？', '入力済みの内容は消えます。', '置き換える')) return;
      items.splice(0, items.length, ...v.items.sort((a, b) => a.position - b.position).map(x => ({ type: x.type, song_id: x.song_id, label: x.label || null, note: x.note || null })));
      m.close(); commit();
    } }, h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, v.name), h('div', { class: 'lsub' }, dshow(v.d) + ' ・ ' + v.items.filter(x => x.type === 'song').length + '曲')))) : [h('p', { class: 'empty' }, 'コピーできるセットリストがまだありません。')])]);
  };
  const noteModal = it => {
    const inp = h('input', { type: 'text', value: it.note || '', placeholder: '例: 短縮ver. / ここでMC', autocomplete: 'off' });
    const m = modal([h('h3', {}, 'メモ'), inp, h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'やめる'), h('button', { class: 'btn', onclick: () => { it.note = inp.value.trim() || null; m.close(); commit(); } }, '保存'))]);
  };
  function draw() {
    let no = 0, total = 0;
    const rowsEl = items.map((it, i) => {
      const s = it.type === 'song' ? byId.get(it.song_id) : null;
      if (s) { no++; total += s.duration_sec || 0; }
      const x = s && st.get(s.id);
      const fresh = s && (!x || x.firstLive === l.id);
      return h('div', { class: 'lrow', style: it.type === 'song' ? '' : 'opacity:.8' },
        h('span', { class: 'lico' }, s ? String(no) : '—'),
        h('button', { class: 'lmain', style: 'text-align:left;background:none;border:0;color:inherit;padding:0', onclick: () => !conf && (isMemo(it) ? memoModal(it) : noteModal(it)) },
          h('div', { class: 'lmemo' }, s ? s.title : (it.type === 'mc' ? 'MC' : (it.label || '—')), fresh ? h('i', { class: 'tag ok', style: 'margin-left:6px' }, '🆕初披露') : null),
          it.note ? h('div', { class: 'lsub' }, it.note) : (s && s.kind === 'cover' ? h('div', { class: 'lsub' }, 'カバー' + (s.artist ? ' / ' + s.artist : '')) : null)),
        conf ? null : h('span', { class: 'ltags', style: 'display:flex;gap:4px' },
          h('button', { class: 'btn small ghost', style: 'padding:6px 10px;min-width:0', 'aria-label': '上へ', onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'btn small ghost', style: 'padding:6px 10px;min-width:0', 'aria-label': '下へ', onclick: () => move(i, 1) }, '↓'),
          h('button', { class: 'btn small ghost', style: 'padding:6px 10px;min-width:0', 'aria-label': '削除', onclick: () => { items.splice(i, 1); commit(); } }, '✕')));
    });
    wrap.replaceChildren(
      h('section', { class: 'card' },
        h('div', { class: 'cap' }, '🎵 セットリスト' + (no ? ` ${no}曲` : '') + (total ? ` ・ 約${Math.round(total / 60)}分` : '')),
        ...(rowsEl.length ? rowsEl : [h('p', { class: 'empty' }, 'まだ曲がありません。下のボタンから追加してください。')]),
        conf ? null : h('div', { style: 'margin-top:10px' },
          h('button', { class: 'btn big', style: 'width:100%', onclick: addSongs }, '＋ 曲を追加'),
          h('div', { class: 'ltags', style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' },
            h('button', { class: 'btn small ghost', onclick: () => addOther('mc', 'MC') }, '＋ MC'),
            h('button', { class: 'btn small ghost', onclick: () => addOther('other', '転換') }, '＋ 転換'),
            h('button', { class: 'btn small ghost', onclick: () => addOther('other', 'SE') }, '＋ SE'),
            h('button', { class: 'btn small ghost', onclick: () => addOther('other', 'ENCORE') }, '＋ アンコール'),
            h('button', { class: 'btn small ghost', onclick: () => memoModal(null) }, '＋ メモ'),
            h('button', { class: 'btn small ghost', onclick: copyFrom }, '📄 過去からコピー')))),
      items.some(x => x.type === 'song') ? h('button', { class: 'btn big', style: 'width:100%;margin-top:4px', onclick: () => exportSetlistModal(l, info, items, byId) }, '🖼 画像・PDFで書き出す') : null,
      h('p', { class: 'hint' }, '曲名の列をタップすると、メモ(短縮ver.など)を付けられます。変更は自動で保存されます。曲の一覧・回数は ', h('a', { href: '#/songs' }, '曲マスター'), ' で見られます。'));
  }
  draw();
  return [wrap];
}

// ---------- Airレジ売上の取り込み ----------
async function airView() {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('📥 Airレジ売上', body));
  try {
    const [baskets, lives, imports] = await Promise.all([api.airBaskets(), api.lives(), api.airImports()]);
    if (my !== renderId) return;
    const reload = () => airView();
    const fileIn = h('input', { type: 'file', accept: '.csv,text/csv', style: 'display:none' });
    const pv = h('div', {});
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; if (!f) return;
      pv.replaceChildren(loading());
      try { await airPreview(f, pv, baskets, reload); } catch (e) { pv.replaceChildren(h('p', { class: 'form-err' }, errMsg(e))); }
      fileIn.value = '';
    });
    // 日ごとにまとめる
    const byDate = new Map();
    for (const b of baskets) { if (!byDate.has(b.sale_date)) byDate.set(b.sale_date, []); byDate.get(b.sale_date).push(b); }
    const liveName = id => { const l = lives.find(x => x.id === id); return l ? `${dshow(l.live_date)} ${l.event_name}` : ''; };
    const rows = [...byDate.entries()].map(([d, bs]) => {
      const tot = bs.reduce((s, b) => s + (Number(b.total) || 0), 0);
      const linkedIds = [...new Set(bs.map(b => b.live_id).filter(Boolean))];
      const cur = linkedIds.length === 1 && bs.every(b => b.live_id) ? linkedIds[0] : '';
      const sel = h('select', { class: 'sel', 'aria-label': 'ひも付けるライブ' },
        h('option', { value: '' }, linkedIds.length > 1 || (linkedIds.length === 1 && !cur) ? '一部だけひも付け済み' : 'ライブにひも付けない'),
        ...lives.map(l => h('option', { value: l.id, selected: l.id === cur }, `${dshow(l.live_date)} ${l.event_name}`)));
      sel.addEventListener('change', async () => {
        try { await api.airLink(d, sel.value || null, state.by); toast(sel.value ? 'ひも付けました' : 'ひも付けを外しました', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
      });
      return h('div', { class: 'lrow', style: 'flex-wrap:wrap' },
        h('span', { class: 'lico' }, '🧾'),
        h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, dshow(d)), h('div', { class: 'lsub' }, `${bs.length}会計`),
          h('div', { class: 'ltags' }, bs.some(b => b.date_mismatch) ? h('i', { class: 'tag mid' }, '取引Noの日付とずれあり') : null, cur ? h('i', { class: 'tag ok' }, 'ライブに紐付け済み') : null)),
        h('div', { class: 'lamt pos' }, yen(tot)),
        h('div', { style: 'width:100%;margin-top:6px' }, sel));
    });
    body.replaceChildren(
      h('section', { class: 'card' }, h('div', { class: 'cap' }, 'AIRレジの月次CSVを取り込む'),
        h('p', { class: 'hint' }, '取り込むと、会計が日ごとに記録され、在庫が減ります(在庫の開始日以降の分だけ)。売上金そのものは、これまでどおり「お金が入った」「ライブの収入」に入力してください。同じファイルを2回入れても二重にはなりません。'),
        h('button', { class: 'btn big', style: 'width:100%', onclick: () => fileIn.click() }, '📂 CSVを選ぶ'), fileIn),
      pv,
      ...(imports.length ? [h('p', { class: 'hint' }, '取り込み済み: ' + imports.slice(0, 3).map(i => `${String(i.target_month || '').slice(0, 7)}(${i.baskets_new}会計)`).join(' / '))] : []),
      h('div', { class: 'cap sec' }, '日ごとの売上とライブのひも付け'),
      ...(rows.length ? rows : [h('p', { class: 'empty' }, 'まだ取り込んでいません。')]));
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, airView)); }
}

async function airPreview(file, box, existing, reload, opt = {}) {
  const buf = await file.arrayBuffer();
  const parsed = parseAir(decodeCsv(buf));
  let hash = await sha256(buf);
  let others = 0; let ovn = 0;
  const useOvn = opt.overnight !== false;
  if (opt.date) { // ライブから取り込むときは、そのライブの日の会計(と、日またぎの深夜分)だけを使う
    ovn = parsed.baskets.filter(b => isOvernight(b, opt.date)).length;
    const keep = b => b.sale_date === opt.date || (useOvn && isOvernight(b, opt.date));
    others = parsed.baskets.filter(b => !keep(b) && !isOvernight(b, opt.date)).length;
    parsed.baskets = parsed.baskets.filter(keep);
    hash += ':' + opt.date + (useOvn && ovn ? ':n' : '');
    if (!parsed.baskets.length) { box.replaceChildren(h('p', { class: 'form-err' }, `このファイルに ${dshow(opt.date)} の会計がありません。ライブの日付とファイルを確認してください。`)); return; }
  }
  const [products, saved] = await Promise.all([api.products(), api.airMap()]);
  const savedMap = new Map(saved.map(m => [[m.menu_norm, m.type1_norm, m.type2_norm].join('|'), m.variant_id]));
  const vlabel = new Map(); for (const p of products) for (const v of p.variants) vlabel.set(v.id, p.name + ' ' + vLabel(v));
  // 一意な品目
  const items = new Map();
  for (const b of parsed.baskets) for (const l of b.lines) {
    const k = keyOf(l); if (!items.has(k)) items.set(k, { l, qty: 0, vid: savedMap.get(k) || autoMatch(l, products) || '' });
    items.get(k).qty += l.qty;
  }
  const exist = new Set(existing.map(b => b.sale_date + '|' + b.txn_no));
  const fresh = parsed.baskets.filter(b => !exist.has(b.sale_date + '|' + b.txn_no));
  const total = fresh.reduce((s, b) => s + (Number(b.total) || b.lines.reduce((x, l) => x + l.price * l.qty, 0)), 0);
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const allV = [...vlabel.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  const itemRows = [...items.entries()].map(([k, it]) => {
    const sel = h('select', { class: 'sel' }, h('option', { value: '' }, '対応づけない(在庫は動かさない)'), ...allV.map(([id, lab]) => h('option', { value: id, selected: id === it.vid }, lab)));
    sel.addEventListener('change', () => { it.vid = sel.value; });
    return h('div', { class: 'saleline' },
      h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, it.l.menu), h('div', { class: 'lsub' }, [it.l.type1, it.l.type2].filter(Boolean).join(' / ') + ` ・ ${it.qty}点`),
        it.vid ? null : h('div', { class: 'ltags' }, h('i', { class: 'tag mid' }, '要選択'))), sel);
  });
  const ok = h('button', { class: 'btn big in', onclick: async () => {
    msg.textContent = '';
    if (!state.by) { await pickBy(true); if (!state.by) return; }
    ok.disabled = true;
    try {
      const baskets = parsed.baskets.map(b => ({ ...b, lines: b.lines.map(l => ({ ...l, variant_id: (items.get(keyOf(l)) || {}).vid || null })) }));
      const map = [...items.values()].filter(it => it.vid).map(it => ({ menu_norm: keyOf(it.l).split('|')[0], type1_norm: keyOf(it.l).split('|')[1], type2_norm: keyOf(it.l).split('|')[2], variant_id: it.vid }));
      const r = await api.airImport({ file_name: file.name, hash, month: parsed.month, baskets, map, by: state.by });
      if (opt.liveId) { await api.airLink(opt.date, opt.liveId, state.by); if (useOvn && ovn) await api.airLinkOvernight(opt.liveId, state.by); }
      toast(`${r.new}会計を取り込みました(在庫を動かした行 ${r.stock_lines})`, 'ok'); reload();
    } catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '取り込む');
  const unm = [...items.values()].filter(it => !it.vid).length;
  box.replaceChildren(h('section', { class: 'card' },
    h('div', { class: 'cap' }, '内容の確認: ' + file.name),
    h('div', { class: 'trio' }, h('div', {}, h('small', {}, '新しい会計'), h('b', {}, fresh.length)), h('div', {}, h('small', {}, '取り込み済み'), h('b', {}, parsed.baskets.length - fresh.length)), h('div', {}, h('small', {}, '売上'), h('b', { class: 'pos' }, yen(total)))),
    unm ? h('p', { class: 'hint' }, `商品マスタと照合できなかった品目が ${unm} 件あります。選ばなければ、売上の記録だけで在庫は動きません。`) : h('p', { class: 'hint' }, 'すべての品目を商品に対応づけました。'),
    h('p', { class: 'hint' }, '同じ種類の品目は1回選べば、次回から覚えます。'),
    ovn ? h('label', { class: 'hint', style: 'display:flex;gap:8px;align-items:center' }, h('input', { type: 'checkbox', checked: useOvn, onchange: ev => airPreview(file, box, existing, reload, { ...opt, overnight: ev.target.checked }) }), `日またぎの会計(翌日0〜6時) ${ovn} 件も、このライブの分として取り込む`) : null,
    others ? h('p', { class: 'hint' }, `ファイルには他の日の会計も ${others} 件ありますが、このライブの日の分だけを使います。`) : null,
    ...itemRows, msg, fresh.length ? ok : h('div', {}, h('p', { class: 'hint' }, 'この日の会計は、すべて取り込み済みです。'),
      opt.liveId ? h('button', { class: 'btn', onclick: async () => { try { await api.airLink(opt.date, opt.liveId, state.by); if (useOvn && ovn) await api.airLinkOvernight(opt.liveId, state.by); toast('このライブにひも付けました', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'err'); } } }, 'この日の会計をこのライブにひも付ける') : null)));
}

// ---------- BASE在庫連携 ----------
// バンクエで増えた・減った数(ライブの売上・入荷など)だけを BASE に足し引きする。
// BASEで売れた分はBASE側ですでに減っているので、上書きはしない。
const pm = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);

async function baseSyncModal(liveId, done) {
  const box = h('div', {}, loading());
  const m = modal([h('h3', {}, '🛒 BASEの在庫に反映'), box]);
  const draw = (lines, mapped) => {
    if (!mapped) { box.replaceChildren(h('p', { class: 'hint' }, 'まだBASEの商品と紐づいていません。先に「BASE連携」で紐づけてください。'), h('a', { class: 'btn big', href: '#/base', onclick: () => m.close() }, 'BASE連携をひらく')); return; }
    if (!lines.length) { box.replaceChildren(h('p', { class: 'hint' }, `前回の反映から、在庫の増減はありません（紐づけ ${mapped}件）。`), h('button', { class: 'btn ghost', style: 'width:100%', onclick: () => m.close() }, '閉じる')); return; }
    const okLines = lines.filter(l => !l.problem);
    const rows = lines.map(l => h('div', { class: 'lrow' + (l.problem ? ' dead' : '') },
      h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, l.label),
        h('div', { class: 'lsub' }, l.problem ? l.problem : `BASE ${l.base_now}点 → ${l.target}点`),
        l.clamped ? h('div', { class: 'ltags' }, h('i', { class: 'tag mid' }, '0点で止めます(数がずれています)')) : null),
      h('div', { class: 'lamt ' + (l.delta < 0 ? 'neg' : 'pos') }, pm(l.delta))));
    const msg = h('p', { class: 'form-err', role: 'alert' });
    const ok = h('button', { class: 'btn big', disabled: !okLines.length, onclick: async () => {
      if (!state.by) { await pickBy(true); if (!state.by) return; }
      ok.disabled = true; msg.textContent = ''; ok.textContent = '反映しています…';
      try {
        const r = await api.baseSync('apply', { by: nameOf(state.by), live_id: liveId || null });
        box.replaceChildren(
          h('p', { class: 'hint' }, r.failed ? `${r.ok}件を反映しました。${r.failed}件は反映できませんでした。` : `✅ ${r.ok}件をBASEに反映しました。`),
          ...r.results.map(l => h('div', { class: 'lrow' + (l.ok ? '' : ' dead') },
            h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, l.label), h('div', { class: 'lsub' }, l.ok ? `BASE ${l.base_now}点 → ${l.target}点` : '× ' + (l.error || '反映できませんでした'))),
            h('div', { class: 'lamt ' + (l.delta < 0 ? 'neg' : 'pos') }, pm(l.delta)))),
          h('button', { class: 'btn ghost', style: 'width:100%;margin-top:8px', onclick: () => { m.close(); if (done) done(); } }, '閉じる'));
        if (!r.failed) toast('BASEの在庫を更新しました', 'ok');
      } catch (e) { msg.textContent = errMsg(e); ok.disabled = false; ok.textContent = 'もう一度反映する'; }
    } }, `BASEに反映する（${okLines.length}件）`);
    box.replaceChildren(h('p', { class: 'hint' }, '前回BASEに反映してから増えた・減った数だけを、BASEの在庫に足し引きします。BASEで売れた分はそのまま残ります。'), ...rows, msg, ok);
  };
  try { const r = await api.baseSync('preview'); draw(r.lines, r.mapped); }
  catch (e) { box.replaceChildren(h('p', { class: 'form-err' }, errMsg(e)), h('button', { class: 'btn ghost', style: 'width:100%', onclick: () => m.close() }, '閉じる')); }
}

function pickBaseModal(p, v, items, cur, done) {
  const q = h('input', { type: 'text', placeholder: 'BASEの商品名で絞り込む', autocomplete: 'off', value: p.name });
  const list = h('div', {});
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const save = async (it, vr) => {
    msg.textContent = '';
    try {
      await api.baseSync('map', it ? { variant_id: v.id, base_item_id: it.item_id, base_variation_id: vr ? vr.variation_id : null, base_label: vr ? `${it.title} / ${vr.variation}` : it.title, by: nameOf(state.by) }
        : { variant_id: v.id, base_item_id: null });
      m.close(); toast(it ? '紐づけました' : '紐づけを外しました', 'ok'); done();
    } catch (e) { msg.textContent = errMsg(e); }
  };
  const draw = () => {
    const t = normKey(q.value);
    const hits = items.filter(it => !t || normKey(it.title).includes(t));
    list.replaceChildren(...(hits.length ? hits.slice(0, 30).map(it => h('div', { class: 'card mini' },
      h('div', { class: 'lmemo' }, it.title),
      it.variations.length ? h('div', { class: 'chips' }, ...it.variations.map(vr => h('button', { type: 'button', class: 'chip', onclick: () => save(it, vr) },
        h('span', { class: 'chip-main' }, vr.variation), h('span', { class: 'chip-sub' }, `BASE ${vr.variation_stock}点`))))
        : h('button', { class: 'btn small', onclick: () => save(it, null) }, `これにする（BASE ${it.stock}点）`))) : [h('p', { class: 'empty' }, '見つかりません。商品名を短くして探してください。')]));
  };
  q.addEventListener('input', draw);
  const m = modal([h('h3', {}, `${p.name}  ${vLabel(v)}`),
    h('p', { class: 'hint' }, cur ? `いまの紐づけ: ${cur.base_label}` : 'BASEのどの商品・色・サイズと同じかを選んでください。紐づけた時点ではBASEの在庫は変わりません。'),
    q, msg, list, cur ? h('button', { class: 'btn ghost', style: 'width:100%;margin-top:8px', onclick: () => save(null) }, '紐づけを外す') : null]);
  draw();
}
const normKey = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

async function baseView(q) {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('🛒 BASE連携', body, '#/manage'));
  if (q && q.get('connected')) toast('BASEにつなぎました', 'ok');
  if (q && q.get('error')) toast(q.get('error'), 'err');
  const reload = () => baseView();
  try {
    const st = await api.baseSync('status');
    if (my !== renderId) return;
    const connect = async () => { try { const r = await api.baseSync('connect'); location.href = r.url; } catch (e) { toast(errMsg(e), 'err'); } };
    const head = h('section', { class: 'card' }, h('div', { class: 'cap' }, '🔗 BASEとの接続'),
      st.connected ? h('div', { class: 'lmemo' }, '✅ つながっています' + (st.shop_name ? `（${st.shop_name}）` : '')) : h('div', { class: 'lmemo' }, 'まだつないでいません'),
      !st.configured ? h('p', { class: 'note' }, 'BASE Developers の Client ID / Secret がまだ設定されていません。設定が終わるとつなげるようになります。') : null,
      h('div', { class: 'duo', style: 'margin-top:10px' },
        h('button', { class: 'btn small', disabled: !st.configured, onclick: connect }, st.connected ? 'つなぎ直す' : 'BASEにつなぐ'),
        st.connected ? h('button', { class: 'btn small ghost', onclick: async () => { if (await confirmBox('BASEとの接続を切る？', '紐づけは残ります。反映するには、もう一度つなぐ必要があります。', '切る')) { try { await api.baseSync('disconnect'); reload(); } catch (e) { toast(errMsg(e), 'err'); } } } }, '接続を切る') : null));
    if (!st.connected) { body.replaceChildren(head, h('p', { class: 'hint' }, 'つなぐと、ライブのあとに「BASEに反映」ボタンで在庫を足し引きできるようになります。')); return; }
    body.replaceChildren(head, h('section', { class: 'card' }, loading()));
    const [products, maps, itemsR, log] = await Promise.all([api.products(), api.baseMaps(), api.baseSync('items'), api.baseLog().catch(() => [])]);
    if (my !== renderId) return;
    const items = itemsR.items || [];
    const mapOf = new Map(maps.map(x => [x.variant_id, x]));
    const act = products.filter(p => p.is_active).map(p => ({ ...p, variants: p.variants.filter(v => v.is_active) })).filter(p => p.variants.length);
    const unmapped = act.flatMap(p => p.variants.filter(v => !mapOf.has(v.id)).map(v => ({ p, v })));
    const sugBox = h('div', {});
    const sugBtn = unmapped.length ? h('button', { class: 'btn small ghost', style: 'width:100%', onclick: async () => {
      sugBtn.disabled = true; sugBox.replaceChildren(loading());
      try {
        const r = await api.baseSync('suggest', { variants: unmapped.map(x => ({ variant_id: x.v.id, product: x.p.name, color: x.v.color, size: x.v.size })) });
        const hits = r.suggestions.filter(s => s.hit).map(s => ({ ...s, x: unmapped.find(u => u.v.id === s.variant_id) }));
        if (!hits.length) { sugBox.replaceChildren(h('p', { class: 'hint' }, '名前から自動で決められるものはありませんでした。1つずつ選んでください。')); return; }
        const all = h('button', { class: 'btn big', onclick: async () => {
          all.disabled = true; let n = 0; const errs = [];
          for (const s of hits) { try { await api.baseSync('map', { variant_id: s.variant_id, base_item_id: s.hit.item_id, base_variation_id: s.hit.variation_id, base_label: s.hit.label, by: nameOf(state.by) }); n++; } catch (e) { errs.push(`${s.x.p.name} ${vLabel(s.x.v)}: ${errMsg(e)}`); } }
          toast(`${n}件を紐づけました`, errs.length ? 'err' : 'ok'); if (errs.length) alert(errs.join('\n')); reload();
        } }, `この${hits.length}件をまとめて紐づける`);
        sugBox.replaceChildren(h('p', { class: 'hint' }, '名前が一致した候補です。違うものがあれば、紐づけたあとに1つずつ直せます。'),
          ...hits.map(s => h('div', { class: 'lrow' }, h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, `${s.x.p.name}  ${vLabel(s.x.v)}`), h('div', { class: 'lsub' }, '→ BASE: ' + s.hit.label)))), all);
      } catch (e) { sugBox.replaceChildren(h('p', { class: 'form-err' }, errMsg(e))); sugBtn.disabled = false; }
    } }, `🪄 名前から自動で候補を出す（未設定 ${unmapped.length}件）`) : null;
    const rows = act.map(p => [h('div', { class: 'cap sec' }, p.name), ...p.variants.map(v => {
      const cur = mapOf.get(v.id);
      return h('div', { class: 'lrow' + (cur ? '' : ' draft') },
        h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, vLabel(v)), h('div', { class: 'lsub' }, cur ? '→ BASE: ' + cur.base_label : '未設定（BASEに無ければこのままでOK）')),
        h('div', { class: 'lamt' }, v.stock + '点'),
        h('button', { class: 'undo', onclick: () => pickBaseModal(p, v, items, cur, reload) }, cur ? '変更' : '選ぶ'));
    })]);
    const logCard = log.length ? h('section', { class: 'card' }, h('div', { class: 'cap' }, '📜 最近の反映'),
      ...log.map(r => h('p', { class: 'hint' }, `${String(r.run_at).slice(0, 16).replace('T', ' ').replaceAll('-', '/')}  ${r.run_by || ''}  ${r.ok}件${r.failed ? `（失敗 ${r.failed}件）` : ''}`))) : null;
    body.replaceChildren(head,
      h('button', { class: 'btn big in', style: 'width:100%', onclick: () => baseSyncModal(null, reload) }, '🛒 BASEの在庫に反映'),
      h('p', { class: 'hint' }, `紐づけ ${maps.length}件 / BASEの商品 ${items.length}件。紐づけた時点の在庫を基準にして、その後に増えた・減った数だけを反映します。`),
      logCard, sugBtn, sugBox, ...rows.flat());
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, reload)); }
}

// ---------- 管理: 定期費用・テンプレート・バックアップ ----------
const lastBackup = () => { try { return localStorage.getItem('withi_last_backup') || ''; } catch { return ''; } };
const daysSince = iso => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null);

// ---- 分析ダッシュボード ----
async function analysisView() {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('📊 分析', body, '#/manage'));
  let data, lives;
  try { [data, lives] = await Promise.all([api.analysis(), api.lives()]); } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, analysisView)); return; }
  if (my !== renderId) return;
  const PERIODS = { m1: '今月', m3: '3か月', y1: '1年', all: '全期間' };
  let per = 'm3'; try { per = localStorage.getItem('withi_an_per') || 'm3'; } catch { /* 無くても動く */ }
  if (!PERIODS[per]) per = 'm3';
  let flow = 'out';
  const now = new Date(); const pad2 = n => String(n).padStart(2, '0');
  const mk = (y, m) => `${y}-${pad2(m)}`;
  const startOf = p => { if (p === 'all') return '0000-00'; const back = { m1: 0, m3: 2, y1: 11 }[p]; const d = new Date(now.getFullYear(), now.getMonth() - back, 1); return mk(d.getFullYear(), d.getMonth() + 1); };
  const catName = id => (state.cats.find(c => c.id === id) || {}).name || '(カテゴリなし)';
  const IN = r => r.kind === 'income';
  const vmap = new Map(); for (const p of data.products) for (const v of p.variants) vmap.set(v.id, { p, v });
  const bar = (w, color) => h('div', { style: `height:10px;border-radius:6px;background:${color};width:${Math.max(2, Math.min(100, w))}%` });

  const draw = () => {
    const from = startOf(per);
    const rows = data.rows.filter(r => r.date.slice(0, 7) >= from);
    const inc = rows.filter(IN).reduce((a, r) => a + r.pnl, 0);
    const exp = -rows.filter(r => !IN(r)).reduce((a, r) => a + r.pnl, 0);
    const profit = inc - exp;

    // 月別
    const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(mk(d.getFullYear(), d.getMonth() + 1)); }
    const mt = months.map(m => { const rs = data.rows.filter(r => r.date.slice(0, 7) === m); return { m, inc: rs.filter(IN).reduce((a, r) => a + r.pnl, 0), exp: -rs.filter(r => !IN(r)).reduce((a, r) => a + r.pnl, 0) }; });
    const mx = Math.max(1, ...mt.map(x => Math.max(x.inc, x.exp)));
    const monthly = h('div', { class: 'card' }, h('div', { class: 'cap' }, '月ごとの収入と支出（直近12か月）'),
      h('div', { style: 'display:flex;align-items:flex-end;gap:4px;height:120px;margin-top:10px' }, ...mt.map(x => h('div', { style: 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0', title: `${x.m} 収入${yen(x.inc)} 支出${yen(x.exp)}` },
        h('div', { style: 'display:flex;align-items:flex-end;gap:2px;height:100%;width:100%;justify-content:center' },
          h('div', { style: `width:42%;background:var(--green);border-radius:3px 3px 0 0;height:${(x.inc / mx) * 100}%;min-height:${x.inc ? 2 : 0}px` }),
          h('div', { style: `width:42%;background:var(--pink);border-radius:3px 3px 0 0;height:${(x.exp / mx) * 100}%;min-height:${x.exp ? 2 : 0}px` }))))),
      h('div', { style: 'display:flex;gap:4px;margin-top:4px' }, ...mt.map(x => h('div', { style: 'flex:1;text-align:center;font-size:10px;color:var(--muted)' }, String(+x.m.slice(5))))),
      h('div', { class: 'hint', style: 'margin-top:8px' }, h('span', { style: 'color:var(--green)' }, '■'), ' 収入　', h('span', { style: 'color:var(--pink)' }, '■'), ' 支出　（数字は月）'));

    // カテゴリ別
    const sel = rows.filter(r => (flow === 'in') === IN(r));
    const byCat = new Map(); for (const r of sel) byCat.set(r.category_id, (byCat.get(r.category_id) || 0) + (IN(r) ? r.pnl : -r.pnl));
    const cats = [...byCat.entries()].map(([id, v]) => [catName(id), Math.abs(v) < 1 ? 0 : v]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
    const tot = cats.reduce((a, x) => a + x[1], 0) || 1;
    const catCard = h('div', { class: 'card' }, h('div', { class: 'cap' }, 'カテゴリ別'),
      h('div', { class: 'tabs', style: 'margin:10px 0' }, h('a', { class: 'tab' + (flow === 'out' ? ' on' : ''), href: 'javascript:void(0)', onclick: () => { flow = 'out'; draw(); } }, '支出'), h('a', { class: 'tab' + (flow === 'in' ? ' on' : ''), href: 'javascript:void(0)', onclick: () => { flow = 'in'; draw(); } }, '収入')),
      ...(cats.length ? cats.slice(0, 10).map(([n, v]) => h('div', { style: 'margin:8px 0' },
        h('div', { style: 'display:flex;justify-content:space-between;font-size:14px' }, h('span', {}, n), h('span', {}, yen(v), ' ', h('span', { class: 'muted' }, Math.round(v / tot * 100) + '%'))),
        bar(v / cats[0][1] * 100, flow === 'in' ? 'var(--green)' : 'var(--pink)'))) : [h('p', { class: 'empty' }, 'この期間のデータはありません')]));

    // ライブ別
    const lv = lives.filter(l => String(l.live_date).slice(0, 7) >= from && (l.income || l.expense)).sort((a, b) => b.profit - a.profit);
    const avg = lv.length ? Math.round(lv.reduce((a, l) => a + l.profit, 0) / lv.length) : 0;
    const liveRow = l => h('a', { class: 'lrow', href: '#/live?id=' + l.id }, h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, l.event_name || '(名前なし)'), h('div', { class: 'lsub' }, String(l.live_date).slice(5).replace('-', '/') + (l.venue_name ? '　' + l.venue_name : ''))),
      h('span', { class: 'lamt', style: `color:${l.profit >= 0 ? 'var(--green)' : 'var(--red)'}` }, yen(l.profit)));
    const liveCard = h('div', { class: 'card' }, h('div', { class: 'cap' }, 'ライブ別の利益'),
      lv.length ? h('div', {}, h('div', { class: 'hint', style: 'margin:6px 0 10px' }, `${lv.length}本　1本あたり平均 ${yen(avg)}`),
        h('div', { class: 'cap', style: 'margin:6px 0' }, 'ベスト'), ...lv.slice(0, 3).map(liveRow),
        lv.length > 3 ? h('div', {}, h('div', { class: 'cap', style: 'margin:10px 0 6px' }, 'ワースト'), ...lv.slice(-Math.min(3, lv.length - 3)).reverse().map(liveRow)) : null)
        : h('p', { class: 'empty' }, 'この期間のライブはありません'));

    // 物販
    const sold = new Map(); for (const m of data.moves) { if (m.date.slice(0, 7) < from) continue; sold.set(m.variant_id, (sold.get(m.variant_id) || 0) - m.qty); }
    const byProd = new Map(); for (const [vid, q] of sold) { const x = vmap.get(vid); if (!x || q === 0) continue; const o = byProd.get(x.p.id) || { name: x.p.name, qty: 0, sales: 0, gp: 0 }; o.qty += q; o.sales += q * x.v.price; o.gp += q * (x.v.price - (x.v.cost || 0)); byProd.set(x.p.id, o); }
    const prods = [...byProd.values()].filter(p => p.qty > 0).sort((a, b) => b.qty - a.qty);
    const maxq = prods[0] ? prods[0].qty : 1;
    const merchCard = h('div', { class: 'card' }, h('div', { class: 'cap' }, '物販の売れ筋'),
      prods.length ? h('div', {}, h('div', { class: 'hint', style: 'margin:6px 0 4px' }, `合計 ${prods.reduce((a, p) => a + p.qty, 0)}点　定価ベースの概算売上 ${yen(prods.reduce((a, p) => a + p.sales, 0))}`),
        ...prods.slice(0, 8).map(p => h('div', { style: 'margin:8px 0' },
          h('div', { style: 'display:flex;justify-content:space-between;font-size:14px;gap:8px' }, h('span', { style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, p.name), h('span', { style: 'white-space:nowrap' }, p.qty + '点 ', h('span', { class: 'muted' }, yen(p.gp)))),
          bar(p.qty / maxq * 100, 'var(--cyan)'))),
        h('div', { class: 'hint' }, '右の金額は「定価−原価」の概算粗利。割引・無料は反映していません。'))
        : h('p', { class: 'empty' }, 'この期間の販売記録はありません（Airレジは取り込んだ分、BASE・個別販売は入力した分を数えます）'));

    body.replaceChildren(
      h('div', { class: 'tabs' }, ...Object.entries(PERIODS).map(([k, v]) => h('a', { class: 'tab' + (k === per ? ' on' : ''), href: 'javascript:void(0)', onclick: () => { per = k; try { localStorage.setItem('withi_an_per', k); } catch { /* 無くても動く */ } draw(); } }, v))),
      h('div', { class: 'card' }, h('div', { class: 'cap' }, PERIODS[per] + 'の収支'),
        h('div', { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px;text-align:center' },
          h('div', {}, h('div', { class: 'hint' }, '収入'), h('div', { style: 'font-weight:800;color:var(--green)' }, yen(inc))),
          h('div', {}, h('div', { class: 'hint' }, '支出'), h('div', { style: 'font-weight:800;color:var(--pink)' }, yen(exp))),
          h('div', {}, h('div', { class: 'hint' }, '利益'), h('div', { style: `font-weight:800;color:${profit >= 0 ? 'var(--yellow)' : 'var(--red)'}` }, yen(profit)))),
        h('div', { class: 'hint', style: 'margin-top:8px' }, '過去の履歴も含む損益です（現金の残高とは別）。取り消した分は引かれています。')),
      monthly, catCard, liveCard, merchCard);
  };
  draw();
}

function manageView() {
  ++renderId;
  const lb = lastBackup(); const d = daysSince(lb);
  const row = (ico, label, sub, href) => h('a', { class: 'lrow', href }, h('span', { class: 'lico' }, ico), h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, label), h('div', { class: 'lsub' }, sub)), h('span', { class: 'lamt' }, '›'));
  $app.replaceChildren(shell('🛠️ 管理', h('div', {},
    row('📊', '分析', '月ごとの収支・カテゴリ別・ライブ別・物販の売れ筋', '#/analysis'),
    row('🔁', '定期費用', '毎月・毎年かかる費用を登録。期限が来たらホームでお知らせ', '#/recurring'),
    row('⭐', 'テンプレート', 'よく使う入力を1タップで呼び出す', '#/templates'),
    row('🛒', 'BASE連携', 'BASEの商品との紐づけ・在庫の反映', '#/base'),
    row('📥', 'Airレジ売上(月ごとにまとめて取り込む)', 'ふだんはライブの画面から取り込めます。日ごとのひも付けの確認はここ', '#/air'),
    row('💾', 'バックアップ', lb ? `最後に作った日: ${dshow(lb)}（${d}日前）` : 'まだ作っていません', '#/backup'))));
}

function ruleModal(rule, done) {
  const cats = state.cats.filter(c => c.group_name === 'general' && c.flow === 'expense' && c.name !== 'STS取り分');
  const f = { cat: rule ? rule.category_id || '' : '', payer: rule ? rule.payer_id || '' : '', unit: rule ? rule.unit : 'month', notice: rule && rule.notice_days != null ? rule.notice_days : 7 };
  let noticeTouched = !!rule;
  const name = h('input', { type: 'text', placeholder: '例: Spotify・ドメイン代', autocomplete: 'off', value: rule ? rule.name : '' });
  const amt = amountField(rule ? rule.amount : 0); const every = intField(rule ? rule.every_n : 1, '1');
  const due = h('input', { type: 'date', value: rule ? String(rule.next_due).slice(0, 10) : ymd() });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const payers = [{ id: '', label: 'Wiθ資金' }, ...state.people.filter(p => p.can_pay).map(p => ({ id: p.id, label: p.name }))];
  const noticeChips = chips([0, 3, 7, 14, 30, 60].map(d => ({ id: d, label: d === 0 ? '当日' : d + '日前' })), f.notice, id => { f.notice = Number(id); noticeTouched = true; });
  if (!rule && f.unit === 'month') f.notice = 7;
  const ok = h('button', { class: 'btn big', onclick: async () => {
    msg.textContent = ''; const n = numOrNull(every);
    if (!name.value.trim()) { msg.textContent = '名前を入れてください'; return; }
    if (!(amt.get() > 0)) { msg.textContent = '金額を入れてください'; return; }
    if (!(n >= 1)) { msg.textContent = '間隔は1以上にしてください'; return; }
    if (!due.value) { msg.textContent = '次の支払日を入れてください'; return; }
    ok.disabled = true;
    try { await api.saveRule(rule && rule.id, { name: name.value.trim(), every_n: n, unit: f.unit, next_due: due.value, amount: amt.get(), category_id: f.cat, payer_id: f.payer, is_active: true, notice_days: f.notice }); m.close(); toast('保存しました', 'ok'); done(); }
    catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '保存する');
  const m = modal([h('h3', {}, rule ? '定期費用を編集' : '定期費用を追加'), field('名前', name),
    field('なにに？', chips(cats.map(c => ({ id: c.id, label: c.name })), f.cat, id => { f.cat = id; })),
    field('金額', amt.el),
    field('くり返し', chips([{ id: 'month', label: 'ヶ月ごと' }, { id: 'year', label: '年ごと' }], f.unit, id => { f.unit = id; if (!noticeTouched) { f.notice = id === 'year' ? 30 : 7; noticeChips.select(f.notice); } })), field('間隔(数)', every, '例: 毎月なら「ヶ月ごと」で1、半年ごとなら6'),
    field('次の支払日', due), field('何日前からお知らせ？', noticeChips, '支払日の前から、ホームに出ます。年契約は30日前がおすすめ'), h('div', { class: 'field' }, h('span', { class: 'field-label' }, '誰が払う？'), chips(payers, f.payer, id => { f.payer = id; })), msg, ok]);
}

async function recurringView() {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('🔁 定期費用', body, '#/manage'));
  try {
    const rules = await api.recurring();
    if (my !== renderId) return;
    const reload = () => recurringView();
    const today = ymd();
    const rows = rules.map(r => {
      const due = String(r.next_due).slice(0, 10); const over = r.is_active && due <= today;
      return h('div', { class: 'lrow' + (r.is_active ? '' : ' dead') },
        h('span', { class: 'lico' }, '🔁'),
        h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, r.name),
          h('div', { class: 'lsub' }, [r.category && r.category.name, `${r.every_n}${r.unit === 'year' ? '年' : 'ヶ月'}ごと`, r.payer ? r.payer.name + 'が立替' : 'Wiθ資金'].filter(Boolean).join(' · ')),
          h('div', { class: 'ltags' }, h('i', { class: 'tag ' + (over ? 'pay' : 'recv') }, '次: ' + dshow(due) + (r.is_active ? '(' + dueText(dayDiff(due, today)) + ')' : '')), r.is_active ? h('i', { class: 'tag dead' }, (r.notice_days ? r.notice_days + '日前' : '当日') + 'にお知らせ') : null, !r.is_active ? h('i', { class: 'tag dead' }, '停止中') : null)),
        h('div', { class: 'lamt neg' }, yen(r.amount)),
        h('button', { class: 'undo', onclick: () => ruleModal(r, reload) }, '編集'),
        r.is_active ? h('button', { class: 'undo', onclick: async () => { if (await confirmBox('停止する？', `${r.name} を停止します。(これまでの記録は残ります)`, '停止する')) { try { await api.saveRule(r.id, { ...r, category_id: r.category_id, is_active: false }); reload(); } catch (e) { toast(errMsg(e), 'err'); } } } }, '停止')
          : h('button', { class: 'undo', onclick: async () => { try { await api.saveRule(r.id, { ...r, is_active: true }); reload(); } catch (e) { toast(errMsg(e), 'err'); } } }, '再開'));
    });
    body.replaceChildren(h('button', { class: 'btn big', style: 'width:100%', onclick: () => ruleModal(null, reload) }, '＋ 定期費用を追加'),
      h('p', { class: 'hint' }, '設定した日数前から、ホームに「記録する／とばす」が出ます。アプリを開いたときに出るお知らせで、自動でお金は動きません。'),
      ...(rows.length ? rows : [h('p', { class: 'empty' }, 'まだ登録がありません。')]));
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, recurringView)); }
}

function saveTplModal(init, done) {
  const label = h('input', { type: 'text', placeholder: '例: 駐車場代', autocomplete: 'off', value: init.label || (init.category_id ? ((state.cats.find(c => c.id === init.category_id) || {}).name || '') : '') });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const ok = h('button', { class: 'btn big', onclick: async () => {
    if (!label.value.trim()) { msg.textContent = '名前を入れてください'; return; }
    ok.disabled = true;
    try { await api.saveTemplate(init.id, { ...init, label: label.value.trim() }); m.close(); toast('テンプレートに保存しました', 'ok'); if (done) done(); }
    catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '保存する');
  const m = modal([h('h3', {}, 'テンプレートに保存'), h('p', { class: 'muted' }, `${init.kind === 'income' ? '収入' : '支出'} ・ ${init.amount ? yen(init.amount) : '金額なし'}` + (init.memo ? ' ・ ' + init.memo : '')), field('ボタンの名前', label), msg, ok]);
}

async function templatesView() {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('⭐ テンプレート', body, '#/manage'));
  try {
    const ts = await api.templates();
    if (my !== renderId) return;
    const reload = () => templatesView();
    const rows = ts.map(t => h('div', { class: 'lrow' },
      h('span', { class: 'lico' }, t.kind === 'income' ? '💰' : '💸'),
      h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, t.label), h('div', { class: 'lsub' }, [(state.cats.find(c => c.id === t.category_id) || {}).name, t.amount ? yen(t.amount) : '', t.payer_id ? nameOf(t.payer_id) + 'が立替' : ''].filter(Boolean).join(' · ') || ' ')),
      h('button', { class: 'undo', onclick: () => saveTplModal({ ...t }, reload) }, '名前'),
      h('button', { class: 'undo', onclick: async () => { if (await confirmBox('削除する？', t.label, '削除する')) { try { await api.removeTemplate(t.id); reload(); } catch (e) { toast(errMsg(e), 'err'); } } } }, '削除')));
    body.replaceChildren(h('p', { class: 'hint' }, '「お金が入った」「お金を使った」の入力画面で、内容を入れたあとに「⭐ テンプレートに保存」を押すと、ここに増えます。'),
      ...(rows.length ? rows : [h('p', { class: 'empty' }, 'まだテンプレートがありません。')]));
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, templatesView)); }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const csvCell = v => { const t = v == null ? '' : String(v); return /[",\n\r]/.test(t) ? '"' + t.replaceAll('"', '""') + '"' : t; };

function backupView() {
  ++renderId;
  const lb = lastBackup(); const d = daysSince(lb);
  const st = h('p', { class: 'hint' }, ''); const msg = h('p', { class: 'form-err', role: 'alert' });
  const run = async mode => {
    msg.textContent = ''; st.textContent = '読み込み中…';
    try {
      const all = await api.exportAll(t => { st.textContent = '読み込み中… ' + t; });
      const stamp = ymd().replaceAll('-', '');
      if (mode === 'json') download(`withi-money-backup-${stamp}.json`, JSON.stringify(all), 'application/json');
      else {
        const rows = all.tables.ledger_entries || []; const cols = ['occurred_on', 'kind', 'amount', 'category_id', 'memo', 'payer_id', 'party_id', 'live_id', 'source', 'is_historical', 'reverses_id', 'created_at'];
        const cn = new Map((all.tables.categories || []).map(c => [c.id, c.name])); const pn = new Map((all.tables.people || []).map(p => [p.id, p.name]));
        const head = ['日付', '種類', '金額', 'カテゴリ', 'メモ', '立替者', '相手', 'ライブID', '元', '過去データ', '取消の対象', '記録日時'];
        const body = rows.map(r => cols.map(c => csvCell(c === 'category_id' ? cn.get(r[c]) : (c === 'payer_id' || c === 'party_id') ? pn.get(r[c]) : r[c])).join(','));
        download(`withi-money-ledger-${stamp}.csv`, '﻿' + [head.join(','), ...body].join('\n'), 'text/csv');
      }
      try { localStorage.setItem('withi_last_backup', new Date().toISOString()); } catch { /* 記録できなくても続行 */ }
      st.textContent = '✅ ダウンロードしました。ファイルは「ファイル」アプリなどに保存されます。Googleドライブなど、スマホ以外の場所にも置いておくと安心です。';
    } catch (e) { st.textContent = ''; msg.textContent = errMsg(e); }
  };
  $app.replaceChildren(shell('💾 バックアップ', h('div', {},
    h('section', { class: 'card' }, h('div', { class: 'cap' }, '最後に作った日'), h('b', {}, lb ? `${dshow(lb)}（${d}日前）` : 'まだ作っていません'),
      h('p', { class: 'hint' }, 'すべての記録(お金・ライブ・商品・在庫・Airレジ・定期費用など)を1つのファイルにまとめます。月に1回くらい作るのがおすすめです。')),
    h('button', { class: 'btn big', style: 'width:100%', onclick: () => run('json') }, '💾 すべてのデータをダウンロード (JSON)'),
    h('button', { class: 'btn ghost', style: 'width:100%;margin-top:10px', onclick: () => run('csv') }, '📄 お金の記録だけをCSVで (Excel等で開けます)'),
    st, msg), '#/manage'));
}

// ---------- ルーター ----------
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/home';
  const [path, q] = raw.split('?');
  return { path, q: new URLSearchParams(q || '') };
}
async function route() {
  const { path, q } = parseHash();
  if (!api.isLoggedIn() && !DEMO) { if (path !== '/login') { location.hash = '#/login'; return; } return loginView(); }
  if (path === '/login') { location.hash = '#/home'; return; }
  if (!state.people.length) { try { await boot(); } catch (e) { $app.replaceChildren(h('div', { class: 'screen' }, errorBox(e, route))); return; } }
  if (!state.by || !state.people.some(p => p.id === state.by)) { state.by = ''; await pickBy(true); }
  window.scrollTo(0, 0);
  // BASEで許可したあと戻ってきたとき(?code=…&state=…)は、ここでトークンに換えてBASE連携画面へ
  { const sp = new URLSearchParams(location.search);
    if (sp.get('state') && (sp.get('code') || sp.get('error'))) {
      const code = sp.get('code'); const st = sp.get('state');
      history.replaceState(null, '', location.pathname + '#/base');
      if (!code) { toast('BASEでの許可がキャンセルされました', 'err'); return baseView(); }
      try { await api.baseSync('exchange', { code, state: st }); toast('BASEにつなぎました', 'ok'); }
      catch (e) { toast(errMsg(e), 'err'); }
      return baseView();
    } }
  { const sp = new URLSearchParams(location.search); const xx = sp.get('x');
    if (xx) { history.replaceState(null, '', location.pathname + location.hash);
      const XM = { ok: ['Xと連携できました', 'ok'], denied: ['Xでの許可がキャンセルされました', 'err'], expired: ['連携の有効時間が切れました。もう一度「Xと連携する」を押してください', 'err'], norefresh: ['Xから連携用の情報を受け取れませんでした。もう一度お試しください', 'err'] };
      const m3 = XM[xx] || ['Xとの連携でエラーが発生しました', 'err']; toast(m3[0], m3[1]); } }
  { const sp = new URLSearchParams(location.search); const ig = sp.get('ig');
    if (ig) { history.replaceState(null, '', location.pathname + location.hash);
      const IM = { ok: ['Instagramと連携できました', 'ok'], denied: ['Instagramでの許可がキャンセルされました', 'err'], expired: ['連携の有効時間が切れました。もう一度「Instagramと連携する」を押してください', 'err'], norefresh: ['Instagramから連携用の情報を受け取れませんでした。もう一度お試しください', 'err'] };
      const m4 = IM[ig] || ['Instagramとの連携でエラーが発生しました', 'err']; toast(m4[0], m4[1]); } }
  { const sp = new URLSearchParams(location.search); const gg = sp.get('google');
    if (gg) { history.replaceState(null, '', location.pathname + location.hash);
      const GM = { ok: ['Googleと連携できました', 'ok'], denied: ['Googleでの許可がキャンセルされました', 'err'], expired: ['連携の有効時間が切れました。もう一度「Googleと連携する」を押してください', 'err'], norefresh: ['Googleから連携用の情報を受け取れませんでした。もう一度お試しください', 'err'] };
      const m2 = GM[gg] || ['Googleとの連携でエラーが発生しました', 'err']; toast(m2[0], m2[1]); } }
  if (path === '/sale') return saleView(q.get('ch') === 'direct' ? 'direct' : 'base');
  if (path === '/in') return moneyView(true, q.get('plain') === '1');
  if (path === '/out') return moneyView(false);
  if (path === '/loan') return loanView(q.get('mode') || 'loan');
  if (path === '/history') return historyView();
  if (path === '/manage') return manageView();
  if (path === '/analysis') return analysisView();
  if (path === '/recurring') return recurringView();
  if (path === '/templates') return templatesView();
  if (path === '/backup') return backupView();
  if (path === '/air') return airView();
  if (path === '/base') return baseView(q);
  if (path === '/live-list') return liveListView();
  if (path === '/live-form') return liveFormView(q.get('id') || '');
  if (path === '/songs') return songsView();
  if (path === '/live') return liveView(q.get('id'));
  if (path === '/live-sale') return saleView('live', q.get('id'));
  if (path === '/merch') return merchView();
  if (path === '/product') return productView(q.get('id'));
  return homeView();
}
async function boot() {
  try {
    [state.people, state.cats] = await Promise.all([api.people(), api.categories()]);
    try { localStorage.setItem('withi_cache_pc', JSON.stringify({ p: state.people, c: state.cats })); } catch { /* 無くても動く */ }
  } catch (e) {
    let c = null; try { c = JSON.parse(localStorage.getItem('withi_cache_pc')); } catch { /* なし */ }
    if (e && e.code === 'net' && c && c.p && c.c) { state.people = c.p; state.cats = c.c; } else throw e;
  }
  try { state.rating = await api.liveRating(); } catch { /* 既定値を使う */ }
}
window.addEventListener('hashchange', route);
window.addEventListener('online', () => { flushQueue().then(r => { if (r.sent) toast(`保存待ちの${r.sent}件を送りました`, 'ok'); }).catch(() => {}); });
flushQueue().catch(() => {});
route(); // module script は DOM 構築後に実行される

if ('serviceWorker' in navigator && !DEMO && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
