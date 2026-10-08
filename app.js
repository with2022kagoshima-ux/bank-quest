// Wiθ MONEY — 画面
import { api, DEMO, ApiError, ymd } from './api.js';

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
  return wrap;
}
function amountField(init) {
  const input = h('input', { class: 'amount', inputmode: 'numeric', autocomplete: 'off', placeholder: '0', 'aria-label': '金額(円)' });
  const fmt = () => { const d = input.value.replace(/[^0-9]/g, ''); input.value = d ? Number(d).toLocaleString('ja-JP') : ''; };
  input.addEventListener('input', fmt);
  if (init) { input.value = String(init); fmt(); }
  return { el: h('div', { class: 'amount-wrap' }, h('span', { class: 'yen' }, '¥'), input), get: () => Number(input.value.replace(/[^0-9]/g, '')), set: v => { input.value = String(v); fmt(); } };
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
    h('p', { class: 'ver' }, 'Wiθ MONEY  Phase 3'),
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
    const payable = d.balances.reduce((s, b) => s + b.withi_owes, 0);
    const recv = d.balances.reduce((s, b) => s + b.owes_withi, 0);
    const btn = (cls, ico, label, href, sub) => h(href ? 'a' : 'div', { class: 'qa ' + cls + (href ? '' : ' soon'), href }, h('span', { class: 'qa-ico' }, ico), h('span', { class: 'qa-label' }, label), sub ? h('span', { class: 'qa-sub' }, sub) : null);
    body.replaceChildren(
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
        btn('live', '🎸', 'ライブを登録', null, 'Phase 4で追加'), btn('merch', '👕', '商品・在庫', '#/merch')),
      d.balances.some(b => b.owes_withi || b.withi_owes) ? h('section', { class: 'card' }, h('div', { class: 'cap' }, '👥 メンバーごと'),
        d.balances.filter(b => b.owes_withi || b.withi_owes).map(b => h('div', { class: 'brow' }, h('span', {}, b.name),
          h('span', {}, b.owes_withi ? h('i', { class: 'tag recv' }, '借入 ' + yen(b.owes_withi)) : null, b.withi_owes ? h('i', { class: 'tag pay' }, '未払い ' + yen(b.withi_owes)) : null)))) : null);
  } catch (e) { if (my === renderId) body.replaceChildren(errorBox(e, homeView)); }
}

// ---------- お金が入った / 使った ----------
function moneyView(isIn) {
  ++renderId;
  const cats = state.cats.filter(c => c.group_name === 'general' && c.flow === (isIn ? 'income' : 'expense'));
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
  const form = h('form', { class: 'form', onsubmit: async ev => {
    ev.preventDefault(); msg.textContent = '';
    const a = amt.get();
    if (!f.cat) { msg.textContent = 'カテゴリを選んでください'; return; }
    if (!(a > 0)) { msg.textContent = '金額を入れてください'; return; }
    if (!state.by) { await pickBy(true); if (!state.by) return; }
    submit.disabled = true;
    try {
      await api.addEntry({ date: date.value, kind: isIn ? 'income' : (f.payer ? 'expense_advanced' : 'expense_fund'), amount: a, category_id: f.cat, memo: memo.value.trim(), payer_id: isIn ? null : (f.payer || null), by: state.by });
      getFx(isIn ? `+${yen(a)}` : `−${yen(a)}`, isIn ? 'MONEY GET!' : (f.payer ? '立替を記録' : 'PAID'));
      location.hash = '#/home';
    } catch (e) { msg.textContent = errMsg(e); submit.disabled = false; }
  } },
  field(isIn ? 'どこから？' : 'なにに？', chips(cats.map(c => ({ id: c.id, label: c.name })), '', id => { f.cat = id; })),
  isIn ? h('p', { class: 'hint' }, 'BASE・物販は、商品と在庫の連携を後のフェーズで追加します。今は金額だけ記録します。') : null,
  field('金額', amt.el), field('内容', memo), field('日付', date),
  isIn ? null : h('div', { class: 'field' }, h('span', { class: 'field-label' }, '誰が払った？'), chips(payers, '', id => { f.payer = id; setHint(); }), payerHint),
  msg, submit);
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
      const canRev = r.posting === 'posted' && !isRev && !r.reversed && !r.is_historical;
      list.append(h('div', { class: 'lrow' + (r.reversed || isRev ? ' dead' : '') },
        h('span', { class: 'lico' }, ico),
        h('div', { class: 'lmain' },
          h('div', { class: 'lmemo' }, r.memo || r.category_name || label),
          h('div', { class: 'lsub' }, [r.category_name, who && (r.kind === 'expense_advanced' ? who + 'が立替' : who), (r.memo || r.category_name) ? label : ''].filter(Boolean).join(' · ') || ' '),
          h('div', { class: 'ltags' },
            r.adv ? h('i', { class: 'tag ' + (r.adv.status === '精算済み' ? 'ok' : r.adv.status === '一部精算' ? 'mid' : 'pay') }, r.adv.status) : null,
            r.is_historical ? h('i', { class: 'tag dead' }, '過去データ') : null,
            r.review_flag ? h('i', { class: 'tag mid' }, '要確認') : null,
            r.reversed ? h('i', { class: 'tag dead' }, '取消済み') : null, isRev ? h('i', { class: 'tag dead' }, '取消の行') : null)),
        h('div', { class: 'lamt ' + (sg > 0 ? 'pos' : sg < 0 ? 'neg' : '') }, (sg > 0 ? '+' : sg < 0 ? '−' : '') + yen(r.amount).replace('−', '')),
        canRev ? h('button', { class: 'undo', 'aria-label': 'この記録を取り消す', onclick: async () => {
          const ok = await confirmBox('この記録を取り消す？', `${r.occurred_on.replaceAll('-', '/')}  ${r.memo || label}  ${yen(r.amount)}\n元の行は消さず、打ち消しの行が追加されます。`, '取り消す');
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
    let showOld = false;
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      const rows = list.filter(p => (showOld || p.is_active) && (!t || p.name.toLowerCase().includes(t)));
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
  if (path === '/in') return moneyView(true);
  if (path === '/out') return moneyView(false);
  if (path === '/loan') return loanView(q.get('mode') || 'loan');
  if (path === '/history') return historyView();
  if (path === '/merch') return merchView();
  if (path === '/product') return productView(q.get('id'));
  return homeView();
}
async function boot() {
  [state.people, state.cats] = await Promise.all([api.people(), api.categories()]);
}
window.addEventListener('hashchange', route);
route(); // module script は DOM 構築後に実行される

if ('serviceWorker' in navigator && !DEMO && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
