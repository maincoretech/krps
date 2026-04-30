import { describe, test, expect, mock } from "bun:test";
import { resolveRound, sortCards, getInferredHumanHand, removeCard } from "./src/match.js";

// Mock minimal dependencies to test the pure logic of resolveRound
// We mock updateMatch and logger to prevent actual DB writes or logs during tests
mock.module("./src/db.js", () => {
  return {
    updateMatch: () => {},
    findMatchById: () => {},
    insertMatch: () => {},
    listMatchesByOwner: () => {},
    listMatchesByUser: () => {},
    deleteMatch: () => {},
    findMatchByInviteCode: () => {}
  };
});
mock.module("./src/logger.js", () => {
  return {
    default: { match: () => {}, info: () => {}, error: () => {} }
  };
});

function createMockMatch() {
  return {
    id: "test-match",
    mode: "human-vs-bot",
    status: "playing",
    botStrategy: "random",
    roundCount: 0,
    tieCount: 0,
    pool: [0, 1, 2, 2],
    history: [],
    pendingMoves: null,
    players: {
      A: {
        userId: "user-A",
        role: "human",
        hand: [0, 1, 2],
        consecutiveLosses: 0,
        tieExchangeReady: false,
      },
      B: {
        userId: null,
        role: "bot",
        hand: [0, 1, 2],
        consecutiveLosses: 0,
        tieExchangeReady: false,
      }
    }
  };
}

function cardName(val) {
  if (val === 0) return "Rock";
  if (val === 1) return "Paper";
  if (val === 2) return "Scissors";
  return String(val);
}

function logState(step, msg) {
  console.log(`\n  [Step: ${step}] -> ${msg}`);
}

describe("Match Logic Core: resolveRound", () => {
  test("Win scenario: Winner keeps card, draws new, loser loses card to pool", () => {
    const match = createMockMatch();
    logState("Setup", "Testing Win Scenario. Player A has [Rock, Paper, Scissors]. Player B has [Rock, Paper, Scissors]. Pool has 4 cards.");
    
    // A plays Rock (0), B plays Scissors (2). A wins.
    match.pendingMoves = { A: 0, B: 2 };
    logState("Action", `Player A plays ${cardName(0)}, Player B plays ${cardName(2)}.`);
    
    // Store old pool to check differences
    const initialPoolSize = match.pool.length;
    
    const result = resolveRound(match);
    const summary = result.round;

    logState("Assertion", `Result is ${summary.result}. A won. Checking hand sizes and pool...`);

    expect(summary.result).toBe("A");
    
    // A should have 4 cards (played 1, got it back, drew 1)
    expect(match.players.A.hand.length).toBe(4);
    logState("Verification", `Player A hand size is ${match.players.A.hand.length} (expected 4: returned played card + drew 1).`);

    // B should have 2 cards (played 1, lost it, drew none)
    expect(match.players.B.hand.length).toBe(2);
    logState("Verification", `Player B hand size is ${match.players.B.hand.length} (expected 2: lost played card).`);

    // Pool size should be same (loser card in, drawn card out)
    expect(match.pool.length).toBe(initialPoolSize);
    logState("Verification", `Pool size is ${match.pool.length} (remains unchanged: 1 card added, 1 card removed).`);
    
    // Consecutive losses check
    expect(match.players.A.consecutiveLosses).toBe(0);
    expect(match.players.B.consecutiveLosses).toBe(1);
    expect(match.tieCount).toBe(0);
    logState("Success", "Win scenario passed successfully.");
  });

  test("Tie scenario: Both keep cards, no draw, tieCount increases", () => {
    const match = createMockMatch();
    logState("Setup", "Testing Tie Scenario. Both players will play Paper.");
    // Both play Paper (1)
    match.pendingMoves = { A: 1, B: 1 };
    logState("Action", `Player A plays ${cardName(1)}, Player B plays ${cardName(1)}.`);
    
    const result = resolveRound(match);
    const summary = result.round;

    logState("Assertion", `Result is ${summary.result}. Both hands should remain unchanged.`);

    expect(summary.result).toBe("tie");
    
    // Both should still have 3 cards
    expect(match.players.A.hand.length).toBe(3);
    expect(match.players.B.hand.length).toBe(3);
    logState("Verification", `Player A hand: ${match.players.A.hand.length}, Player B hand: ${match.players.B.hand.length}.`);
    
    expect(match.tieCount).toBe(1);
    logState("Verification", `Tie count increased to ${match.tieCount}.`);
    expect(match.players.A.consecutiveLosses).toBe(0);
    expect(match.players.B.consecutiveLosses).toBe(0);
    logState("Success", "Tie scenario passed successfully.");
  });

  test("Opening loss exchange triggers on 2 consecutive losses", () => {
    const match = createMockMatch();
    match.roundCount = 1; // It must be <= 3 to trigger
    match.players.A.consecutiveLosses = 1; // Needs one more to trigger
    logState("Setup", "Testing Opening Loss Exchange. Player A already has 1 consecutive loss (within first 3 rounds).");
    
    // A plays Paper (1), B plays Scissors (2). A loses.
    match.pendingMoves = { A: 1, B: 2 };
    logState("Action", `Player A plays ${cardName(1)}, Player B plays ${cardName(2)}. A loses again (2nd loss).`);
    
    const result = resolveRound(match);
    const summary = result.round;
    
    // The round is processed normally first
    expect(summary.result).toBe("B");
    
    // Check if the special action was triggered
    const exchangeAction = summary.specialActions.find(a => a.type === "opening-loss-exchange" && a.playerId === "A");
    logState("Assertion", `Checking if 'opening-loss-exchange' was triggered for Player A.`);
    expect(exchangeAction).toBeDefined();
    
    // A should have lost the round (2 cards), but the exchange doesn't change hand size
    // It just swaps the lowest card with a random pool card
    expect(match.players.A.hand.length).toBe(2);
    expect(match.players.A.consecutiveLosses).toBe(0); // Should be reset after exchange
    logState("Verification", `Player A's hand size is ${match.players.A.hand.length}, and consecutive losses reset to ${match.players.A.consecutiveLosses}.`);
    logState("Success", "Opening loss exchange scenario passed successfully.");
  });

  test("Tie Exchange Ready state updates correctly", () => {
    const match = createMockMatch();
    match.players.A.hand = [0, 1]; // 2 cards
    match.tieCount = 1; // Not enough ties
    logState("Setup", "Testing Tie Exchange. Player A has 2 cards, current tie count is 1.");
    
    // A plays 1, B plays 1. Tie!
    match.pendingMoves = { A: 1, B: 1 };
    logState("Action", "Both players play Paper. Tie count will reach 2.");
    resolveRound(match);
    
    // Now tieCount is 2, and hand length is 2. tieExchangeReady should become true.
    logState("Assertion", `Tie count is now ${match.tieCount}. Hand size is ${match.players.A.hand.length}. Expecting tieExchangeReady to be true.`);
    expect(match.players.A.tieExchangeReady).toBe(true);
    logState("Success", "Tie Exchange Ready state scenario passed successfully.");
  });

  test("Game ends when a player runs out of cards", () => {
    const match = createMockMatch();
    match.players.A.hand = [1]; // A has only 1 card
    match.players.B.hand = [2, 0];
    logState("Setup", "Testing Game Over scenario. Player A has 1 card left.");
    
    // A plays Paper (1), B plays Scissors (2). A loses its last card.
    match.pendingMoves = { A: 1, B: 2 };
    logState("Action", `Player A plays their last card (${cardName(1)}). Player B plays ${cardName(2)}. A loses.`);
    
    const result = resolveRound(match);
    
    logState("Assertion", "Checking if game is marked as finished.");
    expect(match.players.A.hand.length).toBe(0);
    expect(match.status).toBe("finished");
    expect(match.winner).toBe("B");
    expect(result.round.gameOver).toBeDefined();
    expect(result.round.gameOver.winnerId).toBe("B");
    logState("Success", "Game ends properly when a player runs out of cards.");
  });
});

describe("Match Logic Math/Array Optimizations", () => {
  test("sortCards uses counting array for O(N) sort", () => {
    logState("Setup", "Testing sortCards optimization with counting array O(N).");
    const cards = [2, 0, 1, 2, 1, 0, 0];
    logState("Action", `Sorting array: [${cards.join(", ")}].`);
    
    const sorted = sortCards(cards);
    
    logState("Assertion", `Array sorted to: [${sorted.join(", ")}].`);
    expect(sorted).toEqual([0, 0, 0, 1, 1, 2, 2]);
    
    expect(sortCards([])).toEqual([]);
    expect(sortCards([1])).toEqual([1]);
    expect(sortCards([0, 1, 2])).toEqual([0, 1, 2]);
    logState("Success", "sortCards optimization passed successfully.");
  });

  test("getInferredHumanHand calculates remaining pool accurately using counting array", () => {
    const match = createMockMatch();
    logState("Setup", "Testing getInferredHumanHand based on counting array logic.");
    logState("State", "Total cards in game: 3xRock, 3xPaper, 4xScissors. Pool has: [0, 1, 2, 2]. Bot has: [0, 1, 2].");
    
    const inferred = getInferredHumanHand(match, "B");
    
    logState("Assertion", `Calculated inferred hand for Human: [${inferred.join(", ")}]. Expected: [0, 1, 2].`);
    expect(inferred.sort()).toEqual([0, 1, 2]);
    logState("Success", "Inferred hand logic passed successfully.");
  });
  
  test("getInferredHumanHand handles mid-game card distribution", () => {
    const match = createMockMatch();
    match.pool = [1, 2]; // 1 P, 1 S
    match.players.B.hand = [0, 0, 2]; // 2 R, 1 S
    logState("Setup", "Testing mid-game getInferredHumanHand.");
    logState("State", "Pool has: [1, 2]. Bot has: [0, 0, 2].");
    
    const inferred = getInferredHumanHand(match, "B");
    
    logState("Assertion", `Calculated inferred hand for Human: [${inferred.join(", ")}]. Expected: [0, 1, 1, 2, 2].`);
    expect(inferred.sort()).toEqual([0, 1, 1, 2, 2]);
    logState("Success", "Mid-game inferred hand logic passed successfully.");
  });

  test("removeCard safely removes exactly one instance of a card", () => {
    logState("Setup", "Testing removeCard to ensure it removes exactly one instance using O(N) lookup.");
    const hand = [0, 1, 1, 2];
    logState("Action", `Removing one Paper (1) from hand: [${hand.join(", ")}].`);
    
    removeCard(hand, 1);
    
    logState("Assertion", `Hand is now: [${hand.join(", ")}]. Expected: [0, 1, 2].`);
    expect(hand).toEqual([0, 1, 2]);
    
    logState("Action", `Removing Rock (0) from hand.`);
    removeCard(hand, 0);
    expect(hand).toEqual([1, 2]);
    
    logState("Success", "removeCard function operates correctly.");
  });
});
