#!/usr/bin/env bash
set -e

APP_DIR="/var/www/geektech"
REPO_URL="https://github.com/mediageeknet-alt/GEEKTECHCOM.git"

echo "========================================================"
echo "  GEEKTECH-COM — UPDATE PATCH PRODUCTION (SAFE MODE)"
echo "========================================================"

cd "$APP_DIR"

# 1. Backup database lokal (.data) & .env agar data nota servis tetap aman 100%
echo "[1/4] Mengamankan database lokal (.data) & konfigurasi .env..."
rm -rf /tmp/geektech-data-backup
mkdir -p /tmp/geektech-data-backup
cp -r .data/* /tmp/geektech-data-backup/ 2>/dev/null || true
cp .env /tmp/geektech-env-backup 2>/dev/null || true

# 2. Tarik patch terbaru dari GitHub
echo "[2/4] Menarik kode terbaru dari $REPO_URL..."
git remote set-url origin "$REPO_URL" 2>/dev/null || true
git fetch --all
git reset --hard origin/main || git reset --hard origin/master

# 3. Kembalikan database lokal (.data) & .env (pastikan NODE_ENV="production")
echo "[3/4] Mengembalikan database lokal (.data) & .env..."
mkdir -p .data
cp -r /tmp/geektech-data-backup/* .data/ 2>/dev/null || true
if [ -f /tmp/geektech-env-backup ]; then
  cp /tmp/geektech-env-backup .env
else
  cp -n .env.example .env || true
fi

# 4. Install dependencies, build ulang frontend (dist/), dan nyalakan PM2 di mode PRODUCTION
echo "[4/4] Mem-build produksi (dist/) & me-restart server PM2..."
npm install
npm run build

# Hapus proses PM2 lama (jika sebelumnya menjalankan vite dev) dan jalankan server Express Production
pm2 delete all 2>/dev/null || true
NODE_ENV=production pm2 start "npm run start" --name "geektech-app"
pm2 save

echo "========================================================"
echo "  UPDATE PRODUCTION BERHASIL! SERVER AKTIF (MODE DIST)."
echo "========================================================"
