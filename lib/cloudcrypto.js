// Enkripsi ujung ke ujung untuk data cloud: AES-GCM 256 bit, kunci dari sandi enkripsi (PBKDF2-SHA256).
// Server hanya menerima data terenkripsi dan tidak pernah tahu sandinya.
const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 250000;

const b64 = (buf) => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveRaw(passphrase, saltB64) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: unb64(saltB64), iterations: ITER, hash: "SHA-256" }, base, 256);
  return b64(bits);
}

export const importKey = (rawB64) => crypto.subtle.importKey("raw", unb64(rawB64), "AES-GCM", false, ["encrypt", "decrypt"]);

export async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { enc: 1, iv: b64(iv), ct: b64(ct) };
}

// Data lama yang belum terenkripsi dikembalikan apa adanya. Sandi salah melempar galat.
export async function decryptJson(key, blob) {
  if (!blob || blob.enc !== 1) return blob;
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct))));
}
