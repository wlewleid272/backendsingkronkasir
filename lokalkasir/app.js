const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const mysql = require("mysql");
const axios = require("axios");
const fs = require("fs");

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
};
const WEB_API_URL = process.env.WEB_API_URL;
const API_TOKEN = process.env.API_TOKEN;
const KODE_TOKO = process.env.KODE_TOKO;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const connection = mysql.createPool({
  ...dbConfig,
  connectionLimit: 50,
  queueLimit: 25,
  waitForConnections: true,
});

function formatWaktuLokal(inputDate) {
  if (!inputDate) return null;
  const d = new Date(inputDate);
  if (isNaN(d.getTime())) return inputDate;

  const tahun = d.getFullYear();
  const bulan = String(d.getMonth() + 1).padStart(2, "0");
  const tanggal = String(d.getDate()).padStart(2, "0");
  const jam = String(d.getHours()).padStart(2, "0");
  const menit = String(d.getMinutes()).padStart(2, "0");
  const detik = String(d.getSeconds()).padStart(2, "0");

  return `${tahun}-${bulan}-${tanggal} ${jam}:${menit}:${detik}`;
}
const queryDB = (sql) => {
  return new Promise((resolve, reject) => {
    connection.query(sql, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

let isSyncRunning = false;

async function sinkronisasiData() {
  if (isSyncRunning) {
    console.log(`[${new Date().toLocaleTimeString()}] ⏳ Sync sebelumnya belum selesai, lewati giliran ini...`);
    return;
  }

  isSyncRunning = true;
  console.log(`\n[${new Date().toLocaleTimeString()}] 🔄 Memulai proses sinkronisasi berantai ke Cloud...`);

  try {

    
    // -- STOK BARANG --
    const fileSyncPath = path.join(__dirname, "last_sync_barang.txt");
    let waktuTerakhirSync = "2000-01-01 00:00:00";
    if (fs.existsSync(fileSyncPath)) waktuTerakhirSync = fs.readFileSync(fileSyncPath, "utf8");
    
    const stokBarang = await queryDB(`SELECT kode, kode_barcode AS kodebarcode, nama, kategori, golongan, subgolongan1 AS subkategori, supplier AS supplier, isi, satuanbeli, satuan, satuan2, toko, gudang, hpp, harga_toko AS hargatoko1, harga_toko2 AS hargatoko2, harga_toko3 AS hargatoko3, lokasi, waktu_update AS updated_at FROM barang WHERE waktu_update > '${waktuTerakhirSync}' ORDER BY waktu_update ASC`);
    
    if (stokBarang && stokBarang.length > 0) {
      console.log(`[STOK] Menarik ${stokBarang.length} data baru...`);
      for (let i = 0; i < stokBarang.length; i += 20) {
        await axios.post(WEB_API_URL + "/api/v1/sync-kasir/stok", { toko: KODE_TOKO, data: stokBarang.slice(i, i + 20) }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        await sleep(500);
      }
      const tanggalTerbaru = stokBarang.reduce((max, b) => { const w = new Date(b.updated_at); return w > max && !isNaN(w) ? w : max; }, new Date());
      fs.writeFileSync(fileSyncPath, formatWaktuLokal(tanggalTerbaru));
      console.log("✔ Sinkron Stok Selesai.");
    }

    // -- KARYAWAN --
    const dataKaryawan = await queryDB(`SELECT password, kode, nama, level, login_terakhir FROM karyawan`);
    if (dataKaryawan && dataKaryawan.length > 0) {
      console.log(`[KARYAWAN] Menarik ${dataKaryawan.length} data...`);
      for (let i = 0; i < dataKaryawan.length; i += 20) {
        await axios.post(WEB_API_URL + "/api/v1/sync-kasir/karyawan", { toko: KODE_TOKO, data: dataKaryawan.slice(i, i + 20) }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        await sleep(500);
      }
      console.log("✔ Sinkron Karyawan Selesai.");
    }

    // -- PELANGGAN --
    const dataPelanggan = await queryDB(`SELECT kode, nama, alamat, telp, point, nama_toko FROM pelanggan`);
    if (dataPelanggan && dataPelanggan.length > 0) {
      console.log(`[PELANGGAN] Menarik ${dataPelanggan.length} data...`);
      for (let i = 0; i < dataPelanggan.length; i += 20) {
        await axios.post(WEB_API_URL + "/api/v1/sync-kasir/pelanggan", { toko: KODE_TOKO, data: dataPelanggan.slice(i, i + 20) }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        await sleep(500);
      }
      console.log("✔ Sinkron Pelanggan Selesai.");
    }

    // -- SUPPLIER --
    const dataSupplier = await queryDB(`SELECT s.kode, s.nama, s.alamat, s.saldo_piutang, s.tgl_saldo, s.nomor, s.telp, s.fax, s.email, s.no_npwp, s.tampil, s.kdgrouphrg, s.kota, s.alamat2, s.contact, s.saldo_deposit FROM supplier s ORDER BY s.nama ASC`);
    if (dataSupplier && dataSupplier.length > 0) {
      console.log(`[SUPPLIER] Menarik ${dataSupplier.length} data...`);
      for (let i = 0; i < dataSupplier.length; i += 20) {
        await axios.post(WEB_API_URL + "/api/v1/sync-kasir/supplier", { toko: KODE_TOKO, data: dataSupplier.slice(i, i + 20) }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        await sleep(500);
      }
      console.log("✔ Sinkron Supplier Selesai.");
    }


    
    // -- LABA RUGI --
    const dataLabaRugi = await queryDB(`SELECT tanggal, kode_barang, nama_barang, penjualan, hpp, diskon, labarugi, operator, jt, keterangan, pelanggan, nama_pelanggan FROM labarugi WHERE tanggal >= NOW() - INTERVAL 2 DAY ORDER BY tanggal ASC`);
    if (dataLabaRugi && dataLabaRugi.length > 0) {
      console.log(`[LABA RUGI] Menarik ${dataLabaRugi.length} data (2 hari terakhir)...`);
      for (let i = 0; i < dataLabaRugi.length; i += 20) {
        const siapKirim = dataLabaRugi.slice(i, i + 20).map(item => ({ ...item, tanggal: formatWaktuLokal(item.tanggal) }));
        await axios.post(WEB_API_URL + "/api/v1/sync-kasir/labarugi", { toko: KODE_TOKO, data: siapKirim }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        await sleep(1000);
      }
      console.log("✔ Sinkron Laba Rugi Selesai.");
    }

    // -- PENJUALAN (OMSET) --
    const dataPenjualan = await queryDB(`SELECT p.kode, p.tanggal, p.operator, p.subtotal, p.jumlah, p.pelanggan, p.nama_pelanggan, p.alamat_pelanggan, p.piutang, p.bayar, p.kembali, p.lunas, p.status, p.ket_tambahan AS detail_barang_nota FROM penjualan p LEFT JOIN log_sinkronisasi l ON p.kode = l.id_nota WHERE l.id_nota IS NULL AND p.tanggal >= NOW() - INTERVAL 2 DAY ORDER BY p.tanggal ASC`);
    if (dataPenjualan && dataPenjualan.length > 0) {
      console.log(`[PENJUALAN] Menarik ${dataPenjualan.length} data baru...`);
      for (let i = 0; i < dataPenjualan.length; i += 20) {
        const potongan = dataPenjualan.slice(i, i + 20);
        const siapKirim = potongan.map(item => ({ ...item, kode: item.kode || item.id_nota, tanggal: formatWaktuLokal(item.tanggal) }));
        const res = await axios.post(WEB_API_URL + "/api/v1/sync-kasir/omset", { toko: KODE_TOKO, data: siapKirim }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        if (res && res.status === 200) {
          potongan.forEach(nota => connection.query("INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)", [nota.kode]));
        }
        await sleep(1000);
      }
      console.log("✔ Sinkron Penjualan Selesai.");
    }

    // -- PEMBELIAN --
    const dataPembelian = await queryDB(`SELECT p.kode, p.tanggal AS tanggal, p.supplier AS suplier, p.jt AS total, p.jumlah AS jumlah, p.operator AS operator FROM pembelian p LEFT JOIN log_sinkronisasi l ON p.kode = l.id_nota WHERE l.id_nota IS NULL AND p.tanggal >= NOW() - INTERVAL 2 DAY ORDER BY p.tanggal ASC`);
    if (dataPembelian && dataPembelian.length > 0) {
      console.log(`[PEMBELIAN] Menarik ${dataPembelian.length} data baru...`);
      for (let i = 0; i < dataPembelian.length; i += 20) {
        const potongan = dataPembelian.slice(i, i + 20);
        const siapKirim = potongan.map(item => ({ ...item, kode: item.kode || item.id_nota, tanggal: formatWaktuLokal(item.tanggal) }));
        const res = await axios.post(WEB_API_URL + "/api/v1/sync-kasir/pembelian", { toko: KODE_TOKO, data: siapKirim }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        if (res && res.status === 200) {
          potongan.forEach(nota => connection.query("INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)", [nota.kode]));
        }
        await sleep(1000);
      }
      console.log("✔ Sinkron Pembelian Selesai.");
    }

    // -- HUTANG --
    const dataHutang = await queryDB(`SELECT h.kode, h.tanggal, h.supplier AS id_supplier, h.jumlah AS total_hutang, h.operator, h.ket AS data_lengkap_json FROM hutang h LEFT JOIN log_sinkronisasi l ON h.kode = l.id_nota WHERE l.id_nota IS NULL AND h.tanggal >= NOW() - INTERVAL 2 DAY`);
    if (dataHutang && dataHutang.length > 0) {
      console.log(`[HUTANG] Menarik ${dataHutang.length} data baru...`);
      for (let i = 0; i < dataHutang.length; i += 20) {
        const potongan = dataHutang.slice(i, i + 20);
        const siapKirim = potongan.map(item => ({ ...item, tanggal: formatWaktuLokal(item.tanggal) }));
        const res = await axios.post(WEB_API_URL + "/api/v1/sync-kasir/hutang", { toko: KODE_TOKO, data: siapKirim }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        if (res && res.status === 200) potongan.forEach(nota => connection.query("INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)", [nota.kode]));
        await sleep(1000);
      }
      console.log("✔ Sinkron Hutang Selesai.");
    }

    // -- PIUTANG --
    const dataPiutang = await queryDB(`SELECT p.kode, p.tanggal, p.pelanggan AS id_pelanggan, p.jumlah AS total_piutang, p.operator FROM piutang p LEFT JOIN log_sinkronisasi l ON p.kode = l.id_nota WHERE l.id_nota IS NULL AND p.tanggal >= NOW() - INTERVAL 2 DAY`);
    if (dataPiutang && dataPiutang.length > 0) {
      console.log(`[PIUTANG] Menarik ${dataPiutang.length} data baru...`);
      for (let i = 0; i < dataPiutang.length; i += 20) {
        const potongan = dataPiutang.slice(i, i + 20);
        const siapKirim = potongan.map(item => ({ ...item, tanggal: formatWaktuLokal(item.tanggal) }));
        const res = await axios.post(WEB_API_URL + "/api/v1/sync-kasir/piutang", { toko: KODE_TOKO, data: siapKirim }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        if (res && res.status === 200) potongan.forEach(nota => connection.query("INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)", [nota.kode]));
        await sleep(1000);
      }
      console.log("✔ Sinkron Piutang Selesai.");
    }

    // -- PEMASUKAN --
    const dataPemasukan = await queryDB(`SELECT p.kode, p.tanggal, p.keterangan, p.jumlah AS total, p.operator FROM pemasukan p LEFT JOIN log_sinkronisasi l ON p.kode = l.id_nota WHERE l.id_nota IS NULL AND p.tanggal >= NOW() - INTERVAL 2 DAY`);
    if (dataPemasukan && dataPemasukan.length > 0) {
      for (let i = 0; i < dataPemasukan.length; i += 20) {
        const potongan = dataPemasukan.slice(i, i + 20);
        const siapKirim = potongan.map(item => ({ ...item, tanggal: formatWaktuLokal(item.tanggal) }));
        const res = await axios.post(WEB_API_URL + "/api/v1/sync-kasir/pemasukan", { toko: KODE_TOKO, data: siapKirim }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        if (res && res.status === 200) potongan.forEach(nota => connection.query("INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)", [nota.kode]));
        await sleep(500);
      }
    }

    // -- PENGELUARAN --
    const dataPengeluaran = await queryDB(`SELECT p.kode, p.tanggal, p.keterangan, p.jumlah AS total, p.operator FROM pengeluaran p LEFT JOIN log_sinkronisasi l ON p.kode = l.id_nota WHERE l.id_nota IS NULL AND p.tanggal >= NOW() - INTERVAL 2 DAY`);
    if (dataPengeluaran && dataPengeluaran.length > 0) {
      for (let i = 0; i < dataPengeluaran.length; i += 20) {
        const potongan = dataPengeluaran.slice(i, i + 20);
        const siapKirim = potongan.map(item => ({ ...item, tanggal: formatWaktuLokal(item.tanggal) }));
        const res = await axios.post(WEB_API_URL + "/api/v1/sync-kasir/pengeluaran", { toko: KODE_TOKO, data: siapKirim }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        if (res && res.status === 200) potongan.forEach(nota => connection.query("INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)", [nota.kode]));
        await sleep(500);
      }
    }

    // -- RETUR JUAL & BELI (Disingkat) --
    const dataReturJual = await queryDB(`SELECT r.kode, r.tanggal, r.nama_barang, r.qty, r.jumlah AS total, r.operator FROM return_penjualan r LEFT JOIN log_sinkronisasi l ON r.kode = l.id_nota WHERE l.id_nota IS NULL AND r.tanggal >= NOW() - INTERVAL 2 DAY`);
    if (dataReturJual && dataReturJual.length > 0) {
      for (let i = 0; i < dataReturJual.length; i += 20) {
        const res = await axios.post(WEB_API_URL + "/api/v1/sync-kasir/retur-jual", { toko: KODE_TOKO, data: dataReturJual.slice(i, i + 20).map(item => ({ ...item, tanggal: formatWaktuLokal(item.tanggal) })) }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        if (res && res.status === 200) dataReturJual.slice(i, i + 20).forEach(nota => connection.query("INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)", [nota.kode]));
        await sleep(500);
      }
    }

    const dataReturBeli = await queryDB(`SELECT r.kode, r.tanggal, r.nama_barang, r.qty, r.jumlah AS total, r.operator FROM return_pembelian r LEFT JOIN log_sinkronisasi l ON r.kode = l.id_nota WHERE l.id_nota IS NULL AND r.tanggal >= NOW() - INTERVAL 2 DAY`);
    if (dataReturBeli && dataReturBeli.length > 0) {
      for (let i = 0; i < dataReturBeli.length; i += 20) {
        const res = await axios.post(WEB_API_URL + "/api/v1/sync-kasir/retur-beli", { toko: KODE_TOKO, data: dataReturBeli.slice(i, i + 20).map(item => ({ ...item, tanggal: formatWaktuLokal(item.tanggal) })) }, { headers: { Authorization: "Bearer " + API_TOKEN }, timeout: 20000 });
        if (res && res.status === 200) dataReturBeli.slice(i, i + 20).forEach(nota => connection.query("INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)", [nota.kode]));
        await sleep(500);
      }
    }

    console.log(`[${new Date().toLocaleTimeString()}] ✅ PROSES SINKRONISASI SELESAI DENGAN AMAN!`);
  } catch (err) {
    console.error("❌ Terjadi kesalahan saat sinkronisasi:", err.message);
  } finally {
    isSyncRunning = false; 
  }
}


setInterval(sinkronisasiData, 60000);


sinkronisasiData();
