-- =====================================================================
--  BASE在庫連携 (バンクエ → BASE へ「差分」で在庫を反映する)
--  Supabase の SQL Editor に貼り付けて、まとめて1回実行してください。
--  何度実行しても壊れないように書いてあります。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) 事前チェック: 必要なテーブル・列があるかを確かめる
--    (ここでエラーになったら、その文面をClaudeに見せてください)
-- ---------------------------------------------------------------------
do $$
begin
  perform 1 from information_schema.columns where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'ref_id';
  if not found then raise exception 'stock_movements.ref_id がありません。Claudeに伝えてください'; end if;
  perform 1 from information_schema.columns where table_schema = 'public' and table_name = 'merch_order_lines' and column_name = 'order_id';
  if not found then raise exception 'merch_order_lines.order_id がありません。Claudeに伝えてください'; end if;
  perform 1 from information_schema.columns where table_schema = 'public' and table_name = 'merch_orders' and column_name = 'channel';
  if not found then raise exception 'merch_orders.channel がありません。Claudeに伝えてください'; end if;
  perform 1 from information_schema.columns where table_schema = 'public' and table_name = 'v_stock_levels' and column_name = 'stock';
  if not found then raise exception 'v_stock_levels.stock がありません。Claudeに伝えてください'; end if;
  perform 1 from information_schema.columns where table_schema = 'public' and table_name = 'product_variants' and column_name = 'id' and data_type = 'uuid';
  if not found then raise exception 'product_variants.id が uuid ではありません。Claudeに伝えてください'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) バンクエの「色・サイズ」と BASE の商品・バリエーションの対応表
--    baseline = 前回BASEに反映したときの「BASE売上を除いたバンクエ在庫」
--    次回は (いまの値 − baseline) だけを BASE に足し引きする
-- ---------------------------------------------------------------------
create table if not exists public.base_item_map (
  variant_id        uuid primary key references public.product_variants(id) on delete cascade,
  base_item_id      bigint not null,
  base_variation_id bigint,                -- バリエーションの無い商品は null
  base_label        text,                  -- 画面表示用 (例: "CLOUD 長袖T / ブラック L")
  baseline          integer not null,
  mapped_at         timestamptz not null default now(),
  mapped_by         text,
  synced_at         timestamptz
);
-- 同じBASEのバリエーションに、2つの色・サイズをつながない
create unique index if not exists base_item_map_target_uq
  on public.base_item_map (base_item_id, coalesce(base_variation_id, 0));

-- ---------------------------------------------------------------------
-- 2) BASEのログイン情報(トークン)。アプリの画面からは絶対に読めない
--    (RLSを有効にしてポリシーを作らない = Edge Function(service role)だけが読める)
-- ---------------------------------------------------------------------
create table if not exists public.base_tokens (
  id            integer primary key default 1 check (id = 1),
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  shop_name     text,
  connected_by  text,
  updated_at    timestamptz not null default now()
);

-- BASEへの接続途中の合言葉(なりすまし防止)。10分で無効
create table if not exists public.base_oauth_states (
  state      text primary key,
  user_id    uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) 反映の記録 (いつ・誰が・何をいくつ動かしたか)
-- ---------------------------------------------------------------------
create table if not exists public.base_sync_log (
  id      bigint generated always as identity primary key,
  run_at  timestamptz not null default now(),
  run_by  text,
  live_id uuid,
  ok      integer not null default 0,
  failed  integer not null default 0,
  lines   jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------
-- 4) 「BASEの売上を除いた」バンクエ在庫
--    BASEで売れた分(sale_base)と、その取消(reversal)は BASE 側ですでに
--    在庫が動いているので、差分の計算から外す
-- ---------------------------------------------------------------------
create or replace view public.v_base_local_stock with (security_invoker = on) as
select sl.variant_id,
       (sl.stock - coalesce(b.qty, 0))::integer as local_stock
from public.v_stock_levels sl
left join (
  -- 在庫の動きは ref_type/ref_id で注文の明細(merch_line)か注文(merch_order)を指している
  select sm.variant_id, sum(sm.qty) as qty
  from public.stock_movements sm
  left join public.merch_order_lines ml on sm.ref_type = 'merch_line' and ml.id = sm.ref_id
  left join public.merch_orders mo on mo.id = coalesce(ml.order_id, case when sm.ref_type = 'merch_order' then sm.ref_id end)
  where sm.reason = 'sale_base' or mo.channel = 'base'
  group by sm.variant_id
) b on b.variant_id = sl.variant_id;

-- ---------------------------------------------------------------------
-- 5) 権限 (RLS)
--    対応表と記録: ログインしたメンバーは読める。書くのは Edge Function だけ
--    トークンと合言葉: だれも読めない(service role だけ)
-- ---------------------------------------------------------------------
alter table public.base_item_map     enable row level security;
alter table public.base_tokens       enable row level security;
alter table public.base_oauth_states enable row level security;
alter table public.base_sync_log     enable row level security;

drop policy if exists base_item_map_read on public.base_item_map;
create policy base_item_map_read on public.base_item_map for select to authenticated using (true);
drop policy if exists base_sync_log_read on public.base_sync_log;
create policy base_sync_log_read on public.base_sync_log for select to authenticated using (true);

revoke all on public.base_tokens, public.base_oauth_states from anon, authenticated;
revoke insert, update, delete on public.base_item_map, public.base_sync_log from anon, authenticated;
grant select on public.base_item_map, public.base_sync_log, public.v_base_local_stock to authenticated;
