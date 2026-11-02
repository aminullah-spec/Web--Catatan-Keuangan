"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authMessage, cloud, cloudConfigured } from "../lib/cloud";
import { decryptJson, deriveRaw, encryptJson, importKey, newSalt } from "../lib/cloudcrypto";
import { isPristine, merge3, same } from "../lib/merge";

const OK_KEY = "catatan-keuangan-lastsync";
const readOk = () => { try { return Number(localStorage.getItem(OK_KEY)) || 0; } catch { return 0; } };

// Sinkronisasi otomatis: kirim perubahan lokal, tarik perubahan dari perangkat lain, gabung per item.
// Data dienkripsi di perangkat dengan "sandi enkripsi" sebelum dikirim ke cloud.
export function useCloudSync({ db, setDb, loadedFor, normalize, store }) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!cloudConfigured);
  const [recovery, setRecovery] = useState(false); // sedang mengatur ulang kata sandi lewat tautan email
  const [status, setStatus] = useState("idle"); // idle | syncing | ok | offline | error | needkey
  const [keyMode, setKeyMode] = useState("enter"); // create | enter (dipakai saat status needkey)
  const [last, setLast] = useState(0);
  const [lastOk, setLastOk] = useState(0);
  const [error, setError] = useState("");

  // "scope" = pemilik data di perangkat ini: id akun (mode cloud) atau "" (tanpa cloud)
  const scope = cloudConfigured ? (user?.id ?? null) : "";
  const loaded = loadedFor !== null && loadedFor === scope;

  const dbRef = useRef(db); dbRef.current = db;
  const userRef = useRef(null); userRef.current = user;
  const loadedRef = useRef(loaded); loadedRef.current = loaded;
  const busy = useRef(false);
  const again = useRef(false);
  const baseRef = useRef(undefined); // undefined = belum dibaca dari penyimpanan
  const keyRef = useRef(null); // { key, salt } | null
  const revRef = useRef(0);

  useEffect(() => { setLastOk(readOk()); }, []);
  useEffect(() => { if (!loaded) { baseRef.current = undefined; keyRef.current = null; } }, [loaded]);

  useEffect(() => {
    const sb = cloud();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => { setUser(data.session?.user || null); setAuthReady(true); }).catch(() => setAuthReady(true));
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setUser(session?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ganti pengguna: status sinkron mulai dari awal
  const uidNow = user?.id || null;
  useEffect(() => { setStatus("idle"); setError(""); setLast(0); }, [uidNow]);

  const needKey = (mode, msg = "") => { keyRef.current = null; setKeyMode(mode); setStatus("needkey"); setError(msg); };

  const syncNow = useCallback(async () => {
    const sb = cloud();
    const u = userRef.current;
    if (!sb || !u || !loadedRef.current) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    setStatus((s) => (s === "needkey" ? s : "syncing"));
    try {
      if (baseRef.current === undefined) { const b = await store.get("base", u.id); baseRef.current = b ? normalize(b) : null; }
      if (!keyRef.current) {
        const saved = await store.get("key", u.id);
        if (saved) keyRef.current = { key: await importKey(saved.raw), salt: saved.salt, raw: saved.raw };
      }

      for (let attempt = 0; attempt < 4; attempt++) {
        const local = dbRef.current;
        const { data: row, error: e1 } = await sb.from("vaults").select("data,rev,salt").eq("user_id", u.id).maybeSingle();
        if (e1) throw e1;

        if (!keyRef.current) return needKey(row ? "enter" : "create");
        const { key, salt } = keyRef.current;
        if (row && row.data?.enc === 1 && row.salt !== salt) { await store.del("key", u.id); return needKey("enter", "Sandi enkripsi di perangkat ini tidak cocok dengan cloud. Masukkan lagi."); }

        let merged = local;
        let rev;
        if (!row) {
          const { error: e2 } = await sb.from("vaults").insert({ user_id: u.id, data: await encryptJson(key, local), salt, rev: 1 });
          if (e2) { if (e2.code === "23505") continue; throw e2; }
          rev = 1;
        } else {
          let remote;
          try { remote = normalize(await decryptJson(key, row.data)); }
          catch { await store.del("key", u.id); return needKey("enter", "Sandi enkripsi salah atau data cloud rusak."); }
          const base = baseRef.current;
          merged = !base && isPristine(local) ? remote : merge3(base, local, remote, !base);
          if (same(merged, remote) && row.data?.enc === 1) rev = row.rev;
          else {
            const { data: upd, error: e3 } = await sb.from("vaults")
              .update({ data: await encryptJson(key, merged), salt, rev: row.rev + 1, updated_at: new Date().toISOString() })
              .eq("user_id", u.id).eq("rev", row.rev).select("rev");
            if (e3) throw e3;
            if (!upd || !upd.length) continue; // perangkat lain menyimpan lebih dulu: ulangi
            rev = upd[0].rev;
          }
        }
        baseRef.current = merged;
        revRef.current = rev;
        await store.set("base", u.id, merged);
        if (!loadedRef.current) return; // terkunci selagi sinkron berjalan: jangan isi data ke layar
        if (!same(merged, local)) setDb((cur) => (cur === local ? merged : merge3(local, cur, merged)));
        const now = Date.now();
        try { localStorage.setItem(OK_KEY, String(now)); } catch {}
        setStatus("ok"); setLast(now); setLastOk(now); setError("");
        return;
      }
      throw new Error("Sinkronisasi bentrok berulang kali. Coba lagi.");
    } catch (e) {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      const msg = authMessage(e);
      if (offline || /koneksi/i.test(msg)) setStatus("offline");
      else {
        setStatus("error");
        const raw = String(e?.message || "");
        setError(/relation|vaults|schema cache|salt/i.test(raw) ? "Tabel database belum dibuat atau belum diperbarui. Jalankan supabase/schema.sql." : msg);
      }
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; setTimeout(() => syncNow(), 300); }
    }
  }, [normalize, setDb, store]);

  // kirim setelah ada perubahan lokal (ditunda sebentar)
  useEffect(() => {
    if (!user || !loaded) return;
    const t = setTimeout(syncNow, 1200);
    return () => clearTimeout(t);
  }, [db, user, loaded, syncNow]);

  // tarik saat aplikasi dibuka kembali, online lagi, tiap 30 detik, dan lewat realtime
  useEffect(() => {
    if (!user || !loaded) return;
    const sb = cloud();
    const on = () => { if (!document.hidden) syncNow(); };
    document.addEventListener("visibilitychange", on);
    window.addEventListener("online", syncNow);
    window.addEventListener("focus", on);
    const iv = setInterval(on, 30000);
    const ch = sb.channel("vault-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "vaults", filter: `user_id=eq.${user.id}` }, (p) => { if (p.new?.rev !== revRef.current) syncNow(); })
      .subscribe();
    return () => {
      document.removeEventListener("visibilitychange", on);
      window.removeEventListener("online", syncNow);
      window.removeEventListener("focus", on);
      clearInterval(iv);
      sb.removeChannel(ch);
    };
  }, [user, loaded, syncNow]);

  const signIn = async (email, password) => {
    const { error: e } = await cloud().auth.signInWithPassword({ email, password });
    if (e) throw new Error(authMessage(e));
  };
  const signUp = async (email, password) => {
    const { data, error: e } = await cloud().auth.signUp({ email, password });
    if (e) throw new Error(authMessage(e));
    return { needsConfirm: !data.session };
  };
  const signOut = async () => {
    const u = userRef.current;
    try { if (u) await store.del("key", u.id); } catch {}
    keyRef.current = null; baseRef.current = undefined;
    await cloud().auth.signOut();
    setStatus("idle");
  };
  const resetPassword = async (email) => {
    const { error: e } = await cloud().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (e) throw new Error(authMessage(e));
  };
  const updatePassword = async (password) => {
    const { error: e } = await cloud().auth.updateUser({ password });
    if (e) throw new Error(authMessage(e));
    setRecovery(false);
  };

  // Menetapkan sandi enkripsi: membuat baru (perangkat pertama) atau memverifikasi sandi yang sudah ada
  const setPassphrase = async (pass) => {
    const sb = cloud(); const u = userRef.current;
    if (!sb || !u) throw new Error("Belum masuk.");
    if (pass.length < 8) throw new Error("Sandi enkripsi minimal 8 karakter.");
    const { data: row, error: e1 } = await sb.from("vaults").select("data,salt").eq("user_id", u.id).maybeSingle();
    if (e1) throw new Error(authMessage(e1));
    const salt = row?.salt || newSalt();
    const raw = await deriveRaw(pass, salt);
    const key = await importKey(raw);
    if (row) { try { await decryptJson(key, row.data); } catch { throw new Error("Sandi enkripsi salah."); } }
    await store.set("key", u.id, { raw, salt });
    keyRef.current = { key, salt, raw };
    setError(""); setStatus("idle");
    syncNow();
  };

  // Riwayat versi di cloud (dibuat otomatis oleh database)
  const listVersions = async () => {
    const sb = cloud(); const u = userRef.current;
    if (!sb || !u || !keyRef.current) throw new Error("Sandi enkripsi belum diatur.");
    const { data, error: e } = await sb.from("vault_versions").select("id,created_at,data").eq("user_id", u.id).order("created_at", { ascending: false }).limit(40);
    if (e) throw new Error(/vault_versions/.test(e.message) ? "Tabel riwayat belum dibuat. Jalankan ulang supabase/schema.sql." : authMessage(e));
    const out = [];
    for (const v of data) {
      try {
        const d = normalize(await decryptJson(keyRef.current.key, v.data));
        const newest = d.tx.reduce((m, t) => (t.date > m ? t.date : m), "");
        out.push({ id: v.id, at: v.created_at, tx: d.tx.length, goals: d.goals.length, wallets: d.wallets.length, newest, data: d });
      } catch {}
    }
    return out;
  };

  const needsAttention = !!user && (status === "error" || status === "offline") && lastOk > 0 && Date.now() - lastOk > 24 * 3600 * 1000;

  return { configured: cloudConfigured, scope, loaded, authReady, recovery, setRecovery, user, status, keyMode, last, lastOk, error, needsAttention, syncNow, signIn, signUp, signOut, resetPassword, updatePassword, setPassphrase, listVersions };
}
