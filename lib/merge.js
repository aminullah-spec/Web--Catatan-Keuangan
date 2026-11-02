// Penggabungan tiga arah (base = keadaan terakhir yang sudah sinkron, local = di perangkat ini,
// remote = di cloud). Perubahan dari dua perangkat digabung per item, bukan menimpa seluruh data.

const ID_COLS = ["tx", "goals", "recurring", "wallets", "transfers"];

const stable = (v) => {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
};
export const same = (a, b) => stable(a) === stable(b);

function mergeById(b, l, r, remoteWins) {
  const bm = new Map(b.map((x) => [x.id, x]));
  const lm = new Map(l.map((x) => [x.id, x]));
  const rm = new Map(r.map((x) => [x.id, x]));
  const out = [];
  const seen = new Set();
  const pick = (id) => {
    const B = bm.get(id), L = lm.get(id), R = rm.get(id);
    const lc = !same(B, L), rc = !same(B, R);
    if (lc && rc) return remoteWins ? R : L;
    if (lc) return L;
    if (rc) return R;
    return L;
  };
  [...l, ...r].forEach((x) => {
    if (seen.has(x.id)) return;
    seen.add(x.id);
    const v = pick(x.id);
    if (v) out.push(v);
  });
  return out;
}

function mergeSet(b, l, r) {
  const bs = new Set(b), ls = new Set(l), rs = new Set(r);
  const out = l.filter((x) => !(bs.has(x) && !rs.has(x)));
  r.forEach((x) => { if (!ls.has(x) && !bs.has(x) && !out.includes(x)) out.push(x); });
  return out;
}

function scalar(b, l, r, remoteWins) {
  const lc = !same(b, l), rc = !same(b, r);
  if (lc && rc) return remoteWins ? r : l;
  return lc ? l : rc ? r : l;
}

function mergeMap(b, l, r, remoteWins) {
  const out = {};
  new Set([...Object.keys(l), ...Object.keys(r)]).forEach((k) => {
    const v = scalar(b[k], l[k], r[k], remoteWins);
    if (v !== undefined) out[k] = v;
  });
  return out;
}

export function merge3(base, local, remote, remoteWins = false) {
  const b = base || {};
  const out = { ...remote, ...local };
  ID_COLS.forEach((c) => { out[c] = mergeById(b[c] || [], local[c] || [], remote[c] || [], remoteWins); });
  ["name", "photo"].forEach((k) => { out[k] = scalar(b[k], local[k], remote[k], remoteWins); });
  out.lastBackup = [local.lastBackup, remote.lastBackup].filter(Boolean).sort().pop() || "";
  out.budgets = mergeMap(b.budgets || {}, local.budgets || {}, remote.budgets || {}, remoteWins);
  out.categories = {
    expense: mergeSet(b.categories?.expense || [], local.categories?.expense || [], remote.categories?.expense || []),
    income: mergeSet(b.categories?.income || [], local.categories?.income || [], remote.categories?.income || []),
  };
  out.done = [...new Set([...(local.done || []), ...(remote.done || [])])];
  return out;
}

// Perangkat baru yang belum berisi apa pun: cukup ambil data dari cloud
export const isPristine = (d) =>
  !d.tx.length && !d.goals.length && !d.recurring.length && !d.transfers.length &&
  d.wallets.length === 1 && d.wallets[0].id === "w-tunai" && !Number(d.wallets[0].opening) &&
  !Object.keys(d.budgets || {}).length && !d.photo && d.name === "Teman";
