// Istaka: 2 sıra × 14 yuva. Boş yuvayla ayrılan kartlar ayrı grup (per/çift) sayılır.
export const COLS = 14;
export const ROWS = 2;
export const SLOTS = COLS * ROWS;
export type RackSlots = (string | null)[];

export interface Seg { row: number; start: number; end: number; ids: string[]; }

export function groupsOf(r: RackSlots): Seg[] {
  const out: Seg[] = [];
  for (let row = 0; row < ROWS; row++) {
    let cur: Seg | null = null;
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      const id = r[i];
      if (id) {
        if (!cur) cur = { row, start: i, end: i, ids: [] };
        cur.ids.push(id);
        cur.end = i;
      } else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Grupları aralarında bir boşlukla dizer; sığmayan grup alt sıraya geçer. Kalan kartlar sonda. */
export function layoutGroups(groups: string[][], leftovers: string[]): RackSlots {
  const r: RackSlots = Array(SLOTS).fill(null);
  const rest: string[] = [];
  let pos = 0;
  const place = (g: string[], gap: boolean) => {
    if (!g.length) return;
    const col = pos % COLS;
    if (col !== 0 && col + g.length > COLS) pos = (Math.floor(pos / COLS) + 1) * COLS;
    for (const id of g) { if (pos < SLOTS) r[pos++] = id; else rest.push(id); }
    if (gap) pos++;
  };
  groups.forEach((g) => place(g, true));
  place(leftovers, false);
  for (const id of rest) { const e = r.lastIndexOf(null); if (e >= 0) r[e] = id; }
  return r;
}

function isSeparator(r: RackSlots, i: number) {
  const c = i % COLS;
  return c > 0 && c < COLS - 1 && r[i - 1] !== null && r[i + 1] !== null;
}

/** Yeni gelen kart için yer: son kartın bir boşluk sonrası; yoksa grupları birleştirmeyen bir boş yuva. */
function freeSlot(r: RackSlots): number {
  let last = -1;
  r.forEach((x, i) => { if (x) last = i; });
  for (let i = last + 2; i < r.length; i++) if (r[i] === null && r[i - 1] === null) return i;
  for (let i = last + 1; i < r.length; i++) if (r[i] === null) return i;
  for (let i = r.length - 1; i >= 0; i--) if (r[i] === null && !isSeparator(r, i)) return i;
  return r.indexOf(null);
}

function nearestEmpty(r: RackSlots, i: number): number {
  const lo = Math.floor(i / COLS) * COLS, hi = lo + COLS - 1;
  for (let d = 1; d < COLS; d++) {
    if (i + d <= hi && r[i + d] === null) return i + d;
    if (i - d >= lo && r[i - d] === null) return i - d;
  }
  return freeSlot(r);
}

/** Istakayı eldeki kartlarla eşitler: giden kartların yeri boşalır, yeni kart tercih edilen yuvaya ya da boş yere gelir. */
export function syncRack(rack: RackSlots, ids: string[], prefer: number | null): RackSlots {
  const set = new Set(ids);
  const r: RackSlots = Array.from({ length: SLOTS }, (_, i) => (rack[i] && set.has(rack[i]!) ? rack[i] : null));
  const present = new Set(r.filter((x): x is string => !!x));
  for (const id of ids) {
    if (present.has(id)) continue;
    let at = -1;
    if (prefer !== null && prefer >= 0 && prefer < SLOTS) { at = r[prefer] === null ? prefer : nearestEmpty(r, prefer); prefer = null; }
    if (at < 0) at = freeSlot(r);
    if (at >= 0) r[at] = id;
    present.add(id);
  }
  return r;
}

/** Kartı bir yuvaya taşır. Hedef doluysa aynı sıradaki kartlar en yakın boşluğa doğru kayar. */
export function moveCard(rack: RackSlots, from: number, to: number): RackSlots {
  if (from < 0 || to < 0 || from === to) return rack;
  const r = [...rack];
  const id = r[from];
  r[from] = null;
  if (r[to] === null) { r[to] = id; return r; }
  const lo = Math.floor(to / COLS) * COLS, hi = lo + COLS - 1;
  let e = -1;
  for (let d = 1; d < COLS; d++) {
    if (to + d <= hi && r[to + d] === null) { e = to + d; break; }
    if (to - d >= lo && r[to - d] === null) { e = to - d; break; }
  }
  if (e < 0) { r[from] = r[to]; r[to] = id; return r; }
  if (e > to) for (let k = e; k > to; k--) r[k] = r[k - 1];
  else for (let k = e; k < to; k++) r[k] = r[k + 1];
  r[to] = id;
  return r;
}
