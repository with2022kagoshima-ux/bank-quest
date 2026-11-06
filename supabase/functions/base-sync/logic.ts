// BASE在庫連携の計算部分(通信なし)。テストしやすいように index.ts から分けている。

export type MapRow = {
  variant_id: string;
  base_item_id: number;
  base_variation_id: number | null;
  base_label: string | null;
  baseline: number;
};

export type BaseVariation = { variation_id: number; variation: string; variation_stock: number };
export type BaseItem = { item_id: number; title: string; stock: number; variations?: BaseVariation[] };

export type Line = {
  variant_id: string;
  label: string;          // バンクエ側の名前 (例: "CLOUD 長袖Tシャツ ブラック L")
  base_label: string;     // BASE側の名前
  base_item_id: number;
  base_variation_id: number | null;
  local_now: number;      // いまのバンクエ在庫 (BASE売上を除く)
  baseline: number;       // 前回反映したときの値
  delta: number;          // BASEに足し引きする数
  base_now: number | null; // いまのBASE在庫 (見つからなければ null)
  target: number | null;  // 反映後のBASE在庫
  clamped: boolean;       // 0未満になるので0で止めた
  problem: string | null; // 反映できない理由
};

// BASE の今の在庫数を読む。見つからなければ null
export function baseStockOf(item: BaseItem | undefined, variationId: number | null): number | null {
  if (!item) return null;
  if (variationId == null) {
    if (item.variations && item.variations.length) return null; // バリエーションを選び直す必要がある
    return Number(item.stock);
  }
  const v = (item.variations || []).find(x => Number(x.variation_id) === Number(variationId));
  return v ? Number(v.variation_stock) : null;
}

export function computeLines(
  maps: MapRow[],
  local: Map<string, number>,
  items: Map<number, BaseItem | undefined>,
  labels: Map<string, string>,
): Line[] {
  return maps.map(m => {
    const local_now = local.get(m.variant_id) ?? 0;
    const delta = local_now - Number(m.baseline);
    const item = items.get(Number(m.base_item_id));
    const base_now = baseStockOf(item, m.base_variation_id);
    let problem: string | null = null;
    if (!item) problem = 'BASEに商品が見つかりません(削除された可能性があります)';
    else if (base_now == null) problem = 'BASEの色・サイズが見つかりません。紐づけを選び直してください';
    let target: number | null = null; let clamped = false;
    if (base_now != null) {
      target = base_now + delta;
      if (target < 0) { target = 0; clamped = true; }
    }
    return {
      variant_id: m.variant_id, label: labels.get(m.variant_id) || '(不明な商品)', base_label: m.base_label || '',
      base_item_id: Number(m.base_item_id), base_variation_id: m.base_variation_id == null ? null : Number(m.base_variation_id),
      local_now, baseline: Number(m.baseline), delta, base_now, target, clamped, problem,
    };
  });
}

// 名前のゆれ(全角・空白・大文字)をそろえる
export const norm = (s: string) => String(s || '').normalize('NFKC').replace(/[\s\/／・_\-]+/g, '').toLowerCase();

// バンクエの色・サイズに合いそうな BASE の候補を探す(自動の紐づけ提案)
export function suggest(
  productName: string, color: string | null, size: string | null, items: BaseItem[],
): { item_id: number; variation_id: number | null; label: string } | null {
  const pn = norm(productName);
  const cands = items.filter(it => { const t = norm(it.title); return t.includes(pn) || pn.includes(t); });
  if (cands.length !== 1) return null; // あいまいなときは提案しない
  const it = cands[0];
  const vs = it.variations || [];
  if (!vs.length) return color || size ? null : { item_id: it.item_id, variation_id: null, label: it.title };
  const want = [color, size].filter(Boolean).map(x => norm(String(x)));
  if (!want.length) return null;
  const hit = vs.filter(v => {
    const t = norm(v.variation);
    return want.every(w => (w.length <= 3 ? sizeMatch(v.variation, w) : t.includes(w)));
  });
  return hit.length === 1 ? { item_id: it.item_id, variation_id: hit[0].variation_id, label: `${it.title} / ${hit[0].variation}` } : null;
}

// サイズ(S/M/L/XL…)は「XL」に「L」が含まれてしまうので、区切りごとに完全一致で比べる
function sizeMatch(variation: string, w: string): boolean {
  return String(variation).normalize('NFKC').toLowerCase().split(/[\s\/／・,、()（）\-_]+/).some(p => p === w);
}
