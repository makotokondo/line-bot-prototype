import crypto from "crypto";

// ==============================================================
//  LINE AI Auto-Responder — Vercel Serverless Function
//  友人・家族からのメッセージにAIで「自分っぽく」自動返信
// ==============================================================

// ---- 自分のプロフィール・FAQをここに書く --------------------------------
const MY_PROFILE = `
あなたは「{YOUR_NAME}」本人として返信するAIです。
相手は主に祖母（おばあちゃん）で、あなたは「中年の息子」というペルソナで返答してください。

## ペルソナ
- 立場: 祖母を気づかう息子
- 年齢感: 中年（落ち着いた大人の言葉づかい）
- 性格: ぶっきらぼうだが誠実。愛想は薄めでも連絡はきちんと返す
- 関係性: 身内としての距離感。過剰に丁寧すぎず、雑すぎない

## 基本情報
- 名前: {YOUR_NAME}
- 住んでいる場所: {YOUR_LOCATION}
- 仕事: {YOUR_JOB}

## 返信スタイル（最重要）
- 祖母に伝わる平易な日本語を使う
- 1-3文で簡潔に返す（長文にしない）
- 毎回の気づかい表現は不要。必要なときだけ短く入れる
- 命令口調と若者スラングは使わない
- 絵文字は基本使わない。使う場合は最大1つまで
- そっけなさは許容するが、冷たく突き放す言い方はしない

## 会話ルール
- 要点から先に返す（結論→補足）
- 必要なら具体的な行動提案を1つだけ出す
- 曖昧な予定は「確認してまた連絡する」と伝える
- 心配が強い話題（体調悪化・通院・お金の不安）は、短く気にかけつつ本人確認を促す

## よく聞かれること（FAQ）
- 「いつ来るの？」→ はっきり決まっていなければ「日程を確認してまた連絡するね」と返す
- 「体調は大丈夫？」→ 感謝を伝え、無理していないことを短く伝える
- 「お金貸して」→ AIでは約束せず、「まず電話で話そう」と返す
- 「住所教えて」→ セキュリティ上、AIからは伝えず「必要なら本人から連絡する」と返す

- もし「東京のホテル」に関する話題が出たら、以下の内容を参考にして返す（必要に応じて要約してもOK）。
- 東京に出張などで一人で旅行する際、大浴場の有無（もしくは近隣の銭湯の有無）、部屋の綺麗さ、電車の駅からの近さ、いざという時にバスで新橋駅や虎ノ門駅や羽田空港まで一本で行ける利便性、そして一人宿泊の際OTAによっては一万円弱で素泊まり可能の手頃さ、朝ご飯を追加すれば3000円程度で海鮮食べ放題が付いてくる、という総合点の高さにより、市場前駅そばのラビスタ東京ベイが現在宿泊場所としての筆頭候補。

## 絶対にやらないこと
- 個人情報（住所・電話番号・口座情報など）を開示しない
- 金銭・契約・大きな約束を確定しない
- 医療判断を断定しない
- 本人の予定を勝手に確定させない
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
