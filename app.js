// Wiθ MONEY — 画面
import { api, DEMO, ApiError, ymd, queued, flushQueue } from './api.js?v=17';
import { decodeCsv, sha256, parseAir, keyOf, autoMatch } from './air.js?v=17';

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
      h('h3', {}, title), h('p', { class: 'muted' }, body),
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
function openMenu() {
  const m = modal([
    h('h3', {}, 'メニュー'),
    h('p', { class: 'muted' }, '入力者: ' + (nameOf(state.by) || '未選択')),
    h('button', { class: 'btn', onclick: () => { m.close(); pickBy(false); } }, '入力者を変える'),
    DEMO ? h('p', { class: 'muted' }, 'デモ表示中（架空のデータ・保存されません）') :
      h('button', { class: 'btn ghost', onclick: () => { api.logout(); m.close(); location.hash = '#/login'; } }, 'ログアウト'),
    h('p', { class: 'ver' }, 'Wiθ MONEY  Phase 3  ・ 版 10/08-17'),
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
  } }, h('div', { class: 'logo' }, 'Wiθ', h('span', {}, 'MONEY')), field('メール', email), field('パスコード', pass), msg, btn);
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
    const dueRules = rules.filter(r => r.is_active && String(r.next_due).slice(0, 10) <= ymd());
    const pend = queued();
    const bd = DEMO ? 0 : daysSince(lastBackup());
    const payable = d.balances.reduce((s, b) => s + b.withi_owes, 0);
    const recv = d.balances.reduce((s, b) => s + b.owes_withi, 0);
    const btn = (cls, ico, label, href, sub) => h(href ? 'a' : 'div', { class: 'qa ' + cls + (href ? '' : ' soon'), href }, h('span', { class: 'qa-ico' }, ico), h('span', { class: 'qa-label' }, label), sub ? h('span', { class: 'qa-sub' }, sub) : null);
    body.replaceChildren(
      pend.length ? h('section', { class: 'card', style: 'border-color:var(--yellow)' }, h('div', { class: 'cap' }, `⏳ 未送信の記録 ${pend.length}件`),
        h('p', { class: 'hint' }, '電波がなかったため、スマホに一時保存しています。つながると自動で送ります。'),
        h('button', { class: 'btn small', onclick: async () => { const r = await flushQueue(); toast(r.left ? `${r.sent}件送りました。残り${r.left}件` : '送りました', r.left ? 'err' : 'ok'); homeView(); } }, '今すぐ送る')) : null,
      dueRules.length ? h('section', { class: 'card', style: 'border-color:var(--pink)' }, h('div', { class: 'cap' }, `🔁 定期費用の支払い日です(${dueRules.length}件)`),
        ...dueRules.slice(0, 5).map(r => h('div', { class: 'brow' }, h('span', {}, `${r.name} ${yen(r.amount)}`, h('small', { style: 'display:block;color:var(--muted)' }, dshow(r.next_due) + (r.payer ? ' ・' + r.payer.name + 'が立替' : ''))),
          h('span', {}, h('button', { class: 'undo', onclick: async () => { if (!state.by) { await pickBy(true); if (!state.by) return; } try { await api.postRecurring({ rule: r.id, date: String(r.next_due).slice(0, 10), skip: false, by: state.by }); getFx('−' + yen(r.amount), r.payer ? '立替を記録' : 'PAID'); homeView(); } catch (e) { toast(errMsg(e), 'err'); } } }, '記録する'),
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
  const payers = [{ id: '', label: 'Wiθ資金' }, ...state.people.filter(p => p.can_pay).map(p => ({ id: p.id, label: p.name }))];
  const setHint = () => { payerHint.textContent = f.payer ? `立替: Wiθの資金は減らず、${nameOf(f.payer)}への未払い（返す義務）になります。精算ステータスは「未精算」から始まります。` : 'Wiθの資金から支払います。資金が減ります。'; };
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
  const form = h('form', { class: 'form', onsubmit: async ev => {
    ev.preventDefault(); msg.textContent = '';
    const a = amt.get();
    if (!f.cat) { msg.textContent = 'カテゴリを選んでください'; return; }
    if (!(a > 0)) { msg.textContent = '金額を入れてください'; return; }
    if (!state.by) { await pickBy(true); if (!state.by) return; }
    submit.disabled = true;
    try {
      const res = await api.addEntry({ date: date.value, kind: isIn ? 'income' : (f.payer ? 'expense_advanced' : 'expense_fund'), amount: a, category_id: f.cat, memo: memo.value.trim(), payer_id: isIn ? null : (f.payer || null), by: state.by });
      if (usedTpl) api.useTemplate(usedTpl.id, usedTpl.use_count || 0);
      if (res && res.queued) toast('電波がないため、保存待ちにしました。つながると自動で送ります', 'ok');
      else getFx(isIn ? `+${yen(a)}` : `−${yen(a)}`, isIn ? 'MONEY GET!' : (f.payer ? '立替を記録' : 'PAID'));
      location.hash = '#/home';
    } catch (e) { msg.textContent = errMsg(e); submit.disabled = false; }
  } },
  tplBox,
  field(isIn ? 'どこから？' : 'なにに？', catChips),
  isIn && !plain ? h('p', { class: 'hint' }, 'BASE・物販(個別販売)を選ぶと、商品と在庫つきで記録する画面に進みます。') : null,
  field('金額', amt.el), field('内容', memo), field('日付', date),
  isIn ? null : h('div', { class: 'field' }, h('span', { class: 'field-label' }, '誰が払った？'), payerChips, payerHint),
  msg, submit,
  h('button', { type: 'button', class: 'btn ghost', style: 'width:100%', onclick: () => saveTplModal({ kind: isIn ? 'income' : 'expense', category_id: f.cat, amount: amt.get(), memo: memo.value.trim(), payer_id: f.payer }) }, '⭐ この内容をテンプレートに保存'));
  $app.replaceChildren(shell(isIn ? '💰 お金が入った' : '💸 お金を使った', form));
}

// ---------- 貸借 ----------
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
  const cand = d.balances.filter(b => M.pick(b));
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
  cand.length ? field('相手', chips(cand.map(b => ({ id: b.person_id, label: b.name, sub: M.sub(b) })), '', id => { f.party = id; }))
    : h('p', { class: 'empty' }, mode === 'offset' ? '借入と未払いの両方がある人がいません。' : '対象の人がいません。'),
  field('金額', h('div', { class: 'with-btn' }, amt.el, M.max ? maxBtn : null)), field('内容', memo), field('日付', date), msg, submit);
  body.replaceChildren(form);
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
    const rows = await api.ledger(limit);
    if (my !== renderId) return;
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
            r.is_historical ? h('i', { class: 'tag dead' }, '過去データ') : null,
            r.review_flag ? h('i', { class: 'tag mid' }, '要確認') : null,
            r.reversed ? h('i', { class: 'tag dead' }, '取消済み') : null, isRev ? h('i', { class: 'tag dead' }, '取消の行') : null)),
        h('div', { class: 'lamt ' + (sg > 0 ? 'pos' : sg < 0 ? 'neg' : '') }, (sg > 0 ? '+' : sg < 0 ? '−' : '') + yen(r.amount).replace('−', '')),
        canRev ? h('button', { class: 'undo', 'aria-label': 'この記録を取り消す', onclick: async () => {
          const ok = await confirmBox('この記録を取り消す？', `${r.occurred_on.replaceAll('-', '/')}  ${r.memo || label}  ${yen(r.amount)}\n` + (r.merch_order_id ? 'この売上に関する記録(売上・手数料・STS取り分)と在庫が、まとめて元に戻ります。' : r.is_historical ? '過去データの取り消しです。元の行は消さず、打ち消しの行が追加されます。資金や貸借には影響しません(損益の集計だけが戻ります)。' : '元の行は消さず、打ち消しの行が追加されます。'), '取り消す');
          if (!ok) return;
          try { await api.reverse(r.id, state.by); toast('取り消しました', 'ok'); historyView(); } catch (e) { toast(errMsg(e), 'err'); }
        } }, '取消') : null));
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
          h('span', { class: 'lico' }, '👕'),
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
  let mode = 'receive';
  const n = intField(null, '0'); const memo = h('input', { type: 'text', placeholder: '例: 追加納品 / 数え直し', autocomplete: 'off' });
  const date = h('input', { type: 'date', value: ymd() });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const eff = h('p', { class: 'effect' }, '');
  const calc = () => {
    const x = numOrNull(n); if (x == null) return null;
    return mode === 'receive' ? x : mode === 'less' ? -x : x - v.stock;
  };
  const upd = () => { const d = calc(); eff.textContent = `いまの在庫 ${v.stock}点` + (d == null ? '' : ` → ${v.stock + d}点(${d >= 0 ? '+' : ''}${d})`); };
  n.addEventListener('input', upd);
  const ok = h('button', { class: 'btn big', onclick: async () => {
    msg.textContent = ''; const d = calc();
    if (d == null) { msg.textContent = '数を入れてください'; return; }
    if (d === 0) { msg.textContent = '変わる数がありません'; return; }
    if (v.stock + d < 0) { msg.textContent = '在庫がマイナスになります。数を確認してください'; return; }
    if (!state.by) { await pickBy(true); if (!state.by) return; }
    ok.disabled = true;
    try { await api.stockMove({ variant_id: v.id, qty: d, reason: mode === 'receive' ? 'receive' : 'adjust', date: date.value, memo: memo.value.trim() || (mode === 'count' ? '棚卸し' : ''), by: state.by }); m.close(); toast('在庫を更新しました', 'ok'); done(); }
    catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '記録する');
  const hist = h('div', { class: 'hint' }, '');
  api.stockHistory(v.id).then(rows => { if (rows.length) hist.textContent = '最近: ' + rows.slice(0, 4).map(r => `${r.occurred_on.slice(5).replace('-', '/')} ${r.qty > 0 ? '+' : ''}${r.qty}`).join(' / '); }).catch(() => {});
  const m = modal([h('h3', {}, p.name + '  ' + vLabel(v)),
    chips(Object.entries(STOCK_MODES).map(([id, label]) => ({ id, label })), mode, id => { mode = id; upd(); }),
    eff, field(mode === 'count' ? '数えた数' : '数', n), field('メモ', memo), field('日付', date), hist, msg, ok]);
  upd();
}


// ---------- 物販の売上(BASE・個別販売) ----------
async function saleView(channel) {
  const my = ++renderId;
  const isBase = channel === 'base';
  const body = h('div', {}, loading());
  $app.replaceChildren(shell(isBase ? '🛒 BASEの売上' : '🤝 物販(個別販売)', body, '#/in'));
  let products;
  try { products = (await api.products()).filter(p => p.is_active); } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, () => saleView(channel))); return; }
  if (my !== renderId) return;
  const lines = []; // {v, p, qty, price}
  let receivedTouched = false;
  const received = amountField();
  const memo = h('input', { type: 'text', placeholder: isBase ? '例: 10/5入金分' : '例: ジミーさん 手売り', autocomplete: 'off' });
  const date = h('input', { type: 'date', value: ymd() });
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
      await api.merchSale({ channel, date: date.value, lines: lines.map(l => ({ variant_id: l.v.id, qty: l.qty, unit_price: l.price })), received: r, memo: memo.value.trim(), by: state.by });
      getFx(r > 0 ? `+${yen(r)}` : '0円', r > 0 ? 'MONEY GET!' : 'GIFT');
      location.hash = '#/home';
    } catch (e) { msg.textContent = errMsg(e); submit.disabled = false; }
  });
  body.replaceChildren(h('div', { class: 'form' },
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
    h('a', { class: 'hint', href: '#/in?plain=1' }, '商品を選ばず金額だけ記録する'),
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
      h('button', { class: 'btn big in', style: 'width:100%', onclick: () => liveModal(null, id => { location.hash = '#/live?id=' + id; }) }, '＋ ライブを登録'),
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

function liveEntryModal(live, isIn, done, entry) {
  const cats = state.cats.filter(c => c.group_name === live.kind && c.flow === (isIn ? 'income' : 'expense'));
  const f = { cat: entry ? entry.category_id || '' : '', payer: entry && entry.kind === 'expense_advanced' ? entry.payer_id || '' : '' };
  const amt = amountField(entry ? entry.amount : 0); const memo = h('input', { type: 'text', placeholder: isIn ? '例: ギャラ' : '例: 駐車場代', autocomplete: 'off', value: entry ? entry.memo || '' : '' });
  const date = h('input', { type: 'date', value: String(entry ? entry.occurred_on : live.live_date).slice(0, 10) });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const payers = [{ id: '', label: 'Wiθ資金' }, ...state.people.filter(p => p.can_pay).map(p => ({ id: p.id, label: p.name }))];
  const hint = h('span', { class: 'hint' }, f.payer ? `立替: 資金は減らず、${nameOf(f.payer)}への未払いになります。` : 'Wiθの資金から支払います。資金が減ります。');
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
      await api.addEntry({ date: date.value, kind: isIn ? 'income' : (f.payer ? 'expense_advanced' : 'expense_fund'), amount: a, category_id: f.cat, memo: memo.value.trim(), payer_id: isIn ? null : (f.payer || null), live_id: live.id, by: state.by });
      m.close(); getFx(isIn ? `+${yen(a)}` : `−${yen(a)}`, isIn ? 'MONEY GET!' : (f.payer ? '立替を記録' : 'PAID')); done();
    } catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '記録する');
  const m = modal([h('h3', {}, (entry ? '✏️ 修正: ' : '') + (isIn ? '💰 収入 ' : '💸 支出 ') + '— ' + live.event_name),
    entry ? h('p', { class: 'muted' }, '元の記録は「取消済み」として残り、直した内容が新しく追加されます。') : null,
    field(isIn ? 'どこから？' : 'なにに？', chips(cats.map(c => ({ id: c.id, label: c.name })), f.cat, id => { f.cat = id; })),
    field('金額', amt.el), field('内容', memo), field('日付', date),
    isIn ? null : h('div', { class: 'field' }, h('span', { class: 'field-label' }, '誰が払った？'), chips(payers, f.payer, id => { f.payer = id; hint.textContent = id ? `立替: 資金は減らず、${nameOf(id)}への未払いになります。` : 'Wiθの資金から支払います。資金が減ります。'; }), hint),
    msg, ok]);
}

async function liveView(id) {
  const my = ++renderId;
  const body = h('div', {}, loading());
  $app.replaceChildren(shell('🎸 ライブ', body, '#/live-list'));
  try {
    const [lives, entries, abs, ast] = await Promise.all([api.lives(), api.liveEntries(id), api.airBaskets().catch(() => []), api.liveAirStatus(id).catch(() => null)]);
    if (my !== renderId) return;
    const l = lives.find(x => x.id === id);
    if (!l) { body.replaceChildren(h('p', { class: 'empty' }, 'ライブが見つかりません。')); return; }
    const reload = () => liveView(id);
    const conf = l.status === 'confirmed';
    const [ico, lab] = rating(l.profit);
    const rows = entries.map(r => {
      const isRev = !!r.reverses_id; const inc = r.kind === 'income';
      const sg = isRev ? (inc ? -1 : 1) : (inc ? 1 : -1);
      const canRev = !isRev && !r.reversed && !conf;
      const canEdit = canRev && !r.merch_order_id && ['income', 'expense_fund', 'expense_advanced'].includes(r.kind);
      return h('div', { class: 'lrow' + (r.reversed || isRev ? ' dead' : '') },
        h('span', { class: 'lico' }, inc ? '💰' : '💸'),
        h('div', { class: 'lmain' }, h('div', { class: 'lmemo' }, r.memo || r.category_name || ''),
          h('div', { class: 'lsub' }, [r.category_name, r.kind === 'expense_advanced' && r.payer_name ? r.payer_name + 'が立替' : ''].filter(Boolean).join(' · ') || ' '),
          h('div', { class: 'ltags' }, r.reversed ? h('i', { class: 'tag dead' }, '取消済み') : null, isRev ? h('i', { class: 'tag dead' }, '取消の行') : null)),
        h('div', { class: 'lamt ' + (sg > 0 ? 'pos' : 'neg') }, (sg > 0 ? '+' : '−') + yen(r.amount).replace('−', '')),
        canEdit ? h('button', { class: 'undo', onclick: () => liveEntryModal(l, r.kind === 'income', reload, r) }, '編集') : null,
        canRev ? h('button', { class: 'undo', onclick: async () => {
          const ok = await confirmBox('この記録を取り消す？', `${r.memo || r.category_name}  ${yen(r.amount)}\n元の行は消さず、打ち消しの行が追加されます。`, '取り消す');
          if (!ok) return;
          try { await api.reverse(r.id, state.by); toast('取り消しました', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
        } }, '取消') : null);
    });
    const head = h('section', { class: 'card' },
      h('div', { class: 'lmemo' }, l.event_name),
      h('div', { class: 'lsub' }, [dshow(l.live_date), l.venue_name, l.prefecture].filter(Boolean).join(' · ')),
      h('div', { class: 'ltags' }, h('i', { class: 'tag ' + (l.kind === 'host' ? 'pay' : 'recv') }, liveKind(l.kind)), conf ? h('i', { class: 'tag ok' }, '確定') : h('i', { class: 'tag mid' }, '下書き')),
      h('div', { class: 'cap', style: 'margin-top:12px' }, '🎯 LIVE PROFIT'),
      h('div', { class: 'big' + (l.profit < 0 ? ' neg' : '') }, yen(l.profit)),
      h('div', { class: 'trio' }, h('div', {}, h('small', {}, '収入'), h('b', { class: 'pos' }, yen(l.income))), h('div', {}, h('small', {}, '支出'), h('b', { class: 'neg' }, yen(l.expense))), h('div', {}, h('small', {}, '評価'), h('b', {}, ico + ' ' + lab))),
      l.memo ? h('p', { class: 'hint' }, l.memo) : null,
      conf ? null : h('button', { class: 'btn small', style: 'margin-top:10px', onclick: () => liveModal(l, reload) }, 'ライブの情報を編集'));
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
    const upBox = h('div', {}); const upIn = h('input', { type: 'file', accept: '.csv,text/csv', style: 'display:none' });
    upIn.addEventListener('change', async () => {
      const f = upIn.files[0]; if (!f) return; upBox.replaceChildren(loading());
      try { await airPreview(f, upBox, abs, reload, { date: String(l.live_date).slice(0, 10), liveId: l.id }); } catch (e) { upBox.replaceChildren(h('p', { class: 'form-err' }, errMsg(e))); }
      upIn.value = '';
    });
    const upCard = conf ? null : h('section', { class: 'card' }, h('div', { class: 'cap' }, '📥 Airレジの売上CSV'),
      h('p', { class: 'hint' }, `このライブの日(${dshow(l.live_date)})の物販売上を、AirレジのCSVから読み込みます。`),
      h('button', { class: 'btn' + (myAb.length ? ' ghost' : ' big'), style: 'width:100%', onclick: () => upIn.click() }, myAb.length ? '📂 CSVを選び直す' : '📂 CSVを選んで物販売上を出す'), upIn, upBox);
    const unsettled = entries.some(r => r.kind === 'expense_advanced' && !r.reversed && !r.reverses_id);
    body.replaceChildren(head,
      conf ? h('p', { class: 'hint' }, '確定済みです。記録を足したり取り消したりするには、先に「確定を解除」してください。') : h('div', { class: 'duo' },
        h('button', { class: 'btn in', onclick: () => liveEntryModal(l, true, reload) }, '💰 収入を追加'),
        h('button', { class: 'btn out', onclick: () => liveEntryModal(l, false, reload) }, '💸 支出を追加')),
      upCard, airCard,
      h('div', { class: 'cap sec' }, 'このライブのお金'),
      ...(rows.length ? rows : [h('p', { class: 'empty' }, 'まだ記録がありません。')]),
      unsettled ? h('p', { class: 'hint' }, '立替の返済は、ホームの「立替を返す・相殺」から行います。') : null,
      h('button', { class: 'btn ' + (conf ? 'ghost' : 'big'), style: 'width:100%;margin-top:14px', onclick: async () => {
        if (!state.by) { await pickBy(true); if (!state.by) return; }
        const okk = await confirmBox(conf ? '確定を解除する？' : 'このライブを確定する？', conf ? '記録を足したり取り消したりできるようになります。' : `LIVE PROFIT ${yen(l.profit)} で確定します。確定中は記録の追加・取消ができません(いつでも解除できます)。`, conf ? '解除する' : '確定する');
        if (!okk) return;
        try { await api.setLiveStatus(id, { confirm: !conf, by: state.by, score: { profit: l.profit, income: l.income, expense: l.expense, rating: lab, merch_sales: airSales, baskets: myAb.length, avg_basket: myAb.length ? Math.round(airSales / myAb.length) : 0 } }); toast(conf ? '確定を解除しました' : '確定しました', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
      } }, conf ? '確定を解除' : '✅ このライブを確定する'));
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, () => liveView(id))); }
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
  let others = 0;
  if (opt.date) { // ライブから取り込むときは、そのライブの日の会計だけを使う
    others = parsed.baskets.filter(b => b.sale_date !== opt.date).length;
    parsed.baskets = parsed.baskets.filter(b => b.sale_date === opt.date);
    hash += ':' + opt.date;
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
      if (opt.liveId) await api.airLink(opt.date, opt.liveId, state.by);
      toast(`${r.new}会計を取り込みました(在庫を動かした行 ${r.stock_lines})`, 'ok'); reload();
    } catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '取り込む');
  const unm = [...items.values()].filter(it => !it.vid).length;
  box.replaceChildren(h('section', { class: 'card' },
    h('div', { class: 'cap' }, '内容の確認: ' + file.name),
    h('div', { class: 'trio' }, h('div', {}, h('small', {}, '新しい会計'), h('b', {}, fresh.length)), h('div', {}, h('small', {}, '取り込み済み'), h('b', {}, parsed.baskets.length - fresh.length)), h('div', {}, h('small', {}, '売上'), h('b', { class: 'pos' }, yen(total)))),
    unm ? h('p', { class: 'hint' }, `商品マスタと照合できなかった品目が ${unm} 件あります。選ばなければ、売上の記録だけで在庫は動きません。`) : h('p', { class: 'hint' }, 'すべての品目を商品に対応づけました。'),
    h('p', { class: 'hint' }, '同じ種類の品目は1回選べば、次回から覚えます。'),
    others ? h('p', { class: 'hint' }, `ファイルには他の日の会計も ${others} 件ありますが、このライブの日の分だけを使います。`) : null,
    ...itemRows, msg, fresh.length ? ok : h('div', {}, h('p', { class: 'hint' }, 'この日の会計は、すべて取り込み済みです。'),
      opt.liveId ? h('button', { class: 'btn', onclick: async () => { try { await api.airLink(opt.date, opt.liveId, state.by); toast('このライブにひも付けました', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'err'); } } }, 'この日の会計をこのライブにひも付ける') : null)));
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
    row('📥', 'Airレジ売上(月ごとにまとめて取り込む)', 'ふだんはライブの画面から取り込めます。日ごとのひも付けの確認はここ', '#/air'),
    row('💾', 'バックアップ', lb ? `最後に作った日: ${dshow(lb)}（${d}日前）` : 'まだ作っていません', '#/backup'))));
}

function ruleModal(rule, done) {
  const cats = state.cats.filter(c => c.group_name === 'general' && c.flow === 'expense' && c.name !== 'STS取り分');
  const f = { cat: rule ? rule.category_id || '' : '', payer: rule ? rule.payer_id || '' : '', unit: rule ? rule.unit : 'month' };
  const name = h('input', { type: 'text', placeholder: '例: Spotify・ドメイン代', autocomplete: 'off', value: rule ? rule.name : '' });
  const amt = amountField(rule ? rule.amount : 0); const every = intField(rule ? rule.every_n : 1, '1');
  const due = h('input', { type: 'date', value: rule ? String(rule.next_due).slice(0, 10) : ymd() });
  const msg = h('p', { class: 'form-err', role: 'alert' });
  const payers = [{ id: '', label: 'Wiθ資金' }, ...state.people.filter(p => p.can_pay).map(p => ({ id: p.id, label: p.name }))];
  const ok = h('button', { class: 'btn big', onclick: async () => {
    msg.textContent = ''; const n = numOrNull(every);
    if (!name.value.trim()) { msg.textContent = '名前を入れてください'; return; }
    if (!(amt.get() > 0)) { msg.textContent = '金額を入れてください'; return; }
    if (!(n >= 1)) { msg.textContent = '間隔は1以上にしてください'; return; }
    if (!due.value) { msg.textContent = '次の支払日を入れてください'; return; }
    ok.disabled = true;
    try { await api.saveRule(rule && rule.id, { name: name.value.trim(), every_n: n, unit: f.unit, next_due: due.value, amount: amt.get(), category_id: f.cat, payer_id: f.payer, is_active: true }); m.close(); toast('保存しました', 'ok'); done(); }
    catch (e) { msg.textContent = errMsg(e); ok.disabled = false; }
  } }, '保存する');
  const m = modal([h('h3', {}, rule ? '定期費用を編集' : '定期費用を追加'), field('名前', name),
    field('なにに？', chips(cats.map(c => ({ id: c.id, label: c.name })), f.cat, id => { f.cat = id; })),
    field('金額', amt.el),
    field('くり返し', chips([{ id: 'month', label: 'ヶ月ごと' }, { id: 'year', label: '年ごと' }], f.unit, id => { f.unit = id; })), field('間隔(数)', every, '例: 毎月なら「ヶ月ごと」で1、半年ごとなら6'),
    field('次の支払日', due), h('div', { class: 'field' }, h('span', { class: 'field-label' }, '誰が払う？'), chips(payers, f.payer, id => { f.payer = id; })), msg, ok]);
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
          h('div', { class: 'ltags' }, h('i', { class: 'tag ' + (over ? 'pay' : 'recv') }, '次: ' + dshow(due)), !r.is_active ? h('i', { class: 'tag dead' }, '停止中') : null)),
        h('div', { class: 'lamt neg' }, yen(r.amount)),
        h('button', { class: 'undo', onclick: () => ruleModal(r, reload) }, '編集'),
        r.is_active ? h('button', { class: 'undo', onclick: async () => { if (await confirmBox('停止する？', `${r.name} を停止します。(これまでの記録は残ります)`, '停止する')) { try { await api.saveRule(r.id, { ...r, category_id: r.category_id, is_active: false }); reload(); } catch (e) { toast(errMsg(e), 'err'); } } } }, '停止')
          : h('button', { class: 'undo', onclick: async () => { try { await api.saveRule(r.id, { ...r, is_active: true }); reload(); } catch (e) { toast(errMsg(e), 'err'); } } }, '再開'));
    });
    body.replaceChildren(h('button', { class: 'btn big', style: 'width:100%', onclick: () => ruleModal(null, reload) }, '＋ 定期費用を追加'),
      h('p', { class: 'hint' }, '支払日が来ると、ホームに「記録する／今回はとばす」が出ます。自動でお金は動かしません。'),
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
  if (path === '/live-list') return liveListView();
  if (path === '/live') return liveView(q.get('id'));
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
