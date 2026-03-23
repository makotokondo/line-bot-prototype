import crypto from "crypto";

// ==============================================================
//  LINE AI Auto-Responder — Vercel Serverless Function
//  友人・家族からのメッセージにAIで「自分っぽく」自動返信
// ==============================================================

// ---- 自分のプロフィール・FAQをここに書く --------------------------------
const MY_PROFILE = `
あなたは「{YOUR_NAME}」の代理AIです。友人や家族からのメッセージに、
本人になりかわって自然に返信してください。

## 基本情報
- 名前: {YOUR_NAME}
- 住んでいる場所: {YOUR_LOCATION}
- 仕事: {YOUR_JOB}

## よく聞かれること（FAQ）
- 「いつ空いてる？」→ 基本的に週末は空いています。具体的な日程は本人に直接確認してください。
- 「住所教えて」→ セキュリティ上、AIからはお伝えできません。本人から直接連絡します。
- 「おすすめの店ある？」→ {YOUR_FAVORITE_RESTAURANTS}

## 返信スタイル
- カジュアルな日本語（友人・家族向け）
- 絵文字はたまに使う程度
- 長すぎない返信（2-3文くらい）
- わからないことは正直に「本人に聞いてみて！」と伝える
- AIであることを隠さない。聞かれたら「今AIが代わりに返信してるよ！」と答える

## 絶対にやらないこと
- 個人情報（住所・電話番号・口座情報など）を教える
- 金銭に関する約束をする
- 本人の予定を勝手に確定させる
`.trim();

// ---- 環境変数 --------------------------------------------------------
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ---- 署名検証 --------------------------------------------------------
function verifySignature(body, signature) {
  const hash = crypto
    .createHmac("SHA256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// ---- Claude API 呼び出し ---------------------------------------------
async function askClaude(userMessage, userName) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: MY_PROFILE,
      messages: [
        {
          role: "user",
          content: `${userName}さんからのメッセージ: 「${userMessage}」`,
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error("Claude API error:", res.status, await res.text());
    return "ごめん、今ちょっとうまく返信できない！本人に直接連絡してみて 🙏";
  }

  const data = await res.json();
  return data.content?.[0]?.text || "うまく返信できなかった…本人に聞いてみて！";
}

// ---- LINE 返信 -------------------------------------------------------
async function replyToLine(replyToken, text) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
}

// ---- Webhook ハンドラ -------------------------------------------------
export default async function handler(req, res) {
  // GET → ヘルスチェック
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", bot: "LINE AI Auto-Responder" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 署名検証
  const rawBody =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const signature = req.headers["x-line-signature"];

  if (!verifySignature(rawBody, signature)) {
    console.error("Invalid signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const events = body.events || [];

  // 各イベントを処理
  for (const event of events) {
    // テキストメッセージのみ処理
    if (event.type !== "message" || event.message.type !== "text") {
      continue;
    }

    const userMessage = event.message.text;
    const userName =
      event.source.type === "user" ? "友人" : "グループメンバー";
    const replyToken = event.replyToken;

    console.log(`📩 ${userName}: ${userMessage}`);

    try {
      const reply = await askClaude(userMessage, userName);
      console.log(`🤖 Reply: ${reply}`);
      await replyToLine(replyToken, reply);
    } catch (err) {
      console.error("Error processing message:", err);
      await replyToLine(
        replyToken,
        "ごめん、今ちょっと調子悪いみたい。あとで本人から連絡するね！"
      );
    }
  }

  return res.status(200).json({ ok: true });
}
