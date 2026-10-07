# Kiko Telegram Bot Manager — JSON DB + Auto Start

Versi ini **tidak menggunakan MongoDB**. Token bot disimpan di `tokens.json` dan setiap token yang berhasil ditambahkan akan **diverifikasi ke Telegram lalu langsung dijalankan dengan polling**.

## Struktur

- `index.js` — Telegram manager bot + REST API + auto-start bot
- `token.js` — penyimpanan/CRUD token di `tokens.json`
- `tokens.json` — database JSON lokal
- `mods.json` — owner & creator
- `part.json` — partner
- `ress.json` — reseller/PT
- `.env.example` — contoh konfigurasi

## Instalasi

```bash
npm install
npm start
```

## Environment

Buat `.env` sendiri atau masukkan variable di Pterodactyl:

```env
BOT_TOKEN=8806088786:AAGbyi-utm1uviLcF8ra_4wVbPncF8xYQCk
PORT=3000
API_KEY=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

NODE_ENV=production
```

`BOT_TOKEN` adalah token **manager** yang menerima perintah `/addtoken`.

**Jangan upload `.env` atau `tokens.json` ke GitHub.**

## Owner pertama

Edit `mods.json` dan isi Telegram user ID kamu:

```json
{
  "owners": [123456789],
  "creators": []
}
```

## Cara kerja token bot

Saat `/addtoken TOKEN` dijalankan:

1. Format token diperiksa.
2. Token diuji ke Telegram dengan `getMe`.
3. Jika valid, token disimpan ke `tokens.json`.
4. Bot tersebut langsung dibuat sebagai instance polling.
5. Bot mengaktifkan handler `/start` sederhana.

Saat manager dinyalakan kembali, semua token `active: true` di `tokens.json` akan dicoba dijalankan otomatis.

Jika token sudah tidak valid, manager tetap hidup dan hanya menampilkan error untuk token tersebut.

## Perintah Telegram

```text
/start
/addtoken TOKEN
/deltoken TOKEN
/listtoken
/checktoken TOKEN
/addcreator ID
/delcreator ID
/addpartner ID
/delpartner ID
/listpartner
/addreseller ID
/delreseller ID
/listreseller
```

Contoh:

```text
/addtoken 123456789:AAxxxxxxxxxxxxxxxxxxxxxxxx
```

Setelah berhasil, bot akan langsung aktif.

## REST API

Semua endpoint token membutuhkan header:

```text
x-api-key: API_KEY_KAMU
```

Tambah dan langsung jalankan:

```http
POST /api/token/add
Content-Type: application/json
x-api-key: API_KEY_KAMU

{"token":"TOKEN_BOT","label":"manual"}
```

List (token dimasking):

```http
GET /api/token/list
x-api-key: API_KEY_KAMU
```

Hapus dan hentikan bot:

```http
DELETE /api/token/delete
Content-Type: application/json
x-api-key: API_KEY_KAMU

{"token":"TOKEN_BOT"}
```

## Catatan

- Satu token hanya boleh dijalankan oleh satu instance manager. Jika token yang sama sedang polling di program lain, Telegram dapat mengembalikan konflik `409`.
- Jangan memasukkan token Telegram ke GitHub atau membagikannya di chat/screenshot.
- `tokens.json` sengaja masuk `.gitignore` agar token tidak ter-upload ke repository.
