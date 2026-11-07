# Panduan Deploy DIMONEX ke Vercel

DIMONEX telah dikonfigurasi agar siap di-deploy ke **Vercel**.

---

## Opsi 1: Deploy Langsung ke Vercel (Front-end + Serverless API)

File konfigurasi `vercel.json` dan `api/index.ts` sudah disiapkan di repository ini.

### Langkah-langkah:
1. **Push kode ke GitHub/GitLab**:
   ```bash
   git add .
   git commit -m "Configure Vercel deployment and safe JSON parsing"
   git push origin main
   ```
2. **Buka Vercel Dashboard** ([vercel.com](https://vercel.com)):
   - Klik **"Add New..."** > **"Project"**.
   - Pilih repositori Git Anda.
   - Vercel akan otomatis mendeteksi:
     - **Framework Preset**: `Vite`
     - **Build Command**: `npm run build`
     - **Output Directory**: `dist`
3. **Environment Variables**:
   - Jika menggunakan CoinMarketCap API, tambahkan di tab **Environment Variables**:
     - `CMC_API_KEY`: `e16a28cafc354543ab8369dedc2a58c0`
4. Klik **Deploy**.

> **Catatan Serverless di Vercel**:
> Vercel Serverless Function mengeksekusi REST API (`/api/*`). Namun, karena Vercel bersifat ephemeral (serverless tanpa persistent connection), fitur WebSocket (`/ws`) dan background MM bot interval panjang lebih optimal berjalan jika backend dijalankan pada server persisten (lihat Opsi 2). Di Vercel, front-end otomatis menggunakan **polling sync (2.5 detik)** sebagai fallback ketika WebSocket tidak aktif.

---

## Opsi 2: Production Recommended (Vercel Frontend + Railway/VPS Backend)

Untuk bursa kripto produksi dengan High-Frequency Trading, Matching Engine in-memory, WebSocket live feed, dan background algo-bot:

1. **Deploy Backend (`server.ts`)** ke platform persisten:
   - **Railway / Render / Fly.io / VPS DigitalOcean**:
     - Command: `npm run start` (menjalankan `tsx server.ts`)
     - Port: `3000` (atau `$PORT`)
2. **Sambungkan Vercel ke Backend**:
   - Di `vercel.json`, arahkan rewrite `/api/` ke domain backend Anda:
     ```json
     {
       "version": 2,
       "buildCommand": "npm run build",
       "outputDirectory": "dist",
       "framework": "vite",
       "rewrites": [
         {
           "source": "/api/:path*",
           "destination": "https://backend-anda.railway.app/api/:path*"
         },
         {
           "source": "/((?!api/|assets/|favicon.ico).*)",
           "destination": "/index.html"
         }
       ]
     }
     ```

---

## Solusi Error `SyntaxError: Unexpected token '<'`

Jika sebelumnya Anda menemui error:
`SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON`

Penyebabnya adalah request ke endpoint `/api/...` yang mengembalikan halaman HTML 404/SPA Vite alih-alih data JSON.
Hal ini telah **sepenuhnya diperbaiki**:
1. Middleware Express sekarang memiliki fallback eksplisit `app.all('/api/*', ...)` yang selalu mengembalikan JSON `{ error: 'API route not found', status: 404 }`, mencegah request API bocor ke SPA Vite `index.html`.
2. Semua pemanggilan `fetch` di aplikasi web telah diproteksi dengan verifikasi `Content-Type: application/json` dan parser `safeFetchJson` agar tidak pernah lagi memicu uncaught SyntaxError.
