# Kilas Studio

Aplikasi web untuk mengelola reservasi dan pendapatan photo studio. Frontend dibuat dengan HTML, CSS, dan JavaScript tanpa framework; data dan autentikasi menggunakan Supabase.

## Fitur

- Login admin melalui Supabase Auth; email admin tampil di profil.
- Empat halaman yang dapat dibuka dari menu samping (juga di tablet dan HP):
  - **Ringkasan**: pendapatan lunas hari ini, jumlah reservasi, rata-rata transaksi, ruangan tersedia, grafik tren, dan reservasi terbaru.
  - **Reservasi**: tabel lengkap dengan filter (semua, hari ini, belum lunas) dan pencarian nama, nomor HP, atau ruangan.
  - **Ruangan**: status setiap ruangan saat ini, jumlah sesi dan jam terpesan hari ini, jadwal berikutnya, serta tombol pesan langsung.
  - **Pendapatan**: total lunas, belum lunas, dan dikembalikan, serta rincian per ruangan dan per metode pembayaran (7 atau 30 hari).
- Tambah, edit, batalkan, dan hapus reservasi.
- Harga dihitung otomatis dari tarif ruangan × durasi.
- Tandai lunas dengan pilihan metode: tunai, QRIS, transfer, atau kartu.
- Pembatalan: slot jadwal tersedia lagi, dan pembayaran yang sudah lunas dicatat sebagai dikembalikan (*refunded*).
- Validasi jadwal di database agar ruangan tidak dipesan pada waktu yang bertabrakan.
- Ikon lonceng membuka daftar tagihan belum lunas.
- Tampilan responsif untuk laptop, tablet, dan HP.

## Teknologi

- HTML, CSS, JavaScript
- Supabase Auth
- Supabase Database (PostgreSQL, PostgREST, dan Row Level Security)

## Struktur Folder

```text
backend/
  app.js          # Server Node.js alternatif; tidak diperlukan untuk mode frontend statis
  schema.sql      # Skema database, trigger, seed ruangan, dan policy RLS
  data-contoh-demo.sql  # Opsional: data contoh 15 reservasi untuk demo (tanggal relatif hari ini)

docs/
  skema-database-reservasi-studio.md  # Dokumentasi tabel, ERD, dan trigger

frontend/
  app.js          # Logika antarmuka, navigasi halaman, dan koneksi langsung ke Supabase
  index.html      # Halaman login dan dashboard
  styles.css      # Tampilan responsif
```

## Menjalankan Aplikasi Tanpa Node.js

Frontend berjalan sebagai situs statis. Cara praktis untuk menjalankannya secara lokal:

1. Buka folder project di VS Code.
2. Pasang extension **Live Server** jika belum tersedia.
3. Klik kanan `frontend/index.html`, lalu pilih **Open with Live Server**.
4. Buka URL lokal yang ditampilkan Live Server.

Jangan memakai URL API lokal `localhost:3000` untuk mode ini. Frontend memanggil Supabase secara langsung dan tidak membutuhkan server Node.js.

### Indikator koneksi

Badge di kanan atas menunjukkan sumber data:

- **Supabase terhubung**: data dibaca dan disimpan di database.
- **Demo lokal**: Supabase tidak dapat dijangkau, sehingga aplikasi menampilkan data contoh yang hanya tersimpan di browser. Periksa koneksi internet dan pastikan project Supabase tidak sedang *paused*.

## Menjalankan Server Node.js (opsional)

`backend/app.js` menyajikan folder `frontend/` sekaligus menyediakan endpoint REST yang meneruskan permintaan ke Supabase. Membutuhkan Node.js 18 atau lebih baru.

```bash
node backend/app.js
```

Endpoint utama: `GET /api/dashboard`, `POST /api/reservations`, `PATCH /api/reservations/:id`, `POST /api/reservations/:id/cancel`, `DELETE /api/reservations/:id`, dan `PATCH /api/payments/:id`. Frontend saat ini tidak memakai endpoint ini.

## Mengunggah ke GitHub melalui Browser

1. Buat repository baru di GitHub.
2. Pada halaman repository, pilih **Add file > Upload files**.
3. Unggah isi project: `README.md`, `.gitignore`, serta folder `backend`, `docs`, dan `frontend`.
4. Periksa daftar file sebelum mengunggah, lalu pilih **Commit changes**.

Jangan unggah file `.env`, password, access token, atau Supabase `service_role` key. File `.gitignore` membantu mengecualikan file tersebut saat memakai Git, tetapi tidak memfilter upload melalui browser. Publishable key pada frontend memang dapat terlihat; pastikan akses database tetap dibatasi oleh RLS.

## Menyiapkan Supabase

1. Buat atau buka project Supabase.
2. Buka **SQL Editor** dan jalankan seluruh isi `backend/schema.sql`.
3. Pastikan tabel, trigger, seed ruangan, dan policy selesai dibuat tanpa error.
4. Di Supabase Dashboard, buka **Authentication > Users** dan buat user admin.
5. Pastikan user dapat login, misalnya dengan mengonfirmasi email saat membuat user.
6. Matikan pendaftaran publik jika hanya admin terpilih yang boleh mengakses aplikasi.
7. Buka frontend melalui Live Server dan login menggunakan kredensial user tersebut.

### Memperbarui database yang sudah ada

`schema.sql` aman dijalankan ulang: tabel dan data yang sudah ada tidak dihapus. Jalankan ulang file ini untuk memasang dua trigger baru (penjaga harga lunas dan sinkronisasi pembayaran). Perlu diketahui, seed ruangan akan mengembalikan nama, tarif, dan kapasitas `ROOM-01` sampai `ROOM-03` ke nilai di file.

Aplikasi tetap berjalan tanpa trigger baru, karena frontend juga melakukan sinkronisasi yang sama. Trigger membuat aturan tersebut berlaku untuk semua jalur, termasuk perubahan langsung di Table Editor.

### Data contoh untuk demo (opsional)

Aplikasi menolak reservasi untuk waktu yang sudah lewat, sehingga data hari-hari sebelumnya tidak bisa dibuat dari antarmuka. Untuk mengisi grafik dan halaman Pendapatan, jalankan `backend/data-contoh-demo.sql` di SQL Editor setelah `schema.sql`. Script ini membuat 15 reservasi contoh dengan tanggal relatif terhadap hari ini, aman dijalankan ulang, dan memuat perintah untuk menghapusnya kembali.

Skema database dan penjelasan relasinya tersedia di [Dokumentasi Skema dan ERD](docs/skema-database-reservasi-studio.md).

## Konfigurasi Supabase

URL project dan publishable key ditulis pada bagian awal `frontend/app.js`. Publishable key memang digunakan dari browser dan bukan pengganti secret key. Jangan pernah menaruh `service_role` key atau secret key di frontend maupun repository GitHub.

Jika menggunakan project Supabase lain, ubah nilai `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` pada `frontend/app.js` (dan variabel lingkungan untuk `backend/app.js`), lalu jalankan skema SQL pada project tersebut.

## Catatan Keamanan

Policy pada `backend/schema.sql` memberi akses penuh (`FOR ALL`) kepada seluruh role `authenticated`. Pengguna yang belum login tidak memperoleh data (hasil query kosong). Policy belum membatasi data berdasarkan peran admin atau kepemilikan record. Untuk penggunaan selain demo/akademik, perketat policy berdasarkan peran dan nonaktifkan pendaftaran publik.

Publishable key dapat dilihat oleh pengguna browser. Keamanan data harus ditegakkan melalui Row Level Security; menyembunyikan publishable key bukan mekanisme pengamanan.

## Batasan Saat Ini

- Data master ruangan ditampilkan dari database, tetapi belum ada halaman untuk menambah atau mengubah ruangan.
- Semua pengguna yang login memiliki hak akses yang sama; belum ada pembagian peran pemilik dan staf.
- Satu reservasi hanya memiliki satu pembayaran; DP atau cicilan belum didukung.
- Dashboard memuat 200 reservasi terbaru.
- Sesi login berlaku sesuai masa token Supabase; setelah habis, admin perlu login kembali.
- Grafik dan rincian pendapatan mengelompokkan transaksi lunas berdasarkan tanggal sesi (`starts_at`), bukan tanggal pelunasan.
- Skema ini untuk reservasi photo studio; tidak mencakup kas, stok, shift, atau transaksi pom bensin.
