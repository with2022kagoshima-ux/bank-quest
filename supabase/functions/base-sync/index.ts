// Wiθ BANK QUEST — BASE在庫連携の中継 (Supabase Edge Function)
//
// 画面(GitHub Pages)には BASE のトークンを一切置かず、ここだけが BASE と話す。
// 設定するシークレット:
//   BASE_CLIENT_ID / BASE_CLIENT_SECRET … BASE Developers で発行されたもの
//   APP_URL                            … https://with2022kagoshima-ux.github.io/bank-quest/
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY は自動で入る)
//
// デプロイ: supabase functions deploy base-sync --no-verify-jwt
//   (BASEから戻ってくる callback はログイン情報を持たないため。POST はこの中で本人確認する)

import { computeLines, suggest, type BaseItem, type MapRow } from './logic.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = Deno.env.get('BASE_CLIENT_ID') || '';
const CLIENT_SECRET = Deno.env.get('BASE_CLIENT_SECRET') || '';
const APP_URL = (Deno.env.get('APP_URL') || 'https://with2022kagoshima-ux.github.io/bank-quest/').replace(/\/?$/, '/');
const APP_ORIGIN = new URL(APP_URL).origin;
const REDIRECT = `${SB_URL}/functions/v1/base-sync/callback`;
const BASE_API = 'https://api.thebase.in/1';

class UserError extends Error {}

const cors = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

// ---------- Supabase (service role で直接 REST を叩く) ----------
async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const headers: Record<string, string> = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  if (init.prefer) headers.Prefer = init.prefer;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method: init.method || 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`DB ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

// 本人確認: ログイン中のメンバーか (アプリと同じRLSで商品が読めるか) を確かめる
async function requireMember(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) throw new UserError('ログインしてください');
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!u.ok) throw new UserError('ログインの有効期限が切れました');
  const user = await u.json();
  const r = await fetch(`${SB_URL}/rest/v1/product_variants?select=id&limit=1`, { headers: { apikey: ANON, Authorization: auth } });
  const rows = r.ok ? await r.json() : [];
  if (!Array.isArray(rows) || !rows.length) throw new UserError('このアカウントには権限がありません');
  return user as { id: string; email?: string };
}

// ---------- BASE のトークン ----------
async function tokenRequest(params: Record<string, string>) {
  const r = await fetch(`${BASE_API}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new UserError('BASEとの接続に失敗しました: ' + (j.error_description || j.error || r.status));
  return j as { access_token: string; refresh_token: string; expires_in: number };
}
async function saveToken(t: { access_token: string; refresh_token: string; expires_in: number }, extra: Record<string, unknown> = {}) {
  await db('base_tokens?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
    id: 1, access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000).toISOString(), updated_at: new Date().toISOString(), ...extra,
  } });
}
async function accessToken(): Promise<string> {
  const rows = await db('base_tokens?select=access_token,refresh_token,expires_at&id=eq.1');
  if (!rows.length) throw new UserError('BASEにまだつないでいません。「BASE連携」からつないでください');
  const t = rows[0];
  if (new Date(t.expires_at).getTime() - 60_000 > Date.now()) return t.access_token;
  try {
    const n = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    await saveToken(n);
    return n.access_token;
  } catch {
    throw new UserError('BASEとの接続が切れました。「BASE連携」からもう一度つないでください');
  }
}

// ---------- BASE API ----------
async function base(path: string, init: { method?: string; form?: Record<string, string | number> } = {}) {
  const tok = await accessToken();
  const r = await fetch(`${BASE_API}${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, ...(init.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: init.form ? new URLSearchParams(Object.entries(init.form).map(([k, v]) => [k, String(v)])) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = j.error_description || j.error || `HTTP ${r.status}`;
    if (r.status === 429 || /limit/i.test(String(m))) throw new UserError('BASEの利用回数の上限に達しました。しばらく待ってからもう一度押してください');
    throw new UserError('BASE: ' + m);
  }
  return j;
}
async function allItems(): Promise<BaseItem[]> {
  const out: BaseItem[] = [];
  for (let off = 0; off < 2000; off += 100) {
    const j = await base(`/items?limit=100&offset=${off}&order=list_order&sort=asc`);
    const page: BaseItem[] = j.items || [];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}
async function itemDetail(id: number): Promise<BaseItem | undefined> {
  try { const j = await base(`/items/detail/${id}`); return j.item; }
  catch (e) { if (e instanceof UserError && /見つかり|not found|存在/i.test(e.message)) return undefined; throw e; }
}

// ---------- バンクエ側のデータ ----------
async function localStock(): Promise<Map<string, number>> {
  const rows = await db('v_base_local_stock?select=variant_id,local_stock');
  return new Map(rows.map((r: { variant_id: string; local_stock: number }) => [r.variant_id, Number(r.local_stock)]));
}
async function variantLabels(): Promise<Map<string, string>> {
  const rows = await db('product_variants?select=id,size,color,product:products(name)');
  return new Map(rows.map((v: { id: string; size: string | null; color: string | null; product: { name: string } | null }) =>
    [v.id, [v.product && v.product.name, v.color, v.size].filter(Boolean).join(' ')]));
}

// 反映の前に「何がいくつ動くか」を計算する(BASEの今の在庫も読む)
async function buildLines() {
  const maps: MapRow[] = await db('base_item_map?select=variant_id,base_item_id,base_variation_id,base_label,baseline');
  const [local, labels] = await Promise.all([localStock(), variantLabels()]);
  const need = [...new Set(maps.filter(m => (local.get(m.variant_id) ?? 0) !== Number(m.baseline)).map(m => Number(m.base_item_id)))];
  const items = new Map<number, BaseItem | undefined>();
  for (const id of need) items.set(id, await itemDetail(id));
  const changed = maps.filter(m => (local.get(m.variant_id) ?? 0) !== Number(m.baseline));
  return { lines: computeLines(changed, local, items, labels), mapped: maps.length };
}

// ---------- それぞれの操作 ----------
async function handle(action: string, body: Record<string, unknown>, user: { id: string }) {
  if (action === 'status') {
    const rows = await db('base_tokens?select=shop_name,updated_at,expires_at&id=eq.1');
    const maps = await db('base_item_map?select=variant_id');
    return { configured: !!(CLIENT_ID && CLIENT_SECRET), connected: rows.length > 0, shop_name: rows[0] ? rows[0].shop_name : null, mapped: maps.length };
  }
  if (action === 'connect') {
    if (!CLIENT_ID || !CLIENT_SECRET) throw new UserError('BASE_CLIENT_ID / BASE_CLIENT_SECRET がまだ設定されていません');
    const state = crypto.randomUUID();
    await db('base_oauth_states', { method: 'POST', prefer: 'return=minimal', body: { state, user_id: user.id } });
    const u = new URL(`${BASE_API}/oauth/authorize`);
    u.search = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: 'read_users read_items write_items', state }).toString();
    return { url: u.toString() };
  }
  if (action === 'disconnect') {
    await db('base_tokens?id=eq.1', { method: 'DELETE', prefer: 'return=minimal' });
    return { ok: true };
  }
  if (action === 'items') {
    const items = await allItems();
    return { items: items.map(it => ({ item_id: it.item_id, title: it.title, stock: it.stock, variations: (it.variations || []).map(v => ({ variation_id: v.variation_id, variation: v.variation, variation_stock: v.variation_stock })) })) };
  }
  if (action === 'suggest') {
    // body.variants: [{variant_id, product, color, size}]
    const items = await allItems();
    const vs = (body.variants as { variant_id: string; product: string; color: string | null; size: string | null }[]) || [];
    return { suggestions: vs.map(v => ({ variant_id: v.variant_id, hit: suggest(v.product, v.color, v.size, items) })) };
  }
  if (action === 'map') {
    // 紐づけた時点の在庫を「基準」にする(BASEの在庫は変えない)
    const vid = String(body.variant_id || '');
    if (!vid) throw new UserError('商品を選んでください');
    if (body.base_item_id == null) {
      await db(`base_item_map?variant_id=eq.${encodeURIComponent(vid)}`, { method: 'DELETE', prefer: 'return=minimal' });
      return { ok: true };
    }
    const local = await localStock();
    try {
      await db('base_item_map?on_conflict=variant_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
        variant_id: vid, base_item_id: Number(body.base_item_id), base_variation_id: body.base_variation_id == null ? null : Number(body.base_variation_id),
        base_label: String(body.base_label || ''), baseline: local.get(vid) ?? 0, mapped_at: new Date().toISOString(), mapped_by: String(body.by || ''), synced_at: null,
      } });
    } catch (e) {
      if (/base_item_map_target_uq|duplicate/i.test(String(e))) throw new UserError('そのBASEの色・サイズは、別の商品にもう紐づいています');
      throw e;
    }
    return { ok: true };
  }
  if (action === 'preview') {
    return await buildLines();
  }
  if (action === 'apply') {
    const { lines } = await buildLines(); // 画面から来た数字は使わず、ここで計算し直す
    const results = [];
    for (const l of lines) {
      if (l.problem || l.target == null) { results.push({ ...l, ok: false, error: l.problem }); continue; }
      // 先に基準を進めて「取り合い」を防ぐ(2人が同時に押しても二重に反映されない)
      const claimed = await db(`base_item_map?variant_id=eq.${encodeURIComponent(l.variant_id)}&baseline=eq.${l.baseline}`,
        { method: 'PATCH', prefer: 'return=representation', body: { baseline: l.local_now, synced_at: new Date().toISOString() } });
      if (!claimed.length) { results.push({ ...l, ok: false, error: 'ほかの人が先に反映しました' }); continue; }
      try {
        // 直前にもう一度BASEの在庫を読む(プレビューのあとBASEで売れていても正しくなる)
        const fresh = await itemDetail(l.base_item_id);
        const now = fresh ? (l.base_variation_id == null ? Number(fresh.stock) : Number(((fresh.variations || []).find(v => Number(v.variation_id) === l.base_variation_id) || {}).variation_stock)) : NaN;
        if (!Number.isFinite(now)) throw new UserError('BASEの色・サイズが見つかりません');
        const target = Math.max(0, now + l.delta);
        await base('/items/edit_stock', { method: 'POST', form: l.base_variation_id == null
          ? { item_id: l.base_item_id, stock: target }
          : { item_id: l.base_item_id, variation_id: l.base_variation_id, variation_stock: target } });
        results.push({ ...l, base_now: now, target, clamped: now + l.delta < 0, ok: true });
      } catch (e) {
        // BASEに反映できなかったので、基準を元に戻す
        await db(`base_item_map?variant_id=eq.${encodeURIComponent(l.variant_id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { baseline: l.baseline } }).catch(() => {});
        results.push({ ...l, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const ok = results.filter(r => r.ok).length; const failed = results.length - ok;
    if (results.length) {
      await db('base_sync_log', { method: 'POST', prefer: 'return=minimal', body: {
        run_by: String(body.by || ''), live_id: body.live_id || null, ok, failed,
        lines: results.map(r => ({ variant_id: r.variant_id, label: r.label, delta: r.delta, base_before: r.base_now, base_after: r.ok ? r.target : null, error: r.ok ? null : r.error })),
      } }).catch(() => {});
    }
    return { results, ok, failed };
  }
  throw new UserError('不明な操作です');
}

// ---------- BASE から戻ってくる場所 ----------
async function callback(url: URL) {
  const back = (q: string) => Response.redirect(`${APP_URL}#/base?${q}`, 302);
  const code = url.searchParams.get('code'); const state = url.searchParams.get('state') || '';
  if (url.searchParams.get('error') || !code) return back('error=' + encodeURIComponent('BASEでの許可がキャンセルされました'));
  const st = await db(`base_oauth_states?state=eq.${encodeURIComponent(state)}&select=state,created_at`);
  await db(`base_oauth_states?created_at=lt.${new Date(Date.now() - 600_000).toISOString()}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
  if (!st.length || Date.now() - new Date(st[0].created_at).getTime() > 600_000) return back('error=' + encodeURIComponent('時間切れです。もう一度つないでください'));
  await db(`base_oauth_states?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE', prefer: 'return=minimal' });
  try {
    const t = await tokenRequest({ grant_type: 'authorization_code', code });
    let shop: string | null = null;
    try {
      const me = await fetch(`${BASE_API}/users/me`, { headers: { Authorization: `Bearer ${t.access_token}` } }).then(r => r.json());
      shop = (me.user && (me.user.shop_name || me.user.shop_id)) || null;
    } catch { /* 名前が取れなくても続ける */ }
    await saveToken(t, { shop_name: shop });
    return back('connected=1');
  } catch (e) {
    return back('error=' + encodeURIComponent(e instanceof Error ? e.message : 'BASEとの接続に失敗しました'));
  }
}

Deno.serve(async req => {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method === 'GET' && url.pathname.endsWith('/callback')) return await callback(url);
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const user = await requireMember(req);
    const body = await req.json().catch(() => ({}));
    return json(await handle(String(body.action || ''), body, user));
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: 'サーバーでエラーが起きました。時間をおいてもう一度試してください' }, 500);
  }
});
