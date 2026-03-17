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

// 🗄️ MySQL
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});


// 📥 LOAD auth from MySQL → files
async function loadAuthFromDB() {
  const [rows] = await db.query("SELECT * FROM whatsapp_sessions WHERE id = ?", ["session"]);

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
}


// 📤 SAVE auth files → MySQL
async function saveAuthToDB() {
  if (!fs.existsSync(AUTH_FOLDER)) return;

  const files = fs.readdirSync(AUTH_FOLDER);
  let data = {};

  for (const file of files) {
    const content = fs.readFileSync(path.join(AUTH_FOLDER, file), "utf-8");
    data[file] = content;
  }

  await db.query(
    "INSERT INTO whatsapp_sessions (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data=?",
    ["session", JSON.stringify(data), JSON.stringify(data)]
  );

  console.log("💾 Session saved to MySQL");
}


// 🚀 Start WhatsApp
async function startWhatsApp() {
  const baileys = await import("@whiskeysockets/baileys");

  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, DisconnectReason } = baileys;

  // 🔥 LOAD SESSION FROM DB FIRST
  await loadAuthFromDB();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

  sock = makeWASocket({
    auth: state,
    browser: ["Ubuntu", "Chrome", "22.04"],
    syncFullHistory: false
  });

  // Save creds
  sock.ev.on("creds.update", async () => {
    await saveCreds();
    await saveAuthToDB(); // 🔥 also save to MySQL
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
      }
    }
  });
}

startWhatsApp();


// 🔐 API
app.post("/send-message", async (req, res) => {
  const { password, phone, message } = req.body;

  if (password !== process.env.API_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const number = phone + "@s.whatsapp.net";
    await sock.sendMessage(number, { text: message });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.listen(3000, () => {
  console.log("Server running on port 3000");
});