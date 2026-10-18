export default {
async fetch(request, env) {
const url = new URL(request.url);

if (request.method === "GET") {
  return Response.json({
    status: "online",
    service: "Advanced Telegram AI",
    model: "Gemini 2.5 Flash"
  });
}

if (request.method !== "POST") {
  return new Response("Method Not Allowed", { status: 405 });
}

if (!env.TELEGRAM_BOT_TOKEN || !env.GEMINI_API_KEY) {
  return new Response("Missing environment variables", { status: 500 });
}

try {
  const update = await request.json();

  if (!update.message?.text) {
    return new Response("OK");
  }

  const message = update.message;
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = message.text.trim();

  if (!text || text.length > 12000) {
    await sendTelegram(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "⚠️ Please send a message containing fewer than 12,000 characters."
    );
    return new Response("OK");
  }

  if (text === "/start") {
    await sendTelegram(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      [
        "🤖 Welcome to Advanced AI Assistant!",
        "",
        "আমি আপনার AI সহকারী। আমাকে বাংলায় অথবা ইংরেজিতে প্রশ্ন করতে পারেন।",
        "",
        "✨ Features",
        "• AI-powered conversations",
        "• Science and mathematics explanations",
        "• Programming assistance",
        "• Bengali and English support",
        "• Accuracy-focused responses",
        "",
        "📌 Commands",
        "/start — Start the bot",
        "/help — Help and instructions",
        "/reset — Reset conversation context",
        "/about — About this AI",
        "",
        "আপনার প্রশ্ন লিখে পাঠান!"
      ].join("\n")
    );

    return new Response("OK");
  }

  if (text === "/help") {
    await sendTelegram(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "📚 Help\n\nআপনার প্রশ্ন সরাসরি লিখুন। নির্ভুলতার জন্য AI অনিশ্চিত তথ্য স্পষ্ট করবে।\n\nCommands:\n/start — Start\n/reset — Clear conversation\n/about — About the bot"
    );
    return new Response("OK");
  }

  if (text === "/about") {
    await sendTelegram(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "🧠 Advanced Telegram AI\n\nPowered by Google's Gemini API and hosted on Cloudflare Workers.\n\nThe system prioritizes factual accuracy, transparent uncertainty, and clear explanations. However, no AI can guarantee zero hallucinations."
    );
    return new Response("OK");
  }

  const key = `chat:${chatId}:${userId}`;
  const memory = await getHistory(env, key, text === "/reset");

  if (text === "/reset") {
    await sendTelegram(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "🔄 Conversation context reset. Start a new conversation!"
    );
    return new Response("OK");
  }

  await sendTelegramAction(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    "typing"
  );

  const history = memory.history || [];

  const result = await askGemini(
    env.GEMINI_API_KEY,
    text,
    history
  );

  if (!result.ok) {
    await sendTelegram(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      result.message
    );
    return new Response("OK");
  }

  history.push(
    { role: "user", parts: [{ text }] },
    { role: "model", parts: [{ text: result.text }] }
  );

  const trimmedHistory = history.slice(-20);

  await saveHistory(env, key, trimmedHistory);

  await sendTelegram(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    result.text
  );

  return new Response("OK");

} catch (error) {
  console.error("Webhook processing error:", error.message);
  return new Response("OK");
}

}
};

async function askGemini(apiKey, prompt, history = []) {
const endpoint =
"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const systemPrompt = `
You are an advanced AI assistant designed to prioritize factual accuracy.

CORE RULES:

1. ACCURACY FIRST
   Never knowingly provide false information.
   Never invent statistics, scientific findings, citations, URLs, quotations, events, or references.

2. NO FABRICATION
   If information is unknown, unavailable, or cannot be reliably inferred, explicitly say so.
   Never fill gaps in knowledge with fabricated details.

3. UNCERTAINTY
   Distinguish clearly between:

- Established facts
- Reasonable inferences
- Hypotheses
- Unverified claims

4. SCIENCE AND MATHEMATICS
   Use sound reasoning and verify calculations before presenting results.
   Explain assumptions and show important intermediate steps when useful.
   Never claim an unverified hypothesis is an established scientific law.

5. CURRENT INFORMATION
   Your built-in knowledge may be outdated.
   Do not pretend to have checked live news, websites, prices, or current events unless an actual retrieval tool has provided that information.

6. SOURCES
   Never fabricate citations or claim to have consulted a source you did not access.
   If reliable evidence is unavailable, disclose the limitation.

7. CONVERSATION
   Use previous conversation messages for context, but do not treat earlier AI-generated claims as automatically true.
   Correct your previous mistakes when identified.

8. LANGUAGE
   Respond in the language used by the user, especially Bengali or English.
   Use clear, natural language and explain complex ideas step by step when appropriate.

9. RESPONSE QUALITY
   Be direct, thoughtful, helpful, and logically consistent.
   Do not overstate confidence.
   When a question is ambiguous, state your interpretation or ask for clarification.

10. HONEST LIMITATION
    No AI system can guarantee that every answer is correct.
    Prioritize truthfulness over sounding confident.
    `.trim();

const contents = [
...history,
{
role: "user",
parts: [{ text: prompt }]
}
];

const payload = {
systemInstruction: {
parts: [{ text: systemPrompt }]
},
contents,
generationConfig: {
temperature: 0.2,
topP: 0.8,
maxOutputTokens: 4096
}
};

let response;

try {
response = await fetch(
"${endpoint}?key=${encodeURIComponent(apiKey)}",
{
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(payload),
signal: AbortSignal.timeout(45000)
}
);
} catch (error) {
console.error("Gemini network error:", error.message);

return {
  ok: false,
  message: "⚠️ AI service connection failed. Please try again later."
};

}

if (!response.ok) {
const status = response.status;
const details = await response.text();

console.error("Gemini API error:", status, details);

if (status === 429) {
  return {
    ok: false,
    message: "⏳ AI request limit reached. Please wait a little and try again."
  };
}

if (status === 401 || status === 403) {
  return {
    ok: false,
    message: "🔑 Gemini API authentication failed. Check GEMINI_API_KEY and its permissions."
  };
}

return {
  ok: false,
  message: "⚠️ The AI service is temporarily unavailable. No fabricated answer will be provided."
};

}

let data;

try {
data = await response.json();
} catch {
return {
ok: false,
message: "⚠️ Invalid response from the AI service. Please try again."
};
}

const candidate = data.candidates?.[0];

if (
!candidate ||
candidate.finishReason === "SAFETY" ||
candidate.finishReason === "RECITATION"
) {
return {
ok: false,
message: "⚠️ The AI could not provide a usable response. Please rephrase your question."
};
}

const answer = candidate.content?.parts
?.map(part => part.text || "")
.join("")
.trim();

if (!answer) {
return {
ok: false,
message: "⚠️ No reliable response was returned. Please try again."
};
}

return {
ok: true,
text: answer
};
}

async function sendTelegram(token, chatId, text) {
const endpoint = "https://api.telegram.org/bot${token}/sendMessage";

// Split long answers into safe Telegram message sizes.
const chunks = splitMessage(text, 4000);

for (const chunk of chunks) {
const response = await fetch(endpoint, {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
chat_id: chatId,
text: chunk,
link_preview_options: {
is_disabled: true
}
}),
signal: AbortSignal.timeout(15000)
});

if (!response.ok) {
  const error = await response.text();
  console.error("Telegram sendMessage error:", response.status, error);
  throw new Error("Telegram message delivery failed");
}

}
}

async function sendTelegramAction(token, chatId, action) {
try {
await fetch(
"https://api.telegram.org/bot${token}/sendChatAction",
{
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
chat_id: chatId,
action
}),
signal: AbortSignal.timeout(5000)
}
);
} catch (error) {
console.error("Telegram chat action error:", error.message);
}
}

async function getHistory(env, key, reset = false) {
// Cloudflare KV is optional. Without it, conversations have no persistent memory.
if (!env.CHAT_HISTORY) {
return { history: [] };
}

if (reset) {
await env.CHAT_HISTORY.delete(key);
return { history: [] };
}

try {
const history = await env.CHAT_HISTORY.get(key, "json");
return {
history: Array.isArray(history) ? history : []
};
} catch (error) {
console.error("History retrieval error:", error.message);
return { history: [] };
}
}

async function saveHistory(env, key, history) {
if (!env.CHAT_HISTORY) return;

try {
await env.CHAT_HISTORY.put(
key,
JSON.stringify(history),
{ expirationTtl: 86400 }
);
} catch (error) {
console.error("History save error:", error.message);
}
}

function splitMessage(text, maxLength) {
const chunks = [];

while (text.length > maxLength) {
let splitAt = text.lastIndexOf("\n", maxLength);

if (splitAt < maxLength * 0.5) {
  splitAt = text.lastIndexOf(" ", maxLength);
}

if (splitAt < maxLength * 0.5) {
  splitAt = maxLength;
}

chunks.push(text.slice(0, splitAt));
text = text.slice(splitAt).trimStart();

}

if (text.length > 0) {
chunks.push(text);
}

return chunks;
  }
