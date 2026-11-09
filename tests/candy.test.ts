import { describe, it, expect } from 'vitest';
import { newGrid, findMatches, resolve, rng, hasMove, levelConfig, swap } from '../src/candy/logic';

describe('Türk Şekerleri', () => {
  it('yeni tahtada hazır eşleşme yok ve en az bir hamle var', () => {
    for (let s = 1; s < 30; s++) {
      const g = newGrid(6, rng(s));
      expect(findMatches(g).size).toBe(0);
      expect(hasMove(g)).toBe(true);
    }
  });
  it('eşleşme temizlenir, puan verilir, tahta dolu kalır', () => {
    const r = rng(5);
    let g = newGrid(5, r);
    let found = false;
    for (let i = 0; i < 64 && !found; i++) for (const j of [i + 1, i + 8]) {
      if (j < 64 && (j !== i + 1 || i % 8 !== 7) && findMatches(swap(g, i, j)).size) { g = swap(g, i, j); found = true; break; }
    }
    const res = resolve(g, 5, r);
    expect(res.score).toBeGreaterThan(0);
    expect(res.grid.every((k) => k >= 0)).toBe(true);
    expect(findMatches(res.grid).size).toBe(0);
  });
  it('seviyeler zorlaşır', () => {
    expect(levelConfig(20).target).toBeGreaterThan(levelConfig(1).target);
    expect(levelConfig(10).moves).toBeGreaterThanOrEqual(14);
  });
});
