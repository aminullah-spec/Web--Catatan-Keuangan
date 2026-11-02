import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_ = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const cloudConfigured = Boolean(URL_ && KEY_);

let client = null;
export function cloud() {
  if (!cloudConfigured) return null;
  if (!client) client = createClient(URL_, KEY_, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "catatan-keuangan-auth" } });
  return client;
}

export function authMessage(e) {
  const m = String(e?.message || e || "");
  if (/invalid login/i.test(m)) return "Email atau kata sandi salah.";
  if (/already registered|already been registered/i.test(m)) return "Email ini sudah terdaftar. Silakan masuk.";
  if (/email not confirmed/i.test(m)) return "Email belum dikonfirmasi. Cek kotak masuk Anda.";
  if (/rate limit|too many/i.test(m)) return "Terlalu banyak percobaan. Coba lagi beberapa menit lagi.";
  if (/valid email|invalid.*email/i.test(m)) return "Format email tidak valid.";
  if (/not authorized/i.test(m)) return "Email pemulihan belum tersedia untuk alamat ini. Hubungi pengelola aplikasi.";
  if (/signups? not allowed|signup.*disabled/i.test(m)) return "Pendaftaran akun baru sedang ditutup oleh pengelola.";
  if (/weak|at least \d+ char/i.test(m)) return "Kata sandi terlalu lemah. Gunakan minimal 8 karakter.";
  if (/fetch|network/i.test(m)) return "Tidak ada koneksi internet.";
  return m || "Terjadi kesalahan.";
}
