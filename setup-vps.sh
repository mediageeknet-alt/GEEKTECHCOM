#!/usr/bin/env bash
set -e

echo "========================================================"
echo "  GEEKTECH-COM — AUTO INSTALLER VPS (UBUNTU / BIZNET GIO)"
echo "========================================================"

# 1. Buat Swap 2GB jika belum ada (agar build Vite tidak kehabisan RAM di VPS 1GB/2GB)
if [ ! -f /swapfile ]; then
  echo "[1/6] Membuat Swap Memory 2GB..."
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
else
  echo "[1/6] Swap file sudah tersedia, melewati..."
fi

# 2. Update Ubuntu & Install Paket Pendukung + Nginx
echo "[2/6] Menginstal paket sistem & Nginx..."
apt update -y
apt install -y curl git unzip nginx ufw build-essential

# 3. Install Node.js 20 LTS jika belum terinstal
if ! command -v node &> /dev/null; then
  echo "[3/6] Menginstal Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
else
  echo "[3/6] Node.js sudah terinstal ($(node -v))..."
fi

# 4. Install PM2 & tsx Global
echo "[4/6] Menginstal PM2 & tsx..."
npm install -g pm2 tsx

# 5. Install Dependencies Project & Build Frontend
echo "[5/6] Menginstal paket aplikasi & mem-build tampilan frontend..."
npm install
mkdir -p .data
if [ ! -f .env ]; then
  cp .env.example .env
fi
npm run build

# 6. Jalankan Server dengan PM2
echo "[6/6] Menjalankan aplikasi Geektech-Com di PM2..."
pm2 delete geektech-app 2>/dev/null || true
NODE_ENV=production pm2 start "npx tsx server.ts" --name "geektech-app"
pm2 save

# Konfigurasi Nginx Reverse Proxy (Port 80 -> Port 3000)
cat > /etc/nginx/sites-available/geektech << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/geektech /etc/nginx/sites-enabled/geektech
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

PUBLIC_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
echo "========================================================"
echo "  INSTALASI SELESAI!"
echo "  Aplikasi Anda sudah aktif dan bisa langsung dibuka di:"
echo "  http://${PUBLIC_IP}"
echo "========================================================"
