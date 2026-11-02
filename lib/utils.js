export const EXPENSE_CATS = ["Makanan", "Transport", "Belanja", "Tagihan", "Hiburan", "Kesehatan", "Pendidikan", "Lainnya"];
export const INCOME_CATS = ["Gaji", "Bonus", "Usaha", "Investasi", "Hadiah", "Lainnya"];
export const CATS = { expense: EXPENSE_CATS, income: INCOME_CATS };

export const rupiah = (n) => (n < 0 ? "-" : "") + "Rp" + Math.round(Math.abs(n)).toLocaleString("id-ID");
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const pad = (n) => String(n).padStart(2, "0");
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const today = () => toKey(new Date());
export const weekStart = (key) => {
  const d = parse(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // minggu dimulai hari Senin
  return toKey(d);
};
export const fmt = (key, opts) => parse(key).toLocaleDateString("id-ID", opts);
export const monthLabel = (ym) => fmt(ym + "-01", { month: "long", year: "numeric" });
export const prevYm = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
export const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

export const GROUPERS = {
  day: {
    key: (t) => t.date,
    label: (k) => fmt(k, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  },
  week: {
    key: (t) => weekStart(t.date),
    label: (k) => {
      const end = parse(k);
      end.setDate(end.getDate() + 6);
      return `${fmt(k, { day: "numeric", month: "short" })} - ${fmt(toKey(end), { day: "numeric", month: "short", year: "numeric" })}`;
    },
  },
  month: { key: (t) => t.date.slice(0, 7), label: (k) => monthLabel(k) },
};
