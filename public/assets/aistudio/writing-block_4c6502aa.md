# DIMONEX — Initial Listing Implementation Prompt

## ROLE

Bertindak sebagai Senior Staff Engineer, Fintech Architect, dan Security Engineer yang berpengalaman membangun centralized cryptocurrency spot exchange dengan standar production-grade.

Tugas Anda adalah mengimplementasikan fitur **Initial Listing untuk DIMONEX**, sebuah spot crypto exchange dengan quote currency IDR.

Jangan hanya membuat mockup UI, dokumentasi, atau pseudocode. Periksa repository yang tersedia, pahami implementasi yang sudah ada, tulis kode yang terintegrasi, jalankan test suite, dan perbaiki setiap kegagalan yang ditemukan.

## 1. PROJECT CONTEXT

DIMONEX menggunakan arsitektur berikut:

- `backend-go/`: Go matching engine.
- `server/`: Node.js, Express, TypeScript, ledger, matching engine, database, routes, WebSocket, tests.
- `src/`: React 19, TypeScript, Tailwind CSS, Lightweight Charts.
- `deployments/`: Docker Compose dan PostgreSQL migrations.
- `openapi/`: OpenAPI 3.1.
- `RUNBOOK_INSIDEN.md`: prosedur audit dan tanggap darurat.

Fitur listing hanya dapat dibuat dan dikelola oleh admin internal. Tidak ada public token listing submission.

Sebelum menulis kode:
1. Inspeksi struktur repository dan `package.json`.
2. Baca implementasi autentikasi, authorization, ledger, database, matching engine, market catalogue, WebSocket, Admin Console, dan testing.
3. Identifikasi implementasi yang dapat digunakan kembali.
4. Jangan mengganti atau menduplikasi modul yang sudah berfungsi.
5. Buat rencana perubahan file dan migration yang kompatibel dengan sistem yang ada.
6. Implementasikan secara bertahap dan verifikasi setiap tahap.

## 2. NON-NEGOTIABLE FINANCIAL INVARIANTS

### Zero-Float Math

Seluruh perhitungan finansial wajib menggunakan integer eksak.

- IDR disimpan dalam sen.
- BTC disimpan dalam satoshi.
- Aset lain menggunakan integer base unit sesuai presisi yang ditetapkan.
- Harga, kuantitas, tick size, lot size, fee, dan notional harus mempunyai definisi unit yang eksplisit.
- Gunakan `bigint` di TypeScript atau tipe integer eksak yang sesuai di Go.
- PostgreSQL menyimpan nilai integer eksak, misalnya `NUMERIC(78,0)` dengan validasi integer.
- Jangan menggunakan JavaScript `Number`, `parseFloat`, atau floating-point arithmetic untuk perhitungan finansial.
- Jangan mengubah integer finansial menjadi floating point saat serialisasi API, WebSocket, atau frontend.
- Gunakan decimal string untuk transfer nilai integer besar melalui JSON.
- Implementasikan checked arithmetic, validasi rentang, dan aturan rounding eksplisit.

### Double-Entry Immutable Ledger

- Listing atau aktivasi market tidak boleh menciptakan saldo pengguna.
- Jangan menambahkan jalur mutasi saldo baru khusus listing.
- Seluruh settlement trading harus tetap melewati ledger yang sudah ada.
- Setiap transaksi finansial wajib memenuhi debit = kredit dalam unit aset yang sama.
- Available + Locked = Total Balance.
- Tidak boleh ada saldo negatif atau overdraft.
- Koreksi finansial dilakukan melalui jurnal koreksi, bukan menghapus atau mengedit jurnal lama.
- Listing tidak boleh mengubah atau menimpa histori ledger.

### Deterministic Matching Engine

- Pertahankan price-time priority.
- Pertahankan deterministic replay.
- Jangan mengubah urutan event yang sudah committed.
- Market baru tidak boleh menerima order sebelum status trading benar-benar ACTIVE.
- Market yang dihentikan tidak boleh menerima order baru.
- Status market harus dipisahkan dari status deposit dan withdrawal aset.
- Jangan menganggap market ACTIVE berarti wallet, deposit, atau withdrawal otomatis siap.

## 3. LISTING DOMAIN MODEL

Implementasikan domain berikut sesuai konvensi project:

### Asset

Minimal memiliki:

- `id`
- `symbol`
- `name`
- `assetType`
- `decimals`
- `network`
- `contractAddress`
- `status`
- `depositEnabled`
- `withdrawalEnabled`
- `createdAt`
- `updatedAt`

Status aset:

`PENDING`, `ACTIVE`, `SUSPENDED`, `RETIRED`

Persyaratan:
- Symbol harus dinormalisasi dan memiliki aturan keunikan.
- Validasi konflik symbol dan pasangan aset.
- Untuk token, network dan contract address harus divalidasi sesuai jenis jaringan.
- Asset decimals bersifat immutable setelah digunakan dalam transaksi.
- Jangan menganggap simbol unik secara global sebagai satu-satunya bukti identitas token.
- Aset yang sudah direferensikan histori finansial tidak boleh dihapus secara fisik.

### Listing Request

Minimal memiliki:

- `id`
- `assetId`
- `quoteAssetId`
- `status`
- `tickSize`
- `lotSize`
- `minQuantity`
- `minNotional`
- `makerFeeBps`
- `takerFeeBps`
- `scheduledAt`
- `createdBy`
- `createdAt`
- `updatedAt`
- `version`

Quote asset awal adalah IDR.

Status:

`DRAFT`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`, `SCHEDULED`, `ACTIVE`, `SUSPENDED`, `CANCELLED`

Gunakan state machine eksplisit. Tolak transisi yang tidak valid.

Listing yang sudah aktif tidak boleh dihapus secara fisik. Perubahan status dan konfigurasi harus tercatat dalam audit log.

### Market

Minimal memiliki:

- `id`
- `baseAssetId`
- `quoteAssetId`
- `listingRequestId`
- `symbol`
- `status`
- `tickSize`
- `lotSize`
- `minQuantity`
- `minNotional`
- `makerFeeBps`
- `takerFeeBps`
- `activatedAt`
- `version`

Status market:

`PREPARING`, `AUCTION`, `ACTIVE`, `HALTED`, `CLOSED`

Jangan menambahkan status `AUCTION` sebagai status perdagangan yang berfungsi sebelum mekanisme auction benar-benar diimplementasikan. Jika auction belum didukung, market tetap PREPARING sampai diaktifkan.

Pastikan hanya ada satu market untuk setiap pasangan base/quote. Gunakan database constraints, bukan hanya pengecekan di aplikasi.

## 4. ADMIN LISTING WORKFLOW

Implementasikan lifecycle berikut:

1. Admin membuat draft listing.
2. Sistem memvalidasi asset dan parameter market.
3. Admin mengajukan listing untuk review.
4. Admin lain menyetujui atau menolak listing.
5. Sistem memvalidasi kesiapan konfigurasi market.
6. Admin menetapkan jadwal aktivasi jika diperlukan.
7. Sistem menyiapkan market dan matching engine.
8. Aktivasi dilakukan melalui protokol yang aman dan idempoten.
9. Market aktif muncul pada public market catalogue dan frontend trading.
10. Semua perubahan tercatat dalam audit trail.

### Maker-Checker

- Pembuat listing tidak boleh menyetujui listing miliknya sendiri.
- Identitas aktor diambil dari session/token terverifikasi, bukan dari request body.
- Approval wajib menyertakan identitas reviewer, keputusan, waktu, dan alasan.
- Tolak self-approval di service layer dan database jika memungkinkan.
- Gunakan role-based authorization.
- Perubahan parameter penting setelah approval harus membatalkan approval sebelumnya atau memerlukan persetujuan ulang.
- Cegah duplicate approval dengan database constraint.
- Semua keputusan harus dapat diaudit.

Jika hanya tersedia satu akun admin, listing tidak boleh diaktifkan dengan melewati maker-checker.

## 5. BACKEND API

Integrasikan endpoint berikut dengan pola routing, error handling, middleware, dan response envelope yang sudah digunakan DIMONEX.

Admin endpoints:

- `POST /api/admin/listings`
- `GET /api/admin/listings`
- `GET /api/admin/listings/:id`
- `PATCH /api/admin/listings/:id`
- `POST /api/admin/listings/:id/submit`
- `POST /api/admin/listings/:id/approve`
- `POST /api/admin/listings/:id/reject`
- `POST /api/admin/listings/:id/schedule`
- `POST /api/admin/listings/:id/activate`
- `POST /api/admin/listings/:id/suspend`

Public endpoints:

- `GET /api/markets`
- `GET /api/markets/:symbol`

Ketentuan:

- Validasi request menggunakan library validasi yang sudah ada.
- Gunakan pagination untuk daftar listing.
- Gunakan structured error codes.
- Terapkan authentication dan authorization pada setiap admin endpoint.
- Terapkan rate limiting untuk endpoint sensitif.
- Gunakan idempotency key untuk operasi yang dapat diulang.
- Terapkan optimistic concurrency control atau row locking untuk perubahan state.
- Jangan mengekspos draft, rejected, atau suspended market sebagai market yang dapat diperdagangkan.
- Jangan pernah mengandalkan frontend untuk enforcement authorization.

Tambahkan atau perbarui spesifikasi OpenAPI 3.1.

## 6. APPEND-ONLY AUDIT TRAIL

Implementasikan audit trail untuk:

- Asset creation.
- Listing creation.
- Listing submission.
- Approval dan rejection.
- Perubahan konfigurasi market.
- Penjadwalan.
- Aktivasi.
- Suspend dan resume.
- Percobaan aktivasi yang gagal.
- Perubahan status yang ditolak.

Audit event minimal memuat:

- Event ID.
- Aggregate ID.
- Event type.
- Actor ID.
- Timestamp UTC.
- Correlation ID.
- Idempotency key jika relevan.
- Versi aggregate.
- Payload yang diperlukan untuk rekonstruksi.
- Alasan tindakan.
- Metadata keamanan yang relevan.

Gunakan append-only storage. Akun aplikasi biasa tidak boleh dapat mengubah atau menghapus event lama.

Jika menerapkan hash chain, dokumentasikan canonical serialization, algoritma hash, dan strategi verifikasi. Jangan mengklaim hash chain sebagai bukti keamanan absolut.

Jangan menyimpan password, access token, secret API key, private key, atau informasi sensitif yang tidak diperlukan dalam audit payload.

## 7. IDEMPOTENT MARKET ACTIVATION

Ini adalah bagian paling kritis dari implementasi.

Jangan mencoba mengandalkan satu transaksi database untuk menjamin atomisitas lintas PostgreSQL, Redis, message broker, dan proses matching engine.

Implementasikan pola berikut:

1. Validasi listing sudah APPROVED atau SCHEDULED.
2. Validasi approval maker-checker masih valid terhadap versi konfigurasi.
3. Mulai transaksi PostgreSQL.
4. Lock listing atau lakukan conditional state transition.
5. Verifikasi bahwa market pair belum dibuat.
6. Buat market dalam status PREPARING.
7. Simpan event aktivasi ke tabel event/outbox dalam transaksi yang sama.
8. Commit transaksi.
9. Outbox dispatcher mengirim perintah aktivasi secara at-least-once.
10. Engine consumer memproses command menggunakan idempotency key dan aggregate version.
11. Engine menyiapkan order book kosong dan memvalidasi konfigurasi.
12. Engine mengonfirmasi hasil dengan event acknowledgment.
13. Market baru dipublikasikan sebagai ACTIVE setelah readiness dan acknowledgment yang diwajibkan terpenuhi.
14. Jika terjadi timeout atau restart, sistem melakukan retry atau reconciliation tanpa membuat market, order book, atau event bisnis duplikat.

Gunakan unique constraints untuk:
- Base asset dan quote asset.
- Listing request dan market.
- Event ID.
- Idempotency key pada ruang lingkup yang tepat.

Jangan menggunakan status ACTIVE sebagai bukti tunggal bahwa engine sudah siap.

Jika terdapat ketidaksesuaian antara database dan engine:
- Jangan menerima order baru.
- Tandai kondisi sebagai belum siap atau tidak konsisten.
- Catat audit event.
- Jalankan reconciliation yang idempoten.
- Sediakan prosedur recovery untuk operator.

Pertahankan aturan bahwa order tidak boleh diterima sebelum market benar-benar siap.

## 8. DATABASE MIGRATION

Buat migration baru dengan nomor berikutnya yang tersedia.

Jangan berasumsi tabel `assets`, `markets`, atau `listing_requests` belum ada. Inspeksi migration yang sudah tersedia terlebih dahulu.

Migration harus mencakup kebutuhan berikut sesuai model database aktual:

- Listing requests.
- Listing approvals.
- Market configuration.
- Append-only audit events.
- Transactional outbox.
- Idempotency records.
- Unique constraints.
- Foreign keys.
- Validasi nilai integer positif.
- Timestamp dan versioning.

Persyaratan:

- Migration harus reproducible.
- Down migration hanya digunakan untuk perubahan skema yang aman; jangan menghapus histori finansial atau audit.
- Jangan memasukkan private key atau secret.
- Jangan menambahkan token fiktif ke production seed.
- Sertakan prosedur backup dan rollback deployment.
- Uji migration pada database kosong dan database yang sudah memiliki data.

## 9. ADMIN CONSOLE

Implementasikan UI React 19 dan Tailwind CSS yang mengikuti design system DIMONEX.

Buat halaman:

### Listing Overview

Menampilkan:
- Jumlah draft.
- Menunggu review.
- Menunggu approval.
- Scheduled.
- Active.
- Suspended.
- Rejected.

### Create Listing Wizard

Tahapan:

1. Asset identity.
2. Network dan contract validation.
3. Trading pair configuration.
4. Fee dan risk configuration.
5. Review summary.
6. Submit for approval.

### Listing Detail

Menampilkan:
- Asset metadata.
- Market parameters.
- Status dan state transition history.
- Maker dan checker.
- Audit timeline.
- Validation results.
- Engine readiness.
- Error dan recovery status.

### Approval Queue

Menyediakan:
- Detail konfigurasi.
- Perbandingan versi perubahan.
- Approve dengan alasan.
- Reject dengan alasan.
- Pencegahan self-approval.

### Market Operations

Menyediakan:
- Market activation.
- Market halt.
- Resume sesuai policy.
- Status sinkronisasi engine.
- Reconciliation status.

Tampilkan loading, empty, error, success, permission denied, stale version, dan conflict states.

Jangan mengaktifkan tombol berdasarkan asumsi frontend saja. Semua tindakan kritis harus divalidasi ulang di backend.

## 10. TRADING FRONTEND INTEGRATION

Integrasikan listing dengan:

- Market selector.
- Order book.
- Recent trades.
- Trading chart.
- Limit order form.
- Market order form.
- WebSocket market stream.

Market yang belum ACTIVE tidak boleh menerima order.

Jika market baru belum mempunyai histori:
- Tampilkan empty chart state.
- Tampilkan empty order book.
- Tampilkan empty trade history.
- Jangan mengarang harga, volume, atau candle.
- Jangan membuat fake liquidity.

Market selector hanya menampilkan market yang memang tersedia untuk trading.

Pastikan harga, volume, dan notional ditampilkan dengan formatter integer eksak. Parsing nilai input harus memakai decimal string dan konversi deterministik ke base unit.

## 11. WEBSOCKET DAN EVENT STREAMING

Tambahkan integrasi event untuk:

- Market status changes.
- Market metadata updates.
- Order book snapshot.
- Trade updates.
- Market data subscription.

Ketentuan:

- Market activation harus terurut terhadap event market terkait.
- Gunakan market ID dan versi konfigurasi yang konsisten.
- Jangan mengirim event ACTIVE sebelum market siap.
- Dukung reconnect, snapshot resync, dan penanganan sequence gap.
- Jangan memublikasikan private admin events kepada trader.
- Jangan mengandalkan Redis atau WebSocket sebagai sumber kebenaran finansial.

## 12. TESTING

Tambahkan unit, integration, dan property-based tests menggunakan framework yang sudah tersedia.

### Domain Tests

- Valid listing state transitions.
- Invalid transition rejected.
- Self-approval rejected.
- Duplicate approval rejected.
- Approval invalidated after sensitive configuration changes.
- Duplicate market pair rejected.
- Invalid tick size dan lot size rejected.
- Asset precision mismatch rejected.

### Financial Correctness

- Listing tidak mengubah saldo.
- Listing tidak membuat jurnal ledger.
- Tidak ada floating-point arithmetic dalam domain finansial.
- Integer overflow atau batas representasi ditangani.
- Fee dan notional tetap eksak.
- Existing ledger invariants tetap terpenuhi.

### Activation Tests

- Duplicate activation request.
- Duplicate outbox delivery.
- Consumer restart.
- Engine timeout.
- Database transaction rollback.
- Concurrent activation requests.
- Stale configuration version.
- Engine acknowledgment terlambat.
- Database-engine state divergence.
- Recovery setelah proses restart.

### Security Tests

- Trader tidak dapat mengakses admin endpoint.
- Admin tanpa izin tidak dapat melakukan approval.
- Maker tidak dapat menyetujui listing sendiri.
- Request body tidak dapat memalsukan actor ID.
- Audit event tidak dapat diubah melalui API.
- Idempotency key tidak dapat digunakan untuk mengubah hasil operasi berbeda.
- Suspended market tidak menerima order.

### Regression Tests

Jalankan test suite DIMONEX yang sudah ada, termasuk:

`npx tsx server/tests/run_tests.ts`

Jalankan juga test Go bila matching engine Go digunakan.

Jangan mengubah expected results hanya agar test lulus. Setiap perubahan behavior harus dijustifikasi dan diuji.

Jangan mengklaim benchmark atau test telah lulus tanpa benar-benar menjalankannya.

## 13. SECURITY DAN PRODUCTION READINESS

- Terapkan least privilege.
- Gunakan maker-checker untuk tindakan sensitif.
- Gunakan structured logging.
- Redact secrets dan token.
- Terapkan rate limits dan request size limits.
- Validasi network dan contract metadata.
- Gunakan database transactions dengan isolation dan locking yang tepat.
- Tambahkan metrics untuk activation latency, outbox backlog, consumer failures, dan reconciliation failures.
- Tambahkan alert untuk market status divergence.
- Dokumentasikan emergency halt dan recovery.
- Jangan pernah mengaktifkan trading secara otomatis hanya karena konfigurasi listing valid.
- Jangan membuat klaim kepatuhan regulator tanpa bukti proses dan persetujuan yang diperlukan.

## 14. DELIVERABLES

Selesaikan implementasi dan berikan:

1. Ringkasan arsitektur final.
2. Daftar file yang dibuat dan diubah.
3. Database migrations.
4. Backend services dan API.
5. State machine dan maker-checker.
6. Append-only audit dan transactional outbox.
7. Idempotent activation dan reconciliation.
8. Admin Console.
9. Trading frontend integration.
10. OpenAPI updates.
11. Unit, integration, property-based, dan regression tests.
12. Instruksi menjalankan migration.
13. Instruksi menjalankan aplikasi dan test suite.
14. Threat model singkat.
15. Daftar batasan dan pekerjaan yang belum selesai.

## 15. EXECUTION RULES

- Implementasikan fitur secara nyata, bukan hanya memberikan tutorial.
- Ikuti konvensi repository yang tersedia.
- Jangan menimpa implementasi ledger atau matching engine yang sudah berfungsi.
- Jangan membuat data harga atau saldo palsu.
- Jangan melewati autentikasi, maker-checker, atau approval demi mempermudah demo.
- Jangan mengklaim production-ready sebelum seluruh dependency kritis diverifikasi.
- Jika terdapat asumsi yang tidak dapat dibuktikan dari repository, nyatakan asumsi tersebut dan pilih implementasi paling konservatif.
- Jika test gagal, investigasi akar masalah dan perbaiki sebelum menyatakan selesai.
- Jika ada pekerjaan yang belum dapat dilakukan, jelaskan secara eksplisit dan jangan menyamarkannya sebagai implementasi selesai.

## DEFINITION OF DONE

Fitur dianggap selesai apabila:

- Admin internal dapat membuat dan mengelola listing.
- Maker-checker ditegakkan di backend.
- Semua perubahan tercatat di audit trail append-only.
- Market activation idempoten terhadap retry, duplicate delivery, dan restart.
- Engine readiness diverifikasi sebelum trading diaktifkan.
- Market baru muncul di frontend hanya saat benar-benar tersedia.
- Tidak ada mutasi saldo akibat listing.
- Zero-float dan ledger invariants tetap terpenuhi.
- Migration dapat dijalankan pada database target.
- Regression tests dan test baru telah dijalankan.
- Semua kegagalan, asumsi, dan batasan dilaporkan secara jujur.

Mulai dengan menginspeksi repository, lalu implementasikan fitur end-to-end secara bertahap. Jangan berhenti setelah membuat rencana atau UI mockup.