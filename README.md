# Kilas Studio

Aplikasi web untuk mengelola reservasi dan pendapatan self-photo studio. Frontend dibuat dengan HTML, CSS, dan JavaScript tanpa framework; data dan autentikasi menggunakan Supabase.

## Fitur

- Login admin melalui Supabase Auth.
- Ringkasan reservasi dan pendapatan.
- Daftar ruangan studio dan ketersediaannya.
- Tambah, lihat, edit, dan hapus reservasi.
- Pembaruan status pembayaran.
- Pencarian dan filter reservasi.
- Validasi jadwal agar ruangan tidak dipesan pada waktu yang bertabrakan.

## Teknologi

- HTML, CSS, JavaScript
- Supabase Auth
- Supabase Database (PostgreSQL, PostgREST, dan Row Level Security)

## Struktur Folder

```text
backend/
  app.js          # Server Node.js alternatif; tidak diperlukan untuk mode frontend statis
  schema.sql      # Skema database, trigger, seed ruangan, dan policy RLS

docs/
  skema-database-reservasi-studio.md  # Dokumentasi tabel dan ERD

frontend/
  app.js          # Logika antarmuka dan koneksi langsung ke Supabase
  index.html      # Halaman login dan dashboard
  styles.css      # Tampilan responsif
```

## Menjalankan Aplikasi Tanpa Node.js

Frontend berjalan sebagai situs statis. Cara praktis untuk menjalankannya secara lokal:

1. Buka folder project di VS Code.
2. Pasang extension **Live Server** jika belum tersedia.
3. Klik kanan `frontend/index.html`, lalu pilih **Open with Live Server**.
4. Buka URL lokal yang ditampilkan Live Server.

Jangan memakai URL API lokal `localhost:3000` untuk mode ini. Frontend saat ini memanggil Supabase secara langsung dan tidak membutuhkan server Node.js.

## Menyiapkan Supabase

1. Buat atau buka project Supabase.
2. Buka **SQL Editor** dan jalankan seluruh isi `backend/schema.sql`.
3. Pastikan tabel, trigger, seed ruangan, dan policy selesai dibuat tanpa error.
4. Di Supabase Dashboard, buka **Authentication > Users** dan buat user admin.
5. Pastikan user dapat login, misalnya dengan mengonfirmasi email saat membuat user.
6. Matikan pendaftaran publik jika hanya admin terpilih yang boleh mengakses aplikasi.
7. Buka frontend melalui Live Server dan login menggunakan kredensial user tersebut.

Skema database dan penjelasan relasinya tersedia di [Dokumentasi Skema dan ERD](docs/skema-database-reservasi-studio.md).

## Konfigurasi Supabase

URL project dan publishable key saat ini ditulis pada bagian awal `frontend/app.js`. Publishable key memang digunakan dari browser dan bukan pengganti secret key. Jangan pernah menaruh `service_role` key atau secret key di frontend maupun repository GitHub.

Jika menggunakan project Supabase lain, ubah nilai `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` pada `frontend/app.js`, lalu jalankan skema SQL pada project tersebut.

## Catatan Keamanan

Policy pada `backend/schema.sql` memberi akses penuh (`FOR ALL`) kepada seluruh role `authenticated`. Policy tersebut tidak membatasi data berdasarkan admin atau kepemilikan record. Untuk penggunaan selain demo/akademik, perketat policy berdasarkan role admin dan nonaktifkan pendaftaran publik.

Publishable key dapat dilihat oleh pengguna browser. Keamanan data harus ditegakkan melalui Row Level Security; menyembunyikan publishable key bukan mekanisme pengamanan.

## Batasan Saat Ini

- Data master ruangan ditampilkan dari database, tetapi belum ada halaman untuk mengelola ruangan.
- Skema ini untuk reservasi self-photo studio; tidak mencakup kas, stok, shift, atau transaksi pom bensin.
- `backend/app.js` adalah implementasi server Node.js alternatif dan tidak dipakai saat frontend dijalankan secara statis.
