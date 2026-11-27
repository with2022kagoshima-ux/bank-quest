// 投稿先の定義・制限・文章生成・チェック処理（サーバーと画面の両方で使う）
// 制限値は 2026年10月時点の各社公式ドキュメントに基づく。変更されることがあるため、
// 値は SPECS にまとめ、画面にも「確認日」とリンクを表示する。

export const SPEC_CHECKED_AT = '2026-10-08';

const MB = 1024 * 1024;
const GB = 1024 * MB;

// ------------------------------------------------------------
// 投稿先と投稿形式
// ------------------------------------------------------------
export const DESTINATIONS = [{"key": "instagram","name": "Instagram","openUrl": "https://www.instagram.com/","formats": [{"key": "feed","label": "フィード（画像）","media": "image"},{"key": "reel","label": "リール（動画）","media": "video"},{"key": "story","label": "ストーリー","media": "imageOrVideo"}]},{"key": "x","name": "X","openUrl": "https://x.com/compose/post","formats": [{"key": "text","label": "テキストのみ","media": "none"},{"key": "media","label": "画像・動画付き","media": "imageOrVideo"}]},{"key": "tiktok","name": "TikTok","openUrl": "https://www.tiktok.com/tiktokstudio/upload","formats": [{"key": "video","label": "動画投稿","media": "video"}]},{"key": "youtube","name": "YouTube","openUrl": "https://studio.youtube.com/","formats": [{"key": "video","label": "通常動画","media": "video"},{"key": "shorts","label": "Shorts","media": "video"}]},{"key": "googleForm","name": "Googleフォーム（チケット予約）","openUrl": "https://docs.google.com/forms/","formats": [{"key": "addShow","label": "公演の希望枚数欄を追加","media": "imageOptional"}]},{"key": "bandsintown","name": "Bandsintown for Artists","openUrl": "https://artists.bandsintown.com/","formats": [{"key": "event","label": "イベント登録","media": "none"}]},{"key": "wordpress","name": "Wiθ公式サイト LIVE","openUrl": "","formats": [{"key": "liveEntry","label": "LIVE投稿を作成","media": "imageOptional"}]}];

export const ACTION_LABELS = {
  post: '投稿',
  draft: '下書き保存',
  manual: '手動で投稿',
};

export const STATUS = {
  notStarted: { label: '未着手', tone: 'muted' },
  draft: { label: '下書き保存済み', tone: 'info' },
  scheduled: { label: '予約中', tone: 'info' },
  manualPending: { label: '手動対応待ち', tone: 'warn' },
  manualDone: { label: '手動で完了', tone: 'ok' },
  dryRun: { label: '確認のみ（送信していません）', tone: 'info' },
  processing: { label: '処理中（相手側で反映待ち）', tone: 'info' },
  success: { label: '完了', tone: 'ok' },
  failed: { label: '失敗', tone: 'error' },
  waitingEligibility: { label: '利用条件により登録待ち', tone: 'warn' },
  skipped: { label: '対象外', tone: 'muted' },
};

export function getDestination(key) {
  return DESTINATIONS.find((d) => d.key === key);
}

export function getFormat(destKey, formatKey) {
  const d = getDestination(destKey);
  return d?.formats.find((f) => f.key === formatKey) || d?.formats[0];
}

// ------------------------------------------------------------

// 文字数の数え方
// ------------------------------------------------------------
const URL_RE = /https?:\/\/[^\s　]+/g;

/** Xの文字数の上限。X Premium（有料）のアカウントは長文投稿ができるため 25,000 */
let X_LIMIT = 280;
/** 1つの投稿に載せられる画像の枚数（Instagramのフィード・X） */
export const MAX_POST_IMAGES = 3;

export function setXPremium(on) { X_LIMIT = on ? 25000 : 280; }
export function xLimit() { return X_LIMIT; }

/** Xの文字数（半角1・全角2、URLは一律23）。上限は xLimit()。 */
export function countX(text) {
  let total = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    total += 23;
    return '';
  });
  for (const ch of withoutUrls.normalize('NFC')) {
    const cp = ch.codePointAt(0);
    const light =
      (cp >= 0 && cp <= 4351) || (cp >= 8192 && cp <= 8205) ||
      (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
    total += light ? 1 : 2;
  }
  return total;
}

export function countChars(text) {
  return [...text].length;
}
export function countUtf16(text) {
  return text.length;
}
export function countBytes(text) {
  return new TextEncoder().encode(text).length;
}
export function hashtagsOf(text) {
  return text.match(/[#＃][^\s#＃]+/g) || [];
}
export function mentionsOf(text) {
  return text.match(/(^|[^\w])@[A-Za-z0-9._]+/g) || [];
}

// ------------------------------------------------------------
// 日付まわり
// ------------------------------------------------------------
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], w: WEEK[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] };
}
export function fmtDateDot(ymd) {
  const p = parseYmd(ymd);
  return p ? `${p.y}.${String(p.mo).padStart(2, '0')}.${String(p.d).padStart(2, '0')}(${p.w})` : '';
}
export function fmtDateShort(ymd) {
  const p = parseYmd(ymd);
  return p ? `${p.mo}/${p.d}(${p.w})` : '';
}
/** フォームの質問の先頭に使う日付（2026/10/10）。二重登録の判定にも使う */
export function formDateKey(ymd) {
  const p = parseYmd(ymd);
  return p ? `${p.y}/${p.mo}/${p.d}` : '';
}
export function fmtDateJa(ymd) {
  const p = parseYmd(ymd);
  return p ? `${p.y}年${p.mo}月${p.d}日（${p.w}）` : '';
}

/** 東京時間の今日（YYYY-MM-DD） */
export function todayTokyo(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
}

/** 公演が終了済みか（日付が今日より前、または今日で終演時刻を過ぎている） */
export function isPastLive(live, now = new Date()) {
  if (!live?.date) return false;
  const today = todayTokyo(now);
  if (live.date < today) return true;
  if (live.date === today && live.endTime) {
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    return hm > live.endTime;
  }
  return false;
}

/** 投稿・公開が禁止されている理由（なければ null） */
export function publishBlockReason(live, now = new Date()) {
  if (live?.isSample) return 'サンプルデータのため公開・投稿できません（サンプル／公開しない）';
  if (isPastLive(live, now)) return '終了した公演のため公開・投稿できません（サンプル／公開しない）';
  return null;
}

// ------------------------------------------------------------
// 文章の自動生成
// ------------------------------------------------------------
// 改行・「、」・「,」で区切る。ただし（Manchester, UK）のようにカッコの中の区切りでは分けない
function lines(s) {
  const out = [];
  let cur = '', depth = 0;
  for (const ch of String(s || '')) {
    if ('(（[［【'.includes(ch)) depth++;
    else if (')）]］】'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === '\n' || ch === '\r' || (depth === 0 && (ch === '、' || ch === ','))) { out.push(cur); cur = ''; if (ch === '\n' || ch === '\r') depth = 0; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
/** 「ほか」「他」「など」「and more」などの書き方は「and more...」にそろえる */
const AND_MORE = 'and more...';
const isAndMore = (p) => /^(ほか|他|その他|ほか多数|他多数|など|andmore|＆more|&more)$/i.test(String(p).replace(/[（）()…．.。\s　]/g, ''));
export function performersOf(live) {
  const list = Array.isArray(live.performers) ? live.performers.filter(Boolean) : lines(live.performers);
  const named = list.filter((p) => !isAndMore(p));
  return named.length < list.length ? [...named, AND_MORE] : named;
}
// 出店欄で「FOOD:」のように最後に「:」「：」が付いた行は小見出し
const isSubHead = (s) => /[:：]\s*$/.test(String(s));
const dropColon = (s) => String(s).trim().replace(/[:：]\s*$/, '');
/** 出店欄の行（小見出しの行もそのまま含む） */
export function shopLinesOf(live) {
  return Array.isArray(live.shops) ? live.shops.filter(Boolean) : String(live.shops || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}
/** 出店の店名だけ（小見出しの行は除く） */
export function shopsOf(live) {
  return shopLinesOf(live).filter((x) => !isSubHead(x));
}
// 「ACT」「SHOP」の見出しはライブごとに書き換えられる（空にすると見出しなし）
const labelOf = (live, k, def) => dropColon(typeof live?.[k] === 'string' ? live[k] : def);
export const actLabelOf = (live) => labelOf(live, 'actLabel', 'ACT');
export const shopLabelOf = (live) => labelOf(live, 'shopLabel', 'SHOP');
/** SNS用：「見出し：」＋1行ずつ（小見出しの前は1行あける） */
export function snsSection(label, items) {
  if (!items.length) return '';
  const body = items.map((x, i) => (isSubHead(x) && i > 0 ? `\n${x}` : x)).join('\n');
  return label ? `${label}：\n${body}` : body;
}
/** 1行にまとめる形（「ACT：A / B」） */
export function inlineSection(label, items, sep = ' / ') {
  if (!items.length) return '';
  const body = items.map((x) => (isSubHead(x) ? `${dropColon(x)}：` : x)).join(sep).replace(new RegExp(`：${sep.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'g'), '：');
  return label ? `${label}：${body}` : body;
}
/** 公式サイト用の段落（「-ACT-」形式。小見出しも「-FOOD-」に） */
function wpSection(label, items) {
  if (!items.length) return '';
  return para([label ? `-${label}-` : '', ...items.map((x) => (isSubHead(x) ? `-${dropColon(x)}-` : x))]);
}
/** Instagramのハッシュタグの上限 */
export const IG_MAX_HASHTAGS = 5;

/** SNS投稿の先頭につける見出し */
export const LIVE_INFO_HEAD = '【LIVE INFO】';
function timeLine(live) {
  const parts = [];
  if (live.openTime) parts.push(`OPEN ${live.openTime}`);
  if (live.startTime) parts.push(`START ${live.startTime}`);
  if (live.endTime) parts.push(`END ${live.endTime}`);
  return parts.join(' / ');
}
function priceLine(live) {
  const parts = [];
  if (live.ticketPrice) parts.push(live.ticketPrice);
  if (live.drinkFee) parts.push(live.drinkFee);
  return parts.join(' ');
}
function venueLine(live) {
  return [live.region && !String(live.venue || '').includes(live.region) ? live.region : '', live.venue].filter(Boolean).join(' ');
}

/** 会場名から @ハンドルを取り出す（例：神戸 太陽と虎（@taitora_kobe）） */
export function venueHandle(live) {
  const m = /@([A-Za-z0-9._]+)/.exec(live.venue || '');
  return m ? m[1] : '';
}
export function venuePlainName(live) {
  // 「（@handle）」でも「 @handle」でも、会場のSNSアカウント部分は外す
  return String(live.venue || '').replace(/[（(]\s*@[A-Za-z0-9._]+\s*[)）]/g, '').replace(/\s*@[A-Za-z0-9._]+/g, '').replace(/\s+/g, ' ').trim();
}

/** ハッシュタグにできない文字（空白・記号）を取り除く。「SR HALL」→「#SRHALL」 */
function tagify(s) {
  const body = String(s).normalize('NFKC').replace(/[^\p{L}\p{N}_]/gu, '');
  return body ? '#' + body : '';
}
/** 会場名の部分（地域・地名を外した会場そのものの名前）。例：「東京 中野 MOONSTEP」→「MOONSTEP」、「SR HALL」→「SR HALL」 */
function venueCore(live) {
  let words = venuePlainName(live).split(/\s+/).filter(Boolean);
  const region = String(live.region || '').trim();
  // 先頭の地域名（例：鹿児島 SR HALL の「鹿児島」）を外す
  while (words.length > 1 && region && (words[0] === region || region.includes(words[0]))) words = words.slice(1);
  // 先頭が日本語の地名で、そのあとが英字の会場名なら地名を外す（例：中野 MOONSTEP）
  const cjk = (w) => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(w);
  const latin = (w) => /[A-Za-z]/.test(w);
  while (words.length > 1 && cjk(words[0]) && words.slice(1).some(latin)) words = words.slice(1);
  return words.join(' ');
}
/** 会場名のハッシュタグ（例：#MOONSTEP、#SRHALL）。空白や記号は詰める */
export function venueTag(live) {
  const core = venueCore(live);
  return core ? tagify(core) : '';
}
/** 以前の作り方の会場ハッシュタグ（会場名の最後の語だけ：例 #HALL）。作り直し用 */
export function legacyVenueTag(live) {
  const plain = venuePlainName(live).split(/\s+/).filter(Boolean);
  return plain.length ? tagify(plain[plain.length - 1]) : '';
}
export function defaultHashtags(live, destKey) {
  const tags = ['#Wiθ', '#ライブ告知'];
  const plain = venuePlainName(live).split(/\s+/).filter(Boolean);
  if (live.region) tags.push(tagify(live.region));
  else if (plain.length > 1 && !/[A-Za-z]/.test(plain[0])) tags.push(tagify(plain[0]));
  const vt = venueTag(live);
  if (vt) tags.push(vt);
  if (destKey === 'tiktok') tags.push('#バンド', '#ライブ');
  if (destKey === 'instagram' || destKey === 'x') tags.push('#バンド');
  // Instagramはハッシュタグ5個まで
  return [...new Set(tags.filter(Boolean))].slice(0, destKey === 'instagram' ? IG_MAX_HASHTAGS : 99).join(' ');
}

function primaryLink(live) {
  return live.reserveFormUrl || live.playguideUrl || '';
}

/** 投稿先ごとの初期文章を作る */
export function generateContent(live, destKey) {
  if (live.kind === 'announce') return generateAnnouncement(live, destKey);
  const date = fmtDateDot(live.date);
  const venue = venueLine(live);
  const t = timeLine(live);
  const price = priceLine(live);
  const perf = performersOf(live);
  const link = primaryLink(live);
  const hashtags = defaultHashtags(live, destKey);
  const extra = (live.announcement || '').trim();

  // SNS共通の形：
  // 【LIVE INFO】
  //
  // 公演名
  // 📅 日付 / 📍 会場 / ⏰ 時間 / 🎫 料金
  //
  // ACT：
  // 出演者（1行に1組）
  // and more...
  const block = [
    live.title ? String(live.title).trim() : '',
    date ? `📅 ${date}` : '',
    venue ? `📍 ${venue}` : '',
    t ? `⏰ ${t}` : '',
    price ? `🎫 ${price}` : '',
    live.bonus ? `🎁 入場特典：${live.bonus}` : '',
  ].filter(Boolean).join('\n');
  const shopLines = shopLinesOf(live);
  const shopBlock = snsSection(shopLabelOf(live), shopLines);
  const perfBlock = [snsSection(actLabelOf(live), perf), shopBlock].filter(Boolean).join('\n\n');
  const tail = [live.salesMethod, live.notes].filter(Boolean).join('\n');
  const HEAD = snsHeadOf(live);
  const sns = (...parts) => [HEAD, ...parts].filter(Boolean).join('\n\n');

  switch (destKey) {
    case 'instagram': {
      // 「プロフィールのリンク or DMから」はライブごとに入れる／入れないを選べる（TIGETのみ受付などのとき外す）
      const body = sns(block, perfBlock, tail, extra, link && profileReserveOn(live) ? 'チケット予約は、プロフィールのリンク or DMから！' : '');
      return { body, hashtags, link, format: 'feed' };
    }
    case 'x': {
      // 上限（無料は280・全角は2、Premiumは25,000）に収まるよう、情報を少しずつ削った候補から最初に収まるものを使う
      // X Premium（長文OK）ならInstagramと同じハッシュタグ。無料（280字）なら #Wiθ だけ
      const xTags = X_LIMIT > 280 ? defaultHashtags(live, 'x') : '#Wiθ';
      const compose = (b) => [b, link, xTags].filter(Boolean).join('\n\n');
      const perfShort = [snsSection(actLabelOf(live), perf.map(shortName)), shopBlock].filter(Boolean).join('\n\n');
      const perfSlash = [inlineSection(actLabelOf(live), perf.map(shortName)), inlineSection(shopLabelOf(live), shopLines)].filter(Boolean).join('\n');
      const candidates = [
        [block, perfBlock, tail, extra], [block, perfBlock, tail], [block, perfBlock], [block, perfShort], [block, perfSlash], [block],
      ].map((parts) => sns(...parts));
      const body = candidates.find((b) => countX(compose(b)) <= X_LIMIT) || candidates[candidates.length - 1];
      return { body, hashtags: xTags, link, format: 'media' };
    }
    case 'tiktok': {
      const body = sns(block, perfBlock, tail, profileReserveOn(live) ? '🎟 予約はプロフィールから' : '');
      return { body, hashtags, link: '', format: 'video', privacy: '' };
    }
    case 'youtube': {
      const title = truncate(`${HEAD}${stripBrackets(live.title || '')} ${fmtDateShort(live.date)} ${venuePlainName(live)}`.trim(), 100);
      const body = sns(block, perfBlock, tail, extra, link ? `▼チケット予約\n${link}` : '');
      return { title, body, hashtags: '#Wiθ #ライブ', link: '', format: 'video', privacy: 'private' };
    }
    case 'googleForm': {
      // 既存フォームと同じ書き方：「2026/10/10 (土) 神戸 太陽と虎」＋ 案内文
      // 地名（地域）を先頭に付ける。会場名がすでに地名で始まっているときは重ねない
      const vp = venuePlainName(live); const rg = String(live.region || '').trim();
      const place = rg && !vp.normalize('NFKC').includes(rg.normalize('NFKC')) ? `${rg} ${vp}` : vp;
      const title = `${formDateKey(live.date)} (${parseYmd(live.date)?.w || ''}) ${place}\n※(選択)の部分にご希望枚数をご指定ください🙇‍♂️`.trim();
      const body = '';
      return { title, body, hashtags: '', link: '', format: 'addShow', options: '1\n2\n3\n4\n5', required: false };
    }
    case 'bandsintown': {
      const body = [
        `イベント名：${live.title || ''}`,
        `日付：${live.date || ''}`,
        `開場：${live.openTime || ''}`,
        `開演：${live.startTime || ''}`,
        `会場：${venuePlainName(live)}`,
        `住所：${live.venueAddress || ''}`,
        `地域：${live.region || ''}`,
        `国：Japan`,
        `出演（ラインナップ）：${perf.filter((p) => p !== AND_MORE).join(', ')}`,
        `チケットURL：${link}`,
        `チケット種別：${price}`,
        `説明：${[live.bonus ? '入場特典：' + live.bonus : '', inlineSection(shopLabelOf(live), shopLines, ', '), live.notes].filter(Boolean).join(' ')}`,
      ].join('\n');
      return { body, hashtags: '', link, format: 'event' };
    }
    case 'wordpress': {
      return { title: wordpressTitle(live), body: wordpressHtml(live), hashtags: '', link: '', format: 'liveEntry', privacy: 'draft' };
    }
    default:
      return { body: block, hashtags: '', link: '' };
  }
}

// ------------------------------------------------------------
// Bandsintown for Artists の「Upload Events」用の1行ぶん
// ------------------------------------------------------------
const BIT_CITY = { '鹿児島': 'Kagoshima', '福岡': 'Fukuoka', '北九州': 'Kitakyushu', '小倉': 'Kitakyushu', '熊本': 'Kumamoto', '長崎': 'Nagasaki', '佐賀': 'Saga', '大分': 'Oita', '宮崎': 'Miyazaki', '沖縄': 'Okinawa', '那覇': 'Naha', '広島': 'Hiroshima', '岡山': 'Okayama', '山口': 'Yamaguchi', '徳島': 'Tokushima', '高松': 'Takamatsu', '香川': 'Kagawa', '松山': 'Matsuyama', '愛媛': 'Ehime', '高知': 'Kochi', '神戸': 'Kobe', '大阪': 'Osaka', '京都': 'Kyoto', '奈良': 'Nara', '名古屋': 'Nagoya', '東京': 'Tokyo', '横浜': 'Yokohama', '仙台': 'Sendai', '札幌': 'Sapporo', '新潟': 'Niigata', '金沢': 'Kanazawa', '静岡': 'Shizuoka', '浜松': 'Hamamatsu', '三重': 'Mie', '津': 'Tsu' };
export const BIT_HEADERS = ['Venue', 'Country', 'Address', 'City', 'Region', 'Postal Code', 'Start Date', 'End Date', 'Start Time', 'End Time', 'Streaming Link', 'Ticket Link', 'Ticket Type', 'Ticket Link 2', 'Ticket Type 2', 'On-Sale Date', 'On-Sale Time', 'Lineup', 'Event Name', 'Description', 'Scheduled date', 'Scheduled time', 'Timezone'];
export function bandsintownRow(live) {
  const hm = (s) => { const m = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(String(s || '').normalize('NFKC')); return m ? String(m[1]).padStart(2, '0') + ':' + m[2] : ''; };
  const city = BIT_CITY[String(live.region || '').trim()] || String(live.region || '').trim();
  const lineup = performersOf(live).filter((p) => p !== AND_MORE && !/^wi\s*[θϴΘ]/i.test(String(p).normalize('NFKC').trim())).join(', ');
  const link = primaryLink(live) || '';
  const desc = [live.bonus ? '入場特典：' + live.bonus : '', live.notes].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return {
    'Venue': venuePlainName(live), 'Country': 'Japan', 'Address': live.venueAddress || '', 'City': city, 'Region': city, 'Postal Code': '',
    'Start Date': String(live.date || '').slice(0, 10), 'End Date': '', 'Start Time': hm(live.startTime) || hm(live.openTime), 'End Time': '',
    'Streaming Link': '', 'Ticket Link': link, 'Ticket Type': link ? 'Tickets' : '', 'Ticket Link 2': '', 'Ticket Type 2': '', 'On-Sale Date': '', 'On-Sale Time': '',
    'Lineup': lineup, 'Event Name': live.title || '', 'Description': desc, 'Scheduled date': '', 'Scheduled time': '', 'Timezone': 'Asia/Tokyo',
  };
}
export function bandsintownCsv(live) {
  const row = bandsintownRow(live);
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  // ライブ配信用・2つ目のチケット用の列は、空のままだと「無効なURL」と言われることがあるので、空なら列ごと外す
  const OPT = ['End Date', 'End Time', 'Streaming Link', 'Ticket Link 2', 'Ticket Type 2'];
  const cols = BIT_HEADERS.filter((k) => !OPT.includes(k) || String(row[k] || '').trim());
  return '\ufeff' + cols.map(q).join(',') + '\r\n' + cols.map((k) => q(row[k])).join(',') + '\r\n';
}

// ------------------------------------------------------------
// ライブに付随する告知（タイムテーブル解禁・出演ACT追加）
// ------------------------------------------------------------
export const ANNOUNCE_TYPES = {
  timetable: { label: 'タイムテーブル解禁', head: '【タイムテーブル解禁】' },
  addAct: { label: '出演ACT追加', head: '【ADD ACT】' },
};
/** 告知を投稿できる先（予約フォーム・Bandsintownは対象外） */
export const ANNOUNCE_TARGETS = ['instagram', 'x', 'tiktok', 'youtube', 'wordpress'];

function textLines(s) {
  return String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}
/** SNSの文章の先頭に必ずつける見出し（ライブ告知＝【LIVE INFO】、告知＝種類ごと、かんたん投稿＝なし） */
/** SNSの最後に「予約はプロフィールのリンク or DMから」を入れるか（未設定なら入れる） */
export const profileReserveOn = (live) => live?.profileReserve !== false;
/** 見出しの候補（ライブ情報の編集画面でボタンから選べる） */
export const HEAD_PRESETS = ['【LIVE INFO】', '【情報解禁】', '【INFO】', '【NEW LIVE】', '【追加公演】', '【タイムテーブル解禁】', '【ADD ACT】', '【TICKET】'];
/** SNSの本文の1行目の見出し。ライブごとに選べる（未設定なら種類ごとの初期値、空なら見出しなし） */
export function snsHeadOf(live) {
  if (live.kind === 'post') return '';
  if (typeof live.snsHead === 'string') return live.snsHead.trim();
  if (live.kind === 'announce') return (ANNOUNCE_TYPES[live.announceType] || ANNOUNCE_TYPES.timetable).head;
  return LIVE_INFO_HEAD;
}
/** 手で直した文章でも、先頭の見出しが消えていたら付け直す（見出しを変えたら、前の見出しは外す） */
export function ensureSnsHead(live, destKey, body) {
  if (!['instagram', 'x', 'tiktok', 'youtube'].includes(destKey) || live.kind === 'post') return body;
  const head = snsHeadOf(live);
  let b = String(body || '').replace(/^\s+/, '');
  if (head && b.startsWith(head)) return body;
  // 先頭が別の見出し（候補にあるもの）なら外す
  const first = b.split('\n')[0].trim();
  if (first !== head && HEAD_PRESETS.includes(first)) b = b.slice(b.indexOf('\n') < 0 ? b.length : b.indexOf('\n')).replace(/^\s+/, '');
  return head ? `${head}\n\n${b}` : b;
}

export function addedActsOf(a) {
  return textLines(a.addedActs);
}

/** 追加ACTを出演者に足した一覧（and more... は最後に残す） */
export function mergeActs(performers, added) {
  const cur = String(performers || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const add = String(added || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const more = cur.filter((p) => isAndMore(p));
  const named = cur.filter((p) => !isAndMore(p));
  for (const a of add) if (!named.some((n) => n.toLowerCase() === a.toLowerCase())) named.push(a);
  return [...named, ...more].join('\n');
}


function generateAnnouncement(a, destKey) {
  const type = ANNOUNCE_TYPES[a.announceType] || ANNOUNCE_TYPES.timetable;
  const head = snsHeadOf(a);
  const date = fmtDateDot(a.date);
  const venue = venueLine(a);
  const link = primaryLink(a);
  const perf = performersOf(a);
  const shopLines = shopLinesOf(a);
  const added = addedActsOf(a);
  const msg = String(a.message || '').trim();
  const info = [a.title ? String(a.title).trim() : '', date ? `📅 ${date}` : '', venue ? `📍 ${venue}` : ''].filter(Boolean).join('\n');
  const tt = textLines(a.timetable).join('\n');
  const actBlock = [snsSection(actLabelOf(a), perf), snsSection(shopLabelOf(a), shopLines)].filter(Boolean).join('\n\n');
  const main = a.announceType === 'addAct'
    ? [added.length ? `追加出演決定！\n${added.join('\n')}` : '', actBlock]
    : [tt];
  const sns = (...parts) => [head, ...parts].filter(Boolean).join('\n\n');
  const hashtags = defaultHashtags(a, destKey);

  switch (destKey) {
    case 'instagram':
      return { body: sns(info, ...main, msg, link && profileReserveOn(a) ? 'チケット予約は、プロフィールのリンク or DMから！' : ''), hashtags, link, format: 'feed' };
    case 'x': {
      const xTags = X_LIMIT > 280 ? defaultHashtags(a, 'x') : '#Wiθ';
      const compose = (b) => [b, link, xTags].filter(Boolean).join('\n\n');
      const slimAct = a.announceType === 'addAct'
        ? [added.length ? `追加出演決定！\n${added.join('\n')}` : '', inlineSection(actLabelOf(a), perf.map(shortName))]
        : main;
      const candidates = [[info, ...main, msg], [info, ...main], [info, ...slimAct], [info, ...main.slice(0, 1)]].map((parts) => sns(...parts));
      const body = candidates.find((b) => countX(compose(b)) <= X_LIMIT) || candidates[candidates.length - 1];
      return { body, hashtags: xTags, link, format: 'media' };
    }
    case 'tiktok':
      return { body: sns(info, ...main, msg, '🎟 予約はプロフィールから'), hashtags, link: '', format: 'video', privacy: '' };
    case 'youtube': {
      const title = truncate(`${head}${a.title || ''} ${fmtDateShort(a.date)} ${venuePlainName(a)}`.trim(), 100);
      return { title, body: sns(info, ...main, msg, link ? `▼チケット予約\n${link}` : ''), hashtags: '#Wiθ #ライブ', link: '', format: 'video', privacy: 'private' };
    }
    case 'wordpress': {
      // 公式サイトのNEWS（通常の投稿）に下書きで作る
      const p = parseYmd(a.date);
      const dateLine = p ? `${p.y}年${p.mo}月${p.d}日 (${p.w})` : '';
      const blocks = [
        para([a.title, venuePlainName(a) ? `📍 ${venuePlainName(a)}` : '', dateLine]),
        a.announceType === 'addAct'
          ? [added.length ? para(['-追加出演決定-', ...added]) : '', wpSection(actLabelOf(a), perf), wpSection(shopLabelOf(a), shopLines)].filter(Boolean).join('\n\n')
          : (tt ? para(['-TIME TABLE-', ...textLines(a.timetable)]) : ''),
        msg ? para(msg.split('\n')) : '',
        a.reserveFormUrl ? para(['Wiθ チケット予約ページ', linkHtml(a.reserveFormUrl)]) : '',
      ];
      return { title: `${head}${wordpressTitle(a)}`, body: blocks.filter(Boolean).join('\n\n'), hashtags: '', link: '', format: 'liveEntry', privacy: 'draft' };
    }
    default:
      return { body: sns(info, ...main), hashtags: '', link: '' };
  }
}

function titleLine(t) {
  const s = String(t).trim();
  return /[【】]/.test(s) ? s : `【${s}】`;
}
function stripBrackets(s) {
  return String(s).trim();
}
function shortName(p) {
  return String(p).replace(/[（(].*?[）)]/g, '').trim();
}
function truncate(s, n) {
  const arr = [...s];
  return arr.length > n ? arr.slice(0, n - 1).join('') + '…' : s;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function liveMarkerId(live) {
  return `wiθ-live-${live.id}`;
}

const WEEK_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** 公式サイトの既存LIVE投稿と同じタイトル形式：2026.10.12 (MON) @大阪 新神楽 */
export function wordpressTitle(live) {
  const p = parseYmd(live.date);
  const d = p ? `${p.y}.${p.mo}.${p.d} (${WEEK_EN[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()]})` : '';
  const v = venuePlainName(live);
  return [d, v ? `@${v}` : ''].filter(Boolean).join(' ');
}

function para(lines) {
  const html = lines.filter((l) => l != null && l !== '').map((l) => (typeof l === 'object' ? l.html : esc(l))).join('<br>');
  return html ? `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->` : '';
}
function linkHtml(url) {
  return { html: `<a href="${esc(url)}">${esc(url)}</a>` };
}

/** 公式サイトのLIVE投稿本文（既存投稿と同じ段落構成のブロック） */
export function wordpressHtml(live) {
  const perf = performersOf(live);
  const p = parseYmd(live.date);
  const dateLine = p ? `${p.y}年${p.mo}月${p.d}日 (${p.w})` : '';
  const ticket = [priceLine(live), live.bonus ? `入場特典：${live.bonus}` : ''].filter(Boolean);
  const blocks = [
    para([live.title, venuePlainName(live) ? `📍 ${venuePlainName(live)}` : '']),
    para([dateLine, live.openTime ? `OPEN ${live.openTime}` : '', live.startTime ? `START ${live.startTime}` : '', live.endTime ? `END ${live.endTime}` : '']),
    ticket.length ? para(['-TICKET-', ...ticket]) : '',
    wpSection(actLabelOf(live), perf),
    wpSection(shopLabelOf(live), shopLinesOf(live)),
    live.notes ? para(String(live.notes).split('\n')) : '',
    para(['======================================']),
    para(['各ライブチケット絶賛販売中‼️', 'Wiθからもご購入いただけます！', 'DMもしくは、Wiθチケット予約ページまで！']),
    live.reserveFormUrl ? para(['Wiθ チケット予約ページ', linkHtml(live.reserveFormUrl)]) : '',
    live.playguideUrl ? para(['プレイガイド', linkHtml(live.playguideUrl)]) : '',
  ];
  return blocks.filter(Boolean).join('\n\n');
}

/** 画像ブロック（アップロード後に本文の最後へ追加） */
export function wordpressImageBlock(id, url) {
  return `<!-- wp:image {"id":${Number(id)},"sizeSlug":"large","linkDestination":"none"} -->\n<figure class="wp-block-image size-large"><img src="${esc(url)}" alt="" class="wp-image-${Number(id)}"/></figure>\n<!-- /wp:image -->`;
}

// ------------------------------------------------------------
/** 投稿本文・リンク・ハッシュタグを結合した最終文章 */
export function composeText(destKey, c) {
  if (destKey === 'youtube') return [c.body, c.link, c.hashtags].filter((x) => x && x.trim()).join('\n\n');
  if (destKey === 'googleForm') return [c.title, c.body, c.options ? `選択肢：${String(c.options).split('\n').filter(Boolean).join(' / ')}` : ''].filter((x) => x && String(x).trim()).join('\n');
  if (['bandsintown', 'wordpress'].includes(destKey)) return c.body || '';
  return [c.body, c.link, c.hashtags].filter((x) => x && x.trim()).join('\n\n');
}

// ------------------------------------------------------------
// 文章のチェック
// ------------------------------------------------------------
/** 文章の制限チェック。戻り値 {counters:[{label,value,max}], issues:[{level,msg}]} */
export function checkText(destKey, c) {
  const text = composeText(destKey, c);
  const counters = [];
  const issues = [];
  const over = (label, value, max, unit = '字') => {
    counters.push({ label, value, max });
    if (value > max) issues.push({ level: 'error', msg: `${label}が上限を超えています（${value}${unit} / ${max}${unit}）` });
  };
  switch (destKey) {
    case 'instagram': {
      over('キャプション', countChars(text), 2200);
      over('ハッシュタグ', hashtagsOf(text).length, IG_MAX_HASHTAGS, '個');
      over('@メンション', mentionsOf(text).length, 20, '個');
      if (/https?:\/\//.test(text)) issues.push({ level: 'warn', msg: 'Instagramのキャプション内のURLはタップできません。プロフィールのリンクに設定してください' });
      break;
    }
    case 'x': {
      over(X_LIMIT > 280 ? '文字数（X Premium）' : '文字数（全角は2として計算）', countX(text), X_LIMIT);
      if (c.link) issues.push({ level: 'info', msg: 'リンク付きの投稿は、X APIの料金が通常より高くなります' });
      break;
    }
    case 'tiktok': {
      over('キャプション', countUtf16(text), 2200);
      if (c.link || /https?:\/\//.test(text)) issues.push({ level: 'warn', msg: 'TikTokのキャプション内のURLはタップできません' });
      break;
    }
    case 'youtube': {
      over('タイトル', countChars(c.title || ''), 100);
      over('説明欄', countBytes(text), 5000, 'バイト');
      if (!c.title?.trim()) issues.push({ level: 'error', msg: 'タイトルを入力してください' });
      if (/[<>]/.test((c.title || '') + text)) issues.push({ level: 'error', msg: 'タイトルと説明欄に「<」「>」は使えません' });
      if (c.format === 'shorts' && !/#shorts/i.test(text + (c.title || ''))) {
        issues.push({ level: 'info', msg: 'Shortsとして認識されやすくするため、#Shorts を入れることもできます（必須ではありません）' });
      }
      break;
    }
    case 'googleForm': {
      if (!c.title?.trim()) issues.push({ level: 'error', msg: '質問のタイトルを入力してください' });
      const opts = String(c.options || '').split('\n').map((s) => s.trim()).filter(Boolean);
      if (opts.length < 1) issues.push({ level: 'error', msg: '選択肢を1つ以上入れてください' });
      if (new Set(opts).size !== opts.length) issues.push({ level: 'error', msg: '選択肢が重複しています' });
      break;
    }
    case 'wordpress': {
      if (!c.title?.trim()) issues.push({ level: 'error', msg: 'タイトルを入力してください' });
      if (!text.trim()) issues.push({ level: 'error', msg: '本文が空です' });
      break;
    }
    default:
      break;
  }
  if (['instagram', 'x', 'tiktok', 'youtube'].includes(destKey) && !text.trim()) {
    issues.push({ level: 'error', msg: '本文が空です' });
  }
  return { counters, issues };
}

// ------------------------------------------------------------
