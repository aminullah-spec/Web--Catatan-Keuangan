"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EXPENSE_CATS, INCOME_CATS, GROUPERS, fmt, monthLabel, pct, prevYm, rupiah, toKey, today, uid } from "../lib/utils";
import { useCloudSync } from "./use-cloud-sync";
import { createSecurity, encryptData, isEncryptedText, readStored, rewrapSecurity, unlockSecurity, verifySecret } from "../lib/security";

const KEY = "catatan-keuangan-v2";
const OLD_KEY = "catatan-keuangan-v1";
const SEC_KEY = "catatan-keuangan-sec-v1";
const FAIL_KEY = "catatan-keuangan-fail";
const PREF_KEY = "catatan-keuangan-lock-timeout";
const THEME_KEY = "catatan-keuangan-theme";
const BASE_KEY = "catatan-keuangan-syncbase";
const CKEY_KEY = "catatan-keuangan-synckey";
const STORE_KEYS = { base: BASE_KEY, key: CKEY_KEY };
const EMPTY = {
  name: "Teman", photo: "", tx: [], budgets: {}, goals: [], recurring: [], done: [], lastBackup: "",
  wallets: [{ id: "w-tunai", name: "Tunai", opening: 0 }],
  transfers: [],
  categories: { expense: EXPENSE_CATS, income: INCOME_CATS },
};
// Melengkapi data lama (versi sebelumnya) dengan bidang baru
const normalize = (d) => {
  const out = { ...EMPTY, ...d };
  if (!Array.isArray(out.wallets) || !out.wallets.length) out.wallets = EMPTY.wallets;
  if (!Array.isArray(out.transfers)) out.transfers = [];
  const c = out.categories || {};
  out.categories = {
    expense: Array.isArray(c.expense) && c.expense.length ? c.expense : EXPENSE_CATS,
    income: Array.isArray(c.income) && c.income.length ? c.income : INCOME_CATS,
  };
  return out;
};
// Transaksi lama tanpa dompet dianggap milik dompet pertama
const walletOf = (t, wallets) => (wallets.some((w) => w.id === t.wallet) ? t.wallet : wallets[0].id);
const TABS = [["overview", "Beranda", "home"], ["history", "Riwayat", "list"], ["plan", "Rencana", "target"], ["more", "Lainnya", "dots"]];
const DONUT = ["#8fd43f", "#0e3b1f", "#c5ef8a", "#5a9e2c", "#9aa89f", "#d6dcd8"];

const ICONS = {
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z", "M12 9a3 3 0 100 6 3 3 0 000-6z"],
  eyeOff: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z", "M3 3l18 18"],
  bell: ["M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2z", "M10 21h4"],
  check: ["M5 12l5 5L20 7"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  home: ["M4 11l8-7 8 7v9H4z"],
  list: ["M5 7h14", "M5 12h14", "M5 17h9"],
  target: ["M12 4a8 8 0 100 16 8 8 0 000-16z", "M12 9a3 3 0 100 6 3 3 0 000-6z"],
  dots: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  chev: ["M9 6l6 6-6 6"],
  search: ["M11 5a6 6 0 100 12 6 6 0 000-12z", "M20 20l-4-4"],
  lock: ["M6 11h12v9H6z", "M8 11V8a4 4 0 018 0v3"],
};
function Icon({ n, size = 18, sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={n === "dots" ? 3.5 : sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[n].map((d) => (<path key={d} d={d} />))}
    </svg>
  );
}

const sumBy = (list, type) => list.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
const byCat = (list, type) => {
  const m = {};
  list.filter((t) => t.type === type).forEach((t) => (m[t.category] = (m[t.category] || 0) + t.amount));
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

const pad2 = (n) => String(n).padStart(2, "0");
const niceMax = (v) => {
  if (v <= 0) return 100000;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};
const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}jt`.replace(".", ",") : n >= 1e3 ? `${Math.round(n / 1e3)}rb` : String(Math.round(n)));
const mini = (vals) => {
  const mx = Math.max(1, ...vals.map(Math.abs));
  return vals.map((v) => 6 + Math.round((Math.abs(v) / mx) * 46));
};
const TITLES = { overview: "Beranda", history: "Riwayat", plan: "Rencana", more: "Lainnya" };

export default function Home() {
  const [db, setDb] = useState(EMPTY);
  const [loadedFor, setLoadedFor] = useState(null); // milik siapa data yang sedang dimuat
  const [locked, setLocked] = useState(false);
  const [fatal, setFatal] = useState(false);
  const [sec, setSec] = useState(null);
  const [lockTimeout, setLockTimeoutState] = useState(60);
  const [theme, setThemeState] = useState("auto");
  const [tab, setTab] = useState("overview");
  const [month, setMonth] = useState("");
  const [hide, setHide] = useState(false);
  const [planView, setPlanView] = useState("budget");
  const [moreView, setMoreView] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [q, setQ] = useState("");
  const sessionRef = useRef(null);
  const saveSeq = useRef(0);

  // salinan terakhir yang sudah sinkron dan kunci cloud, per akun; ikut dienkripsi bila PIN aktif
  const store = useMemo(() => ({
    async get(name, uid) {
      try {
        const raw = localStorage.getItem(`${STORE_KEYS[name]}:${uid}`);
        if (!raw) return null;
        const p = isEncryptedText(raw) ? (sessionRef.current ? await readStored(sessionRef.current, raw) : null) : JSON.parse(raw);
        return p && p.uid === uid ? p.data : null;
      } catch { return null; }
    },
    async set(name, uid, data) {
      try {
        const payload = { uid, data };
        localStorage.setItem(`${STORE_KEYS[name]}:${uid}`, sessionRef.current ? await encryptData(sessionRef.current, payload) : JSON.stringify(payload));
      } catch {}
    },
    async del(name, uid) { try { localStorage.removeItem(`${STORE_KEYS[name]}:${uid}`); } catch {} },
  }), []);
  const sync = useCloudSync({ db, setDb, loadedFor, normalize, store });
  const { scope, loaded } = sync;
  const K = (base) => (scope ? `${base}:${scope}` : base); // kunci penyimpanan milik akun ini
  const multi = sync.configured; // mode akun: wajib masuk lebih dulu

  // data lama (sebelum ada akun) dipindahkan ke akun pertama yang masuk di perangkat ini
  function migrateLegacy(uid) {
    try {
      if (localStorage.getItem(`${KEY}:${uid}`) || localStorage.getItem(`${SEC_KEY}:${uid}`)) return;
      if (!localStorage.getItem(KEY) && !localStorage.getItem(SEC_KEY) && !localStorage.getItem(OLD_KEY)) return;
      for (const k of [BASE_KEY, CKEY_KEY]) { // pernah tersinkron dengan akun lain: jangan diambil
        const raw = localStorage.getItem(k);
        if (raw && !isEncryptedText(raw)) { const p = JSON.parse(raw); if (p && p.uid && p.uid !== uid) return; }
      }
      for (const k of [KEY, OLD_KEY, SEC_KEY, FAIL_KEY, BASE_KEY, CKEY_KEY]) {
        const v = localStorage.getItem(k);
        if (v !== null) { localStorage.setItem(`${k}:${uid}`, v); localStorage.removeItem(k); }
      }
    } catch {}
  }

  // ---- muat data milik akun ini (terkunci atau biasa); diulang saat ganti akun ----
  useEffect(() => {
    try { const t = localStorage.getItem(THEME_KEY); if (t) setThemeState(t); } catch {}
    try { const v = localStorage.getItem(PREF_KEY); if (v !== null) setLockTimeoutState(Number(v)); } catch {}
    saveSeq.current++;
    sessionRef.current = null;
    setLoadedFor(null); setLocked(false); setFatal(false); setSec(null); setDb(EMPTY);
    setModal(null); setTab("overview"); setMoreView(null);
    if (scope === null) return; // belum masuk
    if (scope) migrateLegacy(scope);
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(K(SEC_KEY)) || "null"); } catch {}
    if (rec) { setSec(rec); setLocked(true); return; }
    try {
      const raw = localStorage.getItem(K(KEY));
      if (raw && isEncryptedText(raw)) { setFatal(true); return; } // terenkripsi tetapi catatan kunci hilang
      if (raw) setDb(normalize(JSON.parse(raw)));
      else {
        const old = localStorage.getItem(K(OLD_KEY)); // migrasi dari versi 1
        if (old) setDb(normalize({ tx: JSON.parse(old) }));
      }
    } catch {}
    setMonth(today().slice(0, 7));
    setLoadedFor(scope);
  }, [scope]);

  useEffect(() => {
    const el = document.documentElement;
    if (theme === "auto") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  // ---- simpan (dienkripsi jika kunci aktif) ----
  useEffect(() => {
    if (!loaded) return;
    const my = ++saveSeq.current;
    const key = K(KEY);
    (async () => {
      try {
        const text = sec && sessionRef.current ? await encryptData(sessionRef.current, db) : JSON.stringify(db);
        if (my === saveSeq.current) localStorage.setItem(key, text);
      } catch {}
    })();
  }, [db, loaded, sec]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const lockNow = useCallback(() => {
    saveSeq.current++;
    sessionRef.current = null;
    setDb(EMPTY);
    setLoadedFor(null);
    setModal(null);
    setTab("overview");
    setMoreView(null);
    setLocked(true);
  }, []);

  useEffect(() => {
    if (!sec || !loaded || !lockTimeout) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > lockTimeout * 1000) lockNow();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sec, loaded, lockTimeout, lockNow]);

  const setLockTimeout = (v) => { setLockTimeoutState(v); try { localStorage.setItem(PREF_KEY, String(v)); } catch {} };

  async function unlock(secret, kind) {
    const session = await unlockSecurity(sec, secret, kind);
    const raw = localStorage.getItem(K(KEY));
    const data = raw ? await readStored(session, raw) : {};
    sessionRef.current = session;
    setDb(normalize(data));
    setMonth(today().slice(0, 7));
    setLocked(false);
    setLoadedFor(scope);
  }

  const wipeLocal = (sc) => {
    const suffix = sc ? `:${sc}` : "";
    try { [KEY, OLD_KEY, SEC_KEY, FAIL_KEY, BASE_KEY, CKEY_KEY].forEach((k) => localStorage.removeItem(k + suffix)); } catch {}
  };

  function resetAll() {
    const msg = multi
      ? "Ketik HAPUS untuk menghapus data akun ini dari perangkat ini (termasuk PIN dan kata sandi aplikasi). Data di cloud tetap aman dan bisa diambil lagi dengan sandi enkripsi."
      : "Ketik HAPUS untuk menghapus semua data dan mengatur ulang aplikasi.";
    if (window.prompt(msg) !== "HAPUS") return;
    saveSeq.current++;
    wipeLocal(scope);
    sessionRef.current = null;
    setSec(null); setDb(EMPTY); setMonth(today().slice(0, 7));
    setLocked(false); setFatal(false); setLoadedFor(scope);
  }

  // keluar dari akun: kembali ke layar masuk
  async function logout() {
    if (!window.confirm("Keluar dari akun ini?")) return;
    const wipe = window.confirm("Hapus juga data akun ini dari perangkat ini? Data tetap aman di cloud dan bisa diambil lagi setelah masuk. Pilih OK jika ini perangkat bersama.");
    const sc = scope;
    saveSeq.current++;
    await sync.signOut();
    if (wipe) wipeLocal(sc);
  }

  const secApi = {
    async enable(password, pin) {
      const { record, session } = await createSecurity(password, pin);
      localStorage.setItem(K(SEC_KEY), JSON.stringify(record)); // catatan kunci lebih dulu, baru data
      localStorage.setItem(K(KEY), await encryptData(session, db));
      for (const k of [BASE_KEY, CKEY_KEY]) { try { const b = localStorage.getItem(K(k)); if (b && !isEncryptedText(b)) localStorage.setItem(K(k), await encryptData(session, JSON.parse(b))); } catch {} }
      sessionRef.current = session;
      setSec(record);
    },
    async changePin(current, pin) {
      if (!(await verifySecret(sec, current, "password"))) throw new Error("Kata sandi saat ini salah.");
      const record = await rewrapSecurity(sec, sessionRef.current, { pin });
      localStorage.setItem(K(SEC_KEY), JSON.stringify(record));
      setSec(record);
    },
    async changePassword(current, password) {
      if (!(await verifySecret(sec, current, "password"))) throw new Error("Kata sandi saat ini salah.");
      const record = await rewrapSecurity(sec, sessionRef.current, { password });
      localStorage.setItem(K(SEC_KEY), JSON.stringify(record));
      setSec(record);
    },
    async disable(current) {
      if (!(await verifySecret(sec, current, "password"))) throw new Error("Kata sandi salah.");
      localStorage.setItem(K(KEY), JSON.stringify(db)); // data biasa dulu, baru hapus catatan kunci
      for (const k of [BASE_KEY, CKEY_KEY]) { try { const b = localStorage.getItem(K(k)); if (b && isEncryptedText(b)) localStorage.setItem(K(k), JSON.stringify(await readStored(sessionRef.current, b))); } catch {} }
      localStorage.removeItem(K(SEC_KEY));
      sessionRef.current = null;
      setSec(null);
    },
  };

  // ---- turunan data ----
  const nowYm = loaded ? today().slice(0, 7) : "";
  const tx = db.tx;
  const saved = db.goals.reduce((s, g) => s + g.saved, 0);
  const wallets = db.wallets;
  const walletBal = Object.fromEntries(wallets.map((w) => [w.id, Number(w.opening) || 0]));
  tx.forEach((t) => { walletBal[walletOf(t, wallets)] += t.type === "income" ? t.amount : -t.amount; });
  db.transfers.forEach((x) => {
    if (x.from in walletBal) walletBal[x.from] -= x.amount;
    if (x.to in walletBal) walletBal[x.to] += x.amount;
  });
  const balance = Object.values(walletBal).reduce((a, b) => a + b, 0) - saved;
  const walletName = (t) => wallets.find((w) => w.id === walletOf(t, wallets))?.name || "";
  const wname = (t) => (wallets.length > 1 ? walletName(t) : "");

  const mTx = useMemo(() => tx.filter((t) => t.date.startsWith(month)), [tx, month]);
  const pTx = useMemo(() => tx.filter((t) => t.date.startsWith(prevYm(month || "2000-01"))), [tx, month]);
  const months = useMemo(() => [...new Set([nowYm, month, ...tx.map((t) => t.date.slice(0, 7))].filter(Boolean))].sort().reverse(), [tx, nowYm, month]);

  const pending = useMemo(() => {
    if (!loaded) return [];
    return db.recurring
      .map((r) => ({ ...r, due: `${nowYm}-${String(r.day).padStart(2, "0")}`, k: `${r.id}-${nowYm}` }))
      .filter((r) => today() >= r.due && !db.done.includes(r.k));
  }, [db.recurring, db.done, nowYm, loaded]);

  const spentNow = useMemo(() => Object.fromEntries(byCat(tx.filter((t) => t.date.startsWith(nowYm)), "expense")), [tx, nowYm]);
  const overBudget = Object.entries(db.budgets).filter(([c, b]) => b > 0 && (spentNow[c] || 0) >= b * 0.8);
  const alerts = pending.length + overBudget.length;

  const update = (patch) => setDb((d) => ({ ...d, ...patch }));
  const addTx = (t) => setDb((d) => ({ ...d, tx: [{ id: uid(), ...t }, ...d.tx] }));
  const removeTx = (id) => {
    const gone = db.tx.find((t) => t.id === id);
    if (!gone) return;
    setDb((d) => ({ ...d, tx: d.tx.filter((t) => t.id !== id) }));
    setToast({ msg: "Transaksi dihapus.", restore: gone });
  };
  const undoRemove = () => {
    if (!toast?.restore) return;
    const r = toast.restore;
    setDb((d) => ({ ...d, tx: d.tx.some((t) => t.id === r.id) ? d.tx : [r, ...d.tx] }));
    setToast(null);
  };
  const editTx = (id, patch) => setDb((d) => ({ ...d, tx: d.tx.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const confirmPending = (r) => {
    addTx({ type: r.type, amount: r.amount, category: r.category, date: r.due, note: r.note, wallet: r.wallet });
    update({ done: [...db.done, r.k] });
  };

  function exportCsv() {
    const rows = [["Tanggal", "Jenis", "Kategori", "Dompet", "Jumlah", "Catatan"]].concat(
      [...tx].sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => [t.date, t.type === "income" ? "Pemasukan" : "Pengeluaran", t.category, walletName(t), t.amount, `"${(t.note || "").replace(/"/g, '""')}"`])
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = "catatan-keuangan.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (multi && !sync.authReady) return <div className="loading">Memuat...</div>;
  if (multi && sync.recovery) return <RecoveryScreen sync={sync} />;
  if (multi && !sync.user) return <AuthScreen sync={sync} />;
  if (fatal) {
    return (
      <div className="lock"><div className="lock-card">
        <h1>Data terkunci tidak dapat dibuka</h1>
        <p>Data tersimpan terenkripsi, tetapi pengaturan kunci tidak ditemukan. Jika Anda punya file cadangan, mulai ulang aplikasi lalu pulihkan dari cadangan.</p>
        <button className="btn light big" onClick={resetAll}>Hapus dan mulai ulang</button>
      </div></div>
    );
  }
  if (locked) return <LockScreen pinLen={sec?.pinLen || 4} onUnlock={unlock} onReset={resetAll} failKey={K(FAIL_KEY)} />;
  if (!loaded) return <div className="loading">Memuat...</div>;
  if (multi && sync.status === "needkey") return <KeyGate sync={sync} onLogout={logout} />;

  // ---- nilai tampilan ----
  const money = (n) => (hide ? "Rp ••••••" : rupiah(n));
  const mIncome = sumBy(mTx, "income");
  const mExpense = sumBy(mTx, "expense");
  const pIncome = sumBy(pTx, "income");
  const pExpense = sumBy(pTx, "expense");
  const net = mIncome - mExpense;
  const expCats = byCat(mTx, "expense");
  const prevCats = Object.fromEntries(byCat(pTx, "expense"));
  const expDelta = pct(mExpense, pExpense);
  const incDelta = pct(mIncome, pIncome);
  const netDelta = pct(net, pIncome - pExpense);
  const spentSel = Object.fromEntries(expCats);

  let insight = "Belum ada data pembanding bulan lalu";
  const rises = expCats.filter(([c, a]) => prevCats[c] > 0 && a > prevCats[c]).map(([c, a]) => [c, pct(a, prevCats[c])]).sort((a, b) => b[1] - a[1]);
  if (rises.length) insight = `Pengeluaran ${rises[0][0]} naik ${rises[0][1]}% dari bulan lalu`;
  else if (expDelta !== null && expDelta <= 0) insight = `Pengeluaran turun ${Math.abs(expDelta)}% dari bulan lalu`;

  const recent = [...tx].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);

  // 7 hari terakhir untuk batang kecil
  const days7 = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return toKey(d); });
  const series = (fn) => days7.map((k) => tx.filter((t) => t.date === k).reduce((s, t) => s + fn(t), 0));
  const inc7 = series((t) => (t.type === "income" ? t.amount : 0));
  const exp7 = series((t) => (t.type === "expense" ? t.amount : 0));
  const net7 = inc7.map((v, i) => v - exp7[i]);

  // grafik pengeluaran harian
  const [cy, cm] = (month || nowYm).split("-").map(Number);
  const dim = new Date(cy, cm, 0).getDate();
  const elapsed = month === nowYm ? new Date().getDate() : dim;
  const daily = Array.from({ length: dim }, (_, i) => mTx.filter((t) => t.type === "expense" && t.date === `${month}-${pad2(i + 1)}`).reduce((s, t) => s + t.amount, 0));
  const maxD = Math.max(0, ...daily);
  const scale = niceMax(maxD);
  const peak = maxD > 0 ? daily.indexOf(maxD) : -1;
  const avg = elapsed ? daily.slice(0, elapsed).reduce((a, b) => a + b, 0) / elapsed : 0;
  const H = 200;
  const xlabels = [1, 5, 10, 15, 20, 25, dim];

  const budgetRows = Object.entries(db.budgets)
    .filter(([, b]) => Number(b) > 0)
    .map(([c, b]) => ({ c, b: Number(b), s: spentSel[c] || 0 }))
    .map((r) => ({ ...r, p: Math.round((r.s / r.b) * 100) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 4);
  const worst = budgetRows.find((r) => r.s > r.b);
  const needAttn = budgetRows.filter((r) => r.p >= 80).length;

  const greet = db.name.trim() || "Teman";
  const go = (k) => { setTab(k); if (k === "more") setMoreView(null); window.scrollTo({ top: 0 }); };
  const goPlan = (v) => { setPlanView(v); setTab("plan"); window.scrollTo({ top: 0 }); };
  const openSync = () => { setMoreView("sync"); setTab("more"); window.scrollTo({ top: 0 }); };
  const openProfile = () => { setMoreView("profile"); setTab("more"); window.scrollTo({ top: 0 }); };
  const shownPending = pending.slice(0, 2);
  const planBadge = overBudget.length;

  const kpi = (label, value, delta, vals, cls, bad) => (
    <div className={"card kpi" + (cls ? " " + cls : "")}>
      <div>
        <p className="k">{label}</p>
        <p className="v">{value}</p>
        {delta !== null && <p className="d"><b className={bad && delta > 0 ? "n" : ""}>{delta > 0 ? "+" : ""}{delta}%</b> vs bulan lalu</p>}
      </div>
      <div className="mb" aria-hidden="true">{mini(vals).map((h, i) => (<i key={i} className={i < 4 ? "o" : ""} style={{ height: h }} />))}</div>
    </div>
  );

  return (
    <div className="stage">
      <div className="app">
        <aside className="side">
          <div className="logo"><span className="mark" aria-hidden="true"><i /><i /><i /></span>Keuangan</div>
          <label className="srch"><Icon n="search" /><input placeholder="Cari transaksi..." aria-label="Cari transaksi" value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value) setTab("history"); }} /></label>
          <p className="lbl">MENU</p>
          <nav className="nv" aria-label="Menu utama">
            {TABS.map(([k, l, ic]) => (
              <button key={k} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => go(k)}>
                <span className="ni"><Icon n={ic} /></span>{l}
                {k === "plan" && planBadge > 0 && <span className="bd">{planBadge}</span>}
              </button>
            ))}
          </nav>
          <div className="usr">
            <Avatar photo={db.photo} name={greet} size={40} />
            <button className="who" onClick={openProfile}><b>{greet}</b><small>{db.lastBackup ? `Cadangan ${fmt(db.lastBackup.slice(0, 10), { day: "numeric", month: "short" })}` : "Belum ada cadangan"}</small></button>
            {sec && <button className="lockb" onClick={lockNow} aria-label="Kunci aplikasi"><Icon n="lock" /></button>}
          </div>
        </aside>

        <main className="main">
          <header className="top">
            <button className="who" onClick={openProfile} aria-label="Buka profil">
              <Avatar photo={db.photo} name={greet} />
              <span className="hello">Halo, {greet}</span>
            </button>
            <div className="hr">
              <SyncBadge sync={sync} onClick={openSync} />
              <button className="bell" onClick={() => (pending.length ? go("overview") : goPlan("budget"))} aria-label={`${alerts} pemberitahuan`}>
                <Icon n="bell" /><b>{alerts}</b>
              </button>
            </div>
          </header>
          <header className="head">
            <h1>{TITLES[tab]}</h1>
            <div className="hr">
              <SyncBadge sync={sync} onClick={openSync} />
              <button className="bell" onClick={() => (pending.length ? go("overview") : goPlan("budget"))} aria-label={`${alerts} pemberitahuan`}>
                <Icon n="bell" /><b>{alerts}</b>
              </button>
              <button className="cta" onClick={() => setModal({ type: "expense" })}><Icon n="plus" /> Catat transaksi</button>
            </div>
          </header>

          <SyncWarning sync={sync} onClick={openSync} />

          {tab === "overview" && (
            <>
              <div className="alerts">
                {shownPending.map((r) => (
                  <div key={r.k} className="pending-card">
                    <div>
                      <strong>{r.note || r.category} {rupiah(r.amount)}</strong>
                      <small>{r.due === today() ? "Jatuh tempo hari ini" : `Jatuh tempo ${fmt(r.due, { day: "numeric", month: "short" })}`}</small>
                    </div>
                    <div className="pc-btns">
                      <button className="chip on" onClick={() => confirmPending(r)}>Catat</button>
                      <button className="chip" onClick={() => update({ done: [...db.done, r.k] })}>Lewati</button>
                    </div>
                  </div>
                ))}
                {pending.length > 2 && <button className="link" onClick={() => goPlan("recurring")}>+{pending.length - 2} tagihan lainnya</button>}
                {overBudget.length > 0 && <button className="warn-pill" onClick={() => goPlan("budget")}>{overBudget.length} anggaran hampir habis atau terlampaui</button>}
              </div>

              <div className="dash">
                {kpi("Sisa bulan ini", rupiah(net), netDelta, net7, "hero-k")}
                {kpi(`Pemasukan, ${monthLabel(month)}`, rupiah(mIncome), incDelta, inc7)}
                {kpi(`Pengeluaran, ${monthLabel(month)}`, rupiah(mExpense), expDelta, exp7, "", true)}

                <section className="card chart span2">
                  <div className="cth">
                    <h2>Pengeluaran harian</h2>
                    <select className="pill-select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Pilih bulan">
                      {months.map((m) => (<option key={m} value={m}>{monthLabel(m)}</option>))}
                    </select>
                  </div>
                  <div className="plot" role="img" aria-label={`Grafik pengeluaran harian ${monthLabel(month)}. Rata-rata ${rupiah(avg)} per hari.`}>
                    <div className="yl">{[0, 1, 2, 3, 4, 5].map((i) => (<span key={i}>{i === 0 ? "0" : short((scale * i) / 5)}</span>))}</div>
                    <div className="bx">
                      {avg > 0 && <div className="avg" style={{ bottom: Math.min(H, (avg / scale) * H) }}><span>rata-rata {rupiah(avg)}</span></div>}
                      {peak >= 0 && <div className="tip" style={{ left: `${((peak + 0.5) / dim) * 100}%`, bottom: (maxD / scale) * H + 8 }}>{fmt(`${month}-${pad2(peak + 1)}`, { day: "numeric", month: "short" })}, {rupiah(maxD)}</div>}
                      <div className="row">
                        {daily.map((v, i) => (<i key={i} className={i >= elapsed ? "f" : i === peak ? "hi" : ""} style={{ height: (v / scale) * H }} />))}
                      </div>
                      <div className="xl">{xlabels.map((d) => (<span key={d}>{d}</span>))}</div>
                    </div>
                  </div>
                </section>

                <section className="card gc">
                  <div className="gtop"><span>Saldo tersedia</span><button className="round sm" onClick={() => setHide(!hide)} aria-label={hide ? "Tampilkan saldo" : "Sembunyikan saldo"}><Icon n={hide ? "eyeOff" : "eye"} /></button></div>
                  <p className="gbig">{money(balance)}</p>
                  <p className="gd"><b className={net >= 0 ? "pos" : "neg"}>{net >= 0 ? "+" : ""}{rupiah(net)}</b> selisih bulan ini</p>
                  {wallets.map((w) => (
                    <div className="wr" key={w.id}><span className="wi">{w.name[0]}</span><div><b>{w.name}</b><small>{money(walletBal[w.id])}</small></div></div>
                  ))}
                  {saved > 0 && <div className="wr"><span className="wi"><Icon n="target" /></span><div><b>Tabungan</b><small>{money(saved)} sudah dikurangkan dari saldo</small></div></div>}
                </section>

                <section className="card tbl span2">
                  <div className="c-head"><h2>Transaksi terbaru</h2><button className="link" onClick={() => go("history")}>Lihat semua</button></div>
                  <div className="tr h"><span>Tanggal</span><span>Kategori</span><span>Dompet</span><span>Catatan</span><span>Jumlah</span></div>
                  {recent.map((t) => (
                    <div className="tr" key={t.id}>
                      <span>{fmt(t.date, { day: "numeric", month: "short" })}</span>
                      <span><span className="chp">{t.category}</span></span>
                      <span>{walletName(t)}</span>
                      <span>{t.note || "-"}</span>
                      <b className={t.type === "income" ? "pos" : "neg"}>{t.type === "income" ? "+" : "-"}{rupiah(t.amount)}</b>
                    </div>
                  ))}
                  {!recent.length && <p className="muted">Belum ada transaksi. Klik Catat transaksi untuk mulai.</p>}
                </section>

                <section className="card bdg">
                  <div className="cth"><h2>Anggaran</h2>{needAttn > 0 && <span className="chp">{needAttn} perlu perhatian</span>}</div>
                  {budgetRows.map((r) => (
                    <div className="bg" key={r.c}>
                      <div className="t"><span>{r.c}</span><b>{r.p}%</b></div>
                      <div className="tk"><i className={r.p > 100 ? "r" : r.p >= 80 ? "w" : ""} style={{ width: `${Math.min(100, r.p)}%` }} /></div>
                    </div>
                  ))}
                  {!budgetRows.length && <p className="empty">Belum ada anggaran. Atur batas per kategori di menu Rencana.</p>}
                  {worst && <div className="call"><b>{worst.c} melebihi {rupiah(worst.s - worst.b)}</b>Batas {rupiah(worst.b)}, terpakai {rupiah(worst.s)}</div>}
                </section>
              </div>

              <div className="mob">
                <section className="hero">
                  <p className="lbl-s">Saldo tersedia</p>
                  <div className="big">
                    <span>{money(balance)}</span>
                    <button className="round sm" onClick={() => setHide(!hide)} aria-label={hide ? "Tampilkan saldo" : "Sembunyikan saldo"}><Icon n={hide ? "eyeOff" : "eye"} /></button>
                  </div>
                  <ul className="wchips" aria-label="Saldo per dompet">
                    {wallets.map((w) => (<li key={w.id}><small>{w.name}</small><strong>{money(walletBal[w.id])}</strong></li>))}
                  </ul>
                  {saved > 0 && <p className="hint">Setelah tabungan {money(saved)}</p>}
                </section>
                <div className="stats">
                  <div className="card"><small>Masuk, {monthLabel(month)}</small><b className="pos">{rupiah(mIncome)}</b></div>
                  <div className="card"><small>Keluar, {monthLabel(month)}</small><b className="neg">{rupiah(mExpense)}</b></div>
                </div>
                <p className="insight">{insight}</p>
                <section className="card recent">
                  <div className="c-head"><h2>Terbaru</h2><button className="link" onClick={() => go("history")}>Lihat semua</button></div>
                  <ul className="tlist">
                    {recent.map((t, i) => (
                      <li key={t.id} className={i >= 3 ? "extra" : ""}>
                        <span className={"ico " + t.type}>{t.category[0]}</span>
                        <div><strong>{t.note || t.category}</strong><small>{fmt(t.date, { day: "numeric", month: "short" })}{wname(t) ? `, ${wname(t)}` : ""}</small></div>
                        <span className={"amt " + (t.type === "income" ? "pos" : "neg")}>{t.type === "income" ? "+" : "-"}{rupiah(t.amount)}</span>
                      </li>
                    ))}
                    {!recent.length && <li className="muted">Belum ada transaksi. Ketuk tombol + di bawah untuk mulai.</li>}
                  </ul>
                </section>
              </div>
            </>
          )}

          {tab === "history" && <HistoryTab tx={tx} months={months} onDelete={removeTx} onEdit={(t) => setModal({ type: t.type, tx: t })} wname={wname} q={q} setQ={setQ} />}
          {tab === "plan" && <PlanPanel db={db} update={update} spent={spentNow} balance={balance} money={money} view={planView} setView={setPlanView} />}
          {tab === "more" && <MorePanel view={moreView} setView={setMoreView} db={db} setDb={setDb} update={update} exportCsv={exportCsv} walletBal={walletBal} sec={sec} secApi={secApi} lockTimeout={lockTimeout} setLockTimeout={setLockTimeout} theme={theme} setTheme={setThemeState} onLockNow={lockNow} sync={sync} onLogout={logout} />}
        </main>
      </div>

      <nav className="bnav" aria-label="Menu utama">
        {TABS.slice(0, 2).map(([k, l, ic]) => (<button key={k} className={"ni" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => go(k)}><Icon n={ic} size={22} /><span>{l}</span></button>))}
        <button className="fab" onClick={() => setModal({ type: "expense" })} aria-label="Catat transaksi"><Icon n="plus" size={26} /></button>
        {TABS.slice(2).map(([k, l, ic]) => (<button key={k} className={"ni" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => go(k)}><Icon n={ic} size={22} /><span>{l}</span></button>))}
      </nav>

      {modal && <TxModal type={modal.type} initial={modal.tx} wallets={wallets} cats={db.categories} onClose={() => setModal(null)} onSave={(t) => { if (modal.tx) editTx(modal.tx.id, t); else addTx(t); setModal(null); }} />}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {toast.restore && <button onClick={undoRemove}>Urungkan</button>}
        </div>
      )}
    </div>
  );
}

function TxModal({ type: type0, initial, wallets, cats, onClose, onSave }) {
  const editing = !!initial;
  const [type, setType] = useState(type0);
  const [f, setF] = useState(initial ? { amount: initial.amount, category: initial.category, date: initial.date, note: initial.note || "", wallet: walletOf(initial, wallets) } : { amount: "", category: cats[type0][0], date: today(), note: "", wallet: wallets[0].id });
  const [err, setErr] = useState("");
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const switchType = (t) => { setType(t); setF((x) => ({ ...x, category: cats[t][0] })); };
  const opts = cats[type].includes(f.category) ? cats[type] : [f.category, ...cats[type]];
  function submit(e) {
    e.preventDefault();
    const amount = Number(f.amount);
    if (!(amount > 0)) return setErr("Isi jumlah dengan angka lebih dari 0.");
    onSave({ type, ...f, amount });
  }
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal sheet" onSubmit={submit} role="dialog" aria-label={editing ? "Ubah transaksi" : "Catat transaksi"}>
        <div className="grab" aria-hidden="true" />
        <div className="c-head" style={{ margin: 0 }}>
          <h2>{editing ? "Ubah transaksi" : "Catat transaksi"}</h2>
          <button type="button" className="round" onClick={onClose} aria-label="Tutup"><Icon n="x" size={16} /></button>
        </div>
        {!editing && (
          <div className="seg" role="group" aria-label="Jenis transaksi">
            <button type="button" className={type === "expense" ? "on" : ""} aria-pressed={type === "expense"} onClick={() => switchType("expense")}>Pengeluaran</button>
            <button type="button" className={type === "income" ? "on" : ""} aria-pressed={type === "income"} onClick={() => switchType("income")}>Pemasukan</button>
          </div>
        )}
        <div className="amount">
          <span className="mut">Jumlah</span>
          <div className="amt-box"><span aria-hidden="true">Rp</span><MoneyInput autoFocus className="amt-input" placeholder="0" aria-label="Jumlah (Rp)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></div>
        </div>
        <div>
          <span className="mut">Kategori</span>
          <div className="chips">
            {opts.map((c) => (<button type="button" key={c} className={"chip" + (f.category === c ? " on" : "")} aria-pressed={f.category === c} onClick={() => setF({ ...f, category: c })}>{c}</button>))}
          </div>
        </div>
        <div className={"two" + (wallets.length > 1 ? "" : " one")}>
          {wallets.length > 1 && (
            <label>Dompet<select value={f.wallet} onChange={(e) => setF({ ...f, wallet: e.target.value })}>{wallets.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}</select></label>
          )}
          <label>Tanggal<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        </div>
        <label>Catatan (opsional)<input type="text" maxLength={60} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <button type="submit" className="btn dark big">Simpan</button>
      </form>
    </div>
  );
}

function HistoryTab({ tx, months, onDelete, onEdit, wname, q, setQ }) {
  const [view, setView] = useState("day");
  const [month, setMonth] = useState("all");
  const [ft, setFt] = useState("all");

  const groups = useMemo(() => {
    const list = tx.filter((t) => (month === "all" || t.date.startsWith(month)) && (ft === "all" || t.type === ft) && (!q || `${t.category} ${t.note || ""}`.toLowerCase().includes(q.toLowerCase())));
    const g = GROUPERS[view];
    const map = new Map();
    list.forEach((t) => {
      const k = g.key(t);
      if (!map.has(k)) map.set(k, { key: k, income: 0, expense: 0, list: [] });
      const row = map.get(k);
      row[t.type] += t.amount;
      row.list.push(t);
    });
    return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [tx, month, ft, q, view]);
  const max = Math.max(1, ...groups.map((g) => Math.max(g.income, g.expense)));

  return (
    <section className="card wide">
      <div className="c-head wrapx">
        <h2>Riwayat transaksi</h2>
        <div className="pills">
          {[["day", "Harian"], ["week", "Mingguan"], ["month", "Bulanan"]].map(([v, l]) => (<button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{l}</button>))}
        </div>
      </div>
      <div className="filters">
        <input type="search" placeholder="Cari kategori atau catatan..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari transaksi" />
        <select value={ft} onChange={(e) => setFt(e.target.value)} aria-label="Jenis"><option value="all">Semua jenis</option><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option></select>
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Bulan"><option value="all">Semua bulan</option>{months.map((m) => (<option key={m} value={m}>{monthLabel(m)}</option>))}</select>
      </div>
      {!groups.length ? <p className="muted">Tidak ada transaksi yang cocok.</p> : (
        <ul className="groups">
          {groups.map((g) => (
            <li key={g.key}>
              <details>
                <summary>
                  <div className="g-top"><span className="cap">{GROUPERS[view].label(g.key)}</span><span className={g.income - g.expense < 0 ? "neg" : "pos"}>{g.income - g.expense < 0 ? "-" : "+"}{rupiah(Math.abs(g.income - g.expense))}</span></div>
                  <div className="gbars" aria-hidden="true"><i className="gi" style={{ width: `${(g.income / max) * 100}%` }} /><i className="ge" style={{ width: `${(g.expense / max) * 100}%` }} /></div>
                  <div className="g-sub"><span>Masuk {rupiah(g.income)}</span><span>Keluar {rupiah(g.expense)}</span></div>
                </summary>
                <ul className="tlist inner">
                  {[...g.list].sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => (
                    <li key={t.id}>
                      <span className={"ico " + t.type}>{t.category[0]}</span>
                      <div><strong>{t.category}</strong><small>{fmt(t.date, { day: "numeric", month: "short" })}{wname(t) ? ` - ${wname(t)}` : ""}{t.note ? ` - ${t.note}` : ""}</small></div>
                      <span className={"amt " + (t.type === "income" ? "pos" : "neg")}>{t.type === "income" ? "+" : "-"}{rupiah(t.amount)}</span>
                      <span className="acts"><button className="link" onClick={() => onEdit(t)} aria-label={`Ubah ${t.category} ${rupiah(t.amount)}`}>Ubah</button><button className="link danger" onClick={() => onDelete(t.id)} aria-label={`Hapus ${t.category} ${rupiah(t.amount)}`}>Hapus</button></span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BudgetTab({ db, update, spent }) {
  return (
    <section className="card wide">
      <div className="c-head"><h2>Anggaran bulanan</h2><span className="tag">{monthLabel(today().slice(0, 7))}</span></div>
      <p className="muted">Tetapkan batas pengeluaran per kategori. Batang berubah oranye di 80% dan merah saat terlampaui.</p>
      <ul className="budgets">
        {db.categories.expense.map((c) => {
          const b = Number(db.budgets[c]) || 0;
          const s = spent[c] || 0;
          const p = b ? Math.min(100, (s / b) * 100) : 0;
          const state = b && s > b ? "over" : b && s >= b * 0.8 ? "warn" : "";
          return (
            <li key={c}>
              <div className="b-top"><strong>{c}</strong><span>{rupiah(s)} {b ? `/ ${rupiah(b)}` : ""}</span></div>
              <div className={"track " + state}><i style={{ width: `${p}%` }} /></div>
              <label className="inline">Batas<MoneyInput placeholder="0" value={db.budgets[c] ?? ""} onChange={(v) => update({ budgets: { ...db.budgets, [c]: v === "" ? 0 : v } })} /></label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GoalsTab({ db, update, balance, money }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [amts, setAmts] = useState({});
  const [err, setErr] = useState("");

  function add(e) {
    e.preventDefault();
    if (!name.trim() || !(Number(target) > 0)) return setErr("Isi nama dan target dengan angka lebih dari 0.");
    setErr("");
    update({ goals: [...db.goals, { id: uid(), name: name.trim(), target: Number(target), saved: 0 }] });
    setName(""); setTarget("");
  }
  function move(g, dir) {
    const a = Number(amts[g.id]);
    if (!(a > 0)) return setErr("Isi jumlah setoran atau penarikan.");
    if (dir > 0 && a > balance) return setErr("Saldo tersedia tidak cukup untuk disetor.");
    if (dir < 0 && a > g.saved) return setErr("Jumlah melebihi isi tabungan target ini.");
    setErr("");
    update({ goals: db.goals.map((x) => (x.id === g.id ? { ...x, saved: x.saved + dir * a } : x)) });
    setAmts({ ...amts, [g.id]: "" });
  }

  return (
    <section className="card wide">
      <div className="c-head"><h2>Target tabungan</h2><span className="tag">Saldo tersedia {money(balance)}</span></div>
      <form className="inline-form" onSubmit={add}>
        <input placeholder="Nama target (mis. Laptop baru)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nama target" />
        <MoneyInput placeholder="Jumlah target" value={target} onChange={setTarget} aria-label="Jumlah target" />
        <button className="btn dark">Tambah target</button>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
      <ul className="goals">
        {db.goals.map((g) => {
          const p = Math.min(100, Math.round((g.saved / g.target) * 100));
          return (
            <li key={g.id}>
              <div className="b-top"><strong>{g.name}</strong><span>{rupiah(g.saved)} / {rupiah(g.target)} ({p}%)</span></div>
              <div className="track"><i style={{ width: `${p}%` }} /></div>
              <div className="inline-form">
                <MoneyInput placeholder="Jumlah" value={amts[g.id] ?? ""} onChange={(v) => setAmts({ ...amts, [g.id]: v })} aria-label={`Jumlah untuk ${g.name}`} />
                <button className="btn dark" onClick={() => move(g, 1)}>Setor</button>
                <button className="btn line" onClick={() => move(g, -1)}>Tarik</button>
                <button className="link danger" onClick={() => window.confirm(`Hapus target "${g.name}"? Isi tabungannya kembali ke saldo tersedia.`) && update({ goals: db.goals.filter((x) => x.id !== g.id) })}>Hapus target</button>
              </div>
            </li>
          );
        })}
        {!db.goals.length && <li className="muted">Belum ada target. Buat satu di atas, misalnya dana darurat atau liburan.</li>}
      </ul>
    </section>
  );
}

function RecurringTab({ db, update }) {
  const [f, setF] = useState({ type: "expense", amount: "", category: db.categories.expense[0], wallet: db.wallets[0].id, day: 1, note: "" });
  const [err, setErr] = useState("");
  function add(e) {
    e.preventDefault();
    if (!(Number(f.amount) > 0)) return setErr("Isi jumlah dengan angka lebih dari 0.");
    setErr("");
    update({ recurring: [...db.recurring, { id: uid(), ...f, amount: Number(f.amount), day: Number(f.day) }] });
    setF({ ...f, amount: "", note: "" });
  }
  return (
    <section className="card wide">
      <div className="c-head"><h2>Transaksi rutin</h2></div>
      <p className="muted">Untuk tagihan atau pemasukan yang berulang tiap bulan (listrik, langganan, gaji). Saat tanggalnya tiba, konfirmasi muncul di kartu Transaksi pada halaman Ringkasan.</p>
      <form className="inline-form" onSubmit={add}>
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, category: db.categories[e.target.value][0] })} aria-label="Jenis"><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></select>
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Kategori">{db.categories[f.type].map((c) => (<option key={c}>{c}</option>))}</select>
        {db.wallets.length > 1 && (
          <select value={walletOf(f, db.wallets)} onChange={(e) => setF({ ...f, wallet: e.target.value })} aria-label="Dompet">{db.wallets.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}</select>
        )}
        <MoneyInput placeholder="Jumlah" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} aria-label="Jumlah" />
        <select value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} aria-label="Tanggal tiap bulan">{Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (<option key={d} value={d}>Tgl {d}</option>))}</select>
        <input placeholder="Catatan (mis. Wifi)" maxLength={40} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} aria-label="Catatan" />
        <button className="btn dark">Tambah</button>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
      <ul className="tlist inner">
        {db.recurring.map((r) => (
          <li key={r.id}>
            <span className={"ico " + r.type}>{r.category[0]}</span>
            <div><strong>{r.note || r.category}</strong><small>Tiap tanggal {r.day} - {r.category}</small></div>
            <span className={"amt " + (r.type === "income" ? "pos" : "neg")}>{r.type === "income" ? "+" : "-"}{rupiah(r.amount)}</span>
            <button className="link danger" onClick={() => window.confirm("Hapus transaksi rutin ini?") && update({ recurring: db.recurring.filter((x) => x.id !== r.id) })}>Hapus</button>
          </li>
        ))}
        {!db.recurring.length && <li className="muted">Belum ada transaksi rutin.</li>}
      </ul>
    </section>
  );
}

function MoneyInput({ value, onChange, ...props }) {
  const display = value === "" || value == null || Number(value) === 0 ? "" : Number(value).toLocaleString("id-ID");
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        onChange(digits === "" ? "" : Number(digits));
      }}
    />
  );
}

function DataTab({ db, setDb, update, exportCsv, cloud }) {
  const [msg, setMsg] = useState("");

  function backup() {
    const payload = { app: "catatan-keuangan", version: 2, exportedAt: new Date().toISOString(), data: db };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    a.download = `cadangan-keuangan-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    update({ lastBackup: new Date().toISOString() });
    setMsg("Cadangan diunduh. Simpan file itu di tempat yang aman (Google Drive, email, atau flashdisk).");
  }

  function restore(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const data = parsed.data || parsed;
        if (!data || !Array.isArray(data.tx)) throw new Error("format");
        const okTx = (t) => t && (t.type === "income" || t.type === "expense") && Number(t.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && typeof t.category === "string";
        const tx = data.tx.filter(okTx).map((t) => ({ id: t.id || uid(), type: t.type, amount: Number(t.amount), category: t.category, date: t.date, note: t.note ? String(t.note) : "", wallet: t.wallet ? String(t.wallet) : "" }));
        const goals = (Array.isArray(data.goals) ? data.goals : []).filter((g) => g && g.name && Number(g.target) > 0 && Number(g.saved) >= 0).map((g) => ({ id: g.id || uid(), name: String(g.name), target: Number(g.target), saved: Number(g.saved) }));
        const recurring = (Array.isArray(data.recurring) ? data.recurring : []).filter((r) => r && (r.type === "income" || r.type === "expense") && Number(r.amount) > 0 && Number(r.day) >= 1 && Number(r.day) <= 28).map((r) => ({ id: r.id || uid(), type: r.type, amount: Number(r.amount), category: String(r.category || "Lainnya"), day: Number(r.day), note: r.note ? String(r.note) : "", wallet: r.wallet ? String(r.wallet) : "" }));
        const wl0 = (Array.isArray(data.wallets) ? data.wallets : []).filter((w) => w && w.id && w.name).map((w) => ({ id: String(w.id), name: String(w.name), opening: Number(w.opening) || 0 }));
        const wl = wl0.length ? wl0 : EMPTY.wallets;
        const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
        const transfers = (Array.isArray(data.transfers) ? data.transfers : []).filter((x) => x && wl.some((w) => w.id === x.from) && wl.some((w) => w.id === x.to) && x.from !== x.to && Number(x.amount) > 0 && isDate(x.date)).map((x) => ({ id: x.id || uid(), from: x.from, to: x.to, amount: Number(x.amount), date: x.date, note: x.note ? String(x.note) : "" }));
        const strs = (a) => (Array.isArray(a) ? a.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()) : []);
        const ci = data.categories || {};
        const categories = { expense: strs(ci.expense).length ? strs(ci.expense) : EXPENSE_CATS, income: strs(ci.income).length ? strs(ci.income) : INCOME_CATS };
        const skipped = data.tx.length - tx.length;
        if (!window.confirm(`Ganti SEMUA data saat ini dengan cadangan ini (${tx.length} transaksi, ${goals.length} target, ${recurring.length} transaksi rutin)?${cloud ? " Perubahan ini juga akan disinkronkan ke perangkat lain." : ""}`)) return;
        setDb({
          ...EMPTY,
          name: typeof data.name === "string" ? data.name : EMPTY.name,
          photo: typeof data.photo === "string" && data.photo.startsWith("data:image/") && data.photo.length < 300000 ? data.photo : "",
          tx, goals, recurring, wallets: wl, transfers, categories,
          budgets: data.budgets && typeof data.budgets === "object" ? data.budgets : {},
          done: Array.isArray(data.done) ? data.done : [],
          lastBackup: typeof data.lastBackup === "string" ? data.lastBackup : "",
        });
        setMsg(`Data dipulihkan: ${tx.length} transaksi.${skipped ? ` ${skipped} baris tidak valid dilewati.` : ""}`);
      } catch {
        setMsg("File tidak dapat dibaca. Pastikan Anda memilih file cadangan .json dari aplikasi ini.");
      }
    };
    reader.readAsText(file);
  }

  function wipe() {
    if (!window.confirm("Hapus SEMUA data (transaksi, anggaran, target, dan transaksi rutin)?" + (cloud ? " Data di perangkat lain yang tersinkron juga ikut terhapus." : "") + " Tindakan ini tidak bisa dibatalkan. Sudah membuat cadangan?")) return;
    setDb({ ...EMPTY });
    setMsg("Semua data telah dihapus.");
  }

  const last = db.lastBackup ? new Date(db.lastBackup).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" }) : "Belum pernah";

  return (
    <section className="card wide">
      <div className="c-head"><h2>Data dan cadangan</h2><span className="tag">{db.tx.length} transaksi</span></div>
      <p className="muted">{cloud ? "Sinkronisasi cloud aktif, tetapi tetap buat cadangan berkala sebagai pengaman tambahan." : "Data hanya tersimpan di browser ini. Jika cache dihapus atau Anda ganti perangkat, data bisa hilang, jadi buat cadangan secara berkala."} File cadangan tidak terenkripsi, jadi simpan di tempat yang aman.</p>
      <ul className="data-list">
        <li>
          <div><strong>Cadangkan data (JSON)</strong><small>Cadangan terakhir: {last}</small></div>
          <button className="btn dark" onClick={backup}>Unduh cadangan</button>
        </li>
        <li>
          <div><strong>Pulihkan dari cadangan</strong><small>Memilih file .json dari tombol di atas. Data saat ini akan diganti.</small></div>
          <label className="btn line filebtn">Pilih file<input type="file" accept=".json,application/json" onChange={restore} /></label>
        </li>
        <li>
          <div><strong>Ekspor ke CSV</strong><small>Untuk dibuka di Excel atau Google Sheets.</small></div>
          <button className="btn line" onClick={exportCsv} disabled={!db.tx.length}>Ekspor CSV</button>
        </li>
        <li>
          <div><strong>Hapus semua data</strong><small>Mulai dari nol. Buat cadangan lebih dulu.</small></div>
          <button className="btn danger" onClick={wipe}>Hapus semua</button>
        </li>
      </ul>
      {msg && <p className="note" role="status">{msg}</p>}
    </section>
  );
}

function WalletsTab({ db, update, walletBal }) {
  const wl = db.wallets;
  const [nw, setNw] = useState({ name: "", opening: "" });
  const [tr, setTr] = useState({ from: wl[0].id, to: "", amount: "", date: today(), note: "" });
  const [err, setErr] = useState("");

  const from = wl.some((w) => w.id === tr.from) ? tr.from : wl[0].id;
  const to = wl.some((w) => w.id === tr.to && w.id !== from) ? tr.to : wl.find((w) => w.id !== from)?.id || "";
  const nameOf = (id) => wl.find((w) => w.id === id)?.name || "?";
  const setW = (id, patch) => update({ wallets: wl.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const inUse = (id) => db.tx.some((t) => walletOf(t, wl) === id) || db.transfers.some((x) => x.from === id || x.to === id);
  const total = Object.values(walletBal).reduce((a, b) => a + b, 0);

  function addWallet(e) {
    e.preventDefault();
    const name = nw.name.trim();
    if (!name) return setErr("Isi nama dompet.");
    if (wl.some((w) => w.name.toLowerCase() === name.toLowerCase())) return setErr("Nama dompet sudah dipakai.");
    setErr("");
    update({ wallets: [...wl, { id: uid(), name, opening: Number(nw.opening) || 0 }] });
    setNw({ name: "", opening: "" });
  }

  function addTransfer(e) {
    e.preventDefault();
    const amount = Number(tr.amount);
    if (!to || from === to) return setErr("Pilih dua dompet yang berbeda.");
    if (!(amount > 0)) return setErr("Isi jumlah transfer.");
    if (amount > walletBal[from]) return setErr(`Saldo ${nameOf(from)} tidak cukup untuk transfer ini.`);
    setErr("");
    update({ transfers: [{ id: uid(), from, to, amount, date: tr.date, note: tr.note.trim() }, ...db.transfers] });
    setTr({ ...tr, amount: "", note: "" });
  }

  return (
    <section className="card wide">
      <div className="c-head"><h2>Dompet dan saldo awal</h2><span className="tag">Total {rupiah(total)}</span></div>
      <p className="muted">Isi <b>saldo awal</b> dengan uang yang sudah ada di tiap dompet sebelum Anda mulai mencatat, supaya saldo di aplikasi sama dengan kenyataan.</p>

      <div>
        {wl.map((w) => (
          <div className="wrow" key={w.id}>
            <label>Nama dompet<input value={w.name} maxLength={24} onChange={(e) => setW(w.id, { name: e.target.value })} /></label>
            <label>Saldo awal (Rp)<MoneyInput placeholder="0" value={w.opening} onChange={(v) => setW(w.id, { opening: v === "" ? 0 : v })} /></label>
            <div>
              <div className="bal">{rupiah(walletBal[w.id])}</div>
              <button className="link danger" disabled={wl.length === 1 || inUse(w.id)} title={inUse(w.id) ? "Dompet yang sudah punya transaksi tidak bisa dihapus" : ""}
                onClick={() => window.confirm(`Hapus dompet "${w.name}"?`) && update({ wallets: wl.filter((x) => x.id !== w.id) })}>Hapus</button>
            </div>
          </div>
        ))}
      </div>

      <form className="inline-form" onSubmit={addWallet} style={{ marginTop: "1rem" }}>
        <input placeholder="Dompet baru (mis. BCA, GoPay)" maxLength={24} value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} aria-label="Nama dompet baru" />
        <MoneyInput placeholder="Saldo awal" value={nw.opening} onChange={(v) => setNw({ ...nw, opening: v })} aria-label="Saldo awal dompet baru" />
        <button className="btn dark">Tambah dompet</button>
      </form>
      {err && <p className="error" role="alert">{err}</p>}

      <h2 style={{ margin: "1.8rem 0 .4rem" }}>Transfer antar dompet</h2>
      {wl.length < 2 ? <p className="muted">Tambahkan minimal dua dompet untuk memindahkan uang di antaranya.</p> : (
        <>
          <p className="muted">Misalnya tarik tunai dari bank atau isi saldo e-wallet. Transfer memindahkan uang antar dompet tanpa dihitung sebagai pemasukan atau pengeluaran.</p>
          <form className="inline-form" onSubmit={addTransfer}>
            <select value={from} onChange={(e) => setTr({ ...tr, from: e.target.value })} aria-label="Dari dompet">{wl.map((w) => (<option key={w.id} value={w.id}>Dari: {w.name}</option>))}</select>
            <select value={to} onChange={(e) => setTr({ ...tr, to: e.target.value })} aria-label="Ke dompet">{wl.filter((w) => w.id !== from).map((w) => (<option key={w.id} value={w.id}>Ke: {w.name}</option>))}</select>
            <MoneyInput placeholder="Jumlah" value={tr.amount} onChange={(v) => setTr({ ...tr, amount: v })} aria-label="Jumlah transfer" />
            <input type="date" value={tr.date} onChange={(e) => setTr({ ...tr, date: e.target.value })} aria-label="Tanggal transfer" />
            <input placeholder="Catatan (opsional)" maxLength={40} value={tr.note} onChange={(e) => setTr({ ...tr, note: e.target.value })} aria-label="Catatan transfer" />
            <button className="btn dark">Transfer</button>
          </form>
          <ul className="tlist inner">
            {[...db.transfers].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 20).map((x) => (
              <li key={x.id}>
                <span className="ico">⇄</span>
                <div><strong>{nameOf(x.from)} → {nameOf(x.to)}</strong><small>{fmt(x.date, { day: "numeric", month: "short", year: "numeric" })}{x.note ? ` - ${x.note}` : ""}</small></div>
                <span className="amt">{rupiah(x.amount)}</span>
                <button className="link danger" onClick={() => window.confirm("Hapus transfer ini?") && update({ transfers: db.transfers.filter((t) => t.id !== x.id) })}>Hapus</button>
              </li>
            ))}
            {!db.transfers.length && <li className="muted">Belum ada transfer.</li>}
          </ul>
        </>
      )}
    </section>
  );
}

function CategoriesCard({ db, setDb }) {
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState({ expense: "", income: "" });

  const exists = (type, name, except) => db.categories[type].some((c) => c !== except && c.toLowerCase() === name.toLowerCase());

  function rename(type, oldName, raw) {
    const n = raw.trim().slice(0, 24);
    if (!n || n === oldName) return false;
    if (exists(type, n, oldName)) { setMsg(`Kategori "${n}" sudah ada.`); return false; }
    setMsg("");
    setDb((d) => {
      let budgets = d.budgets;
      if (type === "expense" && oldName in budgets) {
        const { [oldName]: v, ...rest } = budgets;
        budgets = { ...rest, [n]: v };
      }
      return {
        ...d,
        budgets,
        categories: { ...d.categories, [type]: d.categories[type].map((c) => (c === oldName ? n : c)) },
        tx: d.tx.map((t) => (t.type === type && t.category === oldName ? { ...t, category: n } : t)),
        recurring: d.recurring.map((r) => (r.type === type && r.category === oldName ? { ...r, category: n } : r)),
      };
    });
    return true;
  }

  function add(type, e) {
    e.preventDefault();
    const n = adding[type].trim().slice(0, 24);
    if (!n) return;
    if (exists(type, n)) return setMsg(`Kategori "${n}" sudah ada.`);
    setMsg("");
    setDb((d) => ({ ...d, categories: { ...d.categories, [type]: [...d.categories[type], n] } }));
    setAdding({ ...adding, [type]: "" });
  }

  function remove(type, name) {
    if (!window.confirm(`Hapus kategori "${name}"? Transaksi lama tetap tercatat dengan kategori ini.`)) return;
    setDb((d) => ({ ...d, categories: { ...d.categories, [type]: d.categories[type].filter((c) => c !== name) } }));
  }

  const groups = [["expense", "Kategori pengeluaran"], ["income", "Kategori pemasukan"]];
  return (
    <section className="card wide" style={{ marginBottom: "1rem" }}>
      <div className="c-head"><h2>Kategori</h2></div>
      <p className="muted">Ubah nama kategori dengan mengetik langsung, lalu tekan Enter atau klik di luar kolom. Nama baru ikut berlaku pada transaksi, anggaran, dan transaksi rutin lama.</p>
      <div className="cat-cols">
        {groups.map(([type, title]) => (
          <div key={type}>
            <h3 className="sub">{title}</h3>
            <ul className="cat-list">
              {db.categories[type].map((c) => (
                <li key={c}>
                  <input defaultValue={c} maxLength={24} aria-label={`Ubah nama ${c}`}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    onBlur={(e) => { if (!rename(type, c, e.target.value)) e.target.value = c; }} />
                  <button className="link danger" disabled={db.categories[type].length === 1} onClick={() => remove(type, c)} aria-label={`Hapus kategori ${c}`}>Hapus</button>
                </li>
              ))}
            </ul>
            <form className="inline-form" onSubmit={(e) => add(type, e)}>
              <input placeholder="Kategori baru" maxLength={24} value={adding[type]} onChange={(e) => setAdding({ ...adding, [type]: e.target.value })} aria-label={`Kategori ${type === "expense" ? "pengeluaran" : "pemasukan"} baru`} />
              <button className="btn dark">Tambah</button>
            </form>
          </div>
        ))}
      </div>
      {msg && <p className="error" role="alert">{msg}</p>}
    </section>
  );
}

function resizeImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("gambar")); };
    img.src = url;
  });
}

function Avatar({ photo, name, size = 38 }) {
  const st = { width: size, height: size, fontSize: size * 0.42 };
  if (photo) return <img className="av" src={photo} alt="" style={st} />;
  return <span className="av" style={st} aria-hidden="true">{(name.trim()[0] || "T").toUpperCase()}</span>;
}

function ProfilePanel({ db, update }) {
  const [msg, setMsg] = useState("");
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setMsg("Pilih file gambar (JPG, PNG, atau WebP).");
    if (file.size > 10 * 1024 * 1024) return setMsg("Ukuran foto maksimal 10 MB.");
    try {
      update({ photo: await resizeImage(file) });
      setMsg("Foto profil diperbarui.");
    } catch {
      setMsg("Foto tidak dapat dibaca. Coba file lain.");
    }
  }
  return (
    <section className="card wide">
      <div className="c-head"><h2>Profil</h2></div>
      <div className="profile">
        <Avatar photo={db.photo} name={db.name || "Teman"} size={96} />
        <div className="pbtns">
          <label className="btn dark filebtn">Ganti foto<input type="file" accept="image/*" onChange={pick} /></label>
          {db.photo && <button className="btn line" onClick={() => { update({ photo: "" }); setMsg("Foto dihapus."); }}>Hapus foto</button>}
        </div>
      </div>
      <label className="field">Nama panggilan<input value={db.name} maxLength={24} onChange={(e) => update({ name: e.target.value })} /></label>
      <p className="muted" style={{ marginTop: ".8rem" }}>Foto dipotong persegi dan disimpan di perangkat ini saja.</p>
      {msg && <p className="note" role="status">{msg}</p>}
    </section>
  );
}

function PlanPanel({ db, update, spent, balance, money, view, setView }) {
  const items = [["budget", "Anggaran"], ["goals", "Target"], ["recurring", "Rutin"]];
  return (
    <>
      <div className="seg plan-seg" role="group" aria-label="Bagian rencana">
        {items.map(([k, l]) => (<button key={k} className={view === k ? "on" : ""} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>))}
      </div>
      {view === "budget" && <BudgetTab db={db} update={update} spent={spent} />}
      {view === "goals" && <GoalsTab db={db} update={update} balance={balance} money={money} />}
      {view === "recurring" && <RecurringTab db={db} update={update} />}
    </>
  );
}

function LockScreen({ pinLen, onUnlock, onReset, failKey }) {
  const [mode, setMode] = useState("pin");
  const [pin, setPin] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    try { setUntil(JSON.parse(localStorage.getItem(failKey) || "{}").until || 0); } catch {}
    setNow(Date.now());
  }, []);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [until]);
  const wait = Math.max(0, Math.ceil((until - now) / 1000));

  function recordFail() {
    let f = {};
    try { f = JSON.parse(localStorage.getItem(failKey) || "{}"); } catch {}
    const n = (f.n || 0) + 1;
    const u = n % 5 === 0 ? Date.now() + Math.min(300, 30 * 2 ** (n / 5 - 1)) * 1000 : 0;
    try { localStorage.setItem(failKey, JSON.stringify({ n, until: u })); } catch {}
    setUntil(u); setNow(Date.now());
  }

  async function attempt(secret, kind) {
    if (busy || wait > 0) return;
    setBusy(true); setErr("");
    try {
      await onUnlock(secret, kind);
      try { localStorage.removeItem(failKey); } catch {}
    } catch {
      recordFail();
      setErr(kind === "pin" ? "PIN salah." : "Kata sandi salah.");
      setPin(""); setPw("");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { if (mode === "pin" && pin.length === pinLen) attempt(pin, "pin"); }, [pin]);
  useEffect(() => {
    if (mode !== "pin") return;
    const h = (e) => {
      if (/^\d$/.test(e.key)) push(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  const push = (d) => setPin((p) => (p.length < pinLen && !busy && wait === 0 ? p + d : p));

  return (
    <div className="lock">
      <div className="lock-card">
        <div className="logo"><span className="mark" aria-hidden="true"><i /><i /><i /></span>Keuangan</div>
        <h1>{mode === "pin" ? "Masukkan PIN" : "Masukkan kata sandi"}</h1>
        {mode === "pin" ? (
          <>
            <div className="dots" role="img" aria-label={`${pin.length} dari ${pinLen} angka`}>
              {Array.from({ length: pinLen }, (_, i) => (<i key={i} className={i < pin.length ? "on" : ""} />))}
            </div>
            <div className="pad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (<button key={d} onClick={() => push(String(d))} disabled={busy || wait > 0}>{d}</button>))}
              <button className="alt" onClick={() => { setMode("password"); setErr(""); }}>Kata sandi</button>
              <button onClick={() => push("0")} disabled={busy || wait > 0}>0</button>
              <button className="alt" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Hapus angka terakhir">Hapus</button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (pw) attempt(pw, "password"); }}>
            <PasswordInput autoFocus autoComplete="current-password" aria-label="Kata sandi" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button className="btn light big" disabled={busy || wait > 0 || !pw}>Buka</button>
            <button type="button" className="link" onClick={() => { setMode("pin"); setErr(""); }}>Pakai PIN</button>
          </form>
        )}
        <p className="err" role="alert">{wait > 0 ? `Terlalu banyak percobaan. Coba lagi dalam ${wait} detik.` : busy ? "Memeriksa..." : err}</p>
        <button className="link" onClick={onReset}>Lupa PIN dan kata sandi?</button>
      </div>
    </div>
  );
}

function SecurityPanel({ sec, api, lockTimeout, setLockTimeout, onLockNow }) {
  const blank = { pw: "", pw2: "", pin: "", pin2: "", ok: false, cur: "", np: "", np2: "", nw: "", nw2: "", off: "" };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState({ t: "", ok: true });
  const [busy, setBusy] = useState(false);
  const text = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const digits = (k) => (e) => setF({ ...f, [k]: e.target.value.replace(/\D/g, "").slice(0, 6) });
  const fail = (t) => setMsg({ t, ok: false });

  async function run(fn, okText) {
    setBusy(true); setMsg({ t: "", ok: true });
    try { await fn(); setF(blank); setMsg({ t: okText, ok: true }); }
    catch (e) { fail(e.message || "Terjadi kesalahan."); }
    finally { setBusy(false); }
  }

  const enable = (e) => {
    e.preventDefault();
    if (f.pw !== f.pw2) return fail("Kata sandi dan konfirmasinya tidak sama.");
    if (f.pin !== f.pin2) return fail("PIN dan konfirmasinya tidak sama.");
    if (!f.ok) return fail("Centang pernyataan di atas untuk melanjutkan.");
    run(() => api.enable(f.pw, f.pin), "Kunci aktif. Data Anda sekarang terenkripsi di perangkat ini. Sebaiknya buat cadangan di menu Cadangan.");
  };
  const changePin = (e) => {
    e.preventDefault();
    if (f.np !== f.np2) return fail("PIN baru dan konfirmasinya tidak sama.");
    run(() => api.changePin(f.cur, f.np), "PIN diganti.");
  };
  const changePw = (e) => {
    e.preventDefault();
    if (f.nw !== f.nw2) return fail("Kata sandi baru dan konfirmasinya tidak sama.");
    run(() => api.changePassword(f.cur, f.nw), "Kata sandi diganti.");
  };
  const disable = (e) => {
    e.preventDefault();
    if (!window.confirm("Matikan kunci? Data akan disimpan tanpa enkripsi lagi.")) return;
    run(() => api.disable(f.off), "Kunci dimatikan.");
  };

  const note = msg.t && <p className={msg.ok ? "note" : "error"} role={msg.ok ? "status" : "alert"}>{msg.t}</p>;

  if (!sec) {
    return (
      <section className="card wide">
        <div className="c-head"><h2>Keamanan</h2><span className="tag">Belum aktif</span></div>
        <p className="muted">Atur <b>kata sandi</b> dan <b>PIN</b>. Setelah aktif, data keuangan dienkripsi di perangkat ini dan aplikasi meminta PIN (atau kata sandi) saat dibuka. Gunakan PIN untuk sehari-hari, kata sandi jika lupa PIN.</p>
        <form className="field" style={{ maxWidth: 420, marginTop: "1rem", gap: ".8rem" }} onSubmit={enable}>
          <label>Kata sandi (minimal 8 karakter)<PasswordInput autoComplete="new-password" value={f.pw} onChange={text("pw")} /></label>
          <label>Ulangi kata sandi<PasswordInput autoComplete="new-password" value={f.pw2} onChange={text("pw2")} /></label>
          <label>PIN (4 sampai 6 angka)<PasswordInput inputMode="numeric" autoComplete="off" value={f.pin} onChange={digits("pin")} /></label>
          <label>Ulangi PIN<PasswordInput inputMode="numeric" autoComplete="off" value={f.pin2} onChange={digits("pin2")} /></label>
          <label className="check"><input type="checkbox" checked={f.ok} onChange={(e) => setF({ ...f, ok: e.target.checked })} />Saya paham: jika lupa PIN dan kata sandi, data tidak dapat dipulihkan kecuali dari file cadangan.</label>
          <button className="btn dark big" disabled={busy}>{busy ? "Memproses..." : "Aktifkan kunci"}</button>
        </form>
        {note}
      </section>
    );
  }

  return (
    <section className="card wide">
      <div className="c-head"><h2>Keamanan</h2><span className="tag">Kunci aktif</span></div>
      <p className="muted">Data terenkripsi di perangkat ini. PIN {sec.pinLen} angka.</p>
      <div className="inline-form" style={{ marginTop: "1rem" }}>
        <button className="btn dark" onClick={onLockNow}><Icon n="lock" /> Kunci sekarang</button>
        <label className="inline" style={{ margin: 0 }}>Kunci otomatis
          <select value={lockTimeout} onChange={(e) => setLockTimeout(Number(e.target.value))} style={{ width: "auto", margin: 0 }}>
            <option value={1}>Setiap kali aplikasi ditinggalkan</option>
            <option value={60}>Setelah 1 menit</option>
            <option value={300}>Setelah 5 menit</option>
            <option value={900}>Setelah 15 menit</option>
            <option value={0}>Jangan kunci otomatis</option>
          </select>
        </label>
      </div>
      <details className="acc"><summary>Ubah PIN</summary>
        <form className="body" onSubmit={changePin}>
          <label>Kata sandi saat ini<PasswordInput autoComplete="current-password" value={f.cur} onChange={text("cur")} /></label>
          <label>PIN baru (4 sampai 6 angka)<PasswordInput inputMode="numeric" autoComplete="off" value={f.np} onChange={digits("np")} /></label>
          <label>Ulangi PIN baru<PasswordInput inputMode="numeric" autoComplete="off" value={f.np2} onChange={digits("np2")} /></label>
          <button className="btn dark" disabled={busy}>Simpan PIN</button>
        </form>
      </details>
      <details className="acc"><summary>Ubah kata sandi</summary>
        <form className="body" onSubmit={changePw}>
          <label>Kata sandi saat ini<PasswordInput autoComplete="current-password" value={f.cur} onChange={text("cur")} /></label>
          <label>Kata sandi baru (minimal 8 karakter)<PasswordInput autoComplete="new-password" value={f.nw} onChange={text("nw")} /></label>
          <label>Ulangi kata sandi baru<PasswordInput autoComplete="new-password" value={f.nw2} onChange={text("nw2")} /></label>
          <button className="btn dark" disabled={busy}>Simpan kata sandi</button>
        </form>
      </details>
      <details className="acc"><summary>Matikan kunci</summary>
        <form className="body" onSubmit={disable}>
          <p className="muted">Data akan disimpan tanpa enkripsi dan aplikasi tidak lagi meminta PIN.</p>
          <label>Kata sandi<PasswordInput autoComplete="current-password" value={f.off} onChange={text("off")} /></label>
          <button className="btn danger" disabled={busy}>Matikan kunci</button>
        </form>
      </details>
      {note}
    </section>
  );
}

function PasswordInput({ className, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <span className={"pw" + (className ? " " + className : "")}>
      <input {...props} type={show ? "text" : "password"} />
      <button type="button" className="pw-eye" onClick={() => setShow((v) => !v)} aria-label={show ? "Sembunyikan sandi" : "Tampilkan sandi"} aria-pressed={show}><Icon n={show ? "eyeOff" : "eye"} size={18} /></button>
    </span>
  );
}

const SYNC_TEXT = { idle: "Belum tersinkron", syncing: "Menyinkronkan...", ok: "Tersinkron", offline: "Offline, menunggu koneksi", error: "Gagal sinkron", needkey: "Butuh sandi enkripsi" };

function SyncBadge({ sync, onClick }) {
  if (!sync.configured || !sync.user) return null;
  return (
    <button className={"sync-badge " + (sync.status === "needkey" ? "error" : sync.status)} onClick={onClick} aria-label={`Sinkronisasi: ${SYNC_TEXT[sync.status]}`} title={SYNC_TEXT[sync.status]}>
      <i aria-hidden="true" /><span>{sync.status === "ok" ? "Tersinkron" : sync.status === "syncing" ? "Sinkron..." : sync.status === "offline" ? "Offline" : sync.status === "error" ? "Gagal" : sync.status === "needkey" ? "Sandi" : "..."}</span>
    </button>
  );
}

function SyncWarning({ sync, onClick }) {
  if (!sync.needsAttention) return null;
  const days = Math.max(1, Math.floor((Date.now() - sync.lastOk) / 86400000));
  return (
    <button className="sync-warn" onClick={onClick}>
      Belum tersinkron selama {days} hari atau lebih. Jika internet Anda normal, proyek Supabase mungkin dijeda: buka dashboard Supabase lalu klik Restore. Data di perangkat ini tetap aman. Ketuk untuk detail.
    </button>
  );
}

function PassphraseForm({ sync }) {
  const create = sync.keyMode === "create";
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (create && p1 !== p2) return setErr("Sandi enkripsi dan konfirmasinya tidak sama.");
    if (create && !ok) return setErr("Centang pernyataan di atas untuk melanjutkan.");
    setBusy(true);
    try { await sync.setPassphrase(p1); } catch (x) { setErr(x.message || "Terjadi kesalahan."); } finally { setBusy(false); }
  }
  return (
    <form className="field" style={{ maxWidth: 420, gap: ".8rem", marginTop: "1rem" }} onSubmit={submit}>
      <p className="muted" style={{ margin: 0 }}>
        {create
          ? "Data dienkripsi di perangkat sebelum dikirim ke cloud. Buat sandi enkripsi (berbeda dari sandi akun). Server tidak mengetahuinya."
          : "Data di cloud terenkripsi. Masukkan sandi enkripsi yang Anda buat di perangkat pertama."}
      </p>
      <label>Sandi enkripsi (minimal 8 karakter)<PasswordInput autoComplete={create ? "new-password" : "off"} value={p1} onChange={(e) => setP1(e.target.value)} /></label>
      {create && <label>Ulangi sandi enkripsi<PasswordInput autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></label>}
      {create && <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />Saya paham: jika sandi enkripsi ini lupa, data di cloud tidak dapat dipulihkan oleh siapa pun. Data di perangkat dan file cadangan tetap bisa dipakai.</label>}
      <button className="btn dark big" disabled={busy || !p1}>{busy ? "Memproses..." : create ? "Simpan sandi enkripsi" : "Buka data cloud"}</button>
      {(err || sync.error) && <p className="error" role="alert">{err || sync.error}</p>}
    </form>
  );
}

function VersionHistory({ sync, setDb }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  async function load() {
    setBusy(true); setErr(""); setDone("");
    try { setList(await sync.listVersions()); } catch (e) { setErr(e.message || "Gagal memuat riwayat."); } finally { setBusy(false); }
  }
  function restore(v) {
    const when = new Date(v.at).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" });
    if (!window.confirm(`Pulihkan data ke versi ${when} (${v.tx} transaksi)? Data saat ini diganti dan perubahan ini ikut tersinkron ke perangkat lain. Versi saat ini tetap tersimpan di riwayat.`)) return;
    setDb(normalize(v.data));
    setDone(`Data dipulihkan ke versi ${when}.`);
  }
  return (
    <details className="acc" onToggle={(e) => e.currentTarget.open && !list && load()}>
      <summary>Riwayat versi (pulihkan data lama)</summary>
      <div className="body">
        <p className="muted">Database menyimpan versi sebelum data ditimpa (paling sering tiap 30 menit, 40 versi terakhir). Gunakan jika ada data terhapus tidak sengaja.</p>
        {busy && <p className="muted">Memuat...</p>}
        {err && <p className="error" role="alert">{err}</p>}
        {done && <p className="note" role="status">{done}</p>}
        {list && !list.length && !busy && <p className="muted">Belum ada versi tersimpan. Versi muncul setelah data diubah lagi.</p>}
        {list && list.length > 0 && (
          <ul className="tlist inner">
            {list.map((v) => (
              <li key={v.id}>
                <span className="ico">↺</span>
                <div><strong>{new Date(v.at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</strong><small>{v.tx} transaksi, {v.goals} target, {v.wallets} dompet{v.newest ? `, terbaru ${fmt(v.newest, { day: "numeric", month: "short" })}` : ""}</small></div>
                <button className="link" onClick={() => restore(v)}>Pulihkan</button>
              </li>
            ))}
          </ul>
        )}
        <button className="btn line" onClick={load} disabled={busy}>Muat ulang daftar</button>
      </div>
    </details>
  );
}

function SyncPanel({ sync, setDb, onLogout }) {
  const [mode, setMode] = useState("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ t: "", ok: true });

  async function submit(e) {
    e.preventDefault();
    setMsg({ t: "", ok: true });
    const mail = email.trim();
    if (!mail) return setMsg({ t: "Isi email.", ok: false });
    if (mode === "up") {
      if (pw.length < 8) return setMsg({ t: "Kata sandi minimal 8 karakter.", ok: false });
      if (pw !== pw2) return setMsg({ t: "Kata sandi dan konfirmasinya tidak sama.", ok: false });
    }
    setBusy(true);
    try {
      if (mode === "in") await sync.signIn(mail, pw);
      else {
        const r = await sync.signUp(mail, pw);
        if (r.needsConfirm) setMsg({ t: "Akun dibuat. Buka email Anda untuk konfirmasi, lalu masuk.", ok: true });
      }
      setPw(""); setPw2("");
    } catch (err) {
      setMsg({ t: err.message || "Terjadi kesalahan.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (!sync.configured) {
    return (
      <section className="card wide">
        <div className="c-head"><h2>Sinkronisasi</h2><span className="tag">Belum disiapkan</span></div>
        <p className="muted">Fitur ini butuh database cloud. Ikuti langkah di README (bagian Sinkronisasi HP dan laptop), lalu isi dua variabel Supabase dan deploy ulang.</p>
      </section>
    );
  }

  if (sync.user) {
    const last = sync.last ? new Date(sync.last).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
    const needKey = sync.status === "needkey";
    return (
      <section className="card wide">
        <div className="c-head"><h2>Akun dan sinkronisasi</h2><span className="tag">{SYNC_TEXT[sync.status]}</span></div>
        <p className="muted">Masuk sebagai <b>{sync.user.email}</b>. Catatan Anda hanya milik akun ini. Data baru di HP atau laptop otomatis dikirim (terenkripsi) dan muncul di perangkat lain yang masuk dengan akun dan sandi enkripsi yang sama. Perubahan dari dua perangkat digabung per transaksi.</p>
        {needKey ? <PassphraseForm sync={sync} /> : (
          <>
            <p className="muted">Sinkron terakhir: {last}</p>
            {sync.status === "error" && <p className="error" role="alert">{sync.error}</p>}
            <div className="inline-form" style={{ marginTop: "1rem" }}>
              <button className="btn dark" onClick={sync.syncNow} disabled={sync.status === "syncing"}>Sinkronkan sekarang</button>
              <button className="btn line" onClick={onLogout}>Keluar dari akun</button>
            </div>
            <VersionHistory sync={sync} setDb={setDb} />
          </>
        )}
        {needKey && <div className="inline-form" style={{ marginTop: "1rem" }}><button className="btn line" onClick={onLogout}>Keluar dari akun</button></div>}
        <p className="muted" style={{ marginTop: "1rem" }}>Catatan: PIN dan kata sandi aplikasi diatur terpisah di tiap perangkat. Sinkronisasi hanya berjalan saat aplikasi sedang terbuka (tidak terkunci).</p>
      </section>
    );
  }

  return (
    <section className="card wide">
      <div className="c-head"><h2>Sinkronisasi</h2><span className="tag">Belum masuk</span></div>
      <p className="muted">Masuk dengan akun yang sama di HP dan laptop. Perangkat yang sudah berisi data sebaiknya masuk lebih dulu, perangkat lain akan mengambil data itu.</p>
      <div className="seg" role="group" aria-label="Masuk atau daftar" style={{ maxWidth: 320, margin: "1rem 0" }}>
        <button type="button" className={mode === "in" ? "on" : ""} aria-pressed={mode === "in"} onClick={() => setMode("in")}>Masuk</button>
        <button type="button" className={mode === "up" ? "on" : ""} aria-pressed={mode === "up"} onClick={() => setMode("up")}>Daftar</button>
      </div>
      <form className="field" style={{ maxWidth: 420, gap: ".8rem" }} onSubmit={submit}>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Kata sandi{mode === "up" ? " (minimal 8 karakter)" : ""}<PasswordInput autoComplete={mode === "up" ? "new-password" : "current-password"} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {mode === "up" && <label>Ulangi kata sandi<PasswordInput autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>}
        <button className="btn dark big" disabled={busy}>{busy ? "Memproses..." : mode === "in" ? "Masuk" : "Buat akun"}</button>
      </form>
      {msg.t && <p className={msg.ok ? "note" : "error"} role={msg.ok ? "status" : "alert"}>{msg.t}</p>}
    </section>
  );
}

function AuthShell({ title, children }) {
  return (
    <div className="gate">
      <section className="card">
        <div className="logo"><span className="mark" aria-hidden="true"><i /><i /><i /></span>Keuangan</div>
        <h1>{title}</h1>
        {children}
      </section>
    </div>
  );
}

function AuthScreen({ sync }) {
  const [mode, setMode] = useState("in"); // in | up | forgot
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ t: "", ok: true });
  const go = (m) => { setMode(m); setMsg({ t: "", ok: true }); };

  async function submit(e) {
    e.preventDefault();
    setMsg({ t: "", ok: true });
    const mail = email.trim();
    if (!mail) return setMsg({ t: "Isi email.", ok: false });
    if (mode !== "forgot" && !pw) return setMsg({ t: "Isi kata sandi.", ok: false });
    if (mode === "up") {
      if (pw.length < 8) return setMsg({ t: "Kata sandi minimal 8 karakter.", ok: false });
      if (pw !== pw2) return setMsg({ t: "Kata sandi dan konfirmasinya tidak sama.", ok: false });
    }
    setBusy(true);
    try {
      if (mode === "in") await sync.signIn(mail, pw);
      else if (mode === "up") {
        const r = await sync.signUp(mail, pw);
        if (r.needsConfirm) { go("in"); setMsg({ t: "Akun dibuat. Buka email Anda untuk konfirmasi, lalu masuk.", ok: true }); }
      } else {
        await sync.resetPassword(mail);
        setMsg({ t: "Jika email terdaftar, tautan untuk mengatur ulang kata sandi sudah dikirim. Cek juga folder Spam.", ok: true });
      }
      setPw(""); setPw2("");
    } catch (err) {
      setMsg({ t: err.message || "Terjadi kesalahan.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={mode === "in" ? "Masuk" : mode === "up" ? "Buat akun" : "Lupa kata sandi"}>
      <p className="muted" style={{ margin: 0 }}>
        {mode === "forgot"
          ? "Masukkan email akun Anda. Kami kirim tautan untuk membuat kata sandi baru."
          : "Setiap akun punya catatan keuangan sendiri. Data dienkripsi di perangkat Anda sebelum disimpan, sehingga pengelola layanan tidak dapat membacanya."}
      </p>
      {mode !== "forgot" && (
        <div className="seg" role="group" aria-label="Masuk atau daftar">
          <button type="button" className={mode === "in" ? "on" : ""} aria-pressed={mode === "in"} onClick={() => go("in")}>Masuk</button>
          <button type="button" className={mode === "up" ? "on" : ""} aria-pressed={mode === "up"} onClick={() => go("up")}>Daftar</button>
        </div>
      )}
      <form className="field" style={{ gap: ".8rem" }} onSubmit={submit}>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode !== "forgot" && <label>Kata sandi{mode === "up" ? " (minimal 8 karakter)" : ""}<PasswordInput autoComplete={mode === "up" ? "new-password" : "current-password"} value={pw} onChange={(e) => setPw(e.target.value)} /></label>}
        {mode === "up" && <label>Ulangi kata sandi<PasswordInput autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>}
        <button className="btn dark big" disabled={busy}>{busy ? "Memproses..." : mode === "in" ? "Masuk" : mode === "up" ? "Buat akun" : "Kirim tautan"}</button>
      </form>
      {msg.t && <p className={msg.ok ? "note" : "error"} role={msg.ok ? "status" : "alert"} style={{ marginTop: 0 }}>{msg.t}</p>}
      <div className="auth-links">
        {mode === "in" && <button type="button" className="link" onClick={() => go("forgot")}>Lupa kata sandi?</button>}
        {mode === "forgot" && <button type="button" className="link" onClick={() => go("in")}>Kembali ke masuk</button>}
      </div>
    </AuthShell>
  );
}

function RecoveryScreen({ sync }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) return setErr("Kata sandi minimal 8 karakter.");
    if (pw !== pw2) return setErr("Kata sandi dan konfirmasinya tidak sama.");
    setBusy(true);
    try { await sync.updatePassword(pw); } catch (x) { setErr(x.message || "Terjadi kesalahan."); } finally { setBusy(false); }
  }
  return (
    <AuthShell title="Kata sandi baru">
      <p className="muted" style={{ margin: 0 }}>Buat kata sandi akun yang baru. Ini tidak mengubah sandi enkripsi data Anda.</p>
      <form className="field" style={{ gap: ".8rem" }} onSubmit={submit}>
        <label>Kata sandi baru (minimal 8 karakter)<PasswordInput autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Ulangi kata sandi baru<PasswordInput autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <button className="btn dark big" disabled={busy}>{busy ? "Memproses..." : "Simpan kata sandi"}</button>
      </form>
      {err && <p className="error" role="alert" style={{ marginTop: 0 }}>{err}</p>}
    </AuthShell>
  );
}

function KeyGate({ sync, onLogout }) {
  return (
    <AuthShell title={sync.keyMode === "create" ? "Buat sandi enkripsi" : "Buka data Anda"}>
      <p className="muted" style={{ margin: 0 }}>Masuk sebagai <b>{sync.user.email}</b>.</p>
      <PassphraseForm sync={sync} />
      <div className="auth-links"><button type="button" className="link" onClick={onLogout}>Keluar dari akun</button></div>
    </AuthShell>
  );
}

function AppearancePanel({ theme, setTheme }) {
  return (
    <section className="card wide">
      <div className="c-head"><h2>Tampilan</h2></div>
      <div className="seg" role="group" aria-label="Tema" style={{ maxWidth: 420 }}>
        {[["auto", "Otomatis"], ["light", "Terang"], ["dark", "Gelap"]].map(([k, l]) => (
          <button key={k} className={theme === k ? "on" : ""} aria-pressed={theme === k} onClick={() => setTheme(k)}>{l}</button>
        ))}
      </div>
      <p className="muted" style={{ marginTop: ".8rem" }}>Otomatis mengikuti pengaturan terang atau gelap di perangkat Anda.</p>
    </section>
  );
}

function MorePanel({ view, setView, db, setDb, update, exportCsv, walletBal, sec, secApi, lockTimeout, setLockTimeout, theme, setTheme, onLockNow, sync, onLogout }) {
  if (view) {
    return (
      <>
        <button className="back" onClick={() => setView(null)}>‹ Kembali</button>
        {view === "profile" && <ProfilePanel db={db} update={update} />}
        {view === "wallets" && <WalletsTab db={db} update={update} walletBal={walletBal} />}
        {view === "categories" && <CategoriesCard db={db} setDb={setDb} />}
        {view === "security" && <SecurityPanel sec={sec} api={secApi} lockTimeout={lockTimeout} setLockTimeout={setLockTimeout} onLockNow={onLockNow} />}
        {view === "appearance" && <AppearancePanel theme={theme} setTheme={setTheme} />}
        {view === "sync" && <SyncPanel sync={sync} setDb={setDb} onLogout={onLogout} />}
        {view === "data" && <DataTab db={db} setDb={setDb} update={update} exportCsv={exportCsv} cloud={!!sync.user} />}
      </>
    );
  }
  const last = db.lastBackup ? new Date(db.lastBackup).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "";
  const themeLabel = { auto: "Otomatis", light: "Terang", dark: "Gelap" }[theme];
  const rows = [
    ["profile", "Profil", "Foto dan nama panggilan"],
    ...(sync.configured ? [["sync", "Akun dan sinkronisasi", sync.user ? sync.user.email : "Masuk untuk menyinkronkan"]] : []),
    ["wallets", "Dompet dan saldo awal", `${db.wallets.length} dompet`],
    ["categories", "Kategori", "Ubah, tambah, atau hapus"],
    ["security", "Keamanan", sec ? "Kunci aktif (PIN dan kata sandi)" : "PIN dan kata sandi belum diatur"],
    ["appearance", "Tampilan", themeLabel],
    ["data", "Cadangan dan pemulihan", last ? `Terakhir: ${last}` : "Belum pernah dicadangkan"],
  ];
  return (
    <section className="card wide">
      <div className="c-head"><h2>Lainnya</h2>{sec && <button className="btn dark" onClick={onLockNow}><Icon n="lock" size={16} /> Kunci</button>}</div>
      <ul className="menu-list">
        {rows.map(([k, name, sub]) => (
          <li key={k}>
            <button className="menu-row" onClick={() => setView(k)}>
              {k === "profile" ? <Avatar photo={db.photo} name={db.name || "Teman"} size={40} /> : <span className="ico">{name[0]}</span>}
              <span className="g"><strong>{name}</strong><small>{sub}</small></span>
              <Icon n="chev" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
