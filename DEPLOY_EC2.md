# Panduan Deploy DIMONEX di Amazon EC2 (AWS Cloud)

Dokumen ini menjelaskan **kelayakan arsitektur** serta langkah-langkah lengkap untuk meluncurkan instance virtual (**Launch an instance using EC2**) dan men-deploy platform **DIMONEX Spot Crypto Exchange** di **Amazon Elastic Compute Cloud (Amazon EC2)**.

---

## 1. Apakah Amazon EC2 Bisa & Cocok untuk DIMONEX?

**Jawaban singkat: YA — Amazon EC2 bukan hanya bisa, melainkan JAUH lebih cocok dibandingkan hosting serverless (seperti Vercel/Lambda) untuk arsitektur DIMONEX saat ini.**

### Mengapa Amazon EC2 Cocok untuk DIMONEX?
| Komponen DIMONEX | Kebutuhan Runtime | Kecocokan di Amazon EC2 |
| :--- | :--- | :--- |
| **In-Memory Matching Engine & OrderBook** | Proses Node.js persisten (single-threaded per pair, Zero-Float `BigInt` state di RAM) | **Sangat Cocok.** RAM instance EC2 selalu aktif 24/7 tanpa *cold-start* atau *function timeout*. |
| **Double-Entry Ledger & Disk Snapshot (`server/data/*.json`)** | Write-ahead snapshot & persistensi state transaksi antar-restart | **Cocok.** Volume **Amazon EBS (`gp3`)** bersifat persisten dan dapat di-*backup* via EBS Snapshot, berbeda dengan filesystem *ephemeral* pada PaaS/serverless. |
| **WebSocket Real-Time (`/ws`)** | Koneksi persisten untuk L2 Order Book, Live Trades, & OHLCV Candle Streaming | **Sangat Cocok.** Nginx + EC2 mendukung puluhan ribu koneksi WebSocket stateful secara native tanpa limit durasi koneksi. |
| **Market Maker & HFT Worker Loops (`BotWorkerManager`)** | Loop kuotasi, *portfolio rebalancing*, dan telemetri periodik sub-detik | **Sangat Cocok.** Background worker berjalan terus-menerus tanpa dihentikan paksa oleh *idle suspension*. |

### Batasan Arsitektur yang Wajib Diperhatikan (Penting!)
1. **Wajib Single-Instance pada Engine Node.js (`instances: 1`)**:
   Implementasi runtime `server/` menyimpan state *OrderBook*, *Ledger*, dan snapshot file lokal (`server/data/`) di memori satu proses. **Jangan gunakan** PM2 `cluster` mode atau Auto Scaling Group multi-EC2 secara paralel untuk backend Node.js ini karena akan menyebabkan *split-brain* saldo dan order book antar proses. Gunakan **vertical scaling** (naikkan vCPU/RAM EC2 seperti `t3.medium` -> `c7i.large`) sampai bermigrasi ke stack terdistribusi.
2. **Jangan Gunakan Instance Burstable CPU Rendah untuk Beban HFT Tinggi**:
   Hindari `t2.micro` / `t3.nano` untuk production. Untuk HFT & Market Maker dengan throughput order tinggi, gunakan keluarga **Compute Optimized (`c6i.large` / `c7i.large`)** agar tidak terkena *CPU credit throttling*.
3. **Skala Enterprise Multi-Node**:
   Jika nanti trafik memerlukan *high-availability* multi-node, jalankan arsitektur terdistribusi pada folder `/deployments/docker-compose.yml` (**PostgreSQL / Amazon RDS + Redis + NATS + `backend-go/`**) di EC2 atau EKS/ECS.

---

## 2. Rekomendasi Spesifikasi EC2 Instance

| Skenario | Tipe Instance AWS | vCPU / RAM | Penyimpanan (EBS) | Estimasi Beban |
| :--- | :--- | :--- | :--- | :--- |
| **Dev / Sandbox / Internal QA** | `t3.small` atau `t3.medium` | 2 vCPU / 2–4 GB | 20 GB `gp3` | Testing UI, Trading Demo, 1–3 MM Bot ringan |
| **Staging / Pre-Production** | `t3.large` atau `m6i.large` | 2 vCPU / 8 GB | 30 GB `gp3` | Simulasi beban, WebSocket multi-klien, test suite |
| **Production HFT & Market Maker** | `c6i.large` atau `c7i.xlarge` | 2–4 vCPU dedicated / 4–8 GB | 50 GB `gp3` (3000+ IOPS) | Latensi matching sub-ms stabil tanpa CPU throttling |

---

## 3. Langkah 1 — Launch an Instance di AWS EC2 Console

1. Masuk ke **AWS Management Console** -> buka layanan **EC2** -> pilih region terdekat dengan target pengguna (misal `ap-southeast-3` **Jakarta** atau `ap-southeast-1` **Singapore**).
2. Klik **Launch instances**.
3. **Name and tags**: Isi `dimonex-exchange-prod`.
4. **Application and OS Images (AMI)**: Pilih **Ubuntu Server 24.04 LTS (HVM), SSD Volume Type** (arsitektur `64-bit (x86)`).
5. **Instance type**: Pilih `t3.medium` (sandbox/staging) atau `c6i.large` (production).
6. **Key pair (login)**: Klik *Create new key pair*, pilih `.pem`, simpan file misalnya `dimonex-ec2.pem` di mesin lokal Anda (`chmod 400 dimonex-ec2.pem`).
7. **Network settings (Security Group)**:
   Buat Security Group dengan aturan Inbound berikut:
   - **SSH (`22`)**: Source pilih **My IP** (JANGAN buka `0.0.0.0/0` untuk SSH di production).
   - **HTTP (`80`)**: Source `0.0.0.0/0` (untuk redirect ke HTTPS & verifikasi Let's Encrypt).
   - **HTTPS (`443`)**: Source `0.0.0.0/0` (akses pengguna via Nginx reverse proxy).
   - **Port `3000`**: **Biarkan TERTUTUP dari publik.** Aplikasi Node.js hanya mendengarkan lokal di balik Nginx.
8. **Configure storage**: Atur minimal `30 GiB` **gp3** (aktifkan *Delete on termination: No* untuk volume production agar data `server/data/` tetap aman).
9. Klik **Launch instance** dan catat **Public IPv4 address** serta **Public IPv4 DNS**.

---

## 4. Langkah 2 — Koneksi SSH & Instalasi Runtime Server

Masuk ke instance EC2 dari terminal lokal Anda:

```bash
chmod 400 ~/Downloads/dimonex-ec2.pem
ssh -i ~/Downloads/dimonex-ec2.pem ubuntu@<PUBLIC_IP_EC2>
```

Install dependensi sistem (Node.js 22 LTS, Git, Nginx, PM2, Certbot):

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git nginx certbot python3-certbot-nginx build-essential

# Install Node.js 22 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verifikasi versi Node.js & npm
node -v
npm -v

# Install PM2 global untuk process manager 24/7
sudo npm install -g pm2
```

*(Opsional untuk instance RAM <= 2 GB)* Tambahkan 2 GB swap agar proses `vite build` tidak kehabisan memori:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 5. Langkah 3 — Deploy Aplikasi DIMONEX

```bash
# Buat direktori aplikasi
sudo mkdir -p /var/www/dimonex
sudo chown -R ubuntu:ubuntu /var/www/dimonex
cd /var/www/dimonex

# Clone repository DIMONEX Anda
git clone <URL_REPOSITORY_GIT_ANDA> .

# Install seluruh dependencies produksi & dev untuk build frontend
npm ci
```

Konfigurasi environment variables di file `.env` (jangan pernah commit `.env` ke Git):

```bash
cat << 'EOF' > /var/www/dimonex/.env
NODE_ENV=production
PORT=3000
JWT_SECRET=<GANTI_DENGAN_SECRET_ACAK_MINIMAL_64_KARAKTER>
CORS_ORIGINS=https://exchange.domain-anda.com
APP_URL=https://exchange.domain-anda.com
EOF
```

Generate `JWT_SECRET` kriptografis yang kuat dengan:
```bash
openssl rand -hex 32
```

Build frontend & server produksi, lalu jalankan suite verifikasi finansial:

```bash
npm run build
npx tsx server/tests/run_tests.ts
```

Pastikan output suite berakhir dengan `17 Passed, 0 Failed`.

---

## 6. Langkah 4 — Jalankan 24/7 dengan PM2 (Wajib Single-Instance Fork Mode)

Buat file `/var/www/dimonex/ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    {
      name: 'dimonex-exchange',
      script: 'npm',
      args: 'start',
      cwd: '/var/www/dimonex',
      instances: 1,          // WAJIB 1: In-memory OrderBook & Ledger bersifat single-process
      exec_mode: 'fork',     // JANGAN pakai 'cluster' agar tidak split-brain
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
```

Pastikan di `package.json` script `"start"` menjalankan entrypoint production (`node server.js` atau `tsx server.ts` sesuai output build Anda). Kemudian aktifkan PM2:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd
# Jalankan perintah 'sudo env PATH=...' yang muncul dari output pm2 startup
```

Pantau log secara real-time:
```bash
pm2 logs dimonex-exchange
```

---

## 7. Langkah 5 — Nginx Reverse Proxy, WebSocket (`/ws`), & SSL/TLS

Buat konfigurasi Nginx di `/etc/nginx/sites-available/dimonex`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name exchange.domain-anda.com;

    # Endpoint WebSocket real-time (L2 Depth, Live Trades, Candles)
    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # REST API & Frontend SPA
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10m;
    }
}
```

Aktifkan konfigurasi Nginx dan pasang sertifikat HTTPS gratis via Let's Encrypt:

```bash
sudo ln -s /etc/nginx/sites-available/dimonex /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Pasang SSL/TLS (pastikan DNS A-record domain sudah diarahkan ke Public IP EC2)
sudo certbot --nginx -d exchange.domain-anda.com
```

---

## 8. Langkah 6 — Verifikasi Kesehatan Sistem & Backup Data Ledger

1. **Cek Health & Telemetry**:
   ```bash
   curl -s http://127.0.0.1:3000/health
   curl -s http://127.0.0.1:3000/metrics
   ```
   Akses juga `https://exchange.domain-anda.com` dan buka tab **MM Console -> HFT Engine Telemetry** untuk memantau *Orders-Per-Second*, *Execution Latency (ms)*, dan *Total Fee Generation (IDR)* secara real-time.

2. **Backup State Ledger (`server/data/*.json`)**:
   - Aktifkan **AWS Data Lifecycle Manager (DLM)** untuk snapshot otomatis volume EBS setiap hari.
   - Tambahkan cron backup terenkripsi `server/data/` ke Amazon S3 bucket privat dengan versioning aktif agar rekonsiliasi audit finansial tetap terjaga.
