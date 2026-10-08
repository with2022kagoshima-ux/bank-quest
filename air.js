// Airレジ 月次CSVの読み込み(画面側で解析する。サーバーには整えた結果だけ送る)
import { normName } from './api.js?v=20';

export function decodeCsv(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('shift_jis').decode(buf); }
}
export async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function parseRows(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some(x => x !== '')) rows.push(row); }
  return rows;
}
// 戻り値: { baskets:[{sale_date,txn_no,staff,item_count,total,lines:[{category,menu,type1,type2,price,qty}]}], month }
export function parseAir(text) {
  const rows = parseRows(text);
  if (!rows.length) throw new Error('ファイルが空です');
  const head = rows[0].map(s => s.trim());
  const need = ['取引No', '会計日', 'メニュー名', '価格', '注文数量'];
  for (const n of need) if (!head.includes(n)) throw new Error('Airレジの売上CSVではないようです(「' + n + '」の列がありません)');
  const ix = n => head.indexOf(n);
  const baskets = []; let cur = null;
  for (const r of rows.slice(1)) {
    const no = (r[ix('取引No')] || '').trim(); if (!no) continue;
    const date = (r[ix('会計日')] || '').trim().replaceAll('/', '-');
    if (date) {
      const dd = date.split('-'); const iso = dd.length === 3 ? `${dd[0]}-${dd[1].padStart(2, '0')}-${dd[2].padStart(2, '0')}` : null;
      if (!iso || isNaN(Date.parse(iso))) throw new Error('会計日が読めません: ' + date);
      cur = { sale_date: iso, txn_no: no, staff: (r[ix('レジ担当者名')] || '').trim(), item_count: (r[ix('商品点数')] || '').trim(), total: (r[ix('合計')] || '').trim(), lines: [] };
      baskets.push(cur);
    } else if (!cur || cur.txn_no !== no) throw new Error('取引No ' + no + ' の会計日がありません');
    const price = Number((r[ix('価格')] || '').replace(/[^0-9-]/g, '')); const qty = Number((r[ix('注文数量')] || '').replace(/[^0-9-]/g, ''));
    if (!Number.isFinite(price) || !(qty > 0)) throw new Error('金額か数量が読めません(取引No ' + no + ')');
    cur.lines.push({ category: (r[ix('カテゴリー名')] || '').trim(), menu: (r[ix('メニュー名')] || '').trim(), type1: (r[ix('種別１')] || r[ix('種別1')] || '').trim(), type2: (r[ix('種別２')] || r[ix('種別2')] || '').trim(), price, qty });
  }
  if (!baskets.length) throw new Error('売上の行がありません');
  const months = [...new Set(baskets.map(b => b.sale_date.slice(0, 7)))].sort();
  return { baskets, month: months[0] + '-01', months };
}
const nn = s => normName(s || '');
export const keyOf = l => [nn(l.menu), nn(l.type1), nn(l.type2)].join('|');
// 商品マスタとの自動照合(名前→商品、種別1・2→色/サイズ)
export function autoMatch(l, products) {
  const p = products.find(x => normName(x.name) === nn(l.menu));
  if (!p) return null;
  const vs = p.variants;
  if (!l.type1 && !l.type2) return vs.length === 1 ? vs[0].id : null;
  const want = { size: '', color: '' };
  if (p.air_type1_role) want[p.air_type1_role] = nn(l.type1);
  if (p.air_type2_role) want[p.air_type2_role] = nn(l.type2);
  const hit = vs.filter(v => nn(v.size) === want.size && nn(v.color) === want.color);
  return hit.length === 1 ? hit[0].id : null;
}
