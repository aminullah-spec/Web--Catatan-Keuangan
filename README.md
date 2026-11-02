# Catatan Keuangan - Dashboard (Next.js)

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # hasil statis di folder out/
```

- Data tersimpan di localStorage browser. Gunakan tab **Data** untuk cadangan (JSON), pemulihan, dan ekspor CSV.
- Aplikasi dapat dipasang di HP (PWA). Service worker hanya aktif pada build produksi.
- Deploy di root domain (Vercel/Netlify). Untuk GitHub Pages di sub-folder, path `/sw.js`, `/manifest.webmanifest`, dan ikon perlu disesuaikan.
- Dompet, saldo awal, dan transfer ada di tab **Dompet**. Kategori dapat diubah di tab **Pengaturan**.

- Tampilan HP: menu bawah (Beranda, Riwayat, Catat, Rencana, Lainnya). Foto profil di Lainnya > Profil (disimpan di perangkat, diperkecil ke 256 px).

- Tema Biru Navy (terang, gelap, otomatis) dan keamanan: PIN + kata sandi (enkripsi AES-GCM di perangkat, kode di `lib/security.js`). Lupa PIN dan kata sandi berarti data hanya bisa dipulihkan dari file cadangan.

## Akun dan sinkronisasi (Supabase)

Jika kunci Supabase diisi, aplikasi berjalan dalam **mode akun**:
- Pengguna baru wajib **Daftar** (email dan kata sandi), pengguna lama **Masuk**. Tanpa masuk, aplikasi tidak bisa dibuka.
- Tiap akun punya catatan keuangan sendiri. Data di perangkat juga dipisah per akun, jadi dua orang yang bergantian memakai satu browser tidak saling melihat data.
- Setelah masuk, pengguna membuat **sandi enkripsi** (terpisah dari kata sandi akun). Data dienkripsi di perangkat sebelum dikirim, sehingga pengelola layanan (pemilik proyek Supabase) tidak bisa membacanya.
- Data baru di satu perangkat otomatis muncul di perangkat lain yang masuk dengan akun yang sama (dikirim 1 detik setelah perubahan; ditarik lewat realtime, saat aplikasi dibuka lagi, dan tiap 30 detik). Perubahan dari dua perangkat digabung per transaksi. Saat offline, data tetap tersimpan dan disinkronkan ketika online lagi.
- Lupa PIN aplikasi: pakai "Lupa PIN dan kata sandi?" di layar kunci, lalu masuk dan buka data lagi dengan sandi enkripsi.
- Jika kunci Supabase **tidak** diisi, aplikasi berjalan seperti semula: tanpa akun, data hanya di browser.

### Pemasangan satu kali
1. Buat proyek gratis di https://supabase.com.
2. **SQL Editor**: tempel seluruh isi `supabase/schema.sql`, klik **Run** (aman dijalankan ulang saat memperbarui aplikasi).
3. **Project Settings > API**: salin **Project URL** (tanpa `/rest/v1/`) dan **Publishable key** (`sb_publishable_...`, bukan secret key).
4. Di Vercel/Netlify tambahkan environment variable `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY`, lalu deploy ulang (uji lokal: salin `.env.example` ke `.env.local`).
5. **Authentication > URL Configuration**: isi **Site URL** dengan alamat aplikasi Anda, dan tambahkan alamat itu di **Redirect URLs** (dipakai tautan lupa kata sandi).
6. Atur pendaftaran sesuai tujuan:
   - **Hanya untuk Anda sendiri:** daftarkan akun Anda, lalu matikan **Allow new users to sign up**.
   - **Untuk orang lain:** biarkan pendaftaran terbuka (lihat catatan email di bawah).

### Email konfirmasi dan lupa kata sandi
Layanan email bawaan Supabase hanya mengirim ke alamat anggota tim proyek dan dibatasi sekitar 2 email per jam, jadi tidak cocok untuk pengguna umum. Pilih salah satu:
- **Disarankan untuk pengguna umum:** pasang SMTP sendiri di **Authentication > SMTP Settings** (misalnya Resend atau Brevo, ada paket gratis). Setelah itu **Confirm email** dan **lupa kata sandi** bekerja untuk semua orang.
- **Tanpa SMTP:** matikan **Confirm email**. Pengguna langsung masuk setelah daftar, tetapi tautan lupa kata sandi tidak terkirim ke pengguna biasa. Kata sandi akun yang lupa harus diatur ulang pengelola lewat dashboard (**Authentication > Users**).

### Keamanan dan pemulihan
- **Enkripsi ujung ke ujung:** AES-256-GCM, kunci dari sandi enkripsi lewat PBKDF2. **Jika sandi enkripsi lupa, data di cloud tidak dapat dipulihkan siapa pun**; data di perangkat dan file cadangan tetap bisa dipakai. Sandi enkripsi tidak bisa diubah dari aplikasi.
- **Riwayat versi:** database otomatis menyimpan keadaan sebelum data ditimpa (paling sering sekali per 30 menit, 40 versi terakhir). Pulihkan lewat **Lainnya > Akun dan sinkronisasi > Riwayat versi**.
- **Peringatan sinkron gagal:** jika belum berhasil sinkron lebih dari 1 hari, muncul peringatan di aplikasi. Proyek gratis Supabase dijeda setelah 1 minggu tanpa aktivitas; buka dashboard Supabase dan klik Restore.
- Paket gratis Supabase tidak punya cadangan otomatis dan dibatasi 500 MB database. Jika banyak orang memakainya, pertimbangkan paket berbayar. Anjurkan semua pengguna mengunduh cadangan JSON secara berkala (**Lainnya > Cadangan**).
- Keluar dari akun menawarkan opsi menghapus data akun itu dari perangkat. Pilih hapus jika perangkatnya dipakai bersama.
- Menghapus semua data atau memulihkan cadangan di satu perangkat juga berlaku di perangkat lain.
- Jika dua perangkat mengubah item yang sama pada saat bersamaan, perubahan dari perangkat yang menyinkronkan terakhir yang dipakai.
- Semua kolom kata sandi dan PIN punya tombol mata untuk melihat isinya.

### Data lama (sebelum ada akun)
Data yang sudah ada di browser sebelum memakai versi ini otomatis dipindahkan ke akun pertama yang masuk di perangkat itu.

### Daftar uji setelah pemasangan
1. Buka aplikasi di jendela baru: harus muncul layar Masuk/Daftar.
2. Daftar, buat sandi enkripsi, catat transaksi, lalu keluar.
3. Daftar dengan email kedua: catatan harus kosong (tidak melihat data akun pertama).
4. Masuk lagi dengan akun pertama dan sandi enkripsi: transaksi tadi harus kembali.
5. Masuk dengan akun yang sama di HP: data harus sama; catat di satu perangkat dan cek di perangkat lain.
6. Coba sandi enkripsi yang salah: harus ditolak.
