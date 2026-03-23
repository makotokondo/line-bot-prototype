# 🤖 LINE AI Auto-Responder

友人・家族からのLINEメッセージに、AIが「自分っぽく」自動返信するボット。

## アーキテクチャ

```
友人のLINE → LINE Platform → Webhook (Vercel) → Claude API → 自動返信
```

## セットアップ手順（15分）

### 1. LINE Bot チャネル作成

1. [LINE Developers](https://developers.line.biz/) にログイン
2. プロバイダー作成 → **Messaging API チャネル** を新規作成
3. 以下をメモ:
   - **チャネルシークレット** (Basic settings)
   - **チャネルアクセストークン** (Messaging API tab → 発行)
4. Messaging API 設定:
   - 応答メッセージ: **オフ**
   - あいさつメッセージ: **オフ**（またはカスタマイズ）
   - Webhook: **オン**（URLはデプロイ後に設定）

### 2. Vercel にデプロイ

```bash
# クローン & デプロイ
cd line-ai-bot
npx vercel --prod
```

環境変数を Vercel Dashboard > Settings > Environment Variables で設定:

| 変数名 | 値 |
|--------|-----|
| `LINE_CHANNEL_SECRET` | LINEチャネルシークレット |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINEチャネルアクセストークン |
| `ANTHROPIC_API_KEY` | Anthropic APIキー |

### 3. Webhook URL を LINE に登録

LINE Developers > Messaging API > Webhook URL:

```
https://your-project.vercel.app/api/webhook
```

「検証」ボタンで接続確認 → 成功と出ればOK。

### 4. 自分のプロフィールをカスタマイズ

`api/webhook.js` 内の `MY_PROFILE` を自分の情報に書き換える:

- `{YOUR_NAME}` → 自分の名前
- `{YOUR_LOCATION}` → 住んでいる場所
- `{YOUR_JOB}` → 仕事
- `{YOUR_FAVORITE_RESTAURANTS}` → おすすめの店
- FAQ を自由に追加

### 5. 友人に使ってもらう

LINE Developers > Messaging API > QRコード を友人に共有。
友人がボットを友だち追加すると、メッセージに自動返信が始まる。

## 使用例

```
友人: 「今度いつ空いてる？」
Bot:  「基本的に週末は空いてるよ！具体的な日程は本人に直接聞いてみて 😊」

友人: 「おすすめのラーメン屋ある？」
Bot:  「○○のラーメンがめちゃうまいよ！」

友人: 「住所教えて」
Bot:  「ごめん、住所はAIからは伝えられないんだ。本人に直接聞いてみて！🙏」
```

## カスタマイズのヒント

- **会話履歴を持たせたい** → Vercel KV や Upstash Redis で直近のやり取りを保存し、Claude に渡す
- **特定の人だけ応答したい** → LINE の userId でフィルタ
- **画像メッセージにも対応したい** → LINE Content API で画像取得 → Claude Vision に渡す
- **グループLINEでも使いたい** → event.source.type === "group" の処理を追加

## コスト目安

- **LINE Messaging API**: 無料（月200通まで。友人・家族用なら十分）
- **Claude API**: 従量課金（Sonnet 4: $3/1M入力トークン）
- **Vercel**: 無料枠で十分

## 注意事項

- ボットは「自分の代理AI」であることを隠しません
- 個人情報・金銭に関する返答はしない設計です
- 本人確認が必要な内容は「直接聞いて」と誘導します
