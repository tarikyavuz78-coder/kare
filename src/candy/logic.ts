// Türk Şekerleri – üçlü eşleştirme mantığı
export const SIZE = 8;
export type Grid = number[]; // SIZE*SIZE, değer = tatlı türü

export interface LevelConfig { level: number; moves: number; target: number; kinds: number; }

export function levelConfig(level: number): LevelConfig {
  return {
    level,
    moves: Math.max(14, 22 - Math.floor(level / 8)) + (level % 5 === 0 ? 4 : 0),
    target: 600 + level * 110,
    kinds: level < 8 ? 5 : 6,
  };
}

export function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idx = (r: number, c: number) => r * SIZE + c;

export function newGrid(kinds: number, rand: () => number): Grid {
  const g: Grid = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      let k: number;
      do { k = Math.floor(rand() * kinds); }
      while ((c >= 2 && g[idx(r, c - 1)] === k && g[idx(r, c - 2)] === k) || (r >= 2 && g[idx(r - 1, c)] === k && g[idx(r - 2, c)] === k));
      g.push(k);
    }
  }
  return hasMove(g) ? g : newGrid(kinds, rand);
}

/** Eşleşen hücrelerin indeksleri (yatay veya dikey 3+). */
export function findMatches(g: Grid): Set<number> {
  const out = new Set<number>();
  for (let r = 0; r < SIZE; r++) {
    let run = 1;
    for (let c = 1; c <= SIZE; c++) {
      if (c < SIZE && g[idx(r, c)] >= 0 && g[idx(r, c)] === g[idx(r, c - 1)]) run++;
      else { if (run >= 3) for (let k = c - run; k < c; k++) out.add(idx(r, k)); run = 1; }
    }
  }
  for (let c = 0; c < SIZE; c++) {
    let run = 1;
    for (let r = 1; r <= SIZE; r++) {
      if (r < SIZE && g[idx(r, c)] >= 0 && g[idx(r, c)] === g[idx(r - 1, c)]) run++;
      else { if (run >= 3) for (let k = r - run; k < r; k++) out.add(idx(k, c)); run = 1; }
    }
  }
  return out;
}

export function adjacent(a: number, b: number): boolean {
  const ra = Math.floor(a / SIZE), ca = a % SIZE, rb = Math.floor(b / SIZE), cb = b % SIZE;
  return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
}

export function swap(g: Grid, a: number, b: number): Grid {
  const n = [...g];
  [n[a], n[b]] = [n[b], n[a]];
  return n;
}

export function hasMove(g: Grid): boolean {
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (const j of [i + 1, i + SIZE]) {
      if (j >= SIZE * SIZE || !adjacent(i, j)) continue;
      if (findMatches(swap(g, i, j)).size) return true;
    }
  }
  return false;
}

/** Eşleşmeleri temizler, düşürür, doldurur; zincirleme devam eder. Kazanılan puanı döner. */
export function resolve(g: Grid, kinds: number, rand: () => number): { grid: Grid; score: number; cleared: number } {
  let grid = [...g];
  let score = 0;
  let cleared = 0;
  let chain = 1;
  for (;;) {
    const m = findMatches(grid);
    if (!m.size) break;
    cleared += m.size;
    score += m.size * 20 * chain + (m.size > 3 ? (m.size - 3) * 40 : 0);
    m.forEach((i) => (grid[i] = -1));
    for (let c = 0; c < SIZE; c++) {
      const col: number[] = [];
      for (let r = SIZE - 1; r >= 0; r--) if (grid[idx(r, c)] >= 0) col.push(grid[idx(r, c)]);
      for (let r = SIZE - 1, k = 0; r >= 0; r--, k++) grid[idx(r, c)] = k < col.length ? col[k] : Math.floor(rand() * kinds);
    }
    chain++;
  }
  if (!hasMove(grid)) grid = newGrid(kinds, rand);
  return { grid, score, cleared };
}
