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


// ---------- 商品の共通処理 ----------
export const normName = s => String(s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const SZ = ['S', 'M', 'L', 'XL', 'XXL', 'MENS', 'WOMENS'];
const szRank = s => { const i = SZ.indexOf(s); return i < 0 ? 99 : i; };
export function groupProducts(vs) {
  const m = new Map();
  for (const v of vs) {
    const p = v.product; if (!p) continue;
    if (!m.has(p.id)) m.set(p.id, { ...p, variants: [] });
    m.get(p.id).variants.push({ id: v.id, size: v.size, color: v.color, price: v.price, cost: v.cost, is_active: v.is_active, stock: v.stock });
  }
  const out = [...m.values()];
  for (const p of out) p.variants.sort((x, y) => String(x.color || '').localeCompare(String(y.color || ''), 'ja') || szRank(x.size) - szRank(y.size));
  return out.sort((x, y) => x.name.localeCompare(y.name, 'ja'));
}

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

// ---------- 電波がないときの保存待ち(収入・支出の記録だけ) ----------
const QK = 'withi_queue_v1';
const qLoad = () => { try { return JSON.parse(localStorage.getItem(QK)) || []; } catch { return []; } };
const qSave = q => { try { localStorage.setItem(QK, JSON.stringify(q)); } catch { /* 保存できないときは諦める */ } };
export const queued = () => qLoad();
export async function flushQueue() {
  if (DEMO) return { sent: 0, left: 0, failed: 0 };
  let q = qLoad(); let sent = 0;
  for (const it of [...q]) {
    try { await rest('ledger_entries', { method: 'POST', prefer: 'return=minimal', body: it.body }); sent++; q = q.filter(x => x.body.id !== it.body.id); }
    catch (e) {
      if (e.code === 'net' || e.code === 'auth') break;
      if (/duplicate key/i.test(e.message)) { q = q.filter(x => x.body.id !== it.body.id); sent++; continue; }
      it.error = e.message; q = q.map(x => (x.body.id === it.body.id ? it : x));
    }
  }
  qSave(q);
  return { sent, left: q.length, failed: q.filter(x => x.error).length };
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
    const body = {
      id: crypto.randomUUID(),
      occurred_on: e.date, kind: e.kind, amount: e.amount, category_id: e.category_id || null,
      memo: e.memo || null, payer_id: e.payer_id || null, party_id: e.party_id || null,
      source: e.live_id ? 'live' : 'manual', live_id: e.live_id || null, posting: 'posted', created_by: e.by,
    };
    try { await rest('ledger_entries', { method: 'POST', prefer: 'return=minimal', body }); return { queued: false }; }
    catch (err) {
      if (err.code !== 'net') throw err;
      const q = qLoad(); q.push({ body, at: new Date().toISOString() }); qSave(q);
      return { queued: true };
    }
  },
  reverse: (id, by) => rest('rpc/app_reverse', { method: 'POST', body: { p_id: id, p_by: by } }),
  // 物販の売上(BASE・個別販売)を、注文・在庫・台帳へ一度に記録する
  merchSale: o => rest('rpc/app_merch_sale', { method: 'POST', body: { p_channel: o.channel, p_date: o.date, p_lines: o.lines, p_received: o.received, p_memo: o.memo || null, p_customer: o.customer || null, p_by: o.by } }),
  // ---- Airレジ ----
  async airMap() { const r = await rest('air_item_map?select=menu_norm,type1_norm,type2_norm,variant_id'); return r; },
  airBaskets: () => rest('air_baskets?select=id,sale_date,txn_no,total,item_count,live_id,date_mismatch,staff_name&order=sale_date.desc,txn_no.desc&limit=2000'),
  airImports: () => rest('air_imports?select=file_name,target_month,baskets_new,imported_at&order=imported_at.desc&limit=12'),
  airImport: o => rest('rpc/app_air_import', { method: 'POST', body: { p_file_name: o.file_name, p_hash: o.hash, p_month: o.month, p_baskets: o.baskets, p_map: o.map, p_by: o.by } }),
  airLink: (date, live, by) => rest('rpc/app_air_link', { method: 'POST', body: { p_date: date, p_live: live || null, p_by: by } }),
  // ---- 定期費用・テンプレート・バックアップ ----
  recurring: () => rest('recurring_rules?select=*,category:categories(name),payer:people(name)&order=next_due'),
  saveRule: (id, f) => rest(id ? `recurring_rules?id=eq.${id}` : 'recurring_rules', { method: id ? 'PATCH' : 'POST', prefer: 'return=minimal',
    body: { name: f.name, every_n: f.every_n, unit: f.unit, next_due: f.next_due, amount: f.amount, category_id: f.category_id || null, payer_id: f.payer_id || null, is_active: f.is_active !== false } }),
  postRecurring: o => rest('rpc/app_recurring_post', { method: 'POST', body: { p_rule: o.rule, p_date: o.date, p_skip: !!o.skip, p_by: o.by } }),
  templates: () => rest('quick_templates?select=*&is_active=eq.true&order=use_count.desc,label'),
  saveTemplate: (id, f) => rest(id ? `quick_templates?id=eq.${id}` : 'quick_templates', { method: id ? 'PATCH' : 'POST', prefer: 'return=minimal',
    body: { label: f.label, kind: f.kind, category_id: f.category_id || null, amount: f.amount || null, memo: f.memo || null, payer_id: f.payer_id || null } }),
  removeTemplate: id => rest(`quick_templates?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { is_active: false } }),
  useTemplate: (id, n) => rest(`quick_templates?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { use_count: n + 1 } }).catch(() => {}),
  async exportAll(progress) {
    const T = ['people', 'categories', 'venues', 'settings', 'lives', 'ledger_entries', 'settlement_allocations', 'products', 'product_variants', 'stock_movements',
      'air_imports', 'air_baskets', 'air_lines', 'air_item_map', 'merch_orders', 'merch_order_lines', 'base_payouts', 'recurring_rules', 'quick_templates', 'audit_log'];
    const out = { app: 'withi-money', exported_at: new Date().toISOString(), tables: {} };
    for (const t of T) {
      if (progress) progress(t);
      const rows = []; let off = 0;
      for (;;) { const page = await rest(`${t}?select=*&order=id&limit=1000&offset=${off}`); rows.push(...page); if (page.length < 1000) break; off += 1000; }
      out.tables[t] = rows;
    }
    return out;
  },
  // ---- ライブ ----
  async lives() {
    const [rows, vs, ls] = await Promise.all([
      rest('v_live_profit?select=*&order=live_date.desc'),
      rest('venues?select=id,name,prefecture&order=name'),
      rest('lives?select=id,memo,score'),
    ]);
    const vm = new Map(vs.map(v => [v.id, v])); const lm = new Map(ls.map(l => [l.id, l]));
    return rows.map(r => ({ ...r, id: r.live_id, income: Number(r.income), expense: Number(r.expense), profit: Number(r.profit),
      venue_name: r.venue_id && vm.get(r.venue_id) ? vm.get(r.venue_id).name : '', memo: (lm.get(r.live_id) || {}).memo || '', score: (lm.get(r.live_id) || {}).score || null }));
  },
  liveRating: async () => { const r = await rest('settings?select=value&key=eq.live_rating'); return r[0] ? r[0].value : null; },
  venues: () => rest('venues?select=id,name,prefecture&order=name'),
  async _venueId(name, pref) {
    name = (name || '').trim(); if (!name) return null;
    const ex = await rest(`venues?select=id&name=eq.${encodeURIComponent(name)}`);
    if (ex.length) return ex[0].id;
    const r = await rest('venues', { method: 'POST', prefer: 'return=representation', body: { name, prefecture: pref || null } });
    return r[0].id;
  },
  async addLive(f) {
    const venue_id = await real._venueId(f.venue, f.prefecture);
    const r = await rest('lives', { method: 'POST', prefer: 'return=representation', body: { live_date: f.date, event_name: f.name, kind: f.kind, prefecture: f.prefecture || null, venue_id, memo: f.memo || null, created_by: f.by } });
    return r[0].id;
  },
  async saveLive(id, f) {
    const venue_id = await real._venueId(f.venue, f.prefecture);
    await rest(`lives?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { live_date: f.date, event_name: f.name, kind: f.kind, prefecture: f.prefecture || null, venue_id, memo: f.memo || null } });
  },
  setLiveStatus: (id, st) => rest(`lives?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal',
    body: st.confirm ? { status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: st.by, score: st.score } : { status: 'draft', confirmed_at: null, confirmed_by: null, score: null } }),
  async liveEntries(id) {
    const sel = 'select=*,category:categories(name),payer:people!ledger_entries_payer_id_fkey(name)';
    const [rows, rev] = await Promise.all([
      rest(`ledger_entries?${sel}&live_id=eq.${id}&order=occurred_on.asc,created_at.asc`),
      rest('ledger_entries?select=reverses_id&reverses_id=not.is.null'),
    ]);
    const reversed = new Set(rev.map(x => x.reverses_id));
    return rows.map(r => ({ ...r, amount: Number(r.amount), category_name: r.category && r.category.name, payer_name: r.payer && r.payer.name, reversed: reversed.has(r.id) }));
  },
  // ---- 商品・在庫 ----
  async products() {
    const [vs, st] = await Promise.all([
      rest('product_variants?select=id,size,color,price,cost,is_active,product:products(id,name,category,is_active,image_url,co_share,air_type1_role,air_type2_role)'),
      rest('v_stock_levels?select=variant_id,stock'),
    ]);
    const stock = new Map(st.map(s => [s.variant_id, Number(s.stock)]));
    return groupProducts(vs.map(v => ({ ...v, stock: stock.get(v.id) || 0 })));
  },
  saveVariant: (id, f) => rest(`product_variants?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { price: f.price, cost: f.cost, is_active: f.is_active } }),
  saveProduct: (id, f) => rest(`products?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { name: f.name, name_norm: normName(f.name), category: f.category || null, is_active: f.is_active } }),
  addVariant: (pid, f) => rest('product_variants', { method: 'POST', prefer: 'return=minimal', body: { product_id: pid, size: f.size || null, color: f.color || null, price: f.price, cost: f.cost } }),
  async addProduct(f) {
    const r = await rest('products', { method: 'POST', prefer: 'return=representation', body: { name: f.name, name_norm: normName(f.name), category: f.category || null, has_size: !!f.size, has_color: !!f.color } });
    await rest('product_variants', { method: 'POST', prefer: 'return=minimal', body: { product_id: r[0].id, size: f.size || null, color: f.color || null, price: f.price, cost: f.cost } });
  },
  stockMove: m => rest('stock_movements', { method: 'POST', prefer: 'return=minimal', body: { variant_id: m.variant_id, qty: m.qty, reason: m.reason, occurred_on: m.date, memo: m.memo || null, created_by: m.by } }),
  stockHistory: vid => rest(`stock_movements?select=qty,reason,occurred_on,memo&variant_id=eq.${vid}&order=occurred_on.desc,created_at.desc&limit=30`),
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
    { id: 'p5', name: 'STS', kind: 'external', can_input: false, can_pay: true },
  ];
  const mk = (g, f, names) => names.map((n, i) => ({ id: `${g}-${f}-${i}`, group_name: g, flow: f, name: n, sort_order: i }));
  const CATS = [
    ...mk('general', 'income', ['BASE', '物販(個別販売)', 'サブスク収入', 'SNS収入', 'その他']),
    ...mk('general', 'expense', ['REC・音源制作', '宣伝・デザイン', '駐車場代', 'スタジオ代', '活動機材費', 'サブスク系', 'グッズ・物販制作費', '手数料', '発送・送料', 'STS取り分', 'その他']),
  ];
  CATS.push(...mk('attend', 'income', ['ギャラ(チャージバック含む)', '物販売上', 'その他']), ...mk('attend', 'expense', ['交通費', 'ノルマ', '打ち上げ代', 'その他']), ...mk('host', 'income', ['チケット売上', '物販売上', 'その他']), ...mk('host', 'expense', ['箱代', 'ドリンク代', 'その他']));
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
  // 商品・在庫(デモ)
  let vn = 0;
  const PR = [];
  const mkp = (name, category, vars, extra = {}) => { const p = { id: 'pr' + (PR.length + 1), name, category, is_active: true, image_url: null, ...extra }; PR.push({ p, vars: vars.map(([size, color, price, cost, stock]) => ({ id: 'v' + (++vn), size, color, price, cost, is_active: true, stock })) }); };
  mkp('ロゴ 缶バッジ', '缶バッジ', [[null, null, 200, 60, 7]]);
  mkp('KEEP IT!! T', 'Tシャツ', [['S', '白', 2500, 1000, 0], ['M', '白', 2500, 1000, 1], ['L', '黒', 2500, 1000, 3]], { air_type1_role: 'color', air_type2_role: 'size' });
  mkp('STS TOUR TEE', 'Tシャツ', [['L', null, 3000, 1200, 0], ['XL', null, 3000, 1200, 3]], { co_share: 0.5, air_type1_role: 'size', air_type2_role: null });
  const MV = []; const ORD = new Map(); const RR = []; const TP = []; const LV = []; const AB = []; const AM = []; const AI = [];
  const allV = () => PR.flatMap(x => x.vars.map(v => ({ ...v, product: x.p })));

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
    async addEntry(e) { await wait(); add({ occurred_on: e.date, kind: e.kind, amount: e.amount, category_id: e.category_id, memo: e.memo, payer_id: e.payer_id, party_id: e.party_id, live_id: e.live_id || null, source: e.live_id ? 'live' : 'manual' }); },
    async reimburse(e) { await wait(); const b = bal(e.party_id); if (e.amount > b.payable) throw new ApiError(`返す額がWiθの未払い残(${b.payable}円)を超えています`); const r = add({ occurred_on: e.date, kind: 'reimburse', amount: e.amount, party_id: e.party_id, memo: e.memo }); alloc(r.id, e.party_id, e.amount); },
    async offset(e) { await wait(); const b = bal(e.party_id); if (e.amount > b.payable || e.amount > b.recv) throw new ApiError(`相殺できるのは、未払い残(${b.payable}円)と借入残(${b.recv}円)の小さい方までです`); const r = add({ occurred_on: e.date, kind: 'offset', amount: e.amount, party_id: e.party_id, memo: e.memo }); alloc(r.id, e.party_id, e.amount); },

    async lives() {
      await wait();
      return LV.map(l => { const es = E.filter(e => e.live_id === l.id); const pn = es.map(e => sign(e) * ((eff(e).pnl) || 0));
        return { ...l, live_id: l.id, venue_name: l.venue, income: pn.filter(x => x > 0).reduce((s, x) => s + x, 0), expense: -pn.filter(x => x < 0).reduce((s, x) => s + x, 0), profit: pn.reduce((s, x) => s + x, 0) }; })
        .sort((x, y) => y.live_date.localeCompare(x.live_date));
    },
    async airMap() { await wait(); return AM; },
    async airBaskets() { await wait(); return AB.map(b => ({ ...b })); },
    async airImports() { await wait(); return AI; },
    async airImport(o) {
      await wait(); if (AI.some(x => x.hash === o.hash)) throw new ApiError('このファイルは取り込み済みです');
      let nw = 0, skipped = 0, stock = 0, linked = 0;
      for (const m of o.map || []) { const i = AM.findIndex(x => x.menu_norm === m.menu_norm && x.type1_norm === m.type1_norm && x.type2_norm === m.type2_norm); if (i >= 0) AM[i] = m; else AM.push(m); }
      for (const b of o.baskets) {
        if (AB.some(x => x.sale_date === b.sale_date && x.txn_no === b.txn_no)) { skipped++; continue; }
        const total = Number(b.total) || b.lines.reduce((s, l) => s + l.price * l.qty, 0);
        const same = LV.filter(l => l.live_date === b.sale_date);
        AB.push({ id: 'b' + (++n), sale_date: b.sale_date, txn_no: b.txn_no, total, item_count: Number(b.item_count) || null, live_id: same.length === 1 ? same[0].id : null, date_mismatch: false, staff_name: b.staff });
        nw++; if (same.length === 1) linked++;
        for (const l of b.lines) if (l.variant_id && b.sale_date > '2026-10-07') { const v = PR.flatMap(y => y.vars).find(x => x.id === l.variant_id); if (v) { v.stock -= l.qty; stock++; } }
      }
      AI.unshift({ file_name: o.file_name, target_month: o.month, baskets_new: nw, hash: o.hash, imported_at: new Date().toISOString() });
      return { new: nw, skipped, lines: 0, stock_lines: stock, linked };
    },
    async airLink(date, live) { await wait(); let c = 0; for (const b of AB) if (b.sale_date === date) { b.live_id = live || null; c++; } return c; },
    async recurring() { await wait(); return RR.map(r => ({ ...r, category: { name: (CATS.find(c => c.id === r.category_id) || {}).name }, payer: r.payer_id ? { name: (P.find(p => p.id === r.payer_id) || {}).name } : null })); },
    async saveRule(id, f) { await wait(); const o = { name: f.name, every_n: f.every_n, unit: f.unit, next_due: f.next_due, amount: f.amount, category_id: f.category_id || null, payer_id: f.payer_id || null, is_active: f.is_active !== false }; if (id) Object.assign(RR.find(r => r.id === id), o); else RR.push({ id: 'r' + (++n), ...o }); },
    async postRecurring(o) {
      await wait(); const r = RR.find(x => x.id === o.rule); if (!o.skip) add({ occurred_on: o.date, kind: r.payer_id ? 'expense_advanced' : 'expense_fund', amount: r.amount, category_id: r.category_id, memo: r.name, payer_id: r.payer_id, source: 'recurring' });
      const d = new Date(r.next_due + 'T00:00:00'); if (r.unit === 'year') d.setFullYear(d.getFullYear() + r.every_n); else d.setMonth(d.getMonth() + r.every_n); r.next_due = ymd(d); return r.next_due;
    },
    async templates() { await wait(); return TP.filter(t => t.is_active).sort((a, b) => b.use_count - a.use_count); },
    async saveTemplate(id, f) { await wait(); const o = { label: f.label, kind: f.kind, category_id: f.category_id || null, amount: f.amount || null, memo: f.memo || null, payer_id: f.payer_id || null }; if (id) Object.assign(TP.find(t => t.id === id), o); else TP.push({ id: 't' + (++n), use_count: 0, is_active: true, ...o }); },
    async removeTemplate(id) { await wait(); TP.find(t => t.id === id).is_active = false; },
    async useTemplate(id) { const t = TP.find(x => x.id === id); if (t) t.use_count++; },
    async exportAll() { await wait(); return { app: 'withi-money', demo: true, exported_at: new Date().toISOString(), tables: { ledger_entries: E } }; },
    async liveRating() { return null; },
    async venues() { await wait(); return [...new Set(LV.map(l => l.venue).filter(Boolean))].map(n => ({ id: n, name: n, prefecture: '鹿児島' })); },
    async addLive(f) { await wait(); const id = 'L' + (++n); LV.push({ id, live_date: f.date, event_name: f.name, kind: f.kind, prefecture: f.prefecture || null, venue: f.venue || '', memo: f.memo || '', status: 'draft', score: null }); return id; },
    async saveLive(id, f) { await wait(); Object.assign(LV.find(l => l.id === id), { live_date: f.date, event_name: f.name, kind: f.kind, prefecture: f.prefecture || null, venue: f.venue || '', memo: f.memo || '' }); },
    async setLiveStatus(id, st) { await wait(); Object.assign(LV.find(l => l.id === id), st.confirm ? { status: 'confirmed', score: st.score } : { status: 'draft', score: null }); },
    async liveEntries(id) {
      await wait(); const nm = pid => (P.find(p => p.id === pid) || {}).name;
      return E.filter(e => e.live_id === id).map(e => ({ ...e, category_name: (CATS.find(c => c.id === e.category_id) || {}).name, payer_name: nm(e.payer_id), reversed: E.some(x => x.reverses_id === e.id) }));
    },
    async products() { await wait(); return groupProducts(allV().map(v => ({ ...v, stock: v.stock }))); },
    async saveVariant(id, f) { await wait(); const v = allV().find(x => x.id === id); const o = PR.flatMap(x => x.vars).find(x => x.id === id); Object.assign(o, { price: f.price, cost: f.cost, is_active: f.is_active }); return v; },
    async saveProduct(id, f) { await wait(); const x = PR.find(y => y.p.id === id); Object.assign(x.p, { name: f.name, category: f.category, is_active: f.is_active }); },
    async addVariant(pid, f) { await wait(); PR.find(y => y.p.id === pid).vars.push({ id: 'v' + (++vn), size: f.size || null, color: f.color || null, price: f.price, cost: f.cost, is_active: true, stock: 0 }); },
    async addProduct(f) { await wait(); mkp(f.name, f.category || null, [[f.size || null, f.color || null, f.price, f.cost, 0]]); },
    async stockMove(m) { await wait(); const o = PR.flatMap(x => x.vars).find(x => x.id === m.variant_id); o.stock += m.qty; MV.unshift({ variant_id: m.variant_id, qty: m.qty, reason: m.reason, occurred_on: m.date, memo: m.memo }); },
    async stockHistory(vid) { await wait(); return MV.filter(x => x.variant_id === vid); },
    async merchSale(o) {
      await wait();
      const vs = allV(); let sales = 0;
      if (!o.lines || !o.lines.length) throw new ApiError('商品を1つ以上選んでください');
      for (const l of o.lines) sales += l.qty * l.unit_price;
      if (!(o.received >= 0)) throw new ApiError('受け取った金額を入れてください');
      if (o.channel === 'direct' && o.received > sales) throw new ApiError('受け取った金額が定価の合計より大きくなっています');
      if (o.channel === 'base' && o.received > sales) throw new ApiError(`入金額(${o.received}円)が売上(${sales}円)より大きくなっています。確認してください`);
      const oid = 'o' + (++n); const cat = nm => (CATS.find(c => c.name === nm) || {}).id;
      const label = o.lines.map(l => { const v = vs.find(x => x.id === l.variant_id); return `${v.product.name} ×${l.qty}`; }).join(' / ');
      if (o.channel === 'base' || o.received > 0) add({ occurred_on: o.date, kind: 'income', amount: o.channel === 'base' ? sales : o.received, category_id: cat(o.channel === 'base' ? 'BASE' : '物販(個別販売)'), memo: o.memo || label, merch_order_id: oid, source: o.channel });
      if (o.channel === 'base' && sales > o.received) add({ occurred_on: o.date, kind: 'expense_fund', amount: sales - o.received, category_id: cat('手数料'), memo: 'BASE手数料', merch_order_id: oid, source: 'base' });
      let sts = 0;
      for (const l of o.lines) { const x = PR.flatMap(y => y.vars.map(v => ({ v, p: y.p }))).find(q => q.v.id === l.variant_id); x.v.stock -= l.qty; MV.unshift({ variant_id: l.variant_id, qty: -l.qty, reason: o.channel === 'base' ? 'sale_base' : 'sale_direct', occurred_on: o.date, memo: o.memo, order_id: oid }); if (x.p.co_share) sts += l.qty * l.unit_price * x.p.co_share * (o.channel === 'direct' && sales > 0 ? o.received / sales : 1); }
      if (sts > 0) add({ occurred_on: o.date, kind: 'expense_advanced', amount: Math.round(sts), category_id: cat('STS取り分'), memo: '共同物販の取り分 50%', payer_id: 'p5', merch_order_id: oid, source: o.channel });
      ORD.set(oid, o.lines);
      return oid;
    },
    async reverse(rid) {
      await wait(); const e = E.find(x => x.id === rid);
      if (e.merch_order_id) {
        const oid = e.merch_order_id;
        if (E.some(x => x.merch_order_id === oid && x.reverses_id)) throw new ApiError('すでに取り消されています');
        for (const x of E.filter(q => q.merch_order_id === oid && !q.reverses_id)) {
          if (x.kind === 'expense_advanced' && A.some(a => a.adv === x.id)) throw new ApiError('この立替には返済が充当されています。先に返済を取り消してください');
        }
        for (const x of E.filter(q => q.merch_order_id === oid && !q.reverses_id)) { const { id: _i, created_at: _c, ...rr } = x; add({ ...rr, memo: `取消: ${x.memo || ''}`, reverses_id: x.id }); }
        for (const l of ORD.get(oid) || []) { PR.flatMap(y => y.vars).find(v => v.id === l.variant_id).stock += l.qty; MV.unshift({ variant_id: l.variant_id, qty: l.qty, reason: 'reversal', occurred_on: ymd(), memo: '売上の取消' }); }
        return;
      }
      if (E.some(x => x.reverses_id === rid)) throw new ApiError('すでに取り消されています');
      if (e.kind === 'expense_advanced' && A.some(a => a.adv === rid)) throw new ApiError('この立替には返済が充当されています。先に返済を取り消してください');
      const { id: _i, created_at: _c, ...rest } = e; add({ ...rest, memo: `取消: ${e.memo || ''}`, reverses_id: rid }); for (let i = A.length - 1; i >= 0; i--) if (A[i].rid === rid) A.splice(i, 1);
    },
  };
}

export const api = DEMO ? makeDemo() : real;
