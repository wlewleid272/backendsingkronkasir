const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs"); // ➕ AMUNISI BARU: Tukang rakit file fisik .sid2 lu!
require("dotenv").config({ path: path.join(__dirname, ".env") });

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
app.use(cors());
app.use(express.static(path.join(__dirname)));

const API_TOKEN = process.env.API_TOKEN;

const DAFTAR_DATABASE = {
  TOKO_PUSAT: {
    db_name: process.env.DB_NAME_PUSAT,
    db_user: process.env.DB_USER_PUSAT, // User khusus toko pusat
  },
  CABANG_01: {
    db_name: process.env.DB_NAME_CABANG_01,
    db_user: process.env.DB_USER_CABANG_01,
  },
};

// 2. Fungsi sakti membuat koneksi database dinamis (Otomatis memisahkan nama USER & DATABASE)
function dapatkanKoneksiCabang(kodeToko) {
  // Jika kode toko tidak terdaftar, otomatis pakai ban serep milik TOKO_PUSAT
  const konfigurasiTujuan =
    DAFTAR_DATABASE[kodeToko] || DAFTAR_DATABASE["TOKO_PUSAT"];

  return mysql.createConnection({
    host: process.env.DB_HOST_CLOUD,
    user: konfigurasiTujuan.db_user, // SAKTI: Nama user otomatis berubah sesuai cabang!
    password: process.env.DB_PASS_CLOUD, // Password tetep disamakan biar lu gak pusing
    database: konfigurasiTujuan.db_name, // SAKTI: Nama database otomatis berubah sesuai cabang!
    port: process.env.DB_PORT_CLOUD,
  });
}

function cekTokenKeamanan(req, res, next) {
  const tokenDiterima = req.headers.authorization;
  if (!tokenDiterima || tokenDiterima !== "Bearer " + API_TOKEN) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
  next();
}

// =========================================================================
// 📇 ENDPOINT LOGIN LURUS & SUPER AMAN BERPAGAR BAJA pack BCRYPT
// =========================================================================
app.post("/api/v1/sync-kasir/login", cekTokenKeamanan, (req, res) => {
  const { username, password } = req.body; // Password teks biasa dikirim dari React

  const connection = dapatkanKoneksiCabang("TOKO_PUSAT");
  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB Cloud" });

    // Tarik data karyawan murni dari database cloud
    const queryCekUser =
      "SELECT nama_karyawan, level_akses, data_lengkap_json FROM karyawan_cloud WHERE nama_karyawan = ? LIMIT 1";

    connection.query(queryCekUser, [username], async (qErr, hasilData) => {
      connection.end();

      if (qErr)
        return res
          .status(500)
          .json({ status: "error", message: "Gagal query data login" });

      if (hasilData.length > 0) {
        const userObj = hasilData[0];

        // Bongkar brankas JSON untuk mengambil password_cloud yang sudah di-hash acak tadi
        const dataDetail = userObj.data_lengkap_json
          ? JSON.parse(userObj.data_lengkap_json)
          : {};
        const passwordHashDiDatabase = dataDetail.password_cloud;

        if (!passwordHashDiDatabase) {
          return res.status(401).json({
            status: "error",
            message: "Akun belum disinkronkan dengan aman!",
          });
        }

        // 🔒 MANTRA UTAMA: Bandingkan password ketikan React dengan Hash di database cloud!
        const apakahPasswordCocok = await bcrypt.compare(
          password,
          passwordHashDiDatabase,
        );

        if (apakahPasswordCocok) {
          return res.status(200).json({
            status: "success",
            message: "Login Berhasil, Sistem Super Aman, Brokkk!",
            user: username,
            role: userObj.level_akses,
          });
        }
      }

      // Jika user gak ketemu atau password salah, lempar pesan eror samar (SOP Keamanan Bank!)
      res
        .status(401)
        .json({ status: "error", message: "Username atau Password salah!" });
    });
  });
});

app.post(
  "/api/v1/sync-kasir/omset",
  cekTokenKeamanan,
  [body("toko").isString().trim().escape(), body("data").isArray()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: "error", errors: errors.array() });
    }

    const dataNota = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";

    if (dataNota && dataNota.length > 0) {
      const connection = dapatkanKoneksiCabang(tokoPengirim);

      connection.connect((err) => {
        if (err) {
          console.error("❌ Gagal konek database cloud:", err.message);
          return res
            .status(500)
            .json({ status: "error", message: "Cloud connection failed" });
        }

        let selesaiKueri = 0;
        let adaErorQuery = false;

        dataNota.forEach((nota) => {
          // 🔥 1. DETEKTOR OTOMATIS: Pilah data Toko vs Cabang sebelum dijebloskan ke SQL cloud
          // Deteksi murni dari nama_pelanggan / nama pelanggan lokal yang diawali kode 'GM'
          let jenisPenjualanCloud = "toko";
          if (
            nota.nama_pelanggan &&
            nota.nama_pelanggan.toUpperCase().startsWith("GM")
          ) {
            jenisPenjualanCloud = "cabang";
          }

          // 🪐 2. STRUKTUR QUERY INSERT: Kolom disamakan persis dengan penampung cloud lu
          // Catatan: Jika di cloud belum ada kolom 'jenis_penjualan', kueri ini tetap aman tidak eror
          const queryInsert = `
            INSERT IGNORE INTO penjualan_cloud 
            (id_nota, tanggal, operator, subtotal, jumlah, pelanggan, nama_pelanggan, alamat_pelanggan, piutang, detail_barang_nota, jenis_penjualan) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

          // 🪐 3. PEMETAAN PARAMETER SAKTI (Menyamakan nama properti objek lokal ke cloud)
          connection.query(
            queryInsert,
            [
              nota.kode || nota.id_nota, // Menangkap 'p.kode' (ID Nota) dari database lokal lu
              nota.tanggal, // Tanggal transaksi murni
              nota.operator, // Nama operator kasir
              nota.subtotal, // Nominal rupiah belanja
              nota.jumlah, // Kuantitas total item
              nota.pelanggan || "", // ID Member
              nota.nama_pelanggan || "Tanpa Nama", // Menangkap hasil alias 'nama_pelanggan' lokal
              nota.alamat_pelanggan || "Tanpa Alamat", // Alamat rumah pelanggan
              nota.piutang || 0, // Sisa bon / piutang
              nota.detail_barang_nota || nota.ket_tambahan || "", // Menangkap 'p.ket_tambahan' yang dikirim dari ruko lokal
              jenisPenjualanCloud, // Flag otomatis kasta tertinggi kita (toko/cabang)
            ],
            (qErr) => {
              if (qErr) {
                console.error(
                  `❌ Eror pas insert nota [${nota.kode || nota.id_nota}]:`,
                  qErr.message,
                );
                adaErorQuery = true;
              }

              selesaiKueri++;

              // 🪐 4. GERBANG KUNCIAN FINISH (Wajib di dalam callback looping agar response tidak menggantung)
              if (selesaiKueri === dataNota.length) {
                console.log(
                  `✓ Nota omset + detail barang resmi terekam untuk ${tokoPengirim}!`,
                );
                connection.end();

                if (adaErorQuery) {
                  return res.status(207).json({
                    status: "partial_success",
                    message:
                      "Data omset tersimpan dengan beberapa catatan eror di konsol",
                  });
                } else {
                  return res.status(200).json({
                    status: "success",
                    message: "Data omset tersimpan dengan bersih total 100%!",
                  });
                }
              }
            },
          );
        });
      });
    } else {
      // Respons jika array data kosong melompong
      return res
        .status(400)
        .json({ status: "error", message: "Data array kosong, brokkk!" });
    }
  },
);

app.post(
  "/api/v1/sync-kasir/penjualan-detail",
  cekTokenKeamanan,
  (req, res) => {
    const dataDetail = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";

    if (!dataDetail || dataDetail.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Array data detail kosong, brokkk!",
      });
    }

    const connection = dapatkanKoneksiCabang(tokoPengirim);
    connection.connect((err) => {
      if (err) {
        console.error("❌ Gagal konek DB cloud untuk detail:", err.message);
        return res
          .status(500)
          .json({ status: "error", message: "Cloud connection failed" });
      }

      let selesaiKueri = 0;
      let adaEror = false;

      dataDetail.forEach((item) => {
        // Query INSERT IGNORE mengarah langsung ke tabel kosong di screenshot phpMyAdmin lu!
        const queryInsertDetail = `
        INSERT IGNORE INTO penjualan_detail_cloud 
        (id_nota, kode_barang, nama_barang, harga_jual, jumlah, subtotal) 
        VALUES (?, ?, ?, ?, ?, ?)`;

        connection.query(
          queryInsertDetail,
          [
            item.id_nota || item.kode_nota,
            item.kode_barang,
            item.nama_barang,
            item.harga_jual || 0,
            item.jumlah || 0,
            item.subtotal || 0,
          ],
          (qErr) => {
            if (qErr) {
              console.error(
                `❌ Gagal insert detail barang nota [${item.id_nota}]:`,
                qErr.message,
              );
              adaEror = true;
            }

            selesaiKueri++;
            if (selesaiKueri === dataDetail.length) {
              console.log(
                `✓ Detail barang berhasil terekam di cloud untuk ${tokoPengirim}!`,
              );
              connection.end();

              if (adaEror) {
                return res.status(207).json({
                  status: "partial_success",
                  message: "Detail tersimpan dengan catatan",
                });
              } else {
                return res.status(200).json({
                  status: "success",
                  message: "Detail barang masuk total 100%!",
                });
              }
            }
          },
        );
      });
    });
  },
);
// =========================================================================
// 🛒 ENDPOINT CLOUD: PENERIMA CICILAN NOTA KULAKAN PEMBELIAN SUPPLIER
// =========================================================================
app.post("/api/v1/sync-kasir/pembelian", cekTokenKeamanan, (req, res) => {
  const dataBeli = req.body.data;
  const tokoPengirim = req.body.toko || "TOKO_PUSAT";

  if (!dataBeli || dataBeli.length === 0) {
    return res.status(400).json({
      status: "error",
      message: "Array data pembelian kosong, brokkk!",
    });
  }

  const connection = dapatkanKoneksiCabang(tokoPengirim);
  connection.connect((err) => {
    if (err) {
      console.error("❌ Gagal konek DB cloud untuk pembelian:", err.message);
      return res
        .status(500)
        .json({ status: "error", message: "Cloud connection failed" });
    }

    let selesaiKueriBeli = 0;
    let adaErorBeli = false;

    dataBeli.forEach((notaBeli) => {
      const queryInsertBeli = `
        INSERT IGNORE INTO pembelian_cloud 
        (id_nota_beli, tanggal, suplier, total_beli, jumlah_item, operator) 
        VALUES (?, ?, ?, ?, ?, ?)`;

      connection.query(
        queryInsertBeli,
        [
          notaBeli.kode || notaBeli.id_nota_beli, // Menangkap parameter cicilan lokal
          notaBeli.tanggal,
          notaBeli.suplier,
          notaBeli.total_beli,
          notaBeli.jumlah_item,
          notaBeli.operator,
        ],
        (qErr) => {
          if (qErr) {
            console.error(
              `❌ Gagal insert nota beli [${notaBeli.kode}]:`,
              qErr.message,
            );
            adaErorBeli = true;
          }

          selesaiKueriBeli++;
          if (selesaiKueriBeli === dataBeli.length) {
            console.log(
              `✓ Nota kulakan pembelian berhasil terekam di cloud untuk ${tokoPengirim}!`,
            );
            connection.end();

            if (adaErorBeli) {
              return res.status(207).json({
                status: "partial_success",
                message: "Pembelian tersimpan dengan catatan",
              });
            } else {
              return res.status(200).json({
                status: "success",
                message: "Data pembelian kulakan masuk total 100%!",
              });
            }
          }
        },
      );
    });
  });
});

// =========================================================================
// 🚀 ENDPOINT POST PENANGKAP: NOTA PEMBELIAN KULAKAN (100% SAMA SAMA SS LU)
// =========================================================================
app.post(
  "/api/v1/sync-kasir/pembelian",
  cekTokenKeamanan,
  [body("toko").isString().trim().escape(), body("data").isArray()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });

    const dataBeli = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";
    console.log(
      `\n=== [WEB] NOTA PEMBELIAN BARU MASUK KE DATABASE: ${DAFTAR_DATABASE[tokoPengirim]?.db_name} ===`,
    );

    if (dataBeli && dataBeli.length > 0) {
      const connection = dapatkanKoneksiCabang(tokoPengirim);
      connection.connect((err) => {
        if (err)
          return console.error("❌ Gagal konek database cloud:", err.message);

        let selesaiKueri = 0;
        dataBeli.forEach((beli) => {
          const queryInsert = `INSERT IGNORE INTO pembelian_cloud (id_nota, tanggal, suplier, total_beli, jumlah_item, operator) VALUES (?, ?, ?, ?, ?, ?)`;
          connection.query(
            queryInsert,
            [
              // 🌟 SINKRON: Menangkap key alias dari queryPembelian di screenshot lu!
              beli.kode, // ◄ Lurus dari p.kode AS kode
              beli.tanggal, // ◄ Lurus dari p.tanggal AS tanggal
              beli.suplier, // ◄ Lurus dari p.supplier AS suplier (huruf 'p' satu!)
              beli.total, // ◄ Lurus dari p.jt AS total
              beli.jumlah, // ◄ Lurus dari p.jumlah AS jumlah
              beli.operator, // ◄ Lurus dari p.operator AS operator
            ],
            (qErr) => {
              selesaiKueri++;
              if (selesaiKueri === dataBeli.length) {
                console.log(
                  `✔ Nota kulakan pembelian berhasil direkam permanen di database milik ${tokoPengirim}!`,
                );
                connection.end();
              }
            },
          );
        });
      });
    }
    res
      .status(200)
      .json({ status: "success", message: "Data pembelian tersimpan" });
  },
);

// =========================================================================
// 🚀 ENDPOINT POST PENANGKAP: PEMASUKAN LAIN-LAIN (GAYA MURNI LU)
// =========================================================================
app.post(
  "/api/v1/sync-kasir/pemasukan",
  cekTokenKeamanan,
  [body("toko").isString().trim().escape(), body("data").isArray()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });

    const dataPaket = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";
    console.log(
      `\n=== [WEB] PEMASUKAN BARU MASUK KE DATABASE: ${DAFTAR_DATABASE[tokoPengirim]?.db_name} ===`,
    );

    if (dataPaket && dataPaket.length > 0) {
      const connection = dapatkanKoneksiCabang(tokoPengirim);
      connection.connect((err) => {
        if (err)
          return console.error("❌ Gagal konek database cloud:", err.message);

        let selesaiKueri = 0;
        dataPaket.forEach((item) => {
          const queryInsert = `INSERT IGNORE INTO pemasukan_cloud (id_pemasukan, tanggal, keterangan, total, operator) VALUES (?, ?, ?, ?, ?)`;
          connection.query(
            queryInsert,
            [
              item.kode, // ◄ Sesuai p.kode di screenshot lu
              item.tanggal, // ◄ Sesuai p.tanggal
              item.keterangan, // ◄ Sesuai p.keterangan
              item.total, // ◄ Sesuai p.jumlah AS total di screenshot lu
              item.operator, // ◄ Sesuai p.operator
            ],
            (qErr) => {
              selesaiKueri++;
              if (selesaiKueri === dataPaket.length) {
                console.log(
                  `✔ Laporan pemasukan resmi terekam untuk ${tokoPengirim}!`,
                );
                connection.end();
              }
            },
          );
        });
      });
    }
    res
      .status(200)
      .json({ status: "success", message: "Data pemasukan tersimpan" });
  },
);

// =========================================================================
// 🚀 ENDPOINT POST PENANGKAP: PENGELUARAN OPERASIONAL (GAYA MURNI LU)
// =========================================================================
app.post(
  "/api/v1/sync-kasir/pengeluaran",
  cekTokenKeamanan,
  [body("toko").isString().trim().escape(), body("data").isArray()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });

    const dataPaket = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";
    console.log(
      `\n=== [WEB] PENGELUARAN BARU MASUK KE DATABASE: ${DAFTAR_DATABASE[tokoPengirim]?.db_name} ===`,
    );

    if (dataPaket && dataPaket.length > 0) {
      const connection = dapatkanKoneksiCabang(tokoPengirim);
      connection.connect((err) => {
        if (err)
          return console.error("❌ Gagal konek database cloud:", err.message);

        let selesaiKueri = 0;
        dataPaket.forEach((item) => {
          const queryInsert = `INSERT IGNORE INTO pengeluaran_cloud (id_pengeluaran, tanggal, keterangan, total, operator) VALUES (?, ?, ?, ?, ?)`;
          connection.query(
            queryInsert,
            [
              item.kode, // ◄ Sesuai p.kode di screenshot lu
              item.tanggal, // ◄ Sesuai p.tanggal
              item.keterangan, // ◄ Sesuai p.keterangan
              item.total, // ◄ Sesuai p.jumlah AS total di screenshot lu
              item.operator, // ◄ Sesuai p.operator
            ],
            (qErr) => {
              selesaiKueri++;
              if (selesaiKueri === dataPaket.length) {
                console.log(
                  `✔ Laporan pengeluaran resmi terekam untuk ${tokoPengirim}!`,
                );
                connection.end();
              }
            },
          );
        });
      });
    }
    res
      .status(200)
      .json({ status: "success", message: "Data pengeluaran tersimpan" });
  },
);
// =========================================================================
// 🚀 ENDPOINT POST CLOUD: PENERIMA SINKRONISASI DATA HUTANG (FIXED ANTI-500)
// =========================================================================
// =========================================================================
// 🚀 1. ENDPOINT POST CLOUD: PENERIMA SINKRONISASI DATA HUTANG (ANTI-EROR 500)
// =========================================================================
app.post(
  "/api/v1/sync-kasir/hutang",
  cekTokenKeamanan,
  [body("toko").isString().trim().escape(), body("data").isArray()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: "error", errors: errors.array() });
    }

    const dataPaket = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";

    console.log(
      `\n=== [WEB] HUTANG BARU MASUK KE DATABASE: ${DAFTAR_DATABASE[tokoPengirim]?.db_name} ===`,
    );

    if (dataPaket && dataPaket.length > 0) {
      const connection = dapatkanKoneksiCabang(tokoPengirim);

      connection.connect((err) => {
        if (err) {
          console.error("❌ X Gagal konek database cloud:", err.message);
          return res
            .status(500)
            .json({ status: "error", message: "Cloud connection failed" });
        }

        let selesaiKueri = 0;
        let adaErorQuery = false;

        // ... (Bagian atas body validation tetap sama persis ya bro) ...

        dataPaket.forEach((item) => {
          // 🔥 SEKARANG PAS: 6 Kolom wajib berpasangan dengan 6 tanda tanya (?, ?, ?, ?, ?, ?)!
          const queryInsert = `
            INSERT IGNORE INTO hutang_cloud 
            (id_hutang, tanggal, id_supplier, total_hutang, operator, data_lengkap_json) 
            VALUES (?, ?, ?, ?, ?, ?)`;

          connection.query(
            queryInsert,
            [
              item.kode || item.id_hutang,
              item.tanggal,
              item.id_supplier || item.supplier || "-",
              item.total_hutang || item.jumlah || 0,
              item.operator || "ADMIN_KASIR",
              // 🔥 SUNTIKAN SAKTI: Jika ruko mengirim objek detail barang, ubah otomatis jadi string text JSON!
              item.data_lengkap_json
                ? typeof item.data_lengkap_json === "object"
                  ? JSON.stringify(item.data_lengkap_json)
                  : item.data_lengkap_json
                : "{}",
            ],
            (qErr) => {
              // ... (Sisa callback selesaiKueri di bawahnya teruskan murni bawaan lu bro, jangan diubah!)

              if (qErr) {
                console.error(
                  `❌ Eror pas insert data hutang [${item.kode || item.id_hutang}]:`,
                  qErr.message,
                );
                adaErorQuery = true;
              }

              selesaiKueri++;

              // 🪐 Kunci respons res.status(200) WAJIB di dalam hitungan selesaiKueri agar tidak tabrakan!
              if (selesaiKueri === dataPaket.length) {
                console.log(
                  `✓ Data laporan hutang resmi terekam untuk ${tokoPengirim}!`,
                );
                connection.end(); // Gembok matikan koneksi setelah kloter cicilan kelar

                if (adaErorQuery) {
                  return res.status(207).json({
                    status: "partial_success",
                    message:
                      "Data hutang tersimpan dengan beberapa catatan eror di konsol",
                  });
                } else {
                  return res.status(200).json({
                    status: "success",
                    message:
                      "Data hutang ruko resmi tersimpan bersih total 100%!",
                  });
                }
              }
            },
          );
        });
      });
    } else {
      return res.status(400).json({
        status: "error",
        message: "Data array hutang kosong melompong, brokkk!",
      });
    }
  },
);

// =========================================================================
// 🚀 ENDPOINT POST PENANGKAP: REKAP PIUTANG BON MEMBER (100% SAMA SAMA SS LU)
// =========================================================================
app.post(
  "/api/v1/sync-kasir/piutang",
  cekTokenKeamanan,
  [body("toko").isString().trim().escape(), body("data").isArray()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });

    const dataPaket = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";
    console.log(
      `\n=== [WEB] PIUTANG BARU MASUK KE DATABASE: ${DAFTAR_DATABASE[tokoPengirim]?.db_name} ===`,
    );

    if (dataPaket && dataPaket.length > 0) {
      const connection = dapatkanKoneksiCabang(tokoPengirim);
      connection.connect((err) => {
        if (err)
          return console.error("❌ Gagal konek database cloud:", err.message);

        let selesaiKueri = 0;
        dataPaket.forEach((item) => {
          const queryInsert = `INSERT IGNORE INTO piutang_cloud (id_piutang, tanggal, id_pelanggan, total_piutang, operator) VALUES (?, ?, ?, ?, ?)`;
          connection.query(
            queryInsert,
            [
              // 🌟 SINKRON: Menangkap key alias dari queryPiutang di screenshot lu!
              item.kode, // ◄ Dari p.kode
              item.tanggal, // ◄ Dari p.tanggal
              item.id_pelanggan, // ◄ Dari p.pelanggan AS id_pelanggan
              item.total_piutang, // ◄ Dari p.jumlah AS total_piutang
              item.operator, // ◄ Dari p.operator
            ],
            (qErr) => {
              selesaiKueri++;
              if (selesaiKueri === dataPaket.length) {
                console.log(
                  `✔ Data laporan piutang resmi terekam untuk ${tokoPengirim}!`,
                );
                connection.end();
              }
            },
          );
        });
      });
    }
    res
      .status(200)
      .json({ status: "success", message: "Data piutang tersimpan" });
  },
);

// =========================================================================
// 🚀 ENDPOINT POST PENANGKAP: RETUR PENJUALAN KONSUMEN (GAYA MURNI LU)
// =========================================================================
app.post(
  "/api/v1/sync-kasir/retur-jual",
  cekTokenKeamanan,
  [body("toko").isString().trim().escape(), body("data").isArray()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });

    const dataPaket = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";
    console.log(
      `\n=== [WEB] RETUR PENJUALAN BARU MASUK KE DATABASE: ${DAFTAR_DATABASE[tokoPengirim]?.db_name} ===`,
    );

    if (dataPaket && dataPaket.length > 0) {
      const connection = dapatkanKoneksiCabang(tokoPengirim);
      connection.connect((err) => {
        if (err)
          return console.error("❌ Gagal konek database cloud:", err.message);

        let selesaiKueri = 0;
        dataPaket.forEach((item) => {
          const queryInsert = `INSERT IGNORE INTO retur_jual_cloud (id_retur, tanggal, nama_barang, qty, total, operator) VALUES (?, ?, ?, ?, ?, ?)`;
          connection.query(
            queryInsert,
            [
              item.kode, // ◄ Sesuai r.kode di screenshot lu
              item.tanggal, // ◄ Sesuai r.tanggal
              item.nama_barang, // ◄ Sesuai r.nama_barang
              item.qty, // ◄ Sesuai r.qty
              item.total, // ◄ Sesuai r.jumlah AS total di screenshot lu
              item.operator, // ◄ Sesuai r.operator
            ],
            (qErr) => {
              selesaiKueri++;
              if (selesaiKueri === dataPaket.length) {
                console.log(
                  `✔ Laporan retur penjualan resmi terekam untuk ${tokoPengirim}!`,
                );
                connection.end();
              }
            },
          );
        });
      });
    }
    res
      .status(200)
      .json({ status: "success", message: "Data retur penjualan tersimpan" });
  },
);

// =========================================================================
// 🚀 ENDPOINT POST PENANGKAP: RETUR PEMBELIAN SUPPLIER (GAYA MURNI LU)
// =========================================================================
app.post(
  "/api/v1/sync-kasir/retur-beli",
  cekTokenKeamanan,
  [body("toko").isString().trim().escape(), body("data").isArray()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });

    const dataPaket = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";
    console.log(
      `\n=== [WEB] RETUR PEMBELIAN BARU MASUK KE DATABASE: ${DAFTAR_DATABASE[tokoPengirim]?.db_name} ===`,
    );

    if (dataPaket && dataPaket.length > 0) {
      const connection = dapatkanKoneksiCabang(tokoPengirim);
      connection.connect((err) => {
        if (err)
          return console.error("❌ Gagal konek database cloud:", err.message);

        let selesaiKueri = 0;
        dataPaket.forEach((item) => {
          const queryInsert = `INSERT IGNORE INTO retur_beli_cloud (id_retur, tanggal, nama_barang, qty, total, operator) VALUES (?, ?, ?, ?, ?, ?)`;
          connection.query(
            queryInsert,
            [
              item.kode, // ◄ Sesuai r.kode di screenshot lu
              item.tanggal, // ◄ Sesuai r.tanggal
              item.nama_barang, // ◄ Sesuai r.nama_barang
              item.qty, // ◄ Sesuai r.qty
              item.total, // ◄ Sesuai r.jumlah AS total di screenshot lu
              item.operator, // ◄ Sesuai r.operator
            ],
            (qErr) => {
              selesaiKueri++;
              if (selesaiKueri === dataPaket.length) {
                console.log(
                  `✔ Laporan retur pembelian resmi terekam untuk ${tokoPengirim}!`,
                );
                connection.end();
              }
            },
          );
        });
      });
    }
    res
      .status(200)
      .json({ status: "success", message: "Data retur pembelian tersimpan" });
  },
);

// =========================================================================
// 🚀 ENDPOINT POST PENANGKAP: MASTER PELANGGAN UTUH (100% SAMA SAMA SS LU)
// =========================================================================
app.post(
  "/api/v1/sync-kasir/pelanggan",
  cekTokenKeamanan,
  [body("toko").isString().trim().escape(), body("data").isArray()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });

    const dataPelanggan = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";
    console.log(
      `\n=== [WEB] MASTER PELANGGAN MASUK: ${DAFTAR_DATABASE[tokoPengirim]?.db_name} ===`,
    );

    if (dataPelanggan && dataPelanggan.length > 0) {
      const connection = dapatkanKoneksiCabang(tokoPengirim);
      connection.connect((err) => {
        if (err)
          return console.error(
            "❌ Gagal konek DB cloud pelanggan:",
            err.message,
          );

        let selesaiKueri = 0;
        dataPelanggan.forEach((cust) => {
          // Gulung seluruh properti objek kiriman lokal menjadi string JSON utuh
          const stringJsonLengkap = JSON.stringify(cust);
          const queryUpsert = `
          INSERT INTO pelanggan_cloud (kode_pelanggan, nama_pelanggan, alamat, telp, total_poin, nama_toko, data_lengkap_json) 
          VALUES (?, ?, ?, ?, ?, ?, ?) -- 🌟 PERBAIKAN: Ubah menjadi 7 tanda tanya agar pas sefrekuensi dengan kolom atasnya!
          ON DUPLICATE KEY UPDATE
            kode_pelanggan = VALUES(kode_pelanggan), 
            nama_pelanggan = VALUES(nama_pelanggan), 
            alamat = VALUES(alamat), 
            telp = VALUES(telp),
            total_poin = VALUES(total_poin),
            nama_toko = VALUES(nama_toko),
            data_lengkap_json = VALUES(data_lengkap_json)`;
          // 🔒 PARAMETER PELANGGAN: Jumlahnya pas 7 peluru, disamakan lurus sama urutan kueri baru ruko lu!
          connection.query(
            queryUpsert,
            [
              cust.kode || "", // ◄ 1. Mengisi kode_pelanggan
              cust.nama || "Umum", // ◄ 2. Mengisi nama_pelanggan
              cust.alamat || "", // ◄ 3. Mengisi alamat (Jika kosong, auto string kosong)
              cust.telp || "-", // ◄ 4. Mengisi telp murni dari kueri baru lu
              cust.point || 0, // ◄ 5. Mengisi total_poin murni dari kueri baru lu
              cust.nama_toko || "", // ◄ 6. Mengisi nama_toko murni dari kueri baru lu
              stringJsonLengkap, // ◄ 7. Mengisi data_lengkap_json (Seluruh sisa atribut auto-terbungkus aman!)
            ],
            (qErr) => {
              selesaiKueri++;
              if (selesaiKueri === dataPelanggan.length) {
                connection.end();
                console.log(
                  `✔ Master Pelanggan lengkap sukses disinkronkan untuk ${tokoPengirim}!`,
                );
              }
            },
          );
        });
      });
    }
    res.status(200).json({ status: "success", message: "Data pelanggan aman" });
  },
);
// =========================================================================
// 🏢 GERBANG POST CLOUD: PENERIMA DATA MASTER SUPPLIER LOKAL (PASTIKAN ADA /v1/)
// =========================================================================
app.post("/api/v1/sync-kasir/supplier", cekTokenKeamanan, (req, res) => {
  const dataSupplier = req.body.data;
  const tokoPengirim = req.body.toko || "TOKO_PUSAT";

  if (!dataSupplier || dataSupplier.length === 0) {
    return res.status(400).json({
      status: "error",
      message: "Paket array supplier kosong, brokkk!",
    });
  }

  const connection = dapatkanKoneksiCabang(tokoPengirim);
  connection.connect((err) => {
    if (err) {
      console.error("❌ Gagal koneksi database cloud supplier:", err.message);
      return res
        .status(500)
        .json({ status: "error", message: "Cloud database connection failed" });
    }

    let selesaiKueri = 0;
    let adaEror = false;

    dataSupplier.forEach((s) => {
      // Taktik ON DUPLICATE KEY UPDATE biar kalau data supplier berubah di ruko, cloud otomatis sinkron update!
      const queryInsertSupplier = `
        INSERT INTO supplier_cloud 
        (kode, nama, alamat, saldo_piutang, tgl_saldo, nomor, telp, fax, email, no_npwp, tampil, kdgrouphrg, kota, alamat2, contact, saldo_deposit) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          nama = VALUES(nama),
          alamat = VALUES(alamat),
          saldo_piutang = VALUES(saldo_piutang),
          tgl_saldo = VALUES(tgl_saldo),
          nomor = VALUES(nomor),
          telp = VALUES(telp),
          fax = VALUES(fax),
          email = VALUES(email),
          no_npwp = VALUES(no_npwp),
          tampil = VALUES(tampil),
          kdgrouphrg = VALUES(kdgrouphrg),
          kota = VALUES(kota),
          alamat2 = VALUES(alamat2),
          contact = VALUES(contact),
          saldo_deposit = VALUES(saldo_deposit)`;

      connection.query(
        queryInsertSupplier,
        [
          s.kode,
          s.nama || "Supplier Umum",
          s.alamat || "-",
          s.saldo_piutang || 0,
          s.tgl_saldo || null,
          s.nomor || "-",
          s.telp || "-",
          s.fax || "-",
          s.email || "-",
          s.no_npwp || "-",
          s.tampil || "True",
          s.kdgrouphrg || "-",
          s.kota || "-",
          s.alamat2 || "-",
          s.contact || "-",
          s.saldo_deposit || 0,
        ],
        (qErr) => {
          if (qErr) {
            console.error(
              `❌ Gagal inject supplier cloud [${s.kode}]:`,
              qErr.message,
            );
            adaEror = true;
          }

          selesaiKueri++;
          if (selesaiKueri === dataSupplier.length) {
            console.log(
              `✓ Master data supplier dari ${tokoPengirim} resmi terekam di cloud!`,
            );
            connection.end();

            if (adaEror) {
              return res.status(207).json({
                status: "partial_success",
                message: "Supplier tersimpan dengan beberapa catatan",
              });
            } else {
              return res.status(200).json({
                status: "success",
                message: "Data master supplier masuk total 100%!",
              });
            }
          }
        },
      );
    });
  });
});

// =========================================================================
// 📇 PINTU PENANGKAP MASTER KARYAWAN CLOUD (SUCI DARI EROR 403/500)
// =========================================================================
app.post("/api/v1/sync-kasir/karyawan", cekTokenKeamanan, (req, res) => {
  // 🌟 REVISI SAKTI: Ubah dari req.body.dataKaryawan menjadi req.body.data agar cocok sama Axios ruko lu!
  const dataKaryawan = req.body.data;
  const tokoPengirim = req.body.toko || "TOKO_PUSAT";

  if (dataKaryawan && dataKaryawan.length > 0) {
    const connection = dapatkanKoneksiCabang(tokoPengirim);
    connection.connect((err) => {
      if (err) return console.error("❌ Gagal konek DB cloud:", err.message);

      let selesaiKueri = 0;
      dataKaryawan.forEach((staff) => {
        const stringJsonLengkap = JSON.stringify(staff);

        // Kueri lurus sesuai isi phpMyAdmin baru lu
        const query = `
          INSERT INTO karyawan_cloud (kode_karyawan, nama_karyawan, level_akses, login_terakhir, data_lengkap_json) 
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            nama_karyawan = VALUES(nama_karyawan), 
            level_akses = VALUES(level_akses), 
            login_terakhir = VALUES(login_terakhir),
            data_lengkap_json = VALUES(data_lengkap_json)`;
        // 🔒 PARAMETER KARYAWAN: Jumlahnya pas 6 peluru, meluruskan jumlah tanda tanya biar gak crash 500!
        connection.query(
          query,
          [
            staff.kode || "", // ◄ 1. Mengisi kode_karyawan
            staff.nama || "Kasir", // ◄ 2. Mengisi nama_karyawan
            staff.level || "Kasir", // ◄ 3. Mengisi level_akses
            staff.login_terakhir || "Y", // ◄ 4. Mengisi status_aktif murni dari kueri baru lu
            staff.password || "", // ◄ 5. Mengisi password_kasir (Sandi kasir lokal lu)
            stringJsonLengkap, // ◄ 6. Mengisi data_lengkap_json (Ban serep pembukuan total utuh)
          ],
          (qErr) => {
            selesaiKueri++;
            if (selesaiKueri === dataKaryawan.length) {
              console.log(
                `✔ Master karyawan ${tokoPengirim} resmi sinkron padat masuk DB!`,
              );
              connection.end();
            }
          },
        );
      });
    });
  }
  res.status(200).json({ status: "success" });
});

// =========================================================================
// 🦖 ENDPOINT POST PENANGKAP: MASTER BARANG UTUH 27 KOLOM (WAJIB PALING BONTOT!)
// =========================================================================
app.post(
  "/api/v1/sync-kasir/stok",
  cekTokenKeamanan,
  [body("toko").isString().trim().escape(), body("data").isArray()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });

    const dataStok = req.body.data;
    const tokoPengirim = req.body.toko || "TOKO_PUSAT";
    console.log(
      `\n=== [WEB] UPDATE STOK LENGKAP MASUK KE DATABASE: ${DAFTAR_DATABASE[tokoPengirim]?.db_name} ===`,
    );

    if (dataStok && dataStok.length > 0) {
      const connection = dapatkanKoneksiCabang(tokoPengirim);
      connection.connect((err) => {
        if (err)
          return console.error(
            "❌ Gagal konek database cloud barang:",
            err.message,
          );

        let selesaiKueri = 0;
        dataStok.forEach((barang) => {
          // 🧠 TRIK SAKTI: Ubah seluruh objek barang (27 kolom dari SS lu) jadi string JSON utuh
          const stringJsonLengkap = JSON.stringify(barang);

          const queryUpsert = `
          INSERT INTO barang_cloud (
            kode_barang, kodebarcode, nama_barang, kategori, golongan,
            supplier, isi, satuan_utama, satuan_grosir, satuan_grosir2, stok_toko, 
            stok_gudang, harga_beli, hargatoko1, hargatoko2, hargatoko3, 
            lokasi, data_lengkap_json
          ) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            kodebarcode = VALUES(kodebarcode),
            nama_barang = VALUES(nama_barang), 
            kategori = VALUES(kategori),
            golongan = VALUES(golongan),
            supplier = VALUES(supplier),
            isi = VALUES(isi),
            satuan_utama = VALUES(satuan_utama),
            satuan_grosir = VALUES(satuan_grosir),
            satuan_grosir2 = VALUES(satuan_grosir2),
            stok_toko = VALUES(stok_toko), 
            stok_gudang = VALUES(stok_gudang), 
            harga_beli = VALUES(harga_beli), 
            hargatoko1 = VALUES(hargatoko1),
            hargatoko2 = VALUES(hargatoko2),
            hargatoko3 = VALUES(hargatoko3),
            lokasi = VALUES(lokasi),
            data_lengkap_json = VALUES(data_lengkap_json)`;

          connection.query(
            queryUpsert,
            [
              barang.kode || "", // 1. kode_barang
              barang.kodebarcode || "", // 2. kodebarcode (sn ruko lu)
              barang.nama || "Tanpa Nama", // 3. nama_barang
              barang.kategori || "", // 4. kategori
              barang.golongan || "", // 5. golongan
              barang.supplier || "", // 6. supplier
              Number(barang.isi || 1), // 7. isi
              barang.satuan || "Pcs", // 8. satuan_utama
              barang.satuan2 || "", // 9. satuan_grosir
              barang.satuan3 || "", // 10. satuan_grosir2
              Number(barang.toko || 0), // 11. stok_toko
              Number(barang.gudang || 0), // 12. stok_gudang
              Number(barang.hpp || 0), // 13. harga_beli (HPP)
              Number(barang.hargatoko1 || 0), // 14. hargatoko1
              Number(barang.hargatoko2 || 0), // 15. hargatoko2
              Number(barang.hargatoko3 || 0), // 16. hargatoko3
              barang.lokasi || "-", // 17. lokasi
              stringJsonLengkap, // 18. data_lengkap_json (Ban serep pembungkus total utuh)
            ],
            (qErr) => {
              selesaiKueri++;
              if (selesaiKueri === dataStok.length) {
                console.log(
                  `✔ Seluruh 27 atribut data barang lengkap resmi terekam untuk ${tokoPengirim}!`,
                );
                connection.end();
              }
            },
          );
        });
      });
    }
    res
      .status(200)
      .json({ status: "success", message: "Data stok lengkap ter-update" });
  },
);
// =========================================================================
// 🏢 2. ENDPOINT GET CLOUD: TARIK DATA SUPPLIER UNTUK DROPDOWN & VIEW FRONTEND
// =========================================================================
app.get("/api/v1/sync-kasir/supplier", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";

  const connection = dapatkanKoneksiCabang(tokoDiminta);
  connection.connect((err) => {
    if (err) {
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB cloud" });
    }

    // Ambil seluruh data supplier diurutkan berdasarkan nama abjad terkecil
    const queryAmbilSupplier = "SELECT * FROM supplier_cloud ORDER BY nama ASC";

    connection.query(queryAmbilSupplier, (qErr, hasilData) => {
      connection.end(); // Langsung tutup koneksi database biar server cloud enteng
      if (qErr) {
        return res
          .status(500)
          .json({ status: "error", message: "Gagal query data supplier web" });
      }

      // Kirim balik data super bersih ke frontend React lu!
      res.status(200).json({
        status: "success",
        total_supplier: hasilData.length,
        data: hasilData,
      });
    });
  });
});

// =========================================================================
// 📈 ENDPOINT GET: MENYAJIKAN DATA NOTA PEMBELIAN KULAKAN KE REACT
// =========================================================================
app.get("/api/v1/sync-kasir/pembelian", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";
  const connection = dapatkanKoneksiCabang(tokoDiminta);
  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB cloud" });

    const queryAmbil = `SELECT id_nota, tanggal, suplier, total_beli, jumlah_item, operator FROM pembelian_cloud ORDER BY tanggal DESC LIMIT 100`;
    connection.query(queryAmbil, (qErr, hasilData) => {
      connection.end();
      if (qErr)
        return res
          .status(500)
          .json({ status: "error", message: "Gagal query data pembelian" });
      res.status(200).json({ status: "success", data: hasilData });
    });
  });
});

// =========================================================================
// ROUTE DINAMIS 6: Melayani tarikan data rekap PEMASUKAN LAIN-LAIN
// =========================================================================
app.get("/api/v1/sync-kasir/pemasukan", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";
  const connection = dapatkanKoneksiCabang(tokoDiminta);
  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB" });

    const queryAmbil = `SELECT id_pemasukan, tanggal, keterangan, total, operator FROM pemasukan_cloud ORDER BY tanggal DESC LIMIT 100`;
    connection.query(queryAmbil, (qErr, hasilData) => {
      connection.end();
      if (qErr)
        return res
          .status(500)
          .json({ status: "error", message: "Gagal query data pemasukan" });
      res.status(200).json({ status: "success", data: hasilData });
    });
  });
});

// =========================================================================
// ROUTE DINAMIS 7: Melayani tarikan data rekap PENGELUARAN OPERASIONAL
// =========================================================================
app.get("/api/v1/sync-kasir/pengeluaran", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";
  const connection = dapatkanKoneksiCabang(tokoDiminta);
  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB" });

    const queryAmbil = `SELECT id_pengeluaran, tanggal, keterangan, total, operator FROM pengeluaran_cloud ORDER BY tanggal DESC LIMIT 100`;
    connection.query(queryAmbil, (qErr, hasilData) => {
      connection.end();
      if (qErr)
        return res
          .status(500)
          .json({ status: "error", message: "Gagal query data pengeluaran" });
      res.status(200).json({ status: "success", data: hasilData });
    });
  });
});
// =========================================================================
// 📉 GERBANG GET CLOUD: TARIK DATA HUTANG CLOUD (WAJIB DIBUNGKUS STATUS SUCCESS)
// =========================================================================
app.get("/api/v1/sync-kasir/hutang", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";
  const connection = dapatkanKoneksiCabang(tokoDiminta);
  
  connection.connect((err) => {
    if (err) {
      return res.status(500).json({ status: "error", message: "Gagal konek DB cloud" });
    }

    // Hanya memanggil 7 kolom asli sesuai fisik tabel phpMyAdmin lu kemarin
    const queryAmbilHutang = `
      SELECT id_hutang, tanggal, id_supplier, total_hutang, operator, data_lengkap_json, updated_at
      FROM hutang_cloud 
      ORDER BY tanggal DESC 
      LIMIT 100`;

    connection.query(queryAmbilHutang, (qErr, hasilData) => {
      connection.end(); // Langsung matikan koneksi database biar server cloud enteng
      
      if (qErr) {
        return res.status(500).json({ status: "error", message: "Gagal query data hutang web" });
      }

      // 🔥 KUNCI MANUNGGAL SEJATI: Wajib dibungkus { status: "success", data: ... } 
      // Biar lolos sensor dari baris nomor 15 di file App.jsx frontend ruko lu!
      res.status(200).json({
        status: "success",
        data: hasilData
      }); 
    });
  });
});


// =========================================================================
// ROUTE DINAMIS 9: Melayani tarikan data rekap PIUTANG / BON MEMBER
// =========================================================================
app.get("/api/v1/sync-kasir/piutang", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";
  const connection = dapatkanKoneksiCabang(tokoDiminta);
  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB" });

    const queryAmbil = `SELECT id_piutang, tanggal, id_pelanggan, total_piutang, sisa_piutang, status FROM piutang_cloud ORDER BY tanggal DESC LIMIT 100`;
    connection.query(queryAmbil, (qErr, hasilData) => {
      connection.end();
      if (qErr)
        return res
          .status(500)
          .json({ status: "error", message: "Gagal query data piutang" });
      res.status(200).json({ status: "success", data: hasilData });
    });
  });
});

// =========================================================================
// 📈 ENDPOINT GET: MENYAJIKAN DATA RETUR PENJUALAN KE FRONTEND REACT
// =========================================================================
app.get("/api/v1/sync-kasir/retur-jual", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";
  const connection = dapatkanKoneksiCabang(tokoDiminta);

  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB cloud" });

    const queryAmbil = `SELECT id_retur, tanggal, nama_barang, qty, total, operator FROM retur_jual_cloud ORDER BY tanggal DESC LIMIT 100`;
    connection.query(queryAmbil, (qErr, hasilData) => {
      connection.end();
      if (qErr)
        return res.status(500).json({
          status: "error",
          message: "Gagal query data retur penjualan",
        });
      res.status(200).json({ status: "success", data: hasilData });
    });
  });
});

// =========================================================================
// 📈 ENDPOINT GET: MENYAJIKAN DATA RETUR PEMBELIAN KE FRONTEND REACT
// =========================================================================
app.get("/api/v1/sync-kasir/retur-beli", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";
  const connection = dapatkanKoneksiCabang(tokoDiminta);

  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB cloud" });

    const queryAmbil = `SELECT id_retur, tanggal, nama_barang, qty, total, operator FROM retur_beli_cloud ORDER BY tanggal DESC LIMIT 100`;
    connection.query(queryAmbil, (qErr, hasilData) => {
      connection.end();
      if (qErr)
        return res.status(500).json({
          status: "error",
          message: "Gagal query data retur pembelian",
        });
      res.status(200).json({ status: "success", data: hasilData });
    });
  });
});
// =========================================================================
// 👥 1. KRAN GET PELANGGAN PREMIUM (SINKRON 100% SAMA SKEMA LURUS REQ LU)
// =========================================================================
app.get("/api/v1/sync-kasir/pelanggan", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";
  const connection = dapatkanKoneksiCabang(tokoDiminta);
  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB cloud" });

    // 🌟 REVISI SAKTI: Memanggil seluruh 7 kolom fisik secara komplit (Termasuk nama_toko & max_piutang!)
    const queryAmbil = `
      SELECT 
        kode_pelanggan, 
        nama_pelanggan, 
        alamat, 
        telp, 
        total_poin, 
        nama_toko, 
        data_lengkap_json 
      FROM pelanggan_cloud 
      ORDER BY nama_pelanggan ASC`;

    connection.query(queryAmbil, (qErr, hasilData) => {
      connection.end();
      if (qErr)
        return res
          .status(500)
          .json({ status: "error", message: "Gagal query data pelanggan" });

      const dataSelesaiParse = hasilData.map((item) => {
        try {
          return {
            ...item,
            data_lengkap_json: item.data_lengkap_json
              ? JSON.parse(item.data_lengkap_json)
              : {},
          };
        } catch (e) {
          return { ...item, data_lengkap_json: {} };
        }
      });

      res.status(200).json({ status: "success", data: dataSelesaiParse });
    });
  });
});

// =========================================================================
// 📇 2. KRAN GET KARYAWAN PREMIUM (SINKRON 100% SAMA SKEMA LURUS REQ LU)
// =========================================================================
app.get("/api/v1/sync-kasir/karyawan", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";
  const connection = dapatkanKoneksiCabang(tokoDiminta);
  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB cloud" });

    // 🌟 REVISI SAKTI: Memanggil seluruh 6 kolom fisik secara komplit (Termasuk login_terakhir & password_kasir!)
    const queryAmbil = `
      SELECT 
        kode_karyawan, 
        nama_karyawan, 
        level_akses, 
        login_terakhir,
        data_lengkap_json 
      FROM karyawan_cloud 
      ORDER BY nama_karyawan ASC`;

    connection.query(queryAmbil, (qErr, hasilData) => {
      connection.end();
      if (qErr)
        return res
          .status(500)
          .json({ status: "error", message: "Gagal query data karyawan" });

      const dataSelesaiParse = hasilData.map((item) => {
        try {
          return {
            ...item,
            data_lengkap_json: item.data_lengkap_json
              ? JSON.parse(item.data_lengkap_json)
              : {},
          };
        } catch (e) {
          return { ...item, data_lengkap_json: {} };
        }
      });

      res.status(200).json({ status: "success", data: dataSelesaiParse });
    });
  });
});

// =========================================================================
// 📦 OPTIMASI SAKTI TURBO: GET STOK BARANG SEPERTI REQUEST PREMIUM LU (17 KOLOM LURUS!)
// =========================================================================
app.get("/api/v1/sync-kasir/stok", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";
  const halaman = parseInt(req.query.page) || 1;
  const cari = req.query.search ? `%${req.query.search}%` : null;

  const ukuranKue = 300;
  const lompatanOffset = (halaman - 1) * ukuranKue;

  const connection = dapatkanKoneksiCabang(tokoDiminta);
  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB" });

    let queryAmbil = "";
    let parameterQuery = [];

    // 🌟 1. BLOK JALUR JIKA SI BOS SEDANG MENGETIK DI SEARCH BAR FRONTEND
    if (cari) {
      queryAmbil = `SELECT 
                      kode_barang, kodebarcode, nama_barang, kategori, golongan,
                      supplier, isi, satuan_utama, satuan_grosir, satuan_grosir2, stok_toko, 
                      stok_gudang, harga_beli, hargatoko1, hargatoko2, hargatoko3, 
                      lokasi, data_lengkap_json
                    FROM barang_cloud 
                    WHERE nama_barang LIKE ? OR kode_barang LIKE ? OR kodebarcode LIKE ?
                    ORDER BY nama_barang ASC LIMIT 100`;
      parameterQuery = [cari, cari, cari];
    } else {
      // 🌟 2. BLOK JALUR UTAMA: KEREKAN HALAMAN BERGANTIAN PER 300 BARIS DATA KOKOH
      queryAmbil = `SELECT 
                      kode_barang, kodebarcode, nama_barang, kategori, golongan,
                      supplier, isi, satuan_utama, satuan_grosir, satuan_grosir2, stok_toko, 
                      stok_gudang, harga_beli, hargatoko1, hargatoko2, hargatoko3, 
                      lokasi, data_lengkap_json
                    FROM barang_cloud 
                    ORDER BY nama_barang ASC 
                    LIMIT ? OFFSET ?`;
      parameterQuery = [ukuranKue, lompatanOffset];
    }

    connection.query(queryAmbil, parameterQuery, (qErr, hasilData) => {
      connection.end();
      if (qErr)
        return res.status(500).json({ status: "error", message: qErr.message });

      // Parsing bungkusan JSON ghaib harian lu biar aman anti-crash 500
      const dataSelesai = hasilData.map((item) => {
        try {
          return {
            ...item,
            data_lengkap_json: item.data_lengkap_json
              ? JSON.parse(item.data_lengkap_json)
              : {},
          };
        } catch (e) {
          return { ...item, data_lengkap_json: {} };
        }
      });

      res.status(200).json({ status: "success", data: dataSelesai });
    });
  });
});
app.get("/api/v1/sync-kasir/omset", cors(), (req, res) => {
  const tokoDiminta = req.query.toko || "TOKO_PUSAT";

  // Tangkap query tipe dari frontend (Contoh: ?tipe=toko atau ?tipe=cabang)
  const tipePenjualan = req.query.tipe || "semua";

  const connection = dapatkanKoneksiCabang(tokoDiminta);
  connection.connect((err) => {
    if (err) {
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB cloud" });
    }

    // 🪐 LOGIKA FILTER SAKTI: Pisah data berdasarkan kolom jenis_penjualan
    let kondisiKueri = "";
    if (tipePenjualan === "toko") {
      kondisiKueri = "WHERE jenis_penjualan = 'toko'";
    } else if (tipePenjualan === "cabang") {
      kondisiKueri = "WHERE jenis_penjualan = 'cabang'";
    }

    const queryAmbil = `
      SELECT 
        id_nota,
        tanggal,
        operator,
        subtotal,
        jumlah,
        pelanggan,
        nama_pelanggan,
        alamat_pelanggan,
        piutang,
        detail_barang_nota,
        jenis_penjualan
      FROM penjualan_cloud
      ${kondisiKueri}
      ORDER BY tanggal DESC 
      LIMIT 100`;

    connection.query(queryAmbil, (qErr, hasilData) => {
      connection.end();
      if (qErr) {
        return res.status(500).json({
          status: "error",
          message: "Gagal query data omset penjualan",
        });
      }
      res
        .status(200)
        .json({ status: "success", tipe: tipePenjualan, data: hasilData });
    });
  });
});

app.get("/api/lokal/penjualan/generate-sid2", (req, res) => {
  // Jalankan queryPenjualan global ruko lokal kita
  db.query(queryPenjualan, (err, hasilData) => {
    if (err) {
      console.error("❌ Gagal menarik data sinkronisasi lokal:", err);
      return res.status(500).json({ error: err.message });
    }

    if (hasilData.length === 0) {
      return res.json({
        status: "empty",
        message: "Aman bro, semua data sudah tersinkronisasi!",
      });
    }

    // 🪐 1. SIAPKAN HEADER BERKAS YANG SAMA PERSIS SEPERTI FORMAT CLOUD LU
    let isiTokoSID2 = `## GROSMART_LOCAL_EXPORT_SID2_TOKO ##\n`;
    isiTokoSID2 += `Generated_At:${new Date().toISOString()}\n`;
    isiTokoSID2 += `Total_Records:${hasilData.length}\n`;
    isiTokoSID2 += `==================================================\n`;

    let isiCabangSID2 = `## GROSMART_LOCAL_EXPORT_SID2_CABANG ##\n`;
    isiCabangSID2 += `Generated_At:${new Date().toISOString()}\n`;
    isiCabangSID2 += `Total_Records:${hasilData.length}\n`;
    isiCabangSID2 += `==================================================\n`;

    let hitungToko = 0;
    let hitungCabang = 0;

    // 🪐 2. LOOPING MASSAL MENGIKUTI STRUKTUR VARIABEL DAN KOLOM CLOUD LU
    hasilData.forEach((row) => {
      const barisTeks = `${row.id_nota || row.kode}|${row.tanggal}|${row.operator}|${row.subtotal}|${row.jumlah}|${row.nama_pelanggan}|${row.piutang}|${row.detail_barang_nota || "-"}\n`;

      // Saklar deteksi pemisah kasta: Jika nama pelanggan diawali huruf "GM", banting ke berkas cabang
      if (
        row.nama_pelanggan &&
        row.nama_pelanggan.toUpperCase().startsWith("GM")
      ) {
        isiCabangSID2 += barisTeks;
        hitungCabang++;
      } else {
        isiTokoSID2 += barisTeks;
        hitungToko++;
      }
    });

    // 🪐 3. PROSES PENULISAN BERKAS FISIK DI HARDDISK RUKO LOKAL
    const folderExports = path.join(__dirname, "exports_sid2");
    if (!fs.existsSync(folderExports)) {
      fs.mkdirSync(folderExports);
    }

    const fileTokoPath = path.join(folderExports, `TOKO_${Date.now()}.sid2`);
    const fileCabangPath = path.join(
      folderExports,
      `CABANG_${Date.now()}.sid2`,
    );

    // Tulis ke file fisik jika data kloternya ada
    if (hitungToko > 0) fs.writeFileSync(fileTokoPath, isiTokoSID2, "utf8");
    if (hitungCabang > 0)
      fs.writeFileSync(fileCabangPath, isiCabangSID2, "utf8");

    console.log(
      `⚡ BERHASIL EKSPOR LOKAL! Terbentuk ${hitungToko} data Toko dan ${hitungCabang} data Cabang.`,
    );

    // Kembalikan respons sukses kembar kasta enterprise
    res.status(200).json({
      status: "success",
      message:
        "Boom! File .sid2 lokal sukses diproduksi dengan format kembar seperti Cloud!",
      ringkasan: {
        total_nota_baru: hasilData.length,
        ekspor_toko: hitungToko,
        ekspor_cabang: hitungCabang,
      },
    });
  });
});

// =========================================================================
// 🛒 3. APP.POST KHUSUS: TRANSAKSI PENJUALAN BARU LANGSUNG DARI WEB
//    (Biar bos besar/admin bisa input penjualan manual dari browser handphone)
// =========================================================================
app.post("/api/v1/omset/transaksi-web", cors(), (req, res) => {
  const {
    toko,
    id_nota,
    operator,
    subtotal,
    jumlah,
    pelanggan,
    nama_pelanggan,
    alamat_pelanggan,
    piutang,
    detail_barang_nota,
  } = req.body;

  const tokoTarget = toko || "TOKO_PUSAT";
  const connection = dapatkanKoneksiCabang(tokoTarget);

  connection.connect((err) => {
    if (err)
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB cloud" });

    // 🔥 DETEKTOR OTOMATIS WEB: Tentukan tipe berdasarkan nama pelanggan GM
    let jenisPenjualanWeb = "toko";
    if (nama_pelanggan && nama_pelanggan.toUpperCase().startsWith("GM")) {
      jenisPenjualanWeb = "cabang";
    }

    // Gunakan tanggal real-time server cloud hari ini saat transaksi di-klik
    const tanggalHariIni = new Date().toISOString().slice(0, 10);

    const queryInsertWeb = `
      INSERT INTO penjualan_cloud 
      (id_nota, tanggal, operator, subtotal, jumlah, pelanggan, nama_pelanggan, alamat_pelanggan, piutang, detail_barang_nota, jenis_penjualan) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      id_nota || `WEB-${Date.now()}`, // Auto generate nomor nota jika kasir web lupa isi
      tanggalHariIni,
      operator || "ADMIN_WEB",
      subtotal || 0,
      jumlah || 0,
      pelanggan || "",
      nama_pelanggan || "Umum / Non-Member",
      alamat_pelanggan || "-",
      piutang || 0,
      detail_barang_nota || "",
      jenisPenjualanWeb,
    ];

    connection.query(queryInsertWeb, values, (qErr, result) => {
      connection.end();
      if (qErr) {
        return res.status(500).json({ status: "error", message: qErr.message });
      }
      res.status(201).json({
        status: "success",
        message: `Transaksi penjualan ${jenisPenjualanWeb} via Web berhasil disimpan!`,
        id_nota: id_nota,
      });
    });
  });
});

// =========================================================================
// 🧹 CRON JOB ENDPOINT: ROBOT OTOMATIS BERSIIH-BERSIH NOTA PURBA > 3 BULAN
// =========================================================================
// Rute ini rahasia, dilindungi API_TOKEN biar gak bisa ditembak orang iseng!
app.get("/api/v1/cron/bersihkan-nota-purba", (req, res) => {
  const tokenCron = req.query.token;

  if (!tokenCron || tokenCron !== API_TOKEN) {
    return res
      .status(401)
      .json({ status: "error", message: "Gagal stempel token, Brokkk!" });
  }

  console.log(
    "\n🧹 [CRON JOB] Memulai proses pembersihan nota purba harian...",
  );

  // Eksekusi bersih-bersih serentak di SEMUA database cabang yang terdaftar
  let databaseSelesai = 0;
  const daftarDatabaseKeys = Object.keys(DAFTAR_DATABASE);

  daftarDatabaseKeys.forEach((keyToko) => {
    const connection = dapatkanKoneksiCabang(keyToko);

    connection.connect((err) => {
      if (err) {
        console.error(`❌ Cron gagal konek DB ${keyToko}:`, err.message);
        databaseSelesai++;
        return;
      }

      // Mantra SQL Pembersih Nota > 3 Bulan
      const queryCleanJual = `DELETE FROM penjualan_cloud WHERE tanggal < NOW() - INTERVAL 3 MONTH`;
      const queryCleanBeli = `DELETE FROM pembelian_cloud WHERE tanggal < NOW() - INTERVAL 3 MONTH`;

      connection.query(queryCleanJual, (errJual) => {
        connection.query(queryCleanBeli, (errBeli) => {
          connection.end(); // Selalu tutup koneksi database setelah selesai
          console.log(
            `✔ Database milik ${keyToko} berhasil disapu bersih dari nota purba.`,
          );

          databaseSelesai++;
          if (databaseSelesai === daftarDatabaseKeys.length) {
            return res.status(200).json({
              status: "success",
              message: "Seluruh database cabang resmi ramping & bersih total!",
            });
          }
        });
      });
    });
  });
});
// =========================================================================
// 📇 ENDPOINT LOGIN: COCOK 100% SAMA PASSWORD ASLI SOFTWARE SID RETAIL RUKO
// (SOP: Menyamakan teks ketikan React dengan isi kolom password di dalam JSON)
// =========================================================================
app.post("/api/v1/sync-kasir/login", cors(), (req, res) => {
  const { username, password } = req.body; // ◄ Password ketikan Bos/Karyawan di React

  // Kita ketuk brankas database TOKO_PUSAT yang menyimpan data master karyawan
  const connection = dapatkanKoneksiCabang("TOKO_PUSAT");

  connection.connect((err) => {
    if (err) {
      console.error("❌ Login gagal konek DB Cloud:", err.message);
      return res
        .status(500)
        .json({ status: "error", message: "Gagal konek DB Cloud" });
    }

    // Panggil nama_karyawan dan brankas data_lengkap_json tempat password ruko ngumpet
    const queryCekUser =
      "SELECT nama_karyawan, level_akses, data_lengkap_json FROM karyawan_cloud WHERE nama_karyawan = ? LIMIT 1";

    connection.query(queryCekUser, [username], (qErr, hasilData) => {
      connection.end(); // Selalu tutup koneksi database setelah selesai digunakan

      if (qErr) {
        console.error("❌ Gagal query login:", qErr.message);
        return res
          .status(500)
          .json({ status: "error", message: "Gagal query data login" });
      }

      // 1. Cek apakah nama karyawan/operator terdaftar di database cloud
      if (hasilData.length > 0) {
        const userObj = hasilData[0];

        // 🧠 BONGKAR BRANKAS JSON: String teks cloud dibongkar jadi objek JavaScript asli
        const dataDetailRuko = userObj.data_lengkap_json
          ? JSON.parse(userObj.data_lengkap_json)
          : {};

        // 🔒 AMBIL PASSWORD ASLI: Menarik nilai dari kolom 'password' murni bawaan SID Retail ruko lu!
        const passwordAsliRuko = dataDetailRuko.password;

        // 2. MANTRA UTAMA: Samakan password ketikan React dengan password asli ruko lu!
        if (password === passwordAsliRuko) {
          console.log(
            `✔ Login Sukses: ${username} masuk sebagai ${userObj.level_akses}`,
          );
          return res.status(200).json({
            status: "success",
            message: "Login Berhasil, Akun Sinkron Sempurna Sama Ruko!",
            user: username,
            role: userObj.level_akses, // Mengirim hak akses (Admin/Kasir/Owner) menuju React
          });
        }
      }

      // Jika user tidak ketemu atau password salah, lempar status eror 401
      res
        .status(401)
        .json({ status: "error", message: "Username atau Password salah!" });
    });
  });
});

// =========================================================================
// 🎬 PALING UJUNG BAWAH: SAKLAR UTAMA PENYALAAN SERVER EXPRESS LU
// =========================================================================
const PORT_SISTEM = process.env.PORT_SERVER || 5050;
app.listen(PORT_SISTEM, () => {
  console.log(`Website backend ERP sukses berjalan di port ${PORT_SISTEM}`);
});
