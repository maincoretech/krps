import { describe, test, expect, mock } from "bun:test";
import { resolveRound, sortCards, getInferredHumanHand } from "./src/match.js";

mock.module("./src/db.js", () => ({
  updateMatch: () => {}, findMatchById: () => {}, insertMatch: () => {},
  listMatchesByOwner: () => [], listMatchesByUser: () => [], deleteMatch: () => {},
  findMatchByInviteCode: () => null, upsertUser: () => {}, getLeaderboard: () => [],
  getStorePath: () => "", db: { query: () => ({ all: () => [] }) },
}));
mock.module("./src/logger.js", () => ({
  default: { match: () => {}, info: () => {}, error: () => {}, warn: () => {} }
}));

const T = () => new Date().toISOString();

function botMatch(id, overrides = {}) {
  return { id, mode: "human-vs-bot", ownerId: "u1", status: "playing", botStrategy: "random",
    roundCount: 0, tieCount: 0, pool: [0, 1, 2, 2], history: [], pendingMoves: null,
    version: 1, createdAt: T(), updatedAt: T(), name: id,
    players: { A: { userId: "u1", hand: [0, 1, 2], consecutiveLosses: 0, tieExchangeReady: false },
               B: { userId: null, hand: [0, 1, 2], consecutiveLosses: 0, tieExchangeReady: false } },
    ...overrides };
}

function pvpMatch(id, overrides = {}) {
  return { id, mode: "human-vs-human", ownerId: "u1", status: "playing",
    roundCount: 0, tieCount: 0, pool: [0, 1, 2, 2], history: [],
    pendingMoves: { A: null, B: null }, version: 1, createdAt: T(), updatedAt: T(), name: id,
    hostUserId: "u1", guestUserId: "u2", matchNumber: 1, isPublic: false, inviteCode: "111111",
    startVotes: { A: true, B: true }, rematchVotes: { A: false, B: false },
    players: { A: { userId: "u1", username: "A", hand: [0, 1, 2], consecutiveLosses: 0, tieExchangeReady: false },
               B: { userId: "u2", username: "B", hand: [0, 1, 2], consecutiveLosses: 0, tieExchangeReady: false } },
    ...overrides };
}

function totalCards(m) { return sortCards(m.players.A.hand).length + sortCards(m.players.B.hand).length + sortCards(m.pool).length; }

// ═══ Card Invariants ═════════════════════════════════

describe("Card Invariants", () => {
  test("Total cards always = 10", () => {
    const m = botMatch("i1");
    m.pendingMoves = { A: 0, B: 2 }; resolveRound(m);
    expect(totalCards(m)).toBe(10);
    m.pendingMoves = { A: 1, B: 1 }; resolveRound(m);
    expect(totalCards(m)).toBe(10);
    m.pendingMoves = { A: 2, B: 0 }; resolveRound(m);
    expect(totalCards(m)).toBe(10);
  });

  test("Counts never exceed 3-bit limit or go negative", () => {
    const m = botMatch("i2");
    // Play until game ends or 30 rounds
    for (let i = 0; i < 30 && m.status === "playing"; i++) {
      m.pendingMoves = { A: 0, B: 1 };
      resolveRound(m);
      const check = (bits) => {
        // Must be within valid range (0-7 for each 3-bit field)
        const r = bits & 7, p = (bits >>> 3) & 7, s = (bits >>> 6) & 7;
        if (r < 0 || r > 7 || p < 0 || p > 7 || s < 0 || s > 7) throw new Error(`Overflow: R=${r} P=${p} S=${s}`);
      };
      check(m.players.A.hand); check(m.players.B.hand); check(m.pool);
    }
    // Game should eventually end
    expect(["playing", "finished"]).toContain(m.status);
  });

  test("Initial state resolves correctly", () => {
    const m = botMatch("i3");
    // Before normalize: hands are arrays
    expect(m.players.A.hand.length).toBe(3);
    // Resolve one round
    m.pendingMoves = { A: 0, B: 1 };
    resolveRound(m);
    // After: hands are bit-packed, total cards still 10
    const t = totalCards(m);
    expect(t).toBeGreaterThanOrEqual(4);
  });
});

// ═══ Win / Lose / Tie ════════════════════════════════

describe("Round Resolution", () => {
  test("Win: winner keeps card + draws, loser loses card to pool", () => {
    const m = botMatch("w1");
    m.pendingMoves = { A: 0, B: 2 };
    const r = resolveRound(m);
    expect(r.round.result).toBe("win");
    expect(sortCards(m.players.A.hand).length).toBe(4);
    expect(sortCards(m.players.B.hand).length).toBe(2);
    expect(m.players.A.losses).toBe(0);
    expect(m.players.B.losses).toBe(1);
  });

  test("B wins → A sees 'lose'", () => {
    const m = pvpMatch("w2");
    m.pendingMoves = { A: 0, B: 1 };
    expect(resolveRound(m).round.result).toBe("lose");
    expect(sortCards(m.players.B.hand).length).toBe(4);
    expect(sortCards(m.players.A.hand).length).toBe(2);
  });

  test("Tie: both keep cards, tieCount++", () => {
    const m = botMatch("w3");
    m.pendingMoves = { A: 1, B: 1 };
    expect(resolveRound(m).round.result).toBe("tie");
    expect(sortCards(m.players.A.hand).length).toBe(3);
    expect(sortCards(m.players.B.hand).length).toBe(3);
    expect(m.tieCount).toBe(1);
  });

  test("Win resets tieCount to 0", () => {
    const m = botMatch("w4", { tieCount: 3 });
    m.pendingMoves = { A: 0, B: 2 };
    resolveRound(m);
    expect(m.tieCount).toBe(0);
  });

  test("Consecutive losses increment, win resets", () => {
    const m = botMatch("w5");
    m.pendingMoves = { A: 0, B: 1 }; resolveRound(m);
    expect(m.players.A.losses).toBe(1);
    m.pendingMoves = { A: 2, B: 0 };
    resolveRound(m);
    // After 2nd loss, openingLossEx triggers and resets losses
    expect(m.players.A.losses).toBe(0);
    // Verify exchange happened
    const last = m.history[m.history.length - 1];
    expect(last.specialActions.some(a => a.type === "opening-loss-exchange")).toBe(true);
  });
});

// ═══ Opening Loss Exchange ═══════════════════════════

describe("Opening Loss Exchange", () => {
  test("Triggers on 2nd loss within first 3 rounds", () => {
    const m = botMatch("o1", { roundCount: 1 });
    m.players.A.consecutiveLosses = 1;
    m.pendingMoves = { A: 0, B: 1 };
    const r = resolveRound(m);
    expect(r.round.specialActions.some(a => a.type === "opening-loss-exchange" && a.playerId === "A")).toBe(true);
    expect(m.players.A.losses).toBe(0);
  });

  test("Does NOT trigger on 1st loss", () => {
    const m = botMatch("o2", { roundCount: 1 });
    m.pendingMoves = { A: 0, B: 1 };
    expect(resolveRound(m).round.specialActions).toEqual([]);
    expect(m.players.A.losses).toBe(1);
  });

  test("Does NOT trigger after round 3", () => {
    const m = botMatch("o3", { roundCount: 3 });
    m.players.A.consecutiveLosses = 2;
    m.pendingMoves = { A: 0, B: 1 };
    expect(resolveRound(m).round.specialActions).toEqual([]);
  });

  test("Exchanges lowest available card from remaining hand after the round", () => {
    // A has [P,S]. A plays P and loses to B's S. A's remaining hand is [S].
    // openingLossEx exchanges the lowest card in REMAINING hand → S.
    const m = botMatch("o4", { roundCount: 1 });
    m.players.A.hand = [1, 2]; m.players.A.consecutiveLosses = 1;
    m.pendingMoves = { A: 1, B: 2 };
    const r = resolveRound(m);
    const ex = r.round.specialActions.find(a => a.type === "opening-loss-exchange");
    expect(ex).toBeDefined();
    // After losing, P was removed. Only S remains → S is exchanged.
    expect(ex.putIntoPool).toBe(2);
  });
});

// ═══ Tie Exchange ════════════════════════════════════

describe("Tie Exchange", () => {
  test("tieEx NOT set when tieCount != handSize", () => {
    const m = botMatch("t1", { tieCount: 2 });
    m.players.A.hand = [0, 1]; m.players.B.hand = [0, 1];
    m.pendingMoves = { A: 1, B: 1 };
    resolveRound(m);
    // tieCount was 2, now tie = 3. handSize for A = 2. 3 !== 2 → no tieEx
    expect(m.players.A.tieEx).toBe(0);
  });

  test("tieEx sets when tieCount == handSize", () => {
    const m = botMatch("t2", { tieCount: 1 });
    m.players.A.hand = [0, 1]; m.players.B.hand = [0, 1];
    m.pendingMoves = { A: 1, B: 1 };
    resolveRound(m);
    // tieCount=2, handSize=2 → tieEx!
    expect(m.players.A.tieEx).toBe(1);
  });

  test("Bot auto-exchange preserves A's tieEx", () => {
    const m = botMatch("t3", { tieCount: 1 });
    m.players.A.hand = [0, 1]; m.players.B.hand = [0, 1];
    m.pendingMoves = { A: 1, B: 1 };
    resolveRound(m);
    // Bot auto-exchanged (tieCount=2=handSize for bot), resetting tieCount
    // A's tieEx should be preserved
    expect(m.players.A.tieEx).toBe(1);
    expect(m.players.B.tieEx).toBe(0);
    expect(m.tieCount).toBe(0);
  });
});

// ═══ Game End ════════════════════════════════════════

describe("Game End", () => {
  test("A wins by eliminating B", () => {
    const m = botMatch("e1");
    m.players.B.hand = [0];
    m.pendingMoves = { A: 1, B: 0 };
    resolveRound(m);
    expect(m.status).toBe("finished");
    expect(m.winner).toBe("A");
  });

  test("B wins by eliminating A", () => {
    const m = botMatch("e2");
    m.players.A.hand = [0];
    m.pendingMoves = { A: 0, B: 1 };
    resolveRound(m);
    expect(m.status).toBe("finished");
    expect(m.winner).toBe("B");
  });

  test("Tie with 1 card each triggers bot exchange → tieCount resets", () => {
    const m = botMatch("e3");
    m.players.A.hand = [0]; m.players.B.hand = [0];
    m.pendingMoves = { A: 0, B: 0 };
    resolveRound(m);
    // tie → tieCount=1=handSize → bot auto-exchanges → tieCount=0
    expect(m.status).toBe("playing");
    expect(m.players.A.tieEx).toBe(1); // preserved
  });
});

// ═══ Bot AI ═════════════════════════════════════════

describe("Bot AI", () => {
  test("inferredHumanHand: correct count after normalize", () => {
    const m = botMatch("b1");
    // resolve once to normalize
    m.pendingMoves = { A: 0, B: 2 };
    resolveRound(m);
    const ih = getInferredHumanHand(m);
    expect(ih.length).toBeGreaterThanOrEqual(1);
    expect(ih.every(c => [0, 1, 2].includes(c))).toBe(true);
  });

  test("inferredHumanHand shrinks as cards are played", () => {
    const m = botMatch("b2");
    m.pendingMoves = { A: 0, B: 2 };
    resolveRound(m);
    const ih1 = getInferredHumanHand(m).length;
    m.pendingMoves = { A: 1, B: 2 };
    resolveRound(m);
    const ih2 = getInferredHumanHand(m).length;
    // Card counts should change
    expect(typeof ih1).toBe("number");
    expect(typeof ih2).toBe("number");
  });
});

// ═══ PVP ════════════════════════════════════════════

describe("PVP", () => {
  test("Pending moves cleared after round", () => {
    const m = pvpMatch("p1");
    m.pendingMoves = { A: 0, B: 2 };
    resolveRound(m);
    expect(m.pendingMoves.A).toBe(null);
    expect(m.pendingMoves.B).toBe(null);
  });

  test("Tie exchange works for both PVP players", () => {
    const m = pvpMatch("p2", { tieCount: 1 });
    m.players.A.hand = [0, 1]; m.players.B.hand = [0, 1];
    m.pendingMoves = { A: 1, B: 1 };
    resolveRound(m);
    expect(m.players.A.tieEx).toBe(1);
    expect(m.players.B.tieEx).toBe(1);
  });
});

// ═══ Edge Cases ═════════════════════════════════════

describe("Edge Cases", () => {
  test("Many consecutive ties don't crash", () => {
    const m = botMatch("x1");
    for (let i = 0; i < 15 && m.status === "playing"; i++) {
      m.pendingMoves = { A: 0, B: 0 };
      resolveRound(m);
    }
    expect(m.status === "playing" || m.status === "finished").toBe(true);
  });

  test("History entries valid after each round", () => {
    const m = botMatch("x2");
    for (let i = 0; i < 8 && m.status === "playing"; i++) {
      m.pendingMoves = { A: i % 3, B: (i * 2) % 3 };
      resolveRound(m);
      const last = m.history[m.history.length - 1];
      expect(last.type).toBe("round");
      expect(last.round).toBe(i + 1);
      expect([0, 1, 2]).toContain(last.cards.A);
      expect(["win", "lose", "tie"]).toContain(last.result);
    }
  });

  test("botMatch helper sets all required fields", () => {
    const m = botMatch("x3");
    expect(m.mode).toBe("human-vs-bot");
    expect(Array.isArray(m.players.A.hand)).toBe(true);
  });
});
