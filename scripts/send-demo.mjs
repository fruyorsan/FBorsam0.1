const botToken = "8970421030:AAHdUSY7wGvA5tb8u3Q9sb72Oun35uYYDlU"
const chatId = "8746564178"

const fullExitMsg = `🎯 <b>KÂRLA KAPANDI: PEPE / TRY</b>
━━━━━━━━━━━━━━━━━━
💰 <b>Net Sonuç:</b> <code>+4.56 TL (+%7.48)</code>
🏷️ <b>Çıkış Fiyatı:</b> <code>0.00022594 ₺</code>
📥 <b>Giriş Fiyatı:</b> <code>0.00021022 ₺</code>
📝 <b>Neden:</b> <i>2. Kademe Tavan Hedefi Gerçekleşti</i>
━━━━━━━━━━━━━━━━━━
🏦 <b>Güncel Kasa:</b> <code>518.42 TL</code>`

const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: chatId,
    text: fullExitMsg,
    parse_mode: "HTML",
  }),
})

const data = await res.json()
console.log("FULL_EXIT_SENT:", JSON.stringify(data))
