export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Telegram Webhook is Active!", { status: 200 });
    }

    try {
      const update = await request.json();

      // মেসেজ না থাকলে কিছু করার দরকার নেই
      if (!update.message || !update.message.text) {
        return new Response("OK", { status: 200 });
      }

      const chatId = update.message.chat.id;
      const userText = update.message.text.trim();

      // ১. ইউজার /start দিলে সাধারণ ওয়েলকাম মেসেজ
      if (userText === "/start") {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🤖 আমি আপনার AI সহকারী! আমাকে যেকোনো প্রশ্ন করুন বা খবর জানতে চান কি না লিখুন।");
        return new Response("OK", { status: 200 });
      }

      // ২. Gemini API কল (Google AI Studio)
      const reply = await askGemini(env.GEMINI_API_KEY, userText);

      // ৩. টেলিগ্রামে উত্তর পাঠানো
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, reply);

      return new Response("OK", { status: 200 });
    } catch (err) {
      return new Response("OK", { status: 200 }); // টেলিগ্রাম যাতে বারবার এরর না পাঠায়
    }
  }
};

// Gemini 2.5 Flash API কলিং ফাংশন
async function askGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: {
      parts: [{
        text: "You are a highly accurate, zero-hallucination AI assistant. Answer fluently in the user's language (Bengali or English). Provide clear, direct, and factual answers."
      }]
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (data.candidates && data.candidates[0].content.parts[0].text) {
    return data.candidates[0].content.parts[0].text;
  }
  return "⚠️ উত্তর তৈরিতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।";
}

// টেলিগ্রামে মেসেজ পাঠানোর সাধারণ ফাংশন
async function sendTelegramMessage(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });
}
