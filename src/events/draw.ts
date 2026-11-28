/** Constrained draw solver: random derangement respecting exclusions. */

export class DrawImpossibleError extends Error {
  constructor(message = "draw_impossible") {
    super(message);
    this.name = "DrawImpossibleError";
  }
}

/** Seeded PRNG (mulberry32) for deterministic tests. */
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Compute a derangement (no self-gifts) respecting `excluded` pairs.
 * Backtracking with randomized candidate order; complete search so it finds
 * a solution whenever one exists. Throws DrawImpossibleError otherwise.
 */
export function solveDraw(
  participantIds: string[],
  excluded: Set<string>,
  rng: () => number = Math.random,
): Map<string, string> {
  const n = participantIds.length;
  if (n < 2) throw new DrawImpossibleError();
  const givers = shuffled(participantIds, rng);
  const assignment = new Map<string, string>();
  const used = new Set<string>();

  // Order recipients per giver randomly for uniformity shape.
  const orderCache = new Map<string, string[]>();
  const candidates = (giver: string): string[] => {
    let c = orderCache.get(giver);
    if (!c) {
      c = shuffled(
        participantIds.filter((p) => p !== giver && !excluded.has(`${giver}>${p}`)),
        rng,
      );
      orderCache.set(giver, c);
    }
    return c;
  };

  function backtrack(i: number): boolean {
    if (i === givers.length) return true;
    const giver = givers[i];
    for (const r of candidates(giver)) {
      if (used.has(r)) continue;
      assignment.set(giver, r);
      used.add(r);
      if (backtrack(i + 1)) return true;
      assignment.delete(giver);
      used.delete(r);
    }
    return false;
  }

  if (!backtrack(0)) throw new DrawImpossibleError();
  return assignment;
}
