# Implementasi SMART HFT LADDER BOT & PATTERN CHART CREATOR ENGINE

## 1. Modul A: Advanced Chart & Pattern Creator Engine
- **Struktur Data OHLC**: Mendukung opsi skala waktu `5m`, `15m`, `1h`, dan `4h`. Menghasilkan jumlah candle bars dan Gaussian Noise deviation scale yang proporsional sesuai time frame.
- **14 Formasi Pola Geometris & Matematis**:
  1. *Reversal Patterns*: Head and Shoulders, Inverse Head and Shoulders, Double Top, Triple Top, Double Bottom, Triple Bottom.
  2. *Continuation Patterns*: Bullish Flag, Bearish Flag, Pennant, Cup and Handle, Rectangle.
  3. *Bilateral / Neutral Patterns*: Ascending Triangle, Descending Triangle, Symmetrical Triangle.
- **Titik Jangkar Running (Anchor Pivot)**: Menghitung harga running saat ini (`current_price`) di akhir kurva pola sebagai titik pivot untuk order ladder.

## 2. Modul B: Guarded Multi-Order HFT Ladder Engine
- **Arsitektur Tangga (40 Order Default, configurable s/d 100)**: Membagi order secara simetris (20 Buy Limits di bawah harga anchor dan 20 Sell Limits di atas harga anchor).
- **Anti-Out of Bounds Price Guard**: Membatasi order secara ketat dalam interval `[min_price_bound, max_price_bound]` menggunakan interpolasi linear yang tersebar merata.
- **Volume Scaling Guard**: Mendistribusikan ukuran lot bertahap (marti-light) dari Level 1 (dekat running price) hingga Level 20/terjauh (mendekati batas aman) tanpa melebihi batas lot maksimum.
- **Laporan Verifikasi Konsol**: Mencantumkan ringkasan harga dan lot pada Level 1 (terdekat) dan Level 20 (terjauh) untuk membuktikan proteksi 100% akurat.

## 3. Komponen & Integrasi
- `scripts/smart_hft_ladder_bot.py`: Skrip mandiri Python OOP asinkron lengkap dengan visualisasi matplotlib dark mode, validasi assertions batas aman, dan fallback tanpa pandas/matplotlib.
- `server/services/bots/SmartHftLadderBot.ts`: Engine eksekusi bot di matching engine DIMONEX dengan rotasi ladder anti-stacking dan pencatatan audit log.
- `server/routes/mmConsole.ts`: Endpoint API untuk preview pola (`/api/mm/smart-hft/preview`), katalog pola (`/api/mm/smart-hft/patterns`), pembuatan bot instance (`/api/mm/smart-hft/create`), dan download Python script (`/api/mm/smart-hft/python-script`).
- `src/components/bot/SmartHftLadderSection.tsx`: Antarmuka visual interaktif dengan simulasi grafik HTML5 Canvas, verifikasi laporan Level 1 vs Level 20, visualizer skrip Python, dan kontrol operasional bot.
- `src/components/bot/MMConsoleView.tsx`: Navigasi tab terdedikasi `📐 Smart HFT Ladder` dan integrasi quick action di overview konsol.
