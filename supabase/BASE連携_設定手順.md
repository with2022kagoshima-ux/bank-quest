# BASE在庫連携 設定手順

バンクエで増えた・減った在庫の数を、ボタン1つでBASEに足し引きする仕組みです。
BASEで売れた分はBASE側ですでに減っているので、上書きはしません。

## 全体の流れ

1. BASE Developers でアプリを申請する（審査待ち）
2. Supabase に SQL を流す
3. Supabase に中継プログラム（Edge Function）を置く
4. 申請が通ったら、Client ID / Secret を Supabase に登録する
5. バンクエの画面ファイルを GitHub に上げる
6. バンクエの「管理 → BASE連携」で、BASEにつないで商品を紐づける

---

## 1. BASE Developers の申請

https://developers.thebase.com/ から申請します。

- **アプリ名**: Wiθ BANK QUEST など
- **コールバックURL（リダイレクトURI）**:
  `https://with2022kagoshima-ux.github.io/bank-quest/`（BASEで許可したあと、バンクエの画面に戻ってきます）
- **使う権限**: `read_users` `read_items` `write_items`

通ると **Client ID** と **Client Secret** がもらえます。Secret は人に見せたり、GitHubに上げたりしないでください。

## 2. SQL を流す

Supabase のダッシュボード → **SQL Editor** を開きます。
`supabase/migrations/20261106_base_sync.sql` の中身を全部貼り付けて **Run** を押してください。

最初に「必要な列があるか」をチェックします。エラーが出たら、その文面をClaudeに見せてください。

## 3. Edge Function を置く

### パソコンで Supabase CLI を使う場合

```
supabase login
supabase link --project-ref ggqnpniygowcqqxktbbt
supabase functions deploy base-sync
```

Verify JWT はオンのままで大丈夫です（呼び出すのはログイン中のバンクエ画面だけです）。

### ダッシュボードだけでやる場合

**Edge Functions → Deploy a new function** を開きます。

- 名前: `base-sync`
- `index.ts` と `logic.ts` の2つのファイルを作り、それぞれ中身を貼り付けます。

## 4. シークレットを登録する

Supabase の **Edge Functions → Secrets**（または **Project Settings → Edge Functions**）に、次の3つを登録します。

| 名前 | 値 |
|---|---|
| `BASE_CLIENT_ID` | BASE Developers の Client ID |
| `BASE_CLIENT_SECRET` | BASE Developers の Client Secret |
| `APP_URL` | `https://with2022kagoshima-ux.github.io/bank-quest/` |

## 5. 画面ファイルを GitHub に上げる

変わったファイルは次のとおりです。

- `app.js`、`api.js`、`index.html`、`sw.js`（バージョンを v34 に上げています）
- `supabase/` フォルダ（中継プログラムとSQL。GitHub Pages の表示には影響しません）

## 6. 初めて使うとき

1. バンクエの **管理 → 🛒 BASE連携 → BASEにつなぐ** を押し、BASEで許可します。
2. **🪄 名前から自動で候補を出す** を押し、合っていれば **まとめて紐づける** を押します。残りは1つずつ **選ぶ** で設定します。BASEで売っていない商品は未設定のままで大丈夫です。
3. **紐づけた時点の在庫が「基準」になります。** 紐づける前に、BASEの在庫数とバンクエの在庫数が合っているか確認してください。ずれていたら、BASEの管理画面で直しておきます。

## ふだんの使い方

ライブのあと、Airレジの取り込みなどで物販の入力を終えます。
そのライブの画面で **🛒 BASEの在庫に反映** を押してください。

確認画面に「BASE 3点 → 1点（−2）」のように一覧が出ます。数を見て **BASEに反映する** を押すと、BASEの在庫が変わります。

入荷のときも同じボタンで反映できます（**管理 → BASE連携** にもあります）。

## 仕組み（メモ）

- 反映する数 ＝（いまのバンクエ在庫 − BASEの売上分）−（前回反映したときの値）
- BASEの売上（「BASEの売上」画面で入れた分）とその取消は、計算から外しています。BASE側ですでに在庫が動いているからです。
- 反映の直前にBASEの在庫を読み直します。確認画面を出したあとにBASEで売れても、ずれません。
- 2人が同時に押しても、二重に反映されないようにしています。
- 0点より少なくなりそうなときは0点で止めて、確認画面に「数がずれています」と出します。
