require("dotenv").config();
const express = require("express");
const qrcode = require("qrcode-terminal");

const app = express();
app.use(express.json());

let sock;

// 🚀 Start WhatsApp
async function startWhatsApp() {
  const baileys = await import("@whiskeysockets/baileys");

  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, DisconnectReason } = baileys;

  // ✅ Correct auth (file-based)
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  sock = makeWASocket({
    auth: state,

    // ✅ FIXED device (very important for 405)
    browser: ["Ubuntu", "Chrome", "22.04"],

    // ✅ prevent unnecessary sync issues
    syncFullHistory: false
  });

  // Save session
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    // ✅ SHOW QR PROPERLY
    if (qr) {
      console.log("📱 Scan this QR:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp Connected SUCCESSFULLY!");
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;

      console.log("❌ Disconnected:", reason);

      // ❌ NO AUTO RECONNECT (prevents 405 block)
      if (reason === DisconnectReason.loggedOut) {
        console.log("⚠️ Logged out. Delete auth_info and scan again.");
      } else {
        console.log("⛔ Not reconnecting automatically (safe mode)");
      }
    }
  });
}

startWhatsApp();


// 🔐 SEND MESSAGE API
app.post("/send-message", async (req, res) => {
  const { password, phone, message } = req.body;

  if (password !== process.env.API_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (!sock) {
      return res.status(500).json({ error: "WhatsApp not connected yet" });
    }

    const number = phone + "@s.whatsapp.net";

    await sock.sendMessage(number, { text: message });

    res.json({ success: true, message: "Message sent 🚀" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Health check
app.get("/", (req, res) => {
  res.send("WhatsApp API Running 🚀");
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});