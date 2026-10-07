require("dotenv").config();

const fs = require("fs");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const {
  addToken,
  removeToken,
  listTokens,
  maskToken,
  isValidToken,
  loadTokens
} = require("./token");

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const PORT = Number(process.env.PORT || process.env.EXPRESS_PORT || 3000);
const API_KEY = (process.env.API_KEY || "").trim();

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN belum diatur.");
  console.error("Isi BOT_TOKEN di environment Pterodactyl atau file .env.");
  process.exit(1);
}

if (!API_KEY) {
  console.warn("⚠️ API_KEY belum diatur. API /api/token/* akan ditolak.");
}

const ADMIN_FILE = "mods.json";
const PARTNER_FILE = "part.json";
const RESELLER_FILE = "ress.json";

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    console.error(`❌ Gagal membaca ${file}:`, error.message);
    return fallback;
  }
}

function loadAdmins() {
  const data = readJson(ADMIN_FILE, { owners: [], creators: [] });
  return {
    owners: Array.isArray(data.owners) ? data.owners : [],
    creators: Array.isArray(data.creators) ? data.creators : []
  };
}

function loadPartners() {
  const data = readJson(PARTNER_FILE, { partners: [] });
  return { partners: Array.isArray(data.partners) ? data.partners : [] };
}

function loadResellers() {
  const data = readJson(RESELLER_FILE, { resellers: [] });
  return { resellers: Array.isArray(data.resellers) ? data.resellers : [] };
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function saveAdmins(data) { saveJson(ADMIN_FILE, data); }
function savePartners(data) { saveJson(PARTNER_FILE, data); }
function saveResellers(data) { saveJson(RESELLER_FILE, data); }

function isOwner(userId) {
  return loadAdmins().owners.includes(Number(userId));
}

function isCreator(userId) {
  const { creators, owners } = loadAdmins();
  return owners.includes(Number(userId)) || creators.includes(Number(userId));
}

function isPartner(userId) {
  return loadPartners().partners.includes(Number(userId));
}

function isReseller(userId) {
  return loadResellers().resellers.includes(Number(userId));
}

function hasAccess(userId) {
  return isOwner(userId) || isCreator(userId) || isPartner(userId) || isReseller(userId);
}

function canAddToken(userId) {
  return hasAccess(userId);
}

function canAddReseller(userId) {
  return isOwner(userId) || isCreator(userId) || isPartner(userId);
}

function canDelToken(userId) {
  return isOwner(userId);
}

function canListToken(userId) {
  return isOwner(userId);
}

const MENU_IMAGE = "https://files.catbox.moe/t766yj.jpg";

// =========================
// API JSON database
// =========================
const app = express();
app.use(express.json({ limit: "16kb" }));

// Bot yang disimpan di tokens.json akan dijalankan sebagai bot aktif.
// Map ini mencegah satu token dibuat menjadi beberapa polling instance.
const managedBots = new Map();

async function startManagedBot(token, label = "managed") {
  const normalized = String(token || "").trim();
  if (!normalized) throw new Error("Token kosong.");
  if (managedBots.has(normalized)) return managedBots.get(normalized);

  const bot = new TelegramBot(normalized, { polling: false });

  try {
    const me = await bot.getMe();

    bot.on("polling_error", (error) => {
      console.error(`❌ polling_error @${me.username || me.id}: ${error.code || "UNKNOWN"} - ${error.message || error}`);
    });

    bot.on("error", (error) => {
      console.error(`❌ telegram_error @${me.username || me.id}: ${error.message || error}`);
    });

    bot.onText(/\/start/, (msg) => {
      bot.sendMessage(msg.chat.id, `🤖 Bot @${me.username || me.first_name} aktif.`).catch(() => {});
    });

    await bot.startPolling();
    managedBots.set(normalized, bot);
    console.log(`✅ Bot aktif: @${me.username || me.first_name} [${label}]`);
    return bot;
  } catch (error) {
    try { await bot.stopPolling(); } catch (_) {}
    throw new Error(`Gagal menjalankan bot: ${error.message || error}`);
  }
}

async function stopManagedBot(token) {
  const normalized = String(token || "").trim();
  const bot = managedBots.get(normalized);
  if (!bot) return false;

  try {
    await bot.stopPolling();
  } catch (error) {
    console.error(`⚠️ Gagal menghentikan bot: ${error.message || error}`);
  }

  managedBots.delete(normalized);
  return true;
}

async function startAllManagedBots() {
  const tokens = loadTokens();
  const active = tokens.filter((item) => item.active && !isExpiredForIndex(item));

  if (!active.length) {
    console.log("ℹ️ Belum ada bot aktif di tokens.json. Manager tetap berjalan.");
    return;
  }

  for (const item of active) {
    try {
      await startManagedBot(item.token, item.label);
    } catch (error) {
      console.error(`❌ ${item.label || "bot"}: ${error.message}`);
    }
  }
}

function isExpiredForIndex(item) {
  if (!item.expiresAt) return false;
  const timestamp = new Date(item.expiresAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    return res.status(503).json({ success: false, message: "API_KEY belum dikonfigurasi." });
  }

  const supplied = req.get("x-api-key");
  if (!supplied || supplied !== API_KEY) {
    return res.status(401).json({ success: false, message: "API key tidak valid." });
  }

  next();
}

app.get("/", (_req, res) => {
  res.json({ success: true, service: "Kiko Bot DB", storage: "tokens.json" });
});

app.get("/health", (_req, res) => {
  res.json({ success: true, uptime: process.uptime() });
});

app.get("/api/token/list", requireApiKey, (_req, res) => {
  const tokens = listTokens();
  res.json({
    success: true,
    count: tokens.length,
    tokens: tokens.map((item) => ({
      label: item.label,
      token: maskToken(item.token),
      active: item.active,
      createdBy: item.createdBy,
      expiresAt: item.expiresAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      lastUsedAt: item.lastUsedAt
    }))
  });
});

app.post("/api/token/add", requireApiKey, async (req, res) => {
  try {
    const { token, label } = req.body || {};

    // Verifikasi token ke Telegram sebelum menyimpannya.
    const testBot = new TelegramBot(String(token || "").trim(), { polling: false });
    const me = await testBot.getMe();

    const saved = addToken(token, { label: label || me.username || "api" });
    await startManagedBot(saved.token, saved.label);

    res.status(201).json({
      success: true,
      message: `Token tersimpan dan bot @${me.username || me.first_name} langsung aktif.`,
      token: maskToken(saved.token),
      label: saved.label
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || String(error) });
  }
});

app.delete("/api/token/delete", requireApiKey, async (req, res) => {
  try {
    const { token } = req.body || {};
    await stopManagedBot(token);
    const deleted = removeToken(token);

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Token tidak ditemukan." });
    }

    res.json({ success: true, message: "Token dihapus dan bot dihentikan." });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || String(error) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 API aktif di port ${PORT}`);
});

// =========================
// Telegram manager bot
// =========================
async function startBot() {
  const bot = new TelegramBot(BOT_TOKEN, { polling: false });

  try {
    const me = await bot.getMe();
    console.log(`🤖 Manager bot: @${me.username || me.first_name}`);
  } catch (error) {
    console.error("❌ BOT_TOKEN manager tidak valid atau Telegram tidak dapat dihubungi.");
    console.error(`   ${error.message}`);
    process.exit(1);
  }

  bot.on("polling_error", (error) => {
    console.error(`❌ polling_error: ${error.code || "UNKNOWN"} - ${error.message}`);
  });

  bot.on("error", (error) => {
    console.error(`❌ telegram_error: ${error.message}`);
  });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!hasAccess(userId)) {
      return bot.sendMessage(chatId, "❌ Anda tidak memiliki akses!");
    }

    const menuText = `
DATABASE BOT

TOKEN MENU
/Addtoken TOKEN
/Deltoken TOKEN
/Listtoken
/Checktoken TOKEN

CREATOR MENU
/addcreator ID
/delcreator ID

PARTNER MENU
/addpartner ID
/delpartner ID
/listpartner

RESELLER/PT MENU
/addreseller ID
/delreseller ID
/listreseller
`.trim();

    try {
      await bot.sendPhoto(chatId, MENU_IMAGE, { caption: menuText });
    } catch (_error) {
      await bot.sendMessage(chatId, menuText);
    }
  });

  // ===== CREATOR =====
  bot.onText(/\/addcreator (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const newId = Number(match[1]);

    if (!isOwner(userId)) return bot.sendMessage(chatId, "❌ Hanya owner yang bisa menambah creator!");

    const data = loadAdmins();
    if (data.creators.includes(newId)) return bot.sendMessage(chatId, "⚠️ Creator sudah ada!");

    data.creators.push(newId);
    saveAdmins(data);
    bot.sendMessage(chatId, `✅ Creator berhasil ditambahkan: ${newId}`);
  });

  bot.onText(/\/delcreator (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const removeId = Number(match[1]);

    if (!isOwner(userId)) return bot.sendMessage(chatId, "❌ Hanya owner yang bisa menghapus creator!");

    const data = loadAdmins();
    if (!data.creators.includes(removeId)) return bot.sendMessage(chatId, "⚠️ Creator tidak ditemukan!");

    data.creators = data.creators.filter((id) => id !== removeId);
    saveAdmins(data);
    bot.sendMessage(chatId, `✅ Creator berhasil dihapus: ${removeId}`);
  });

  // ===== PARTNER =====
  bot.onText(/\/addpartner (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const newId = Number(match[1]);

    if (!isCreator(userId)) return bot.sendMessage(chatId, "❌ Hanya owner/creator yang bisa menambah partner!");

    const data = loadPartners();
    if (data.partners.includes(newId)) return bot.sendMessage(chatId, "⚠️ Partner sudah ada!");

    data.partners.push(newId);
    savePartners(data);
    bot.sendMessage(chatId, `✅ Partner berhasil ditambahkan: ${newId}`);
  });

  bot.onText(/\/delpartner (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const removeId = Number(match[1]);

    if (!isCreator(userId)) return bot.sendMessage(chatId, "❌ Hanya owner/creator yang bisa menghapus partner!");

    const data = loadPartners();
    if (!data.partners.includes(removeId)) return bot.sendMessage(chatId, "⚠️ Partner tidak ditemukan!");

    data.partners = data.partners.filter((id) => id !== removeId);
    savePartners(data);
    bot.sendMessage(chatId, `✅ Partner berhasil dihapus: ${removeId}`);
  });

  bot.onText(/\/listpartner/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isCreator(userId)) return bot.sendMessage(chatId, "❌ Anda tidak memiliki akses!");

    const items = loadPartners().partners;
    bot.sendMessage(chatId, `👥 Daftar Partner:\n\n${items.map((id, i) => `${i + 1}. ${id}`).join("\n") || "🚫 Tidak ada partner!"}`);
  });

  // ===== RESELLER =====
  bot.onText(/\/addreseller (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const newId = Number(match[1]);

    if (!canAddReseller(userId)) return bot.sendMessage(chatId, "❌ Hanya owner, creator, dan partner yang bisa menambah reseller/PT!");

    const data = loadResellers();
    if (data.resellers.includes(newId)) return bot.sendMessage(chatId, "⚠️ Reseller/PT sudah ada!");

    data.resellers.push(newId);
    saveResellers(data);
    bot.sendMessage(chatId, `✅ Reseller/PT berhasil ditambahkan: ${newId}`);
  });

  bot.onText(/\/delreseller (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const removeId = Number(match[1]);

    if (!isCreator(userId)) return bot.sendMessage(chatId, "❌ Hanya owner/creator yang bisa menghapus reseller/PT!");

    const data = loadResellers();
    if (!data.resellers.includes(removeId)) return bot.sendMessage(chatId, "⚠️ Reseller/PT tidak ditemukan!");

    data.resellers = data.resellers.filter((id) => id !== removeId);
    saveResellers(data);
    bot.sendMessage(chatId, `✅ Reseller/PT berhasil dihapus: ${removeId}`);
  });

  bot.onText(/\/listreseller/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isCreator(userId)) return bot.sendMessage(chatId, "❌ Anda tidak memiliki akses!");

    const items = loadResellers().resellers;
    bot.sendMessage(chatId, `👥 Daftar Reseller/PT:\n\n${items.map((id, i) => `${i + 1}. ${id}`).join("\n") || "🚫 Tidak ada reseller!"}`);
  });

  // ===== TOKEN =====
  bot.onText(/\/addtoken(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const newToken = (match[1] || "").trim();

    if (!canAddToken(userId)) return bot.sendMessage(chatId, "❌ Hanya owner, creator, partner, dan reseller yang bisa menambah token!");
    if (!newToken) return bot.sendMessage(chatId, "❌ Format: /addtoken TOKEN");

    try {
      const testBot = new TelegramBot(newToken, { polling: false });
      const me = await testBot.getMe();
      const saved = addToken(newToken, { createdBy: userId, label: me.username || "telegram" });
      await startManagedBot(saved.token, saved.label);
      await bot.sendMessage(chatId, `✅ @${me.username || me.first_name} berhasil ditambahkan dan langsung aktif.\nToken: ${maskToken(saved.token)}`);
    } catch (error) {
      await bot.sendMessage(chatId, `❌ Gagal menambahkan/menjalankan bot: ${error.message || error}`);
    }
  });

  bot.onText(/\/deltoken(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const tokenToRemove = (match[1] || "").trim();

    if (!canDelToken(userId)) return bot.sendMessage(chatId, "❌ Hanya owner yang bisa menghapus token!");
    if (!tokenToRemove) return bot.sendMessage(chatId, "❌ Format: /deltoken TOKEN");

    try {
      await stopManagedBot(tokenToRemove);
      const deleted = removeToken(tokenToRemove);
      bot.sendMessage(chatId, deleted ? "✅ Token dihapus dan bot dihentikan!" : "⚠️ Token tidak ditemukan!");
    } catch (error) {
      bot.sendMessage(chatId, `❌ ${error.message}`);
    }
  });

  bot.onText(/\/listtoken/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!canListToken(userId)) return bot.sendMessage(chatId, "❌ Hanya owner yang bisa melihat daftar token!");

    const tokens = listTokens();
    if (!tokens.length) return bot.sendMessage(chatId, "⚠️ Tidak ada token tersimpan.");

    const tokenList = tokens.map((item, index) => `${index + 1}. ${maskToken(item.token)} (${item.label})`).join("\n");
    bot.sendMessage(chatId, `📜 Daftar Token:\n\n${tokenList}`);
  });

  bot.onText(/\/checktoken(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const rawToken = (match[1] || "").trim();

    if (!canListToken(userId)) return bot.sendMessage(chatId, "❌ Hanya owner yang bisa mengecek token!");
    if (!rawToken) return bot.sendMessage(chatId, "❌ Format: /checktoken TOKEN");

    bot.sendMessage(chatId, isValidToken(rawToken) ? "✅ Token tersimpan dan aktif." : "❌ Token tidak tersimpan/format tidak valid/expired.");
  });

  await bot.startPolling();
  console.log(`🚀 Bot Token Manager berjalan. Token tersimpan: ${loadTokens().length}`);
  await startAllManagedBots();
}

startBot().catch((error) => {
  console.error("❌ Gagal menjalankan manager bot:", error.message);
  process.exit(1);
});

process.once("SIGINT", async () => {
  for (const token of managedBots.keys()) await stopManagedBot(token);
  process.exit(0);
});

process.once("SIGTERM", async () => {
  for (const token of managedBots.keys()) await stopManagedBot(token);
  process.exit(0);
});
