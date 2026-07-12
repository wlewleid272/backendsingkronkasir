@echo off
title SISTEM INTEGRASI KASIR MULTI-CABANG - wlewleid.id
cd /d "%~dp0"

echo ==========================================================
echo [1/3] Menghidupkan Pipa 2: Pengirim Data Cloud Hostinger...
echo ==========================================================
start "Pipa 2 - Pengirim Cloud" /min node lokalbackendkasir/app.js

echo.
echo MEMERIKSA JALUR... Memberi jeda 3 detik agar Pipa 2 siap mengunci internet...
timeout /t 3 /nobreak > status_jaringan.txt

echo.
echo ==========================================================
echo [2/3] JALUR AMAN! Menghidupkan Pipa 1: Penarik Data SID Lokal...
echo ==========================================================
start "Pipa 1 - Penarik Data" /min node lokalkasir/app.js

echo.
echo ==========================================================
echo [3/3] SUKSES! Kedua sistem kurir sedang berjalan senyap di background.
echo JANGAN TUTUP LAYAR INI SELAMA TOKO MASIH BUKA!
echo ==========================================================
pause
