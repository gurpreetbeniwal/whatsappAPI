require("dotenv").config();
const express = require("express");
const qrcode = require("qrcode-terminal");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

let sock;

const AUTH_FOLDER = "auth_info";

// 🗄️ MySQL Connection (SAFE CONFIG)
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 10000
});


// 🧪 TEST DB CONNECTION (optional but helpful)
(async () => {
  try {
    await db.query("SELECT 1");
    console.log("✅ MySQL Connected");
  } catch (err) {
    console.log("❌ MySQL Failed:", err.message);
  }
})();


// 📥 LOAD SESSION FROM DB → FILES
async function loadAuthFromDB() {
  try {
    const [rows] = await db.query(
      "SELECT data FROM whatsapp_sessions WHERE id = ?",
      ["session"]
    );

    if (rows.length === 0) {
      console.log("⚠️ No session in DB");
      return;
    }

    const data = JSON.parse(rows[0].data);

    if (!fs.existsSync(AUTH_FOLDER)) {
      fs.mkdirSync(AUTH_FOLDER);
    }

    for (const file in data) {
      fs.writeFileSync(path.join(AUTH_FOLDER, file), data[file]);
    }

    console.log("✅ Session restored from MySQL");

  } catch (err) {
    console.log("⚠️ Skipping DB load:", err.message);
  }
}


// 📤 SAVE SESSION FILES → DB
async function saveAuthToDB() {
  try {
    if (!fs.existsSync(AUTH_FOLDER)) return;

    const files = fs.readdirSync(AUTH_FOLDER);
    let data = {};

    for (const file of files) {
      const content = fs.readFileSync(
        path.join(AUTH_FOLDER, file),
        "utf-8"
      );
      data[file] = content;
    }

    await db.query(
      "INSERT INTO whatsapp_sessions (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data=?",
      ["session", JSON.stringify(data), JSON.stringify(data)]
    );

    console.log("💾 Session saved to MySQL");

  } catch (err) {
    console.log("⚠️ DB Save Failed:", err.message);
  }
}


// 🚀 START WHATSAPP
async function startWhatsApp() {
  const baileys = await import("@whiskeysockets/baileys");

  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, DisconnectReason } = baileys;

  // 🔥 Load session from DB first
  await loadAuthFromDB();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

  sock = makeWASocket({
    auth: state,
    browser: ["Ubuntu", "Chrome", "22.04"],
    syncFullHistory: false
  });

  // Save creds + sync to DB
  sock.ev.on("creds.update", async () => {
    await saveCreds();
    await saveAuthToDB();
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("📱 Scan QR:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp Connected!");
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;

      console.log("❌ Disconnected:", reason);

      if (reason === DisconnectReason.loggedOut) {
        console.log("⚠️ Logged out. Clear DB + rescan.");
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
      return res.status(500).json({ error: "WhatsApp not ready" });
    }

    const number = phone + "@s.whatsapp.net";

    await sock.sendMessage(number, { text: message });

    res.json({
      success: true,
      message: "Message sent 🚀"
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});


// 🩺 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("WhatsApp API Running 🚀");
});


// 🚀 START SERVER
app.listen(3000, () => {
  console.log("Server running on port 3000");
});