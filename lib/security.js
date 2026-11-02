// Pengamanan data di perangkat: AES-GCM 256 bit + PBKDF2-SHA256 (Web Crypto API).
// Data dienkripsi dengan satu "kunci data" acak. Kunci data itu dibungkus dua kali:
// satu oleh kata sandi, satu oleh PIN. Salah satunya cukup untuk membuka data.

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 250000;

const b64 = (buf) => {
  const a = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function kek(secret, salt, iters) {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: b64(iv), ct: b64(ct) };
}
async function openBox(key, box) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct)));
}
const importData = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

export const validPin = (pin) => /^\d{4,6}$/.test(pin || "");
export const validPassword = (pw) => typeof pw === "string" && pw.length >= 8;

async function wrapWith(raw, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), box: await seal(await kek(secret, salt, ITER), raw) };
}

async function build(raw, password, pin, prev) {
  const p = password ? await wrapWith(raw, password) : { salt: prev.saltP, box: prev.wrapP };
  const n = pin ? await wrapWith(raw, pin) : { salt: prev.saltN, box: prev.wrapN };
  const record = { v: 1, iters: ITER, saltP: p.salt, wrapP: p.box, saltN: n.salt, wrapN: n.box, pinLen: pin ? pin.length : prev.pinLen };
  return { record, session: { raw, key: await importData(raw) } };
}

export async function createSecurity(password, pin) {
  if (!validPassword(password)) throw new Error("Kata sandi minimal 8 karakter.");
  if (!validPin(pin)) throw new Error("PIN harus 4 sampai 6 angka.");
  return build(crypto.getRandomValues(new Uint8Array(32)), password, pin);
}

export async function unlockSecurity(record, secret, kind) {
  const salt = unb64(kind === "pin" ? record.saltN : record.saltP);
  const box = kind === "pin" ? record.wrapN : record.wrapP;
  const raw = await openBox(await kek(secret, salt, record.iters), box); // melempar galat jika salah
  return { raw, key: await importData(raw) };
}

export async function verifySecret(record, secret, kind) {
  try { await unlockSecurity(record, secret, kind); return true; } catch { return false; }
}

export async function rewrapSecurity(record, session, { password, pin }) {
  if (password && !validPassword(password)) throw new Error("Kata sandi minimal 8 karakter.");
  if (pin && !validPin(pin)) throw new Error("PIN harus 4 sampai 6 angka.");
  return (await build(session.raw, password, pin, record)).record;
}

export async function encryptData(session, obj) {
  return JSON.stringify({ enc: 1, ...(await seal(session.key, enc.encode(JSON.stringify(obj)))) });
}

export async function readStored(session, text) {
  const p = JSON.parse(text);
  if (p && p.enc === 1) return JSON.parse(dec.decode(await openBox(session.key, p)));
  return p; // data lama yang belum terenkripsi
}

export const isEncryptedText = (t) => { try { return JSON.parse(t)?.enc === 1; } catch { return false; } };
