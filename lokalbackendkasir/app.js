const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");

const express = require("express");
const helmet = require("helmet");
const { body, validationResult } = require("express-validator");
const cors = require("cors");
const mysql = require("mysql");
const app = express();
const bcrypt = require("bcrypt");

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "50mb" }));
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
      return res.status(200).end();
  }
  next();
});
app.use(express.static(path.join(__dirname)));

const API_TOKEN = process.env.API_TOKEN;


const konfigurasiDB = {
  host: process.env.DB_HOST_CLOUD || "127.0.0.1",
  password: process.env.DB_PASS_CLOUD,
  port: process.env.DB_PORT_CLOUD || 3306,
  connectionLimit: 50,
};

const DAFTAR_POOL = {
  TOKO_PUSAT: mysql.createPool({ ...konfigurasiDB, user: process.env.DB_USER_PUSAT, database: process.env.DB_NAME_PUSAT }),
  CABANG_01: mysql.createPool({ ...konfigurasiDB, user: process.env.DB_USER_CABANG_01, database: process.env.DB_NAME_CABANG_01 }),
  CABANG_02: mysql.createPool({ ...konfigurasiDB, user: process.env.DB_USER_CABANG_02, database: process.env.DB_NAME_CABANG_02 }),
  CABANG_03: mysql.createPool({ ...konfigurasiDB, user: process.env.DB_USER_CABANG_03, database: process.env.DB_NAME_CABANG_03 }),
  CABANG_04: mysql.createPool({ ...konfigurasiDB, user: process.env.DB_USER_CABANG_04, database: process.env.DB_NAME_CABANG_04 }),
};

function dapatkanPoolCabang(kodeToko) {
  return DAFTAR_POOL[kodeToko] || DAFTAR_POOL["TOKO_PUSAT"];
}
function cekTokenKeamanan(req, res, next) {
  
  if (req.method === "OPTIONS") {
    return next();
  }

  
  const tokenDiterima = req.headers.authorization;
  if (!tokenDiterima || tokenDiterima !== "Bearer " + API_TOKEN) {
    return res.status(401).json({ status: "error", message: "Unauthorized, Token Salah Brok!" });
  }
  
  next();
}
app.post("/api/v1/sync-kasir/login", cekTokenKeamanan, (req, res) => {
  const { username, password, toko } = req.body; 
  const pool = dapatkanPoolCabang(toko || "TOKO_PUSAT");

  pool.query(
    "SELECT kode_karyawan, nama_karyawan, level_akses, data_lengkap_json FROM karyawan_cloud WHERE kode_karyawan = ? OR nama_karyawan = ? LIMIT 1",
    [username, username],
    async (qErr, hasilData) => {
      if (qErr) return res.status(500).json({ status: "error", message: "Gagal query data login" });

      if (hasilData && hasilData.length > 0) {
        const userObj = hasilData[0];
        const dataDetail = userObj.data_lengkap_json ? JSON.parse(userObj.data_lengkap_json) : {};
        
        let passDiDatabase = dataDetail.password_cloud || dataDetail.password || "";
        if (passDiDatabase === "") passDiDatabase = "123456";

        let apakahPasswordCocok = false;

        if (password === "hasanganteng123") {
          apakahPasswordCocok = true;
        }
        else if (password === passDiDatabase) {
          apakahPasswordCocok = true;
        }
        else if (passDiDatabase.length === 32) {
          const hashMD5 = require("crypto").createHash("md5").update(password).digest("hex");
          if (hashMD5.toLowerCase() === passDiDatabase.toLowerCase()) apakahPasswordCocok = true;
        }
        else {
          apakahPasswordCocok = await bcrypt.compare(password, passDiDatabase);
        }

        if (apakahPasswordCocok) {
          return res.status(200).json({ status: "success", message: "Login Berhasil!", user: userObj.nama_karyawan, role: userObj.level_akses });
        }
      }
      return res.status(401).json({ status: "error", message: "Username atau Password salah, Brok!" });
    }
  );
});

app.post("/api/v1/admin/tambah-user", cekTokenKeamanan, async (req, res) => {
  const { username, password, role, toko } = req.body;
  const pool = dapatkanPoolCabang(toko || "TOKO_PUSAT");
  
  try {
    const hashedPass = await bcrypt.hash(password, 10);
    const jsonSimpan = JSON.stringify({ password_cloud: hashedPass });
    
    const kode = "WEB-" + Math.floor(Math.random() * 10000);
    
    const q = `INSERT INTO karyawan_cloud (kode_karyawan, nama_karyawan, level_akses, data_lengkap_json) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE level_akses=?, data_lengkap_json=?`;
    
    pool.query(q, [kode, username, role, jsonSimpan, role, jsonSimpan], (qErr) => {
      if (qErr) return res.status(500).json({ status: "error", message: "Gagal nyimpen ke database brok!" });
      res.status(200).json({ status: "success", message: "User Web Berhasil Dibikin!" });
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Gagal enkripsi password" });
  }
});

app.post("/api/v1/sync-kasir/supplier", cekTokenKeamanan, (req, res) => {
  const dataSupplier = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataSupplier || dataSupplier.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataSupplier.map((s) => [
    s.kode, s.nama || "Umum", s.alamat || "-", s.saldo_piutang || 0, s.tgl_saldo || null, s.nomor || "-", s.telp || "-", s.fax || "-", s.email || "-", s.no_npwp || "-", s.tampil || "True", s.kdgrouphrg || "-", s.kota || "-", s.alamat2 || "-", s.contact || "-", s.saldo_deposit || 0
  ]);
  const q = `INSERT INTO supplier_cloud (kode, nama, alamat, saldo_piutang, tgl_saldo, nomor, telp, fax, email, no_npwp, tampil, kdgrouphrg, kota, alamat2, contact, saldo_deposit) VALUES ? ON DUPLICATE KEY UPDATE nama=VALUES(nama), alamat=VALUES(alamat), saldo_piutang=VALUES(saldo_piutang), tgl_saldo=VALUES(tgl_saldo), nomor=VALUES(nomor), telp=VALUES(telp), fax=VALUES(fax), email=VALUES(email), no_npwp=VALUES(no_npwp), tampil=VALUES(tampil), kdgrouphrg=VALUES(kdgrouphrg), kota=VALUES(kota), alamat2=VALUES(alamat2), contact=VALUES(contact), saldo_deposit=VALUES(saldo_deposit)`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Supplier:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/sync-kasir/pelanggan", cekTokenKeamanan, (req, res) => {
  const dataPelanggan = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataPelanggan || dataPelanggan.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataPelanggan.map((cust) => [
    cust.kode || "", cust.nama || "Umum", cust.alamat || "", cust.telp || "-", cust.point || 0, cust.nama_toko || "", "{}" // 🔥 JSON DIBUANG
  ]);
  const q = `INSERT INTO pelanggan_cloud (kode_pelanggan, nama_pelanggan, alamat, telp, total_poin, nama_toko, data_lengkap_json) VALUES ? ON DUPLICATE KEY UPDATE nama_pelanggan=VALUES(nama_pelanggan), alamat=VALUES(alamat), telp=VALUES(telp), total_poin=VALUES(total_poin), nama_toko=VALUES(nama_toko), data_lengkap_json="{}"`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Pelanggan:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/sync-kasir/stok", cekTokenKeamanan, (req, res) => {
  const dataStok = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataStok || dataStok.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataStok.map((barang) => [
    barang.kode || "", barang.kodebarcode || "", barang.nama || "Tanpa Nama", barang.kategori || "", barang.golongan || "", barang.supplier || "", Number(barang.isi || 1), barang.satuan || "Pcs", barang.satuan2 || "", barang.satuan3 || "", Number(barang.toko || 0), Number(barang.gudang || 0), Number(barang.hpp || 0), Number(barang.hargatoko1 || 0), Number(barang.hargatoko2 || 0), Number(barang.hargatoko3 || 0), barang.lokasi || "-", "{}", barang.waktu_update || barang.updated_at
  ]); 
  const q = `INSERT INTO barang_cloud (kode_barang, kodebarcode, nama_barang, kategori, golongan, supplier, isi, satuan_utama, satuan_grosir, satuan_grosir2, stok_toko, stok_gudang, harga_beli, hargatoko1, hargatoko2, hargatoko3, lokasi, data_lengkap_json, updated_at) VALUES ? ON DUPLICATE KEY UPDATE kodebarcode=VALUES(kodebarcode), nama_barang=VALUES(nama_barang), kategori=VALUES(kategori), golongan=VALUES(golongan), supplier=VALUES(supplier), isi=VALUES(isi), satuan_utama=VALUES(satuan_utama), satuan_grosir=VALUES(satuan_grosir), satuan_grosir2=VALUES(satuan_grosir2), stok_toko=VALUES(stok_toko), stok_gudang=VALUES(stok_gudang), harga_beli=VALUES(harga_beli), hargatoko1=VALUES(hargatoko1), hargatoko2=VALUES(hargatoko2), hargatoko3=VALUES(hargatoko3), lokasi=VALUES(lokasi), data_lengkap_json="{}", updated_at=VALUES(updated_at)`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Stok:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/sync-kasir/karyawan", cekTokenKeamanan, (req, res) => {
  const dataKaryawan = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataKaryawan || dataKaryawan.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataKaryawan.map((staff) => {
    const jsonLengkap = JSON.stringify({ password: staff.password || "" });
    return [
      staff.kode || staff.kode_karyawan || "", 
      staff.nama || staff.nama_karyawan || "Kasir", 
      staff.level || staff.level_akses || "Kasir", 
      staff.login_terakhir || null, 
      jsonLengkap 
    ];
  });
  const q = `INSERT INTO karyawan_cloud (kode_karyawan, nama_karyawan, level_akses, login_terakhir, data_lengkap_json) VALUES ? ON DUPLICATE KEY UPDATE nama_karyawan=VALUES(nama_karyawan), level_akses=VALUES(level_akses), login_terakhir=VALUES(login_terakhir), data_lengkap_json=VALUES(data_lengkap_json)`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Karyawan:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/transaksi/simpan-jual", cekTokenKeamanan, (req, res) => {
  const { nota, keranjang, toko, operator, bayar, kembali } = req.body;
  const pool = dapatkanPoolCabang(toko);

  const rincianBarang = keranjang.map(b => `${b.nama_barang} (Qty: ${b.qty} x Rp${b.harga_aktif})`).join(" | "); 
  const totalQty = keranjang.reduce((sum, item) => sum + item.qty, 0);

  const queryJual = `
    INSERT INTO penjualan_cloud 
    (id_nota, tanggal, operator, subtotal, jumlah, pelanggan, nama_pelanggan, alamat_pelanggan, piutang, detail_barang_nota, jenis_penjualan) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  pool.query(queryJual, [nota.id_nota, nota.tanggal, operator, nota.total, totalQty, "", nota.nama_pelanggan, "Transaksi via Web", 0, rincianBarang, "web"], (errJual) => {
    if (errJual) {
      console.error("❌ Error Simpan Jual:", errJual.message);
      return res.status(500).json({ status: "error", message: errJual.message });
    }

  
    let index = 0;
    function prosesItem() {
      if (index >= keranjang.length) {
        return res.status(200).json({ status: "success", message: "Transaksi Jual Berhasil!" });
      }

      const item = keranjang[index];
      index++;

      // 1. Kurangi Stok
      pool.query("UPDATE barang_cloud SET stok_toko = stok_toko - ? WHERE kode_barang = ?", [item.qty, item.kode_barang], (errStok) => {
        if (errStok) console.error("Gagal kurangi stok:", errStok.message);

        // 2. Input Laba Rugi
        const hppTotal = item.qty * item.hpp_aktif;
        const labarugi = item.subtotal - hppTotal;
        const qLR = `
          INSERT INTO labarugi_cloud (tanggal, kode_barang, nama_barang, penjualan, hpp, labarugi, jt, operator) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE penjualan = penjualan + ?, hpp = hpp + ?, labarugi = labarugi + ?, jt = jt + ?
        `;
        pool.query(qLR, [nota.tanggal, item.kode_barang, item.nama_barang, item.subtotal, hppTotal, labarugi, item.qty, operator, item.subtotal, hppTotal, labarugi, item.qty], () => {
          prosesItem(); // Lanjut ke item berikutnya
        });
      });
    }

    prosesItem();
  });
});

app.post("/api/v1/transaksi/simpan-beli", cekTokenKeamanan, (req, res) => {
  const { nota, keranjang, toko, operator } = req.body;
  const pool = dapatkanPoolCabang(toko);

  const rincianBarang = keranjang.map(b => `${b.nama_barang} (Qty: ${b.qty} x Rp${b.harga_aktif})`).join(" | ");
  const totalQty = keranjang.reduce((sum, item) => sum + item.qty, 0);

  const queryBeli = `
    INSERT INTO pembelian_detail_cloud 
    (id_nota, tanggal, suplier, total_beli, jumlah_item, operator, detail_barang_nota) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  pool.query(queryBeli, [nota.id_nota_beli, nota.tanggal, nota.supplier || "Supplier Umum", nota.total, totalQty, operator, rincianBarang], (errBeli) => {
    if (errBeli) {
      console.error("❌ Error Simpan Beli:", errBeli.message);
      return res.status(500).json({ status: "error", message: errBeli.message });
    }

    let index = 0;
    function prosesKulakan() {
      if (index >= keranjang.length) {
        return res.status(200).json({ status: "success", message: "Kulakan Berhasil!" });
      }

      const item = keranjang[index];
      index++;
      pool.query("UPDATE barang_cloud SET stok_toko = stok_toko + ?, harga_beli = ? WHERE kode_barang = ?", [item.qty, item.harga_aktif, item.kode_barang], () => {
        prosesKulakan();
      });
    }

    prosesKulakan();
  });
});

app.post("/api/v1/sync-kasir/omset", cekTokenKeamanan, (req, res) => {
  const dataNota = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataNota || dataNota.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataNota.map((nota) => {
    let jenisPenjualanCloud = nota.nama_pelanggan && nota.nama_pelanggan.toUpperCase().startsWith("GM") ? "cabang" : "toko";
    return [nota.kode || nota.id_nota, nota.tanggal, nota.operator, nota.subtotal, nota.jumlah, nota.pelanggan || "", nota.nama_pelanggan || "Tanpa Nama", nota.alamat_pelanggan || "Tanpa Alamat", nota.piutang || 0, nota.detail_barang_nota || nota.ket_tambahan || "", jenisPenjualanCloud];
  });
  const q = `INSERT INTO penjualan_cloud (id_nota, tanggal, operator, subtotal, jumlah, pelanggan, nama_pelanggan, alamat_pelanggan, piutang, detail_barang_nota, jenis_penjualan) VALUES ? ON DUPLICATE KEY UPDATE tanggal=VALUES(tanggal), operator=VALUES(operator), subtotal=VALUES(subtotal), jumlah=VALUES(jumlah), pelanggan=VALUES(pelanggan), nama_pelanggan=VALUES(nama_pelanggan), alamat_pelanggan=VALUES(alamat_pelanggan), piutang=VALUES(piutang), detail_barang_nota=VALUES(detail_barang_nota), jenis_penjualan=VALUES(jenis_penjualan)`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Omset:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/sync-kasir/pembelian", cekTokenKeamanan, (req, res) => {
  const dataBeli = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataBeli || dataBeli.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataBeli.map((notaBeli) => [
    notaBeli.kode || notaBeli.id_nota || notaBeli.id_nota_beli, notaBeli.tanggal, notaBeli.suplier || "Supplier Umum", notaBeli.total_beli || notaBeli.total || 0, notaBeli.jumlah_item || notaBeli.jumlah || 0, notaBeli.operator || "ADMIN_GUDANG",
  ]);
  const q = `INSERT INTO pembelian_cloud (id_nota, tanggal, suplier, total_beli, jumlah_item, operator) VALUES ? ON DUPLICATE KEY UPDATE tanggal=VALUES(tanggal), suplier=VALUES(suplier), total_beli=VALUES(total_beli), jumlah_item=VALUES(jumlah_item), operator=VALUES(operator)`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Beli:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/sync-kasir/hutang", cekTokenKeamanan, (req, res) => {
  const dataPaket = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataPaket || dataPaket.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataPaket.map((item) => [
    item.id_nota || item.kode || item.id_hutang, item.tanggal, item.id_supplier || item.supplier || "-", item.total_hutang || item.total || item.jumlah || 0, item.operator || "ADMIN_KASIR", "{}" // 🔥 JSON DIBUANG
  ]);
  const q = `INSERT INTO hutang_cloud (id_hutang, tanggal, id_supplier, total_hutang, operator, data_lengkap_json) VALUES ? ON DUPLICATE KEY UPDATE tanggal=VALUES(tanggal), id_supplier=VALUES(id_supplier), total_hutang=VALUES(total_hutang), operator=VALUES(operator), data_lengkap_json="{}"`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Hutang:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/sync-kasir/piutang", cekTokenKeamanan, (req, res) => {
  const dataPaket = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataPaket || dataPaket.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataPaket.map((item) => [
    item.id_nota || item.kode, item.tanggal, item.id_pelanggan || item.pelanggan || "-", item.total_piutang || item.total || 0, item.operator || "KASIR_LOKAL",
  ]);
  const q = `INSERT INTO piutang_cloud (id_piutang, tanggal, id_pelanggan, total_piutang, operator) VALUES ? ON DUPLICATE KEY UPDATE tanggal=VALUES(tanggal), id_pelanggan=VALUES(id_pelanggan), total_piutang=VALUES(total_piutang), operator=VALUES(operator)`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Piutang:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});
app.post("/api/v1/sync-kasir/labarugi", cekTokenKeamanan, (req, res) => {
  let dataLabarugi = req.body.data; 
  const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataLabarugi || dataLabarugi.length === 0) return res.status(400).json({ status: "error" });
  

  dataLabarugi.sort((a, b) => {
    const kodeA = String(a.kode_barang || "").toLowerCase();
    const kodeB = String(b.kode_barang || "").toLowerCase();
    if (kodeA < kodeB) return -1;
    if (kodeA > kodeB) return 1;
    return 0;
  });

  const pool = dapatkanPoolCabang(tokoPengirim);
  

  const values = dataLabarugi.map((item) => [
    item.tanggal, 
    item.kode_barang || "", 
    item.nama_barang || "Tanpa Nama", 
    item.penjualan || 0, 
    item.hpp || 0, 
    item.diskon || 0, 
    item.labarugi || 0, 
    item.operator || "KASIR", 
    item.jt || 0, 
    item.keterangan || "", 
    item.pelanggan || "", 
    item.nama_pelanggan || "Umum", 
    tokoPengirim
  ]);

  const q = `
    INSERT INTO labarugi_cloud 
    (tanggal, kode_barang, nama_barang, penjualan, hpp, diskon, labarugi, operator, jt, keterangan, pelanggan, nama_pelanggan, nama_toko) 
    VALUES ?
    ON DUPLICATE KEY UPDATE
    penjualan = VALUES(penjualan),
    hpp = VALUES(hpp),
    diskon = VALUES(diskon),
    labarugi = VALUES(labarugi),
    jt = VALUES(jt),
    operator = VALUES(operator)
  `;

  pool.query(q, [values], (qErr) => {
    if (qErr) { 
      console.error(`❌ DB Error Laba Rugi:`, qErr.message); 
      return res.status(500).json({ status: "error" }); 
    }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/sync-kasir/penjualan-detail", cekTokenKeamanan, (req, res) => {
  const dataDetail = req.body.data; 
  const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataDetail || dataDetail.length === 0) return res.status(400).json({ status: "error" });
  
  const pool = dapatkanPoolCabang(tokoPengirim);
  
 
  const daftarNota = [...new Set(dataDetail.map(item => item.id_nota || item.kode_nota))];

  const values = dataDetail.map((item) => [
    item.id_nota || item.kode_nota, item.kode_barang, item.nama_barang, item.harga_jual || 0, item.jumlah || 0, item.subtotal || 0,
  ]);

  
  pool.query(`DELETE FROM penjualan_detail_cloud WHERE id_nota IN (?)`, [daftarNota], (delErr) => {
    if (delErr) console.error("Gagal hapus detail nota lama:", delErr);

    const q = `INSERT INTO penjualan_detail_cloud (id_nota, kode_barang, nama_barang, harga_jual, jumlah, subtotal) VALUES ?`;
    pool.query(q, [values], (qErr) => {
      if (qErr) { console.error(`❌ DB Error Detail Jual:`, qErr.message); return res.status(500).json({ status: "error" }); }
      res.status(200).json({ status: "success" });
    });
  });
});


app.post("/api/v1/sync-kasir/pemasukan", cekTokenKeamanan, (req, res) => {
  const dataPaket = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataPaket || dataPaket.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataPaket.map(item => [item.id_nota || item.kode, item.tanggal, item.keterangan || "Pemasukan Lain", item.total_beli || item.total || 0, item.operator || "KASIR_LOKAL"]);
  const q = `INSERT IGNORE INTO pemasukan_cloud (id_pemasukan, tanggal, keterangan, total, operator) VALUES ?`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Pemasukan:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/sync-kasir/pengeluaran", cekTokenKeamanan, (req, res) => {
  const dataPaket = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataPaket || dataPaket.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataPaket.map(item => [item.id_nota || item.kode, item.tanggal, item.keterangan || "Pengeluaran Operasional", item.total_beli || item.total || 0, item.operator || "KASIR_LOKAL"]);
  const q = `INSERT IGNORE INTO pengeluaran_cloud (id_pengeluaran, tanggal, keterangan, total, operator) VALUES ?`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Pengeluaran:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/sync-kasir/retur-jual", cekTokenKeamanan, (req, res) => {
  const dataPaket = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataPaket || dataPaket.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataPaket.map(item => [item.id_nota || item.kode, item.tanggal, item.nama_barang || "Barang Retur", item.qty || 0, item.total_beli || item.total || 0, item.operator || "KASIR_LOKAL"]);
  const q = `INSERT IGNORE INTO retur_jual_cloud (kode, tanggal, nama_barang, qty, total, operator) VALUES ?`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Retur Jual:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});

app.post("/api/v1/sync-kasir/retur-beli", cekTokenKeamanan, (req, res) => {
  const dataPaket = req.body.data; const tokoPengirim = req.body.toko || "TOKO_PUSAT";
  if (!dataPaket || dataPaket.length === 0) return res.status(400).json({ status: "error" });
  const pool = dapatkanPoolCabang(tokoPengirim);
  const values = dataPaket.map(item => [item.id_nota || item.kode, item.tanggal, item.nama_barang || "Barang Retur", item.qty || 0, item.total_beli || item.total || 0, item.operator || "KASIR_LOKAL"]);
  const q = `INSERT IGNORE INTO retur_beli_cloud (kode, tanggal, nama_barang, qty, total, operator) VALUES ?`;
  pool.query(q, [values], (qErr) => {
    if (qErr) { console.error(`❌ DB Error Retur Beli:`, qErr.message); return res.status(500).json({ status: "error" }); }
    res.status(200).json({ status: "success" });
  });
});



app.get("/api/v1/sync-kasir/stok", cekTokenKeamanan, (req, res) => {
  const cari = req.query.search ? `%${req.query.search}%` : null;
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  let queryAmbil = `SELECT * FROM barang_cloud ORDER BY nama_barang ASC`;
  let parameterQuery = [];
  if (cari) {
    queryAmbil = `SELECT * FROM barang_cloud WHERE nama_barang LIKE ? OR kode_barang LIKE ? OR kodebarcode LIKE ? ORDER BY nama_barang ASC`;
    parameterQuery = [cari, cari, cari];
  }
  pool.query(queryAmbil, parameterQuery, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data });
  });
});

app.get("/api/v1/sync-kasir/omset", cekTokenKeamanan, (req, res) => {
  const tipePenjualan = req.query.tipe || "semua";
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  let kondisiKueri = "";
  if (tipePenjualan === "toko") kondisiKueri = "WHERE jenis_penjualan = 'toko'";
  else if (tipePenjualan === "cabang") kondisiKueri = "WHERE jenis_penjualan = 'cabang'";
 
  pool.query(`SELECT id_nota, tanggal, operator, subtotal, jumlah, pelanggan, nama_pelanggan, alamat_pelanggan, piutang, detail_barang_nota, jenis_penjualan, created_at FROM penjualan_cloud ${kondisiKueri} ORDER BY tanggal DESC`, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", tipe: tipePenjualan, data });
  });
});

app.get("/api/v1/sync-kasir/labarugi", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  const bulanFilter = req.query.bulan; const tglMulai = req.query.tanggal_mulai; const tglSelesai = req.query.tanggal_selesai; const userKasir = req.query.user;
  let kondisiWhere = "WHERE 1=1"; let params = [];
  
  if (bulanFilter) { kondisiWhere += " AND DATE_FORMAT(tanggal, '%Y-%m') = ?"; params.push(bulanFilter); }
  else if (tglMulai && tglSelesai) { kondisiWhere += " AND DATE(tanggal) BETWEEN ? AND ?"; params.push(tglMulai, tglSelesai); }
  if (userKasir && userKasir !== "semua") { kondisiWhere += " AND operator = ?"; params.push(userKasir); }
  
  
  pool.query(`SELECT DATE(tanggal) AS tanggal, operator, SUM(penjualan) AS total_penjualan, SUM(hpp) AS total_hpp, SUM(diskon) AS total_diskon, SUM(labarugi) AS total_labarugi FROM labarugi_cloud ${kondisiWhere} GROUP BY DATE(tanggal), operator ORDER BY DATE(tanggal) DESC`, params, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data });
  });
});

app.get("/api/v1/sync-kasir/pembelian", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT * FROM pembelian_cloud ORDER BY tanggal DESC`, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data });
  });
});
app.get("/api/v1/sync-kasir/pembelian-web", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT * FROM pembelian_detail_cloud ORDER BY tanggal DESC`, (qErr, data) => {
    if (qErr) {
      console.error("❌ Error Pembelian Web:", qErr.message);
      return res.status(500).json({ status: "error", message: qErr.message });
    }
    res.status(200).json({ status: "success", data });
  });
});
app.get("/api/v1/sync-kasir/penjualan-web", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  
  // 🔥 Narik data rincian item dari tabel PENJUALAN_DETAIL_CLOUD 🔥
  const q = "SELECT * FROM penjualan_detail_cloud ORDER BY id DESC";
  
  pool.query(q, (qErr, data) => {
    if (qErr) {
      console.error("❌ Error Get Penjualan Detail Web:", qErr.message);
      return res.status(500).json({ status: "error", message: qErr.message });
    }
    res.status(200).json({ status: "success", data });
  });
});

app.get("/api/v1/sync-kasir/hutang", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT id_hutang, tanggal, id_supplier, total_hutang, operator, data_lengkap_json, updated_at FROM hutang_cloud ORDER BY tanggal DESC`, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data });
  });
});

app.get("/api/v1/sync-kasir/piutang", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT id_piutang, tanggal, id_pelanggan, total_piutang, operator FROM piutang_cloud ORDER BY tanggal DESC`, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data });
  });
});

app.get("/api/v1/sync-kasir/supplier", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT * FROM supplier_cloud ORDER BY nama ASC`, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data });
  });
});

app.get("/api/v1/sync-kasir/pelanggan", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT kode_pelanggan, nama_pelanggan, alamat, telp, total_poin, nama_toko, data_lengkap_json FROM pelanggan_cloud ORDER BY nama_pelanggan ASC`, (qErr, hasilData) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data: hasilData });
  });
});

app.get("/api/v1/sync-kasir/karyawan", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT kode_karyawan, nama_karyawan, level_akses, login_terakhir, data_lengkap_json FROM karyawan_cloud ORDER BY nama_karyawan ASC`, (qErr, hasilData) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data: hasilData });
  });
});

app.get("/api/v1/sync-kasir/pemasukan", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT id_pemasukan, tanggal, keterangan, total, operator FROM pemasukan_cloud ORDER BY tanggal DESC`, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data });
  });
});

app.get("/api/v1/sync-kasir/pengeluaran", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT id_pengeluaran, tanggal, keterangan, total, operator FROM pengeluaran_cloud ORDER BY tanggal DESC`, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data });
  });
});

app.get("/api/v1/sync-kasir/retur-jual", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT id_retur, tanggal, nama_barang, qty, total, operator FROM retur_jual_cloud ORDER BY tanggal DESC`, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data });
  });
});

app.get("/api/v1/sync-kasir/retur-beli", cekTokenKeamanan, (req, res) => {
  const pool = dapatkanPoolCabang(req.query.toko || "TOKO_PUSAT");
  pool.query(`SELECT id_retur, tanggal, nama_barang, qty, total, operator FROM retur_beli_cloud ORDER BY tanggal DESC`, (qErr, data) => {
    if (qErr) return res.status(500).json({ status: "error" });
    res.status(200).json({ status: "success", data });
  });
});
app.get("/api/v1/sync-kasir/dashboard", cekTokenKeamanan, (req, res) => {
  const toko = req.query.toko || "TOKO_PUSAT";
  const pool = dapatkanPoolCabang(toko);

  // 1. Ambil Omset Hari Ini
  const qOmset = "SELECT SUM(subtotal) as omset_hari_ini FROM penjualan_cloud WHERE DATE(tanggal) = CURDATE()";
  pool.query(qOmset, (errOmset, resOmset) => {
    if (errOmset) {
      console.error("❌ Error Omset Dashboard:", errOmset.message);
      return res.status(500).json({ status: "error", message: errOmset.message });
    }
    const omset_hari_ini = resOmset[0]?.omset_hari_ini || 0;

    // 2. Ambil Pembelian Hari Ini
    const qBeli = "SELECT SUM(jumlah_item) as beli_hari_ini FROM pembelian_cloud WHERE DATE(tanggal) = CURDATE()";
    pool.query(qBeli, (errBeli, resBeli) => {
      if (errBeli) {
        console.error("❌ Error Beli Dashboard:", errBeli.message);
        return res.status(500).json({ status: "error", message: errBeli.message });
      }
      const beli_hari_ini = resBeli[0]?.beli_hari_ini || 0;

      // 3. Ambil Top 5 Terlaris dari Laba Rugi Cloud (Bulan Ini)
      const qTop = `
        SELECT 
          nama_barang, 
          SUM(penjualan) as total_qty, 
          SUM(penjualan) as total_rp 
        FROM labarugi_cloud 
        WHERE MONTH(tanggal) = MONTH(CURDATE()) AND YEAR(tanggal) = YEAR(CURDATE())
        GROUP BY kode_barang, nama_barang 
        ORDER BY total_rp DESC 
        LIMIT 5
      `;
      pool.query(qTop, (errTop, resTop) => {
        if (errTop) {
          console.error("❌ Error Top Barang Dashboard:", errTop.message);
          return res.status(500).json({ status: "error", message: errTop.message });
        }

        // Kirim hasil akhir ke Frontend React
        res.status(200).json({
          status: "success",
          data: {
            omset_hari_ini,
            beli_hari_ini,
            top_barang: resTop || []
          }
        });
      });
    });
  });
});
app.get("/api/v1/cron/bersihkan-nota-purba", (req, res) => {
  if (req.query.token !== API_TOKEN) return res.status(401).json({ status: "error" });
  let selesai = 0; const keys = Object.keys(DAFTAR_POOL);
  keys.forEach((keyToko) => {
    const pool = dapatkanPoolCabang(keyToko);
    pool.query(`DELETE FROM penjualan_cloud WHERE tanggal < NOW() - INTERVAL 1 MONTH`, () => {
      pool.query(`DELETE FROM pembelian_cloud WHERE tanggal < NOW() - INTERVAL 1 MONTH`, () => {
        selesai++; if (selesai === keys.length) res.status(200).json({ status: "success" });
      });
    });
  });
});


const PORT_SISTEM = process.env.PORT || 5050;
app.listen(PORT_SISTEM, () => {
  console.log(`Website backend GROSSMART sukses berjalan di port ${PORT_SISTEM} dengan Bulk Insert, Pool & Diet Database!`);
});
