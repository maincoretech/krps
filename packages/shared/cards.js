// ═══ KRPS Shared: Card Constants & Bitwise Engine ═══
// Cards: 0=Rock 1=Paper 2=Scissors
// Hand/Pool: bit-packed u32 (3 bits per type, max 7 each)

export const R = 0, P = 1, S = 2;
export const CARDS = [R, P, S];
const SFT = [0, 3, 6];
const ADD = [1, 8, 64];
const SUB = [-1, -8, -64];

// Pre-computed tables
const WIN = new Uint8Array(16);
const SCORE = new Int8Array(9);
for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
  const w = a === b ? 0 : ((a === R && b === S) || (a === P && b === R) || (a === S && b === P)) ? 1 : 2;
  WIN[(a << 2) | b] = w;
  SCORE[a * 3 + b] = w === 2 ? 1 : w === 1 ? -1 : 0;
}

export const CTR = new Uint8Array([P, S, R]);

// Initial bit-packs
export const HAND = 1 | 8 | 64;             // 1R 1P 1S = 73
export const POOL = 1 | 8 | 128;            // 1R 1P 2S = 137
// Total cards: 3R + 3P + 4S
export const TOTAL = [3, 3, 4];

// ═══ Bitwise Ops ═════════════════════════════════════════

export const has   = (b, c) => ((b >>> SFT[c]) & 7) > 0;
export const add   = (b, c) => b + ADD[c];
export const rem   = (b, c) => b + SUB[c];
export const cnt   = (b) => (b & 7) + ((b >>> 3) & 7) + ((b >>> 6) & 7);
export const tCnt  = (b, c) => (b >>> SFT[c]) & 7;
export const cnts  = (b) => [b & 7, (b >>> 3) & 7, (b >>> 6) & 7];

/** Expand bit-packed to sorted array */
export const unpack = (b) => {
  const a = new Array(cnt(b));
  let i = 0, rc = b & 7, pc = (b >>> 3) & 7, sc = (b >>> 6) & 7;
  while (rc--) a[i++] = R; while (pc--) a[i++] = P; while (sc--) a[i++] = S;
  return a;
};

/** Pick the smallest card present */
export const first = (b) => (has(b, R) ? R : has(b, P) ? P : S);

/** Draw random from pool → { card, newPool } */
export const draw = (p) => {
  let t = cnt(p), r = (Math.random() * t) | 0, rc = p & 7;
  if (r < rc) return { card: R, np: p + SUB[R] };
  if ((r -= rc) < ((p >>> 3) & 7)) return { card: P, np: p + SUB[P] };
  return { card: S, np: p + SUB[S] };
};

/** Infer remaining hand from totals minus pool minus bot (PERFECT — bot should NOT use this) */
export const infer = (pool, bot) => {
  const [pr, pp, ps] = cnts(pool), [br, bp, bs] = cnts(bot);
  return Math.max(0, TOTAL[R] - pr - br) | (Math.max(0, TOTAL[P] - pp - bp) << 3) | (Math.max(0, TOTAL[S] - ps - bs) << 6);
};

/** Human-like estimate from history only — same info a human player has */
export const estimateHuman = (history, botHand, poolBits) => {
  // Start from the human's perspective: total cards available after accounting for bot's hand
  const [br, bp, bs] = cnts(botHand), [pr, pp, ps] = cnts(poolBits);
  let known = Math.max(0, TOTAL[R] - br) | (Math.max(0, TOTAL[P] - bp) << 3) | (Math.max(0, TOTAL[S] - bs) << 6);

  // Track what we've seen the human play and whether they kept it
  for (const h of history) {
    if (h.type !== "round") continue;
    const card = h.cards.A; // human's card
    // If human won or tied, they kept the card (still in hand)
    // If human lost, the card went to pool (removed from hand)
    const humanLost = h.result === "lose"; // "lose" = human (A) lost
    if (humanLost && has(known, card)) {
      known = rem(known, card);
    }
    // If human won, they drew a card — but we don't know which one
    // Human-like: we just know they have at least this card + one unknown
    if (h.result === "win" && has(known, card)) {
      // They kept the played card (remove from known, it's accounted for)
      known = rem(known, card);
    }
  }

  // What's in pool is visible to both players
  // Remaining = (total - bot - pool) but we don't use pool for the estimate
  // since pool contents are known. Human can see pool.
  const [pr2, pp2, ps2] = cnts(poolBits);
  let estimate = Math.max(0, TOTAL[R] - br - pr2) | (Math.max(0, TOTAL[P] - bp - pp2) << 3) | (Math.max(0, TOTAL[S] - bs - ps2) << 6);

  // If estimate would be 0 (too little info), fall back to a reasonable guess
  if (cnt(estimate) === 0) {
    // Human has at least the cards that aren't in bot hand or pool
    return Math.max(1, TOTAL[R] - br - pr2) | (Math.max(1, TOTAL[P] - bp - pp2) << 3) | (Math.max(1, TOTAL[S] - bs - ps2) << 6);
  }

  return estimate;
};

/** O(1) score of bot card vs hand */
export const score = (bc, hb) => {
  const [r, p, s] = cnts(hb);
  return r * SCORE[bc * 3 + R] + p * SCORE[bc * 3 + P] + s * SCORE[bc * 3 + S];
};

/** O(1) loss count of bot card vs hand */
export const losses = (bc, hb) => {
  // LOSS[bc*3 + oc] = WIN[(oc<<2)|bc] === 1 ? 1 : 0
  const [r, p, s] = cnts(hb);
  let l = 0;
  if (r) l += r * (WIN[(R << 2) | bc] === 1 ? 1 : 0);
  if (p) l += p * (WIN[(P << 2) | bc] === 1 ? 1 : 0);
  if (s) l += s * (WIN[(S << 2) | bc] === 1 ? 1 : 0);
  return l;
};

/** Win determination: 0=tie 1=A_wins 2=B_wins */
export const winOf = (a, b) => WIN[(a << 2) | b];
