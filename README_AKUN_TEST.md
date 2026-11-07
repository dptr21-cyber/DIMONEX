# 🔐 PANDUAN KREDENSIAL & AKUN PENGUJIAN DIMONEX (TEST ACCOUNTS & PASSWORDS)

Dokumen ini berisi daftar lengkap seluruh akun pengujian, alamat email, kata sandi (password), peran (*role*), saldo awal, serta cakupan pengujian fitur untuk platform bursa aset kripto **DIMONEX**.

---

## 1. Tabel Kredensial Seluruh Akun (All Test Accounts)

| No | Peran / Hak Akses | Nama Pengguna | Email Login | Kata Sandi (Password) | Status KYC | Saldo Dompet Awal |
|:---|:---|:---|:---|:---|:---|:---|
| 1 | **SUPER ADMIN** | Super Admin DIMONEX | `admin@dimonex.id` | `AdminDimonex2026!` | Tier 2 (Approved) | Rp 50.000.000.000, 100 BTC, 100 ETH, 500.000 USDT, 1.000.000 DOGE |
| 2 | **COMPLIANCE & RISK** | Compliance Officer | `compliance@dimonex.id` | `ComplianceDimonex2026!` | Tier 2 (Approved) | Rp 5.000.000.000, 10 BTC, 10 ETH, 50.000 USDT |
| 3 | **MARKET MAKER (MM)** | MM Operator | `mm@dimonex.id` | `MarketMaker2026!` | Tier 2 (Approved) | Rp 50.000.000.000, 50 BTC, 100 ETH, 500.000 USDT, 1.000.000 DOGE |
| 4 | **PRO TRADER 1** | Budi Santoso | `budi@dimonex.id` | `TraderDimonex123!` | Tier 2 (Approved) | Rp 10.000.000.000, 10 BTC, 10 ETH, 25.000 USDT, 100.000 DOGE |
| 5 | **PRO TRADER 2** | Siti Rahmawati | `siti@dimonex.id` | `TraderDimonex123!` | Tier 2 (Approved) | Rp 5.000.000.000, 20 BTC, 5 ETH, 10.000 USDT |
| 6 | **REGULAR USER 1** | User Satu Trading | `user1@dimonex.id` | `User1Dimonex2026!` | Tier 2 (Approved) | Rp 10.000.000.000, 10 BTC, 10 ETH, 25.000 USDT |
| 7 | **REGULAR USER 2** | User Dua Trading | `user2@dimonex.id` | `User2Dimonex2026!` | Tier 2 (Approved) | Rp 5.000.000.000, 20 BTC, 5 ETH, 10.000 USDT |
| 8 | **FRESH TEST USER** | Akun Pengujian Baru | `test@dimonex.id` | `TestDimonex2026!` | Tier 2 (Approved) | Rp 100.000.000, 1 BTC, 2 ETH, 5.000 USDT |

---

## 2. Cakupan Fitur Sesuai Peran (Role-Based Features)

### A. Super Admin (`admin@dimonex.id` / `AdminDimonex2026!`)
* **Admin Console Penuh**: Akses tombol **🛡️ Panel Admin** di header.
* **Token Listing Management**: Membuat permohonan listing token baru (Maker) dan menyetujui pasangan trading (Checker).
* **Manajemen Pasangan Trading (Markets)**: Menghentikan trading sementara (*Halt Pair*), mengaktifkan kembali (*Resume*), dan mengubah fee maker/taker.
* **Ledger & Solvency**: Audit solvabilitas perbankan bursa ($\sum Assets \ge \sum Liabilities$).
* **Global Risk Control**: Mengaktifkan *Emergency Kill-Switch* bot di seluruh sistem.

### B. Compliance Officer (`compliance@dimonex.id` / `ComplianceDimonex2026!`)
* **Review & Verifikasi KYC**: Meninjau dokumen KTP/Paspor nasabah dan menaikkan limit Tier 1 / Tier 2.
* **Audit Trail & AML Alerts**: Memantau mutasi abnormal, transaksi bernilai besar, dan log audit yang tidak dapat dihapus (*append-only*).
* **Token Listing Review**: Bertindak sebagai *Compliance Checker* untuk menyetujui parameter legal dan smart contract token baru.
* **Suspensi Akun**: Membekukan sementara akun yang mencurigakan (*Freeze/Unfreeze*).

### C. Market Maker Operator (`mm@dimonex.id` / `MarketMaker2026!`)
* **MM Console & Bot Likuiditas**: Akses tombol **⚡ MM Console** di header.
* **Liquidity Provision Configuration**:
  - Konfigurasi bot tangga harga (Linear, Geometric, Exponential, Fibonacci).
  - Mode **Custom Pricing** (menetapkan `Min/Max Limit Buy` dan `Min/Max Limit Sell` secara otonom tanpa tergantung feed eksternal).
  - Mode **Penempatan Presisi (0 Jitter / 100% Persis Preview)**.
  - Parameter manajemen inventaris: `Max Total Bid IDR`, `Max Total Ask Qty`, `Max Open Orders`.
  - Sistem **Anti-Numpuk (Anti-Stacking)** yang secara atomik membatalkan antrean usang sebelum menempatkan rungs baru.

### D. Trader Budi & Siti (`budi@dimonex.id` & `siti@dimonex.id` / `TraderDimonex123!`)
* **Spot Trading Terminal**: Melakukan penempatan order Limit dan Market pada seluruh pair (BTC/IDR, ETH/IDR, USDT/IDR, DOGE/IDR).
* **Visualisasi Order Book**: Melihat kedalaman pasar real-time dengan grafik D3.js Depth Chart.
* **Uji Transaksi Instan (Cross-Matching)**: Masuk sebagai Budi untuk menaruh Limit Sell, lalu masuk sebagai Siti untuk membeli dengan Market Buy. Transaksi matched dalam sub-milidetik.
* **Deposit & Penarikan**: Menguji mutasi saldo IDR (Virtual Account) dan transfer kripto on-chain.

### E. Akun Pengujian Baru (`test@dimonex.id` / `TestDimonex2026!`)
* Akun bersih untuk menguji alur onboarding pengguna baru dari awal.
* Pengaturan keamanan 2FA TOTP (Google Authenticator) di menu **Keamanan Akun**.

---

## 3. Cara Pengujian Instan Melalui UI (1-Click Login)

1. Buka aplikasi DIMONEX pada URL browser Anda.
2. Klik tombol **"Masuk / Daftar"** di pojok kanan atas.
3. Di dalam dialog login, perhatikan bagian **"Akun Pengujian Demo Cepat"**.
4. Klik salah satu akun yang ingin diuji (misal: *Super Admin*, *MM Operator*, atau *Budi Santoso*).
5. Kolom Email dan Kata Sandi akan terisi secara otomatis.
6. Klik **"Masuk ke Platform"** — Anda akan langsung dialihkan ke dashboard dengan profil dan saldo terisi penuh.
