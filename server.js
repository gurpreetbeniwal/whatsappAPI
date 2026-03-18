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
// 🚀 START WHATSAPP
// 🚀 START WHATSAPP
async function startWhatsApp() {
  const baileys = await import("@whiskeysockets/baileys");
  const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion
  } = baileys;

  // 1. Load session from MySQL first
  await loadAuthFromDB();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion(); 

  // 2. Initialize WhatsApp Socket
  sock = makeWASocket({
    auth: state,
    version: version,
    browser: ["Windows", "Chrome", "122.0.0.0"],
    syncFullHistory: false
  });

  // 🚨 THE CRUCIAL FIX: Save credentials to local files AND MySQL
  sock.ev.on("creds.update", async () => {
    await saveCreds();
    await saveAuthToDB();
  });

  // 3. Handle Connection Events
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

      console.log("❌ Disconnected. Reason Code:", reason);

      if (reason === DisconnectReason.loggedOut) {
        console.log("⚠️ Logged out from WhatsApp. Clear DB and rescan.");
      } 
      else if (reason === DisconnectReason.restartRequired || reason === 515) {
        console.log("🔄 WhatsApp requested a restart (515). Reconnecting now...");
        startWhatsApp(); 
      } 
      else {
        console.log("🔌 Connection dropped. Attempting to auto-reconnect...");
        startWhatsApp(); 
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
// 🌐 WEB FRONTEND
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp API Sender</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #e5ddd5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .container { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
        h2 { text-align: center; color: #075E54; margin-top: 0; margin-bottom: 25px; }
        input, textarea, button { width: 100%; margin-bottom: 15px; padding: 12px; border: 1px solid #ccc; border-radius: 8px; box-sizing: border-box; font-size: 15px; }
        input:focus, textarea:focus { outline: none; border-color: #25D366; box-shadow: 0 0 5px rgba(37, 211, 102, 0.3); }
        button { background-color: #25D366; color: white; border: none; font-weight: bold; cursor: pointer; transition: background-color 0.2s; }
        button:hover { background-color: #128C7E; }
        #status { text-align: center; font-weight: bold; margin-top: 10px; min-height: 20px; }
        .success { color: #075E54; }
        .error { color: #d32f2f; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>💬 Send Message</h2>
        <input type="password" id="apiPwd" placeholder="Enter API Password" required>
        <input type="text" id="phone" placeholder="Phone with Country Code (e.g., 919876543210)" required>
        <textarea id="message" rows="4" placeholder="Type your message here..." required></textarea>
        <button onclick="sendMessage()">Send via WhatsApp 🚀</button>
        <p id="status"></p>
      </div>

      <script>
        async function sendMessage() {
          const statusEl = document.getElementById('status');
          const btn = document.querySelector('button');
          
          statusEl.textContent = 'Sending...';
          statusEl.className = '';
          btn.disabled = true;

          const payload = {
            password: document.getElementById('apiPwd').value,
            phone: document.getElementById('phone').value,
            message: document.getElementById('message').value
          };

          try {
            // Because the frontend is served from the same app, we can just call '/send-message' directly
            const response = await fetch('/send-message', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            
            const data = await response.json();
            
            if (response.ok) {
              statusEl.textContent = '✅ ' + data.message;
              statusEl.className = 'success';
              document.getElementById('message').value = ''; // clear the message box after success
            } else {
              statusEl.textContent = '❌ Error: ' + (data.error || 'Failed to send');
              statusEl.className = 'error';
            }
          } catch (err) {
            statusEl.textContent = '❌ Network Error - Is the server running?';
            statusEl.className = 'error';
          } finally {
            btn.disabled = false;
          }
        }
      </script>
    </body>
    </html>
  `);
});


// 🚀 START SERVER
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
