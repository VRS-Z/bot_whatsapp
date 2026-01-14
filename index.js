const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");

// Garante pastas necessárias no Render
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("public")) fs.mkdirSync("public");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
const upload = multer({ dest: "uploads/" });

// =====================
// Inicializa WhatsApp
// =====================
let client;

function initClient() {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    },
    takeoverOnConflict: true,
    restartOnAuthFail: true,
  });

  client.on("qr", (qr) => {
    console.log("QR Code gerado");
    io.emit("qr", qr);
    io.emit("status", "QR Code gerado. Escaneie com seu WhatsApp!");
  });

  client.on("ready", () => {
    console.log("Bot pronto!");
    io.emit("status", "Bot conectado!");
    io.emit("ready");
  });

  client.on("authenticated", () => {
    console.log("Autenticado com sucesso!");
    io.emit("status", "Autenticado! Aguardando pronto...");
  });

  client.on("auth_failure", (msg) => {
    console.log("Falha na autenticação:", msg);
    io.emit("status", "Falha na autenticação, aguardando novo QR...");
  });

  client.on("disconnected", async (reason) => {
    console.log("Bot desconectado:", reason);
    io.emit("status", `Desconectado: ${reason}. Gerando novo QR...`);

    try {
      await client.destroy();
    } catch {}

    setTimeout(() => initClient(), 2000);
  });

  client.initialize().catch((err) => {
    console.error("Erro ao inicializar o WhatsApp:", err);
  });
}

initClient();

// =====================
// Rotas Express
// =====================
app.get("/get-groups", async (req, res) => {
  try {
    if (!client.info || !client.info.pushname) {
      return res.status(400).json({ error: "Bot não está pronto ainda" });
    }

    const chats = await client.getChats();
    const groups = chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({ id: chat.id._serialized, name: chat.name }));

    res.json({ groups });
  } catch (err) {
    console.error("Erro ao buscar grupos:", err);
    res.status(500).json({ error: "Erro ao buscar grupos" });
  }
});

app.post("/send", upload.single("image"), async (req, res) => {
  const message = req.body.message || "";
  const targets = JSON.parse(req.body.targets || "[]");
  const image = req.file;

  if (!message && !image)
    return res.status(400).json({ error: "Mensagem ou imagem faltando" });

  for (let targetId of targets) {
    try {
      const chat = await client.getChatById(targetId);

      if (image) {
        const mediaData = fs.readFileSync(image.path);
        const mediaMsg = new MessageMedia(
          image.mimetype,
          mediaData.toString("base64"),
          image.originalname
        );
        await chat.sendMessage(mediaMsg, { caption: message || "" });
      } else {
        await chat.sendMessage(message);
      }

      console.log("Mensagem enviada para:", chat.name);
      await new Promise((r) => setTimeout(r, 15000));
    } catch (err) {
      console.error("Erro enviando para:", targetId, err);
    }
  }

  if (image) fs.unlinkSync(image.path);
  res.json({ status: "ok", sentTo: targets.length });
});

// =====================
// Inicia servidor
// =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

// =====================
// Captura erros globais
// =====================
process.on("uncaughtException", (err) => {
  console.error("Erro não capturado:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Promise rejeitada não tratada:", reason);
});
