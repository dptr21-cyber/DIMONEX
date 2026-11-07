# DIMONEX — Spot Crypto Exchange (Quote Currency IDR)

**DIMONEX** (*Dimension + Money + Exchange*) adalah platform bursa spot aset kripto teregulasi lokal dengan quote currency Rupiah (IDR). Sistem mengutamakan **kebenaran mutasi saldo (financial ledger correctness)** di atas segalanya, didukung *single-threaded in-memory matching engine* per pair dengan *event sourcing log*, autentikasi berlapis, KYC bertingkat, serta antarmuka trading modern berdensitas tinggi.

***

## Prinsip Rekayasa Inti (Non-Negotiable)

1. **Zero-Float Math**: Seluruh perhitungan finansial, saldo akun, harga, volume, dan fee menggunakan integer satuan terkecil (BigInt):
   - IDR: dalam sen ($10^{-2}$, 100 sen = 1 IDR)
   - BTC: dalam Satoshis ($10^{-8}$, 100,000,000 sats = 1 BTC)
   - ETH: dalam 8 desimal ($10^{-8}$)
   - USDT: dalam micro-units ($10^{-6}$)
2. **Double-Entry Immutable Ledger**:
   - $\sum \text{Debit} \equiv \sum \text{Credit}$ untuk setiap transaksi jurnal.
   - Saldo Tersedia (*Available*) + Saldo Terkunci (*Locked*) = Total Saldo.
   - Tidak ada saldo negatif (*no overdraft*), tidak ada pembatalan mutasi tanpa jurnal koreksi berpasangan.
3. **Deterministic Single-Threaded Matching Engine**:
   - Price-time priority (FIFO di level harga yang sama).
   - Order types: Limit & Market.
   - Time-In-Force: GTC (*Good-Til-Cancelled*) & IOC (*Immediate-Or-Cancel*).
   - Self-Trade Prevention (STP: Cancel Maker) untuk mencegah wash trading.
   - Append-Only Event Sourcing Log (dapat di-replay 100% konsisten).

***

## Arsitektur Folder

```
dimonex/
├── backend-go/                      # Implementasi Go produksi
│   ├── cmd/
│   │   └── engine/main.go           # Daemon matching engine
│   ├── internal/domain/
│   │   └── orderbook.go             # Order book BigInt Go
│   └── go.mod
├── deployments/                     # Docker & PostgreSQL Migrations
│   ├── docker-compose.yml           # Postgres, Redis, NATS, Engine
│   └── migrations/                  # 001_init_users_kyc.sql ... 004_wallets_api_keys_audit.sql
├── openapi/                         # Spesifikasi OpenAPI 3.1
│   └── dimonex-api.yaml
├── server/                          # Live full-stack execution engine (Node/Express/TS)
│   ├── engine/                      # In-memory OrderBook & MatchingEngine
│   ├── ledger/                      # Double-Entry Ledger & PrecisionMath
│   ├── db/                          # ACID in-memory transactional database
│   ├── routes/                      # Auth, KYC, Trading, Wallet, API Keys, Admin, Risk, Metrics
│   ├── websocket/                   # Real-time L2 depth & trade streaming
│   └── tests/                       # Property-based tests & performance benchmark
├── src/                             # Frontend UI (React 19 + Tailwind + Lightweight Charts)
│   ├── components/                  # Chart, OrderBook, Trades, Form, Wallet, KYC, Security, Admin
│   ├── types/                       # Shared domain types & kamus bilingual (ID / EN)
│   └── App.tsx                      # Master application view router
├── RUNBOOK_INSIDEN.md               # SOP tanggap darurat dan audit keuangan
└── server.ts                        # Dev server entrypoint (port 3000)
```

***

## Menjalankan Suite Pengujian Finansial

Untuk memvalidasi integritas matematis zero-float, double-entry ledger, matching engine, dan benchmark 1.000 order/detik:

```bash
npx tsx server/tests/run_tests.ts
```

Output:
```
====================================================
   DIMONEX EXCHANGE TEST SUITE: FINANCIAL CORE
====================================================
  ✓ PASS: Parse 0.15000000 BTC to 15,000,000 sats
  ✓ PASS: Parse Rp 1,450,000,000.50 to 145000000050 sen
  ✓ PASS: 1.0 BTC @ 1,450,000,000 IDR yields exact 1,450,000,000.00 IDR
  ✓ PASS: Maker fee 0.10% on 1.45B IDR is exactly Rp 1,450,000.00
  ✓ PASS: Invariant holds after User A deposit
  ✓ PASS: Invariant holds after User B deposit
  ✓ PASS: Locking IDR correctly adjusts available and locked without changing total
  ✓ PASS: Unlocking returns funds to available
  ✓ PASS: Limit Buy is placed in order book when book is empty
  ✓ PASS: Orders matched and trade generated
  ✓ PASS: Full match quantity 1.0 ETH
  ✓ PASS: Taker order filled
  ✓ PASS: STP cancels maker order and prevents wash trading between same user
  ✓ PASS: Unmatched IOC order is immediately cancelled
  ✓ PASS: IOC immediately unlocks all pre-locked funds on cancellation
  ✓ PASS: Target 1,000 orders/sec met (Achieved: ~27,000 orders/sec)
  ✓ PASS: Final global ledger balance invariants 100% verified
====================================================
RESULT: 17 Passed, 0 Failed
====================================================
```

***

## 📋 Kredensial & Akun Pengujian Lengkap (Test Accounts & Passwords)

Seluruh akun di bawah telah di-*pre-seed* ke dalam basis data transaksional ACID, telah lolos verifikasi **KYC Tier 2**, dan memiliki saldo aset yang siap ditransaksikan secara *real-time* di matching engine.

| Peran (Role) | Nama Akun | Email Login | Kata Sandi (Password) | Saldo Awal Unggulan | Otoritas & Fitur yang Dapat Diuji |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SUPER ADMIN** | Super Admin DIMONEX | `admin@dimonex.id` | `AdminDimonex2026!` | Rp 50 Miliar, 100 BTC, 100 ETH, 500k USDT, 1M DOGE | Akses penuh **Admin Console**, Maker/Checker Token Listing, Manajemen Pasangan Trading, Ledger Solvency, AML & Risk Monitor. |
| **COMPLIANCE** | Compliance & Risk Officer | `compliance@dimonex.id` | `ComplianceDimonex2026!` | Rp 5 Miliar, 10 BTC, 10 ETH, 50k USDT | Akses **Audit Trail AML**, Verifikasi KYC Pengguna, Approval Listing Token (Checker role), Freeze/Unfreeze akun. |
| **MARKET MAKER** | MM Operator DIMONEX | `mm@dimonex.id` | `MarketMaker2026!` | Rp 50 Miliar, 50 BTC, 100 ETH, 500k USDT, 1M DOGE | Akses **MM Console**, Pembuatan Bot Likuiditas Depth Grid, Mode Spacing Tangga (Linear/Geometrik/Eksponensial), Custom Bounds Pricing tanpa feed eksternal. |
| **PRO TRADER 1** | Budi Santoso | `budi@dimonex.id` | `TraderDimonex123!` | Rp 10 Miliar, 10 BTC, 10 ETH, 25k USDT, 100k DOGE | Trading Terminal Spot (BTC-IDR, ETH-IDR, USDT-IDR, DOGE-IDR), Limit & Market Order, Self-Trade Prevention, Penarikan/Deposit. |
| **PRO TRADER 2** | Siti Rahmawati | `siti@dimonex.id` | `TraderDimonex123!` | Rp 5 Miliar, 20 BTC, 5 ETH, 10k USDT | Counterparty Trader untuk pengujian eksekusi order instan, kedalaman L2 order book, dan riwayat transaksi (trades history). |
| **REGULAR USER 1** | User Satu Trading | `user1@dimonex.id` | `User1Dimonex2026!` | Rp 10 Miliar, 10 BTC, 10 ETH, 25k USDT | Trading Terminal Spot, Dompet Aset, Riwayat Mutasi Jurnal Double-Entry, Portofolio. |
| **REGULAR USER 2** | User Dua Trading | `user2@dimonex.id` | `User2Dimonex2026!` | Rp 5 Miliar, 20 BTC, 5 ETH, 10k USDT | Pengujian transaksi multi-pengguna, L2 Depth streaming real-time, order cancellation. |
| **FRESH TEST USER** | Akun Pengujian Baru | `test@dimonex.id` | `TestDimonex2026!` | Rp 100 Juta, 1 BTC, 2 ETH, 5k USDT | Pengujian alur registrasi, login baru, deposit perdana, KYC tingkat lanjut, dan aktivasi 2FA TOTP. |

> 💡 **Tips Pengujian Instan di Browser**:
> 1. Klik tombol **"Masuk / Daftar"** di pojok kanan atas aplikasi web.
> 2. Pada jendela login, buka tab atau daftar preset **"Akun Pengujian Demo Cepat"** untuk memilih akun yang diinginkan dengan 1-klik tanpa perlu mengetik manual.
> 3. Formulir email dan password akan terisi otomatis, lalu tekan **"Masuk ke Platform"**.

