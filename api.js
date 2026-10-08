// Wiθ MONEY — データ層。Supabase(REST)版とデモ版を切り替える。
// 外部ライブラリは使わない(fetchだけ)。長期運用で壊れにくくするため。
const C = window.WITH_CONFIG || {};
export const DEMO = new URLSearchParams(location.search).has('demo');
const LS = 'withi_session_v1';

export class ApiError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

// ---------- 日付 (端末のローカル日付 = 日本時間) ----------
export const pad = n => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthStart = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;

// ---------- 台帳の効果 (DBの ledger_effects ビューと同じ規則) ----------
export const EFFECT = {
  income:             a => ({ fund: +a, pnl: +a }),
  expense_fund:       a => ({ fund: -a, pnl: -a }),
  expense_advanced:   a => ({ pnl: -a, payable: +a }),
  loan:               a => ({ fund: -a, recv: +a }),
  loan_repay:         a => ({ fund: +a, recv: -a }),
  reimburse:          a => ({ fund: -a, payable: -a }),
  offset:             a => ({ recv: -a, payable: -a }),
  opening_fund:       a => ({ fund: +a }),
  opening_receivable: a => ({ recv: +a }),
  opening_payable:    a => ({ payable: +a }),
};

// =====================================================================
//  Supabase 版
// =====================================================================
function sessionLoad() { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } }
function sessionSave(s) { localStorage.setItem(LS, JSON.stringify(s)); }
function sessionClear() { localStorage.removeItem(LS); }

async function authPost(path, body) {
  let r;
  try {
    r = await fetch(`${C.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: C.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { throw new ApiError('通信できません。電波のある場所でもう一度お試しください。', 'net'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = j.error_description || j.msg || j.message || '';
    if (/invalid login/i.test(m)) throw new ApiError('メールまたはパスコードが違います', 'login');
    throw new ApiError(m || 'ログインに失敗しました', 'login');
  }
  return j;
}
const toSession = j => ({
  access: j.access_token, refresh: j.refresh_token,
  exp: Date.now() + (j.expires_in || 3600) * 1000, email: j.user && j.user.email,
});

let refreshing = null;
async function freshSession() {
  const s = sessionLoad();
  if (!s) throw new ApiError('ログインしてください', 'auth');
  if (Date.now() < s.exp - 60000) return s;
  if (!refreshing) {
    refreshing = authPost('token?grant_type=refresh_token', { refresh_token: s.refresh })
      .then(j => { const n = toSession(j); n.email = n.email || s.email; sessionSave(n); return n; })
      .catch(e => { if (e.code !== 'net') sessionClear(); throw e.code === 'net' ? e : new ApiError('ログインの有効期限が切れました', 'auth'); })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const s = await freshSession();
  const headers = { apikey: C.key, Authorization: `Bearer ${s.access}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  let r;
  try {
    r = await fetch(`${C.url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError('通信できません。電波のある場所でもう一度お試しください。', 'net'); }
  if (r.status === 401) { sessionClear(); throw new ApiError('ログインの有効期限が切れました', 'auth'); }
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* 空 */ }
  if (!r.ok) {
    const m = (j && j.message) || '';
    if (/row-level security|permission denied/i.test(m)) throw new ApiError('このアカウントには権限がありません', 'perm');
    throw new ApiError(m || 'エラーが発生しました', 'api');
  }
  return j;
}

const real = {
  isLoggedIn: () => !!sessionLoad(),
  email: () => (sessionLoad() || {}).email || '',
  async login(email, pass) {
    const j = await authPost('token?grant_type=password', { email, password: pass });
    sessionSave(toSession(j));
  },
  logout() { sessionClear(); },
  people: () => rest('people?select=*&is_active=eq.true&order=sort_order,name'),
  categories: () => rest('categories?select=*&is_active=eq.true&order=sort_order'),
  async home() {
    const [fund, month, bal] = await Promise.all([
      rest('v_fund_balance?select=fund'),
      rest(`v_monthly_summary?select=*&month=eq.${monthStart()}`),
      rest('v_person_balances?select=*&order=name'),
    ]);
    const m = month[0] || { income: 0, expense: 0, profit: 0 };
    return {
      fund: Number(fund[0] ? fund[0].fund : 0),
      month: { income: Number(m.income), expense: Number(m.expense), profit: Number(m.profit) },
      balances: bal.map(b => ({ person_id: b.person_id, name: b.name, owes_withi: Number(b.owes_withi), withi_owes: Number(b.withi_owes) })),
    };
  },
  async ledger(limit = 80) {
    const sel = 'select=*,category:categories(name),payer:people!ledger_entries_payer_id_fkey(name),party:people!ledger_entries_party_id_fkey(name)';
    const [rows, rev, adv] = await Promise.all([
      rest(`ledger_entries?${sel}&order=occurred_on.desc,created_at.desc&limit=${limit}`),
      rest('ledger_entries?select=reverses_id&reverses_id=not.is.null'),
      rest('v_advance_status?select=advanced_entry_id,status,remaining'),
    ]);
    const reversed = new Set(rev.map(x => x.reverses_id));
    const advMap = new Map(adv.map(a => [a.advanced_entry_id, a]));
    return rows.map(r => ({
      ...r, amount: Number(r.amount),
      category_name: r.category && r.category.name, payer_name: r.payer && r.payer.name, party_name: r.party && r.party.name,
      reversed: reversed.has(r.id), adv: advMap.get(r.id) || null,
    }));
  },
  async addEntry(e) {
    await rest('ledger_entries', {
      method: 'POST', prefer: 'return=minimal',
      body: {
        occurred_on: e.date, kind: e.kind, amount: e.amount, category_id: e.category_id || null,
        memo: e.memo || null, payer_id: e.payer_id || null, party_id: e.party_id || null,
        source: 'manual', posting: 'posted', created_by: e.by,
      },
    });
  },
  reimburse: e => rest('rpc/app_reimburse', { method: 'POST', body: { p_party: e.party_id, p_amount: e.amount, p_date: e.date, p_memo: e.memo || null, p_by: e.by } }),
  offset: e => rest('rpc/app_offset', { method: 'POST', body: { p_party: e.party_id, p_amount: e.amount, p_date: e.date, p_memo: e.memo || null, p_by: e.by } }),
  reverse: (id, by) => rest('rpc/app_reverse', { method: 'POST', body: { p_id: id, p_by: by } }),
};

// =====================================================================
//  デモ版 (?demo=1) — 画面の確認用。架空のデータで、保存もされない
// =====================================================================
function makeDemo() {
  const P = [
    { id: 'p1', name: '夏樹', kind: 'member', can_input: true, can_pay: true },
    { id: 'p2', name: '一道', kind: 'member', can_input: true, can_pay: true },
    { id: 'p3', name: 'かぶ', kind: 'member', can_input: true, can_pay: true },
    { id: 'p4', name: 'スタッフ', kind: 'staff', can_input: true, can_pay: true },
  ];
  const mk = (g, f, names) => names.map((n, i) => ({ id: `${g}-${f}-${i}`, group_name: g, flow: f, name: n, sort_order: i }));
  const CATS = [
    ...mk('general', 'income', ['BASE', '物販(個別販売)', 'サブスク収入', 'SNS収入', 'その他']),
    ...mk('general', 'expense', ['REC・音源制作', '宣伝・デザイン', '駐車場代', 'スタジオ代', '活動機材費', 'サブスク系', 'グッズ・物販制作費', '手数料', '発送・送料', 'その他']),
  ];
  let n = 0; const id = () => `e${++n}`;
  const E = []; const A = []; // entries, allocations
  const now = () => new Date().toISOString();
  const add = (o) => { const r = { id: id(), posting: 'posted', is_historical: false, reverses_id: null, memo: null, category_id: null, payer_id: null, party_id: null, created_at: now(), ...o }; E.push(r); return r; };
  const t = ymd();
  add({ occurred_on: t, kind: 'opening_fund', amount: 29483, memo: '初期残高' });
  add({ occurred_on: t, kind: 'opening_receivable', amount: 20290, party_id: 'p1' });
  add({ occurred_on: t, kind: 'opening_receivable', amount: 65072, party_id: 'p2' });
  add({ occurred_on: t, kind: 'opening_receivable', amount: 18207, party_id: 'p3' });
  const sign = e => (e.reverses_id ? -1 : 1);
  const eff = e => (e.posting === 'posted' ? EFFECT[e.kind](e.amount) : {});
  const sum = (f, pred = () => true) => E.filter(pred).reduce((s, e) => s + sign(e) * ((eff(e)[f]) || 0) * (f !== 'pnl' && e.is_historical ? 0 : 1), 0);
  const cp = e => e.party_id || e.payer_id;
  const bal = pid => ({ recv: sum('recv', e => cp(e) === pid), payable: sum('payable', e => cp(e) === pid) });
  const adv = () => E.filter(e => e.kind === 'expense_advanced' && !e.reverses_id && !E.some(x => x.reverses_id === e.id))
    .map(e => { const s = A.filter(a => a.adv === e.id).reduce((q, a) => q + a.amount, 0); return { advanced_entry_id: e.id, payer_id: e.payer_id, occurred_on: e.occurred_on, remaining: e.amount - s, status: s === 0 ? '未精算' : s >= e.amount ? '精算済み' : '一部精算' }; });
  const alloc = (rid, party, amount) => { let left = amount; for (const a of adv().filter(x => x.payer_id === party && x.remaining > 0).sort((a, b) => a.occurred_on.localeCompare(b.occurred_on))) { if (left <= 0) break; const take = Math.min(left, a.remaining); A.push({ rid, adv: a.advanced_entry_id, amount: take }); left -= take; } };
  const wait = async () => { await new Promise(r => setTimeout(r, 120)); };
  return {
    isLoggedIn: () => true, email: () => 'demo@example.com', login: async () => {}, logout() {},
    async people() { await wait(); return P; }, async categories() { await wait(); return CATS; },
    async home() {
      await wait();
      const m = monthStart();
      const inM = e => e.occurred_on >= m;
      const pnls = E.filter(inM).map(e => sign(e) * ((eff(e).pnl) || 0));
      return {
        fund: sum('fund'),
        month: { income: pnls.filter(x => x > 0).reduce((a, b) => a + b, 0), expense: -pnls.filter(x => x < 0).reduce((a, b) => a + b, 0), profit: pnls.reduce((a, b) => a + b, 0) },
        balances: P.map(p => ({ person_id: p.id, name: p.name, owes_withi: bal(p.id).recv, withi_owes: bal(p.id).payable })),
      };
    },
    async ledger() {
      await wait();
      const nm = pid => (P.find(p => p.id === pid) || {}).name;
      const av = new Map(adv().map(a => [a.advanced_entry_id, a]));
      return [...E].reverse().sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)).map(e => ({
        ...e, category_name: (CATS.find(c => c.id === e.category_id) || {}).name, payer_name: nm(e.payer_id), party_name: nm(e.party_id),
        reversed: E.some(x => x.reverses_id === e.id), adv: av.get(e.id) || null,
      }));
    },
    async addEntry(e) { await wait(); add({ occurred_on: e.date, kind: e.kind, amount: e.amount, category_id: e.category_id, memo: e.memo, payer_id: e.payer_id, party_id: e.party_id }); },
    async reimburse(e) { await wait(); const b = bal(e.party_id); if (e.amount > b.payable) throw new ApiError(`返す額がWiθの未払い残(${b.payable}円)を超えています`); const r = add({ occurred_on: e.date, kind: 'reimburse', amount: e.amount, party_id: e.party_id, memo: e.memo }); alloc(r.id, e.party_id, e.amount); },
    async offset(e) { await wait(); const b = bal(e.party_id); if (e.amount > b.payable || e.amount > b.recv) throw new ApiError(`相殺できるのは、未払い残(${b.payable}円)と借入残(${b.recv}円)の小さい方までです`); const r = add({ occurred_on: e.date, kind: 'offset', amount: e.amount, party_id: e.party_id, memo: e.memo }); alloc(r.id, e.party_id, e.amount); },
    async reverse(rid) {
      await wait(); const e = E.find(x => x.id === rid);
      if (E.some(x => x.reverses_id === rid)) throw new ApiError('すでに取り消されています');
      if (e.kind === 'expense_advanced' && A.some(a => a.adv === rid)) throw new ApiError('この立替には返済が充当されています。先に返済を取り消してください');
      const { id: _i, created_at: _c, ...rest } = e; add({ ...rest, memo: `取消: ${e.memo || ''}`, reverses_id: rid }); for (let i = A.length - 1; i >= 0; i--) if (A[i].rid === rid) A.splice(i, 1);
    },
  };
}

export const api = DEMO ? makeDemo() : real;
