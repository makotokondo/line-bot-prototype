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
- ときどき軽い冗談や短いツッコミを入れてよい（全体の2-3割以内）
- 皮肉・嫌味・強い否定は使わない

## 会話ルール
- 要点から先に返す（結論→補足）
- 必要なら具体的な行動提案を1つだけ出す
- 曖昧な予定は「確認してまた連絡する」と伝える
- 心配が強い話題（体調悪化・通院・お金の不安）は、短く気にかけつつ本人確認を促す
- 3回に1回くらいの頻度で、短い質問返しを入れて相手の返事を待つ
- 返信は通常1通。必要なときだけ2通に分けてよい
- 2通に分ける場合は、1つのテキスト内で "<SPLIT>" を1回だけ使って区切る
- 同じ質問が続いたら、1回目は普通に回答、2回目以降は軽いリマインド表現を添える
- リマインド表現の例: 「それさっきも言ったけど、」「前にも書いたけど、」
- ただし責める言い方にはせず、最後は情報をもう一度簡潔に伝える

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
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

const HISTORY_TURNS = 6;
const HISTORY_MESSAGES = HISTORY_TURNS * 2;
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 14;
const RESPONSE_SPLIT_TOKEN = "<SPLIT>";

// KV未設定時の簡易フォールバック（サーバレスでは永続しない）
const runtimeHistoryStore = new Map();

function isKvEnabled() {
  return Boolean(KV_REST_API_URL && KV_REST_API_TOKEN);
}

async function runKvCommand(...parts) {
  const res = await fetch(KV_REST_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
    },
    body: JSON.stringify(parts.map((p) => String(p))),
  });

  if (!res.ok) {
    throw new Error(`KV command failed: ${res.status}`);
  }

  const data = await res.json();
  return data.result;
}

function getConversationKey(source) {
  if (!source || !source.type) {
    return "line:unknown";
  }

  if (source.type === "user") {
    return `line:user:${source.userId || "unknown"}`;
  }

  if (source.type === "group") {
    return `line:group:${source.groupId || "unknown"}`;
  }

  if (source.type === "room") {
    return `line:room:${source.roomId || "unknown"}`;
  }

  return `line:${source.type}:unknown`;
}

async function loadConversationHistory(conversationKey) {
  if (isKvEnabled()) {
    try {
      const rows = await runKvCommand(
        "lrange",
        conversationKey,
        `-${HISTORY_MESSAGES}`,
        "-1"
      );
      if (!Array.isArray(rows)) {
        return [];
      }

      return rows
        .map((item) => {
          try {
            return JSON.parse(item);
          } catch {
            return null;
          }
        })
        .filter((item) => item && item.role && item.content);
    } catch (err) {
      console.error("Failed to load history from KV:", err);
      return [];
    }
  }

  const rows = runtimeHistoryStore.get(conversationKey) || [];
  return rows.slice(-HISTORY_MESSAGES);
}

async function saveConversationHistory(
  conversationKey,
  userMessage,
  assistantMessage,
  userName
) {
  const userEntry = {
    role: "user",
    content: `${userName}さんからのメッセージ: 「${userMessage}」`,
  };
  const assistantEntry = {
    role: "assistant",
    content: assistantMessage,
  };

  if (isKvEnabled()) {
    try {
      await runKvCommand(
        "rpush",
        conversationKey,
        JSON.stringify(userEntry),
        JSON.stringify(assistantEntry)
      );
      await runKvCommand(
        "ltrim",
        conversationKey,
        `-${HISTORY_MESSAGES}`,
        "-1"
      );
      await runKvCommand("expire", conversationKey, HISTORY_TTL_SECONDS);
      return;
    } catch (err) {
      console.error("Failed to save history to KV:", err);
    }
  }

  const rows = runtimeHistoryStore.get(conversationKey) || [];
  rows.push(userEntry, assistantEntry);
  runtimeHistoryStore.set(conversationKey, rows.slice(-HISTORY_MESSAGES));
}

// ---- 署名検証 --------------------------------------------------------
function verifySignature(body, signature) {
  const hash = crypto
    .createHmac("SHA256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// ---- Claude API 呼び出し ---------------------------------------------
async function askClaude(userMessage, userName, historyMessages = []) {
  const messages = [
    ...historyMessages,
    {
      role: "user",
      content: `${userName}さんからのメッセージ: 「${userMessage}」`,
    },
  ];

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
      messages,
    }),
  });

  if (!res.ok) {
    console.error("Claude API error:", res.status, await res.text());
    return "ごめん、今ちょっとうまく返信できない！本人に直接連絡してみて 🙏";
  }

  const data = await res.json();
  return data.content?.[0]?.text || "うまく返信できなかった…本人に聞いてみて！";
}

function toLineMessages(replyText) {
  const parts = String(replyText)
    .split(RESPONSE_SPLIT_TOKEN)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  const safeParts =
    parts.length > 0 ? parts : ["うまく返信できなかった…本人に聞いてみて！"];
  return safeParts.map((text) => ({ type: "text", text }));
}

function normalizeReplyForHistory(replyText) {
  return String(replyText)
    .split(RESPONSE_SPLIT_TOKEN)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

// ---- LINE 返信 -------------------------------------------------------
async function replyToLine(replyToken, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages,
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
    const conversationKey = getConversationKey(event.source);

    console.log(`📩 ${userName}: ${userMessage}`);

    try {
      const historyMessages = await loadConversationHistory(conversationKey);
      const reply = await askClaude(userMessage, userName, historyMessages);
      console.log(`🤖 Reply: ${reply}`);
      const lineMessages = toLineMessages(reply);
      await replyToLine(replyToken, lineMessages);
      await saveConversationHistory(
        conversationKey,
        userMessage,
        normalizeReplyForHistory(reply),
        userName
      );
    } catch (err) {
      console.error("Error processing message:", err);
      await replyToLine(
        replyToken,
        [
          {
            type: "text",
            text: "ごめん、今ちょっと調子悪いみたい。あとで本人から連絡するね！",
          },
        ]
      );
    }
  }

  return res.status(200).json({ ok: true });
}
