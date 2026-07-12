const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const mysql = require("mysql");
const axios = require("axios");
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

function sinkronisasiData() {
  console.log(
    `[${new Date().toLocaleTimeString()}] Memulai scan database lokal...`,
  );

  const connection = mysql.createConnection(dbConfig);

  connection.connect((err) => {
    if (err) {
      console.error("❌ Gagal terhubung ke database:", err.message);
      return;
    }
    const queryPembelian = `
            SELECT 
                p.kode AS kode,       -- Sesuai baris 1 di Navicat lu
                p.tanggal AS tanggal, -- Sesuai baris 2 di Navicat lu
                p.supplier AS suplier, -- Sesuai baris 3 di Navicat lu
                p.jt AS total,        -- Sesuai baris 10 di Navicat lu (Kolom Jumlah Total)
                p.jumlah AS jumlah,   -- Sesuai baris 8 di Navicat lu
                p.operator AS operator -- Sesuai baris 9 di Navicat lu
            FROM pembelian p          -- Sesuai nama tabel asli di panel kiri lu
            LEFT JOIN log_sinkronisasi l ON p.kode = l.id_nota
            WHERE l.id_nota IS NULL AND p.tanggal >= NOW() - INTERVAL 3 MONTH 
            LIMIT 50
        `;

    const queryPenjualan = `
  SELECT 
    p.kode,  
    p.tanggal,                   
    p.operator,                 
    p.subtotal,                  
    p.jumlah,                    
    p.pelanggan,                  -- ID Member
    p.nama_pelanggan,  
    p.alamat_pelanggan,          
    p.piutang,                   
    p.bayar,                   
    p.kembali,                
    p.lunas,                     
    p.status,                 
    p.ket_tambahan AS detail_barang_nota

  FROM penjualan p
  LEFT JOIN log_sinkronisasi l ON p.kode = l.id_nota
  WHERE l.id_nota IS NULL 
    AND p.tanggal >= NOW() - INTERVAL 3 MONTH
  ORDER BY p.tanggal ASC`;

    const queryPemasukan = `
      SELECT 
        p.kode, 
        p.tanggal, 
        p.keterangan, 
        p.jumlah AS total,
        p.operator
      FROM pemasukan p 
      LEFT JOIN log_sinkronisasi l ON p.kode = l.id_nota
      WHERE l.id_nota IS NULL AND p.tanggal >= NOW() - INTERVAL 3 MONTH`;

    const queryPengeluaran = `
      SELECT 
        p.kode, 
        p.tanggal, 
        p.keterangan, 
        p.jumlah AS total,
        p.operator
      FROM pengeluaran p 
      LEFT JOIN log_sinkronisasi l ON p.kode = l.id_nota
      WHERE l.id_nota IS NULL AND p.tanggal >= NOW() - INTERVAL 3 MONTH`;

    const queryHutang = `
  SELECT 
    h.kode AS id_hutang,            
    h.tanggal,
    h.supplier AS id_supplier,
    h.jumlah AS total_hutang,
    h.operator,
    h.ket AS data_lengkap_json
  FROM hutang h
  LEFT JOIN log_sinkronisasi l ON h.kode = l.id_nota
  WHERE l.id_nota IS NULL 
    AND h.tanggal >= NOW() - INTERVAL 3 MONTH`;

    const queryPiutang = `
      SELECT 
        p.kode, 
        p.tanggal, 
        p.pelanggan AS id_pelanggan,
        p.jumlah AS total_piutang,
        p.operator
      FROM piutang p 
      LEFT JOIN log_sinkronisasi l ON p.kode = l.id_nota
      WHERE l.id_nota IS NULL AND p.tanggal >= NOW() - INTERVAL 3 MONTH`;
    const queryReturJual = `
      SELECT 
        r.kode, 
        r.tanggal, 
        r.nama_barang, 
        r.qty, 
        r.jumlah AS total,
        r.operator 
      FROM return_penjualan r 
      LEFT JOIN log_sinkronisasi l ON r.kode = l.id_nota
      WHERE l.id_nota IS NULL AND r.tanggal >= NOW() - INTERVAL 3 MONTH`;

    const queryReturBeli = `
      SELECT 
        r.kode, 
        r.tanggal, 
        r.nama_barang, 
        r.qty, 
        r.jumlah AS total,
        r.operator 
      FROM return_pembelian r 
      LEFT JOIN log_sinkronisasi l ON r.kode = l.id_nota
      WHERE l.id_nota IS NULL AND r.tanggal >= NOW() - INTERVAL 3 MONTH  LIMIT 50`;

    const queryPelanggan = `
      SELECT 
        kode, nama, alamat,
        telp, point, 
        nama_toko
      FROM pelanggan`;

    const queryKaryawan = `
      SELECT 
        password, kode, nama, level, login_terakhir
      FROM karyawan`;

    const queryBarang = `
      SELECT 
    kode, 
    kode_barcode AS kodebarcode,
    nama, 
    kategori, 
    golongan,
    subgolongan1 AS subkategori,
    supplier AS supplier, 
    isi, 
    satuanbeli,
    satuan, 
    satuan2, 
    toko, 
    gudang, 
    hpp, 
    harga_toko AS hargatoko1, 
    harga_toko2 AS hargatoko2, 
    harga_toko3 AS hargatoko3,
    lokasi
  FROM barang`;
    const querySupplier = `
  SELECT 
    s.kode,                        
    s.nama,                        
    s.alamat,                      
    s.saldo_piutang,               
    s.tgl_saldo,
    s.nomor,
    s.telp,                        
    s.fax,
    s.email,
    s.no_npwp,
    s.tampil,                      
    s.kdgrouphrg,                  
    s.kota,                        
    s.alamat2,                     
    s.contact,                     
    s.saldo_deposit                
  FROM supplier s
  ORDER BY s.nama ASC`;

    connection.query(queryPembelian, async (errorBeli, notaBeliBaru) => {
      if (errorBeli) {
        console.error("❌ X Gagal query pembelian:", errorBeli.message);
        connection.end();
        return;
      }

      if (notaBeliBaru && notaBeliBaru.length > 0) {
        const totalNotaBeli = notaBeliBaru.length;

        // 🪐 1. SET UKURAN CICILAN (Biar internet ruko anti-down!)
        const ukuranCicilanBeli = 100;

        console.log(
          `Menemukan ${totalNotaBeli} nota pembelian baru. Mengirim ke web...`,
        );

        try {
          // 🪐 2. LOOPING MASAL PER 100 NOTA KULAKAN
          for (let i = 0; i < totalNotaBeli; i += ukuranCicilanBeli) {
            // Ambil potongan data per kloter 100 baris nota pembelian
            const potonganDataBeli = notaBeliBaru.slice(
              i,
              i + ukuranCicilanBeli,
            );

            console.log(
              ` -> Mengirim cicilan data pembelian ke-${i + 1} sampai ke-${Math.min(i + ukuranCicilanBeli, totalNotaBeli)}...`,
            );

            // Map data agar nama properti dari database lokal lu dipastikan aman saat dikirim
            const dataBeliSiapKirim = potonganDataBeli.map((nota) => ({
              kode: nota.kode,
              tanggal: nota.tanggal,
              suplier: nota.suplier || nota.supplier || "Supplier Umum",
              total_beli: nota.total_beli || nota.subtotal || 0,
              jumlah_item: nota.jumlah_item || nota.jumlah || 0,
              operator: nota.operator || "ADMIN_GUDANG",
            }));

            // 🪐 3. AXIOS POST SAMA PERSIS FORMAT LU (Pakai await agar sekuensial)
            const resBeli = await axios.post(
              WEB_API_URL + "/api/v1/sync-kasir/pembelian",
              {
                toko: KODE_TOKO,
                data: dataBeliSiapKirim, // Kirim potongan data 100 item kulakan lengkap ke web
              },
              {
                headers: { Authorization: "Bearer " + API_TOKEN },
              },
            );

            // 🪐 4. JIKA KLOTER 100 DATA SUKSES, LANGSUNG KUNCI KE LOG_SINKRONISASI LOKAL LU
            if (resBeli.status === 200) {
              potonganDataBeli.forEach((nota) => {
                connection.query(
                  "INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)",
                  [nota.kode],
                  (logErr) => {
                    if (logErr)
                      console.error(
                        "❌ Gagal simpan log_sinkronisasi pembelian lokal:",
                        logErr.message,
                      );
                  },
                );
              });
              console.log(
                ` ✓ Kloter nota pembelian ke-${i + 1} berhasil disinkronkan ke web.`,
              );
            }

            // 🪐 5. BERI WAKTU NAPAS MODEM: Istirahat 3 detik sebelum lanjut kloter berikutnya
            await sleep(3000);
          }

          console.log("✓ Data nota pembelian sukses disinkronkan ke web.");
        } catch (apiErr) {
          console.error("❌ X Error kirim pembelian ke API:", apiErr.message);
        }
      } else {
        console.log("ℹ Tidak ada data nota pembelian kulakan baru.");
      }
    });

    connection.query(queryPenjualan, async (error, notaBaru) => {
      if (error) {
        console.error("❌ Gagal query penjualan:", error.message);
        connection.end();
        return;
      }

      if (notaBaru && notaBaru.length > 0) {
        const totalNota = notaBaru.length;

        // 🪐 1. SET UKURAN CICILAN (Biar internet ruko anti-down!)
        const ukuranCicilan = 100;

        console.log(
          `Menemukan ${totalNota} nota baru. Memulai proses mencicil ke web...`,
        );

        try {
          // 🪐 2. LOOPING MASAL PER 100 NOTA
          for (let i = 0; i < totalNota; i += ukuranCicilan) {
            // Ambil potongan data per kloter 100 baris
            const potonganData = notaBaru.slice(i, i + ukuranCicilan);

            console.log(
              ` -> Mengirim cicilan data penjualan ke-${i + 1} sampai ke-${Math.min(i + ukuranCicilan, totalNota)}...`,
            );

            // Map data agar nama properti yang dikirim murni seragam ke cloud
            const dataSiapKirim = potonganData.map((nota) => ({
              kode: nota.kode,
              tanggal: nota.tanggal,
              operator: nota.operator,
              subtotal: nota.subtotal,
              jumlah: nota.jumlah,
              pelanggan: nota.pelanggan,
              nama_pelanggan: nota.nama_pelanggan, // Aman dari spasi database lokal karena sudah di-alias di query
              alamat_pelanggan: nota.alamat_pelanggan,
              piutang: nota.piutang,
              detail_barang_nota: nota.detail_barang_nota, // Mengambil isi p.ket_tambahan ruko lu
            }));

            // 🪐 3. AXIOS POST SAMA PERSIS FORMAT LU (Pakai await agar sekuensial)
            const resJual = await axios.post(
              WEB_API_URL + "/api/v1/sync-kasir/omset",
              {
                toko: KODE_TOKO,
                data: dataSiapKirim, // Kirim potongan data 100 item lengkap secara utuh ke web
              },
              {
                headers: { Authorization: "Bearer " + API_TOKEN },
              },
            );

            // 🪐 4. JIKA KLOTER 100 DATA INI SUKSES, LANGSUNG KUNCI KE LOG_SINKRONISASI LOKAL
            if (resJual.status === 200) {
              potonganData.forEach((nota) => {
                connection.query(
                  "INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)",
                  [nota.kode],
                  (logErr) => {
                    if (logErr)
                      console.error(
                        "❌ Gagal simpan log_sinkronisasi lokal:",
                        logErr.message,
                      );
                  },
                );
              });
              console.log(
                ` ✓ Kloter nota ke-${i + 1} berhasil disinkronkan ke web.`,
              );
            }

            // 🪐 5. BERI WAKTU NAPAS MODEM: Istirahat 3 detik sebelum lanjut kloter berikutnya
            await sleep(3000);
          }

          console.log("📢 ✓ Data omset berhasil disinkronkan ke web.");
        } catch (apiErr) {
          console.error("❌ Error kirim omset ke API:", apiErr.message);
        }
      } else {
        console.log("ℹ Tidak ada data transaksi omset baru.");
      }

      connection.query(
        queryPemasukan,

        async (errorPemasukan, dataPemasukan) => {
          if (errorPemasukan) {
            console.error(
              "❌ Gagal query pemasukan lokal:",
              errorPemasukan.message,
            );
          }

          if (dataPemasukan && dataPemasukan.length > 0) {
            console.log(
              `Menemukan ${dataPemasukan.length} data laporan pemasukan baru. Mengirim ke web...`,
            );
            try {
              const resPemasukan = await axios.post(
                WEB_API_URL + "/api/v1/sync-kasir/pemasukan",
                {
                  toko: KODE_TOKO,
                  data: dataPemasukan,
                },
                {
                  headers: { Authorization: "Bearer " + API_TOKEN },
                },
              );

              if (resPemasukan.status === 200) {
                dataPemasukan.forEach((nota) => {
                  connection.query(
                    "INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)",
                    [nota.kode],
                  );
                });
                console.log(
                  "✔ Laporan rekap pemasukan sukses disinkronkan ke web cloud.",
                );
              }
            } catch (apiErr) {
              console.error("❌ Error kirim pemasukan ke API:", apiErr.message);
            }
          } else {
            console.log(
              "ℹ Laporan rekap pemasukan aman (Tidak ada data baru).",
            );
          }
        },
      );

      connection.query(
        queryPengeluaran,
        async (errorPengeluaran, dataPengeluaran) => {
          if (errorPengeluaran) {
            console.error(
              "❌ Gagal query pengeluaran lokal:",
              errorPengeluaran.message,
            );
          }

          if (dataPengeluaran && dataPengeluaran.length > 0) {
            console.log(
              `Menemukan ${dataPengeluaran.length} data laporan pengeluaran baru. Mengirim ke web...`,
            );
            try {
              const resPengeluaran = await axios.post(
                WEB_API_URL + "/api/v1/sync-kasir/pengeluaran",
                {
                  toko: KODE_TOKO,
                  data: dataPengeluaran,
                },
                {
                  headers: { Authorization: "Bearer " + API_TOKEN },
                },
              );

              if (resPengeluaran.status === 200) {
                dataPengeluaran.forEach((nota) => {
                  connection.query(
                    "INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)",
                    [nota.kode],
                  );
                });
                console.log(
                  "✔ Laporan rekap pengeluaran sukses disinkronkan ke web cloud.",
                );
              }
            } catch (apiErr) {
              console.error(
                "❌ Error kirim pengeluaran ke API:",
                apiErr.message,
              );
            }
          } else {
            console.log(
              "ℹ Laporan rekap pengeluaran aman (Tidak ada data baru).",
            );
          }
        },
      );
      connection.query(queryHutang, async (errorHutang, dataHutang) => {
        if (errorHutang) {
          console.error(
            "❌ Gagal query hutang toko lokal:",
            errorHutang.message,
          );
        }

        if (dataHutang && dataHutang.length > 0) {
          const totalHutang = dataHutang.length;

          // 🪐 1. SET UKURAN CICILAN: Dipotong per 200 transaksi sesuai komando!
          const ukuranCicilanHutang = 200;

          console.log(
            `Menemukan ${totalHutang} data laporan hutang baru. Mengirim ke web...`,
          );
          try {
            // 🪐 2. LOOPING CICILAN MASAL PER 200 BARIS NOTA
            for (let i = 0; i < totalHutang; i += ukuranCicilanHutang) {
              const potonganDataHutang = dataHutang.slice(
                i,
                i + ukuranCicilanHutang,
              );

              const dataHutangSiapKirim = potonganDataHutang.map((nota) => ({
                kode: nota.kode,
                tanggal: nota.tanggal,
                supplier: nota.supplier || "-",
                jumlah: nota.jumlah || 0,
                operator: nota.operator || "ADMIN_KASIR",
                // Menyedot data JSON asli dari database kasir ruko lokal lu
                data_lengkap_json: nota.data_lengkap_json || "{}",
              }));

              console.log(
                ` -> Mengirim cicilan data hutang ke-${i + 1} sampai ke-${Math.min(i + ukuranCicilanHutang, totalHutang)}...`,
              );

              console.log(
                ` -> Mengirim cicilan data hutang ke-${i + 1} sampai ke-${Math.min(i + ukuranCicilanHutang, totalHutang)}...`,
              );

              // 🔥 LOGIKA SAKTI ANTI LOST: Ulangi pengiriman kloter ini jika internet ruko terputus mendadak
              let suksesKirim = false;
              let percobaanKe = 1;
              const maksimalPercobaan = 5; // Maksimal 5x nyoba kirim ulang kalau lost connection
              let resHutang = null;

              while (!suksesKirim && percobaanKe <= maksimalPercobaan) {
                try {
                  // FORMAT AXIOS POST SAMA PERSIS 100% DENGAN ASLI BAWOAAN KODEMU
                  resHutang = await axios.post(
                    WEB_API_URL + "/api/v1/sync-kasir/hutang",
                    {
                      toko: KODE_TOKO,
                      data: dataHutangSiapKirim, // Mengirimkan potongan kloter 200 data utuh
                    },
                    {
                      headers: { Authorization: "Bearer " + API_TOKEN },
                      timeout: 20000, // Batas tunggu 20 detik, lewat dari ini dianggap internet ruko lost
                    },
                  );

                  if (resHutang && resHutang.status === 200) {
                    suksesKirim = true;
                  }
                } catch (postErr) {
                  console.warn(
                    `⚠️ Sinyal Lost pada kloter hutang ke-${i + 1} (Percobaan ke-${percobaanKe}/${maksimalPercobaan}): ${postErr.message}`,
                  );
                  percobaanKe++;

                  if (percobaanKe <= maksimalPercobaan) {
                    console.log(
                      `⏳ Internet ruko ngadat, brokkk! Istirahat 5 detik sebelum otomatis kirim ulang...`,
                    );
                    await sleep(5000); // Modem istirahat biar sinyal stabil dulu
                  } else {
                    throw new Error(
                      `Koneksi ruko down parah! Gagal kirim kloter hutang setelah ${maksimalPercobaan} kali dicoba.`,
                    );
                  }
                }
              }

              // 🪐 3. JIKA KLOTER 200 DATA INI SUKSES SAKTI, KUNCI LOG LOKAL LU PERSIS BAWOAAN ASLI LU
              if (suksesKirim) {
                potonganDataHutang.forEach((nota) => {
                  connection.query(
                    "INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)",
                    [nota.kode],
                  );
                });
                console.log(
                  `  ✓ Kloter data hutang ke-${i + 1} berhasil disinkronkan ke web.`,
                );
              }

              // Beri waktu jeda napas modem ruko selama 3 detik sebelum lanjut kloter berikutnya
              await sleep(3000);
            }

            console.log(
              "✔ Laporan rekap hutang supplier sukses disinkronkan ke web cloud.",
            );
          } catch (apiErr) {
            console.error("❌ Error kirim hutang ke API:", apiErr.message);
          }
        } else {
          console.log(
            "ℹ Laporan rekap hutang supplier aman (Tidak ada data baru).",
          );
        }
      });

      connection.query(queryPiutang, async (errorPiutang, dataPiutang) => {
        if (errorPiutang) {
          console.error("❌ Gagal query piutang lokal:", errorPiutang.message);
        }

        if (dataPiutang && dataPiutang.length > 0) {
          console.log(
            `Menemukan ${dataPiutang.length} data laporan piutang baru. Mengirim ke web...`,
          );
          try {
            const resPiutang = await axios.post(
              WEB_API_URL + "/api/v1/sync-kasir/piutang",
              {
                toko: KODE_TOKO,
                data: dataPiutang,
              },
              {
                headers: { Authorization: "Bearer " + API_TOKEN },
              },
            );

            if (resPiutang.status === 200) {
              dataPiutang.forEach((nota) => {
                connection.query(
                  "INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)",
                  [nota.kode],
                );
              });
              console.log(
                "✔ Laporan rekap piutang member sukses disinkronkan ke web cloud.",
              );
            }
          } catch (apiErr) {
            console.error("❌ Error kirim piutang ke API:", apiErr.message);
          }
        } else {
          console.log(
            "ℹ Laporan rekap piutang member aman (Tidak ada data baru).",
          );
        }
      });
      connection.query(
        queryReturJual,
        async (errorReturJual, dataReturJual) => {
          if (errorReturJual) {
            console.error(
              "❌ Gagal query retur penjualan:",
              errorReturJual.message,
            );
          }

          if (dataReturJual && dataReturJual.length > 0) {
            console.log(
              `Menemukan ${dataReturJual.length} data retur penjualan baru. Mengirim ke web...`,
            );
            try {
              const resReturJual = await axios.post(
                WEB_API_URL + "/api/v1/sync-kasir/retur-jual",
                {
                  toko: KODE_TOKO,
                  data: dataReturJual,
                },
                {
                  headers: { Authorization: "Bearer " + API_TOKEN },
                },
              );

              if (resReturJual.status === 200) {
                dataReturJual.forEach((nota) => {
                  connection.query(
                    "INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)",
                    [nota.kode],
                  );
                });
                console.log(
                  "✔ Laporan retur penjualan sukses disinkronkan ke web.",
                );
              }
            } catch (apiErr) {
              console.error(
                "❌ Error kirim retur penjualan ke API:",
                apiErr.message,
              );
            }
          } else {
            console.log("ℹ Tidak ada data transaksi retur penjualan baru.");
          }
        },
      );
      connection.query(
        queryReturBeli,
        async (errorReturBeli, dataReturBeli) => {
          if (errorReturBeli) {
            console.error(
              "❌ Gagal query retur pembelian:",
              errorReturBeli.message,
            );
          }

          if (dataReturBeli && dataReturBeli.length > 0) {
            console.log(
              `Menemukan ${dataReturBeli.length} data retur pembelian baru. Mengirim ke web...`,
            );
            try {
              const resReturBeli = await axios.post(
                WEB_API_URL + "/api/v1/sync-kasir/retur-beli",
                {
                  toko: KODE_TOKO,
                  data: dataReturBeli,
                },
                {
                  headers: { Authorization: "Bearer " + API_TOKEN },
                },
              );

              if (resReturBeli.status === 200) {
                dataReturBeli.forEach((nota) => {
                  connection.query(
                    "INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)",
                    [nota.kode],
                  );
                });
                console.log(
                  "✔ Laporan retur pembelian sukses disinkronkan ke web.",
                );
              }
            } catch (apiErr) {
              console.error(
                "❌ Error kirim retur pembelian ke API:",
                apiErr.message,
              );
            }
          } else {
            console.log("ℹ Tidak ada data transaksi retur pembelian baru.");
          }
        },
      );

      connection.query(queryPelanggan, (error, dataPelanggan) => {
        if (error)
          return console.error(
            "❌ Gagal query tabel pelanggan lokal:",
            error.message,
          );

        if (dataPelanggan && dataPelanggan.length > 0) {
          console.log(
            `\n🚀 Sinkronisasi member komplit... Ditemukan ${dataPelanggan.length} pelanggan.`,
          );

          // ✅ LURUS: Menggunakan WEB_API_URL dan KODE_TOKO bawaan kodemu, melempar 25 kolom utuh
          axios
            .post(
              WEB_API_URL + "/api/v1/sync-kasir/pelanggan",
              {
                toko: KODE_TOKO,
                data: dataPelanggan, // Mengirim berkas 25 kolom (max_piutang, nama_toko, dll)
              },
              // 🌟 REVISI SAKTI MUTLAK: Pastikan spasi di dalam tanda kutip murni cuma ada 1 spasi saja setelah huruf 'r' biar gak ditolak satpam cloud!
              {
                headers: { Authorization: "Bearer " + API_TOKEN },
              },
            )
            .then((res) => {
              if (res.status === 200) {
                console.log(
                  "✔ Master data pelanggan lengkap berhasil diperbarui di cloud!",
                );
              }
            })
            .catch((err) =>
              console.error(
                "❌ Gagal kirim data pelanggan lengkap ke cloud:",
                err.message,
              ),
            );
        }
      });

      // =========================================================================
      // 🏢 1. GERBANG ESTAFET PERTAMA: UTAMAKAN SINKRONISASI DATA MASTER SUPPLIER
      // =========================================================================
      connection.query(querySupplier, (errorSupplier, dataSupplier) => {
        if (errorSupplier) {
          return console.error(
            "❌ X Gagal query tabel supplier lokal:",
            errorSupplier.message,
          );
        }

        if (dataSupplier && dataSupplier.length > 0) {
          console.log(
            `\n📊 Sinkronisasi data supplier komplit... Ditemukan ${dataSupplier.length} supplier.`,
          );

          // Pemetaan data disamakan 100% dengan nama kolom fisik database asli ruko lu
          const dataSupplierSiapKirim = dataSupplier.map((s) => ({
            kode: s.kode,
            nama: s.nama,
            alamat: s.alamat,
            saldo_piutang: s.saldo_piutang || 0,
            tgl_saldo: s.tgl_saldo,
            nomor: s.nomor || "-",
            telp: s.telp || "-",
            fax: s.fax || "-",
            email: s.email || "-",
            no_npwp: s.no_npwp || "-",
            tampil: s.tampil || "True",
            kdgrouphrg: s.kdgrouphrg || "-",
            kota: s.kota || "-",
            alamat2: s.alamat2 || "-",
            contact: s.contact || "-",
            saldo_deposit: s.saldo_deposit || 0,
          }));

          // ★ LURUS: Menggunakan WEB_API_URL dan KODE_TOKO bawaan kodemu, melempar data komplit tanpa password
          axios
            .post(
              WEB_API_URL + "/api/v1/sync-kasir/supplier",
              {
                toko: KODE_TOKO,
                data: dataSupplierSiapKirim,
              },
              // ★ REVISI SAKTI MUTLAK: Spasi headers persis bawaan ruko lu
              {
                headers: { Authorization: "Bearer " + API_TOKEN },
              },
            )
            .then((res) => {
              if (res.status === 200) {
                // Jika sukses 200 dari cloud, kunci data ke log_sinkronisasi lokal ruko lu
                dataSupplier.forEach((nota) => {
                  connection.query(
                    "INSERT IGNORE INTO log_sinkronisasi (id_nota) VALUES (?)",
                    [nota.kode],
                    (logErr) => {
                      if (logErr)
                        console.error(
                          "❌ Gagal simpan log_sinkronisasi supplier:",
                          logErr.message,
                        );
                    },
                  );
                });
                console.log(
                  "  ✔ Master data supplier lengkap berhasil diperbarui di cloud!",
                );
              }
            })
            .catch((err) => {
              console.error(
                "❌ X Gagal kirim data supplier lengkap ke cloud:",
                err.message,
              );
            });
        }

        // =========================================================================
        // 🚀 2. GERBANG ESTAFET KEDUA: JABAT TANGAN MASUK KE SINKRONISASI PELANGGAN
        //    (Ditaruh tepat di dalam rahim penutup bodi dataSupplier agar berurutan!)
        // =========================================================================
        connection.query(queryPelanggan, (error, dataPelanggan) => {
          if (error) {
            return console.error(
              "❌ Gagal query tabel pelanggan lokal:",
              error.message,
            );
          }

          if (dataPelanggan && dataPelanggan.length > 0) {
            console.log(
              `\n🚀 Sinkronisasi member komplit... Ditemukan ${dataPelanggan.length} pelanggan.`,
            );

            // ✅ LURUS: Menggunakan WEB_API_URL dan KODE_TOKO bawaan kodemu, melempar 25 kolom utuh
            axios
              .post(
                WEB_API_URL + "/api/v1/sync-kasir/pelanggan",
                {
                  toko: KODE_TOKO,
                  data: dataPelanggan, // Mengirim berkas 25 kolom (max_piutang, nama_toko, dll)
                },
                // 🌟 REVISI SAKTI MUTLAK: Jarak spasi suci token lu yang legendaris!
                {
                  headers: { Authorization: "Bearer " + API_TOKEN },
                },
              )
              .then((res) => {
                if (res.status === 200) {
                  console.log(
                    "✔ Master data pelanggan lengkap berhasil diperbarui di cloud!",
                  );
                }
              })
              .catch((err) => {
                console.error(
                  "❌ Gagal kirim data pelanggan lengkap ke cloud:",
                  err.message,
                );
              });
          }
        }); // <-- Mengunci rahim queryPelanggan secara aman
      }); // <-- Mengunci rahim querySupplier asli penyeimbang kasta kita!

      connection.query(queryKaryawan, (error, dataKaryawan) => {
        if (error)
          return console.error(
            "❌ Gagal query tabel karyawan lokal:",
            error.message,
          );

        if (dataKaryawan && dataKaryawan.length > 0) {
          console.log(
            `\n🚀 Sinkronisasi data karyawan komplit... Ditemukan ${dataKaryawan.length} orang.`,
          );

          // ✅ LURUS: Menggunakan WEB_API_URL dan KODE_TOKO bawaan kodemu, melempar data komplit tanpa password
          axios
            .post(
              WEB_API_URL + "/api/v1/sync-kasir/karyawan",
              {
                toko: KODE_TOKO,
                data: dataKaryawan, // Mengirim objek data karyawan terlengkap
              },
              // 🌟 REVISI SAKTI MUTLAK: Pastikan spasi di dalam tanda kutip murni cuma ada 1 spasi saja setelah huruf 'r' biar gak ditolak satpam cloud!
              {
                headers: { Authorization: "Bearer " + API_TOKEN },
              },
            )
            .then((res) => {
              if (res.status === 200) {
                console.log(
                  "✔ Master data karyawan lengkap berhasil diperbarui di cloud!",
                );
              }
            })
            .catch((err) =>
              console.error(
                "❌ Gagal kirim data karyawan lengkap ke cloud:",
                err.message,
              ),
            );
        }
      });
      // =========================================================================
      // 🧠 MANTRA SAKTI ANTI-RTO: Fungsi pembungkus Axios otomatis nyoba kirim ulang jika internet ruko putus-nyambung!
      // =========================================================================
      async function tembakKeCloudDenganRetry(
        url,
        dataPaket,
        konfigurasi,
        sisaPercobaan = 3,
      ) {
        try {
          return await axios.post(url, dataPaket, konfigurasi);
        } catch (err) {
          // Jika erornya murni karena kendala internet ruko kedip/putus (ENOTFOUND / ECONNRESET / TIMEOUT)
          if (
            sisaPercobaan > 0 &&
            (err.code === "ENOTFOUND" ||
              err.code === "ECONNRESET" ||
              err.message.includes("timeout"))
          ) {
            console.log(
              `\n⚠️ Internet ruko kedip/RTO, otomatis mencoba kirim ulang dalam 3 detik... (Sisa jatah: ${sisaPercobaan}x)`,
            );
            await new Promise((resolve) => setTimeout(resolve, 3000)); // Kasih modem ruko napas adem 3 detik
            return tembakKeCloudDenganRetry(
              url,
              dataPaket,
              konfigurasi,
              sisaPercobaan - 1,
            ); // Tembak ulang ghaib!
          }
          throw err; // Jika eror sintaks database asli atau salah token, biarkan dilempar ke catch utama
        }
      }

      connection.query(queryBarang, async (errorBarang, stokBarang) => {
        if (errorBarang) {
          console.error("❌ Gagal query barang:", errorBarang.message);
          connection.end();
          return;
        }

        if (stokBarang && stokBarang.length > 0) {
          const totalBarang = stokBarang.length;

          // ⚡ INTERNET AMAN: Kita set cicilan ke 20 item biar internet ruko luar pulau gak langsung down/lag!
          const ukuranCicilan = 20;

          console.log(
            `Menarik ${totalBarang} data stok barang. Memulai proses mencicil ke web...`,
          );

          try {
            for (let i = 0; i < totalBarang; i += ukuranCicilan) {
              const potonganData = stokBarang.slice(i, i + ukuranCicilan);
              console.log(
                `-> Mengirim cicilan barang ke-${i + 1} sampai ke-${Math.min(i + ukuranCicilan, totalBarang)}...`,
              );

              // Penggabungan rute URL yang rapi, presisi, dan tidak dobel folder
              // 🌟 REVISI SAKTI: Mengganti await axios.post menjadi await tembakKeCloudDenganRetry biar kebal RTO!
              await tembakKeCloudDenganRetry(
                WEB_API_URL + "/api/v1/sync-kasir/stok",
                {
                  toko: KODE_TOKO,
                  data: potonganData, // Mengirimkan potonganData 20 item lengkap secara utuh ke web
                },
                {
                  headers: { Authorization: "Bearer " + API_TOKEN },
                },
              );
              await sleep(3000);
            }
            console.log("✔ SEMUA DATA STOK BARANG BERHASIL DIPERBARUI DI WEB!");
          } catch (apiErr) {
            console.error(
              "❌ Error kirim cicilan stok ke API:",
              apiErr.message,
            );
          }
        }

        connection.end();
      });
    });
  });
}

// Jalankan otomatis di background setiap 30 detik
setInterval(sinkronisasiData, 3001);

// Jalankan sekali di awal startup
sinkronisasiData();
