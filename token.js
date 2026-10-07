const fs = require("fs");
const path = require("path");

const TOKEN_FILE = path.join(__dirname, "tokens.json");

function loadTokens() {
  if (!fs.existsSync(TOKEN_FILE)) return [];

  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("❌ Gagal membaca tokens.json:", error.message);
    return [];
  }
}

function saveTokens(tokens) {
  const tempFile = `${TOKEN_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(tokens, null, 2), "utf8");
  fs.renameSync(tempFile, TOKEN_FILE);
}

function normalizeToken(value = "") {
  return String(value || "").trim();
}

function maskToken(value = "") {
  const token = normalizeToken(value);
  if (!token) return "";
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}***${token.slice(-4)}`;
}

// Format dasar token Telegram Bot: angka:karakter
function looksLikeTelegramToken(value = "") {
  return /^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(normalizeToken(value));
}

function addToken(rawToken, metadata = {}) {
  const token = normalizeToken(rawToken);

  if (!looksLikeTelegramToken(token)) {
    throw new Error("Format token Telegram tidak terlihat valid.");
  }

  const tokens = loadTokens();
  const existing = tokens.find((item) => item.token === token);

  if (existing) {
    if (existing.active) throw new Error("Token sudah ada dan aktif.");
    existing.active = true;
    existing.updatedAt = new Date().toISOString();
    saveTokens(tokens);
    return existing;
  }

  const now = new Date().toISOString();
  const newToken = {
    token,
    label: metadata.label || "manual",
    active: metadata.active !== false,
    createdBy: metadata.createdBy ?? null,
    expiresAt: metadata.expiresAt ?? null,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null
  };

  tokens.push(newToken);
  saveTokens(tokens);
  return newToken;
}

function removeToken(rawToken) {
  const token = normalizeToken(rawToken);
  if (!token) throw new Error("Token tidak valid.");

  const tokens = loadTokens();
  const filtered = tokens.filter((item) => item.token !== token);

  if (filtered.length === tokens.length) return false;

  saveTokens(filtered);
  return true;
}

function listTokens() {
  return loadTokens()
    .filter((item) => item.active && !isExpired(item))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function isExpired(item) {
  if (!item.expiresAt) return false;
  const expires = new Date(item.expiresAt).getTime();
  return Number.isFinite(expires) && expires <= Date.now();
}

function isValidToken(rawToken) {
  const token = normalizeToken(rawToken);
  if (!looksLikeTelegramToken(token)) return false;

  const found = loadTokens().find((item) => item.token === token && item.active);
  return Boolean(found && !isExpired(found));
}

function markTokenUsed(rawToken) {
  const token = normalizeToken(rawToken);
  if (!token) return false;

  const tokens = loadTokens();
  const found = tokens.find((item) => item.token === token);
  if (!found) return false;

  const now = new Date().toISOString();
  found.lastUsedAt = now;
  found.updatedAt = now;
  saveTokens(tokens);
  return true;
}

function hasValidTokens() {
  return listTokens().length > 0;
}

module.exports = {
  loadTokens,
  addToken,
  removeToken,
  listTokens,
  isValidToken,
  markTokenUsed,
  hasValidTokens,
  maskToken,
  looksLikeTelegramToken
};
