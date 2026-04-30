import { randomUUID } from "node:crypto";
import logger from "./logger.js";
import {
  findMatchById as dbFindMatchById,
  findMatchByInviteCode as dbFindMatchByInviteCode,
  insertMatch as dbInsertMatch,
  listMatchesByOwner as dbListMatchesByOwner,
  listMatchesByUser as dbListMatchesByUser,
  updateMatch as dbUpdateMatch,
  deleteMatch as dbDeleteMatch,
} from "./db.js";

// --- IN-MEMORY MATCH CACHE ---
const activeMatches = new Map(); // id -> match object
const dirtyMatches = new Set();  // set of match ids that need to be flushed

// Flush dirty matches to SQLite every 2 seconds
setInterval(() => {
  if (dirtyMatches.size === 0) return;
  const toFlush = Array.from(dirtyMatches);
  dirtyMatches.clear();
  
  for (const id of toFlush) {
    const match = activeMatches.get(id);
    if (match) {
      try {
        dbUpdateMatch(match);
      } catch (err) {
        logger.error(`Failed to flush match ${id} to DB: ${err.message}`);
        dirtyMatches.add(id); // Re-queue on failure
      }
    }
  }
}, 2000);

function getMatchFromCacheOrDb(matchId) {
  if (activeMatches.has(matchId)) {
    return activeMatches.get(matchId);
  }
  const match = dbFindMatchById(matchId);
  if (match) {
    // Only cache active/playing games to save memory
    if (match.status !== "finished") {
      activeMatches.set(matchId, match);
    }
  }
  return match;
}

function findMatchByInviteCode(code) {
  // Check memory first
  for (const match of activeMatches.values()) {
    if (match.inviteCode === code && match.mode === "human-vs-human") return match;
  }
  return dbFindMatchByInviteCode(code);
}

function updateMatch(match) {
  if (match.status === "finished") {
    // Write immediately and remove from memory cache
    dbUpdateMatch(match);
    activeMatches.delete(match.id);
    dirtyMatches.delete(match.id);
  } else {
    // Update in memory and mark dirty
    activeMatches.set(match.id, match);
    dirtyMatches.add(match.id);
  }
}

function insertMatch(match) {
  dbInsertMatch(match);
  if (match.status !== "finished") {
    activeMatches.set(match.id, match);
  }
}

function deleteMatchFromStore(matchId) {
  activeMatches.delete(matchId);
  dirtyMatches.delete(matchId);
  dbDeleteMatch(matchId);
}

function listMatchesByUser(userId) {
  // For listing, we can just rely on DB, or merge DB and Memory.
  // DB will be at most 2 seconds behind, which is acceptable for lists,
  // but to be strictly correct, we merge.
  const dbMatches = dbListMatchesByUser(userId);
  const memMatches = Array.from(activeMatches.values()).filter(m => 
    m.players?.A?.userId === userId || m.players?.B?.userId === userId
  );
  
  // Create a map to prefer memory matches over DB matches
  const mergedMap = new Map();
  for (const m of dbMatches) mergedMap.set(m.id, m);
  for (const m of memMatches) mergedMap.set(m.id, m); // Overwrite with fresh mem state
  
  return Array.from(mergedMap.values());
}

function listMatchesByOwner(userId) {
  const dbMatches = dbListMatchesByOwner(userId);
  const memMatches = Array.from(activeMatches.values()).filter(m => 
    m.ownerId === userId || m.hostUserId === userId
  );
  
  const mergedMap = new Map();
  for (const m of dbMatches) mergedMap.set(m.id, m);
  for (const m of memMatches) mergedMap.set(m.id, m);
  
  return Array.from(mergedMap.values());
}
// --- END CACHE ---

const CARD_ORDER = [0, 1, 2];
const CARD_BEATS = { 0: 2, 1: 0, 2: 1 };
const COUNTER_CARD = { 0: 1, 1: 2, 2: 0 };

const INITIAL_HAND = [0, 1, 2];
const INITIAL_POOL = [0, 1, 2, 2];
const DEFAULT_BOT_STRATEGY = "random";

const BOT_STRATEGIES = [
  { id: "random", name: "Random", description: "Play a random legal card and exchange a random card." },
  { id: "pattern", name: "Pattern", description: "Rotate through 0, 1, 2 in a fixed order." },
  { id: "counter", name: "Counter", description: "Choose the card with the best expected result against the human hand." },
  { id: "adaptive", name: "Adaptive", description: "Predict the human's next move from history, then counter it." },
  { id: "defensive", name: "Defensive", description: "Prefer cards with lower loss risk, even if it means taking more ties." },
  { id: "streak", name: "Streak", description: "Switch style by momentum: pattern when stable, counter when losing." },
];

const BOT_STRATEGY_MAP = Object.fromEntries(BOT_STRATEGIES.map(s => [s.id, s]));

export class MatchError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "MatchError";
    this.status = status;
  }
}

export function listBotStrategies() {
  return BOT_STRATEGIES.map(s => ({ ...s }));
}

function normalizeCard(card) {
  const normalized = Number(card);
  if (![0, 1, 2].includes(normalized)) {
    throw new MatchError(400, "Card must be one of: 0, 1, 2.");
  }
  return normalized;
}

function normalizeBotStrategy(botStrategy, fallback = DEFAULT_BOT_STRATEGY) {
  const normalized = String(botStrategy ?? fallback).trim().toLowerCase();
  if (BOT_STRATEGY_MAP[normalized]) return normalized;
  if (fallback && BOT_STRATEGY_MAP[fallback]) return fallback;
  throw new MatchError(400, `botStrategy must be one of: ${BOT_STRATEGIES.map(i => i.id).join(", ")}.`);
}

function getBotStrategyInfo(botStrategy) {
  return { ...BOT_STRATEGY_MAP[normalizeBotStrategy(botStrategy)] };
}

function normalizeInviteCode(inviteCode) {
  const normalized = String(inviteCode ?? "").trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new MatchError(400, "Invite code must be a 6-digit string.");
  }
  return normalized;
}

export function sortCards(cards) {
  let r = 0, p = 0, s = 0;
  for (let i = 0; i < cards.length; i++) {
    if (cards[i] === 0) r++;
    else if (cards[i] === 1) p++;
    else if (cards[i] === 2) s++;
  }
  let index = 0;
  while (r--) cards[index++] = 0;
  while (p--) cards[index++] = 1;
  while (s--) cards[index++] = 2;
  return cards;
}

function drawRandomCard(pool) {
  if (pool.length === 0) throw new MatchError(500, "Pool is empty.");
  const index = Math.floor(Math.random() * pool.length);
  return pool.splice(index, 1)[0];
}

export function removeCard(cards, card) {
  const index = cards.indexOf(card);
  if (index === -1) throw new MatchError(400, `Card ${card} is not in hand.`);
  cards.splice(index, 1);
}

function createSeatState(userId = null, username = "") {
  return {
    userId,
    username,
    role: userId ? "human" : "bot",
    hand: sortCards(INITIAL_HAND),
    consecutiveLosses: 0,
    tieExchangeReady: false,
  };
}

function ensureSeatState(player) {
  player.userId = player.userId ?? null;
  player.username = String(player.username ?? "");
  player.role = player.userId ? "human" : "bot";
  player.hand = sortCards(Array.isArray(player.hand) ? player.hand : INITIAL_HAND);
  player.consecutiveLosses = Number(player.consecutiveLosses ?? 0);
  player.tieExchangeReady = Boolean(player.tieExchangeReady);
}

function ensureMatchShape(match) {
  match.mode = match.mode ?? "human-vs-bot";
  match.name = String(match.name ?? "").trim() || `Match ${match.id}`;
  match.status = match.status ?? "playing";
  match.botStrategy = match.mode === "human-vs-bot" ? normalizeBotStrategy(match.botStrategy) : null;
  
  if (match.mode === "human-vs-human") {
    match.isPublic = match.isPublic ?? true;
    match.hostUserId = match.hostUserId ?? match.players?.A?.userId ?? null;
    match.guestUserId = match.guestUserId ?? match.players?.B?.userId ?? null;
    match.inviteCode = match.inviteCode ?? null;
    match.matchNumber = Number(match.matchNumber ?? 1);
    match.startVotes = { A: Boolean(match.startVotes?.A), B: Boolean(match.startVotes?.B) };
    match.rematchVotes = { A: Boolean(match.rematchVotes?.A), B: Boolean(match.rematchVotes?.B) };
    match.pendingMoves = {
      A: match.pendingMoves?.A == null ? null : Number(match.pendingMoves.A),
      B: match.pendingMoves?.B == null ? null : Number(match.pendingMoves.B),
    };
  }

  match.winner = match.winner ?? null;
  match.roundCount = Number(match.roundCount ?? 0);
  match.tieCount = Number(match.tieCount ?? 0);
  match.pool = sortCards(Array.isArray(match.pool) ? match.pool : INITIAL_POOL);
  match.history = Array.isArray(match.history) ? match.history : [];
  match.createdAt = match.createdAt ?? new Date().toISOString();
  match.updatedAt = match.updatedAt ?? match.createdAt;
  
  match.players = match.players ?? { A: createSeatState(), B: createSeatState() };
  ensureSeatState(match.players.A);
  ensureSeatState(match.players.B);
}

function clonePlayer(player) {
  return {
    userId: player.userId,
    username: player.username,
    role: player.role,
    hand: [...player.hand],
    consecutiveLosses: player.consecutiveLosses,
    canExchangeOnTie: player.tieExchangeReady,
  };
}

function serializeMatch(match, userId = null) {
  const data = {
    id: match.id,
    name: match.name,
    ownerId: match.ownerId ?? match.hostUserId,
    mode: match.mode,
    status: match.status,
    winner: match.winner,
    roundCount: match.roundCount,
    tieCount: match.tieCount,
    pool: sortCards(match.pool),
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
    players: { A: clonePlayer(match.players.A), B: clonePlayer(match.players.B) },
    history: match.history.map(entry => JSON.parse(JSON.stringify(entry))),
  };

  if (match.mode === "human-vs-bot") {
    const strategy = getBotStrategyInfo(match.botStrategy);
    data.humanPlayerId = "A";
    data.bot = { playerId: "B", strategy: strategy.id, strategyName: strategy.name, strategyDescription: strategy.description };
  } else {
    data.isPublic = match.isPublic;
    data.hostUserId = match.hostUserId;
    data.guestUserId = match.guestUserId;
    data.inviteCode = match.inviteCode;
    data.matchNumber = match.matchNumber;
    data.startVotes = { ...match.startVotes };
    data.rematchVotes = { ...match.rematchVotes };
    
    // Hide opponent pending move value and hand
    data.pendingMoves = { A: null, B: null };
    if (match.pendingMoves.A != null) data.pendingMoves.A = userId === match.players.A.userId ? match.pendingMoves.A : -1;
    if (match.pendingMoves.B != null) data.pendingMoves.B = userId === match.players.B.userId ? match.pendingMoves.B : -1;
    
    // Self player ID helper
    data.selfPlayerId = userId === match.players.A.userId ? "A" : userId === match.players.B.userId ? "B" : null;
    data.opponentPlayerId = data.selfPlayerId ? (data.selfPlayerId === "A" ? "B" : "A") : null;
    
    if (data.opponentPlayerId && data.players[data.opponentPlayerId]) {
      data.players[data.opponentPlayerId].handSize = data.players[data.opponentPlayerId].hand.length;
      data.players[data.opponentPlayerId].hand = undefined;
    }
  }
  return data;
}

export function serializeMatchDiff(match, userId = null) {
  // Only send the parts that actually change during gameplay.
  // This drastically cuts down CPU usage (avoiding history array deep clone) and bandwidth.
  const data = {
    id: match.id,
    status: match.status,
    winner: match.winner,
    roundCount: match.roundCount,
    tieCount: match.tieCount,
    pool: sortCards(match.pool),
    updatedAt: match.updatedAt,
    players: { A: clonePlayer(match.players.A), B: clonePlayer(match.players.B) },
    // Only send the latest history entry instead of the whole array
    newHistoryItem: match.history.length > 0 ? JSON.parse(JSON.stringify(match.history[match.history.length - 1])) : null,
  };

  if (match.mode === "human-vs-human") {
    data.startVotes = { ...match.startVotes };
    data.rematchVotes = { ...match.rematchVotes };
    
    data.pendingMoves = { A: null, B: null };
    if (match.pendingMoves.A != null) data.pendingMoves.A = userId === match.players.A.userId ? match.pendingMoves.A : -1;
    if (match.pendingMoves.B != null) data.pendingMoves.B = userId === match.players.B.userId ? match.pendingMoves.B : -1;
    
    data.selfPlayerId = userId === match.players.A.userId ? "A" : userId === match.players.B.userId ? "B" : null;
    data.opponentPlayerId = data.selfPlayerId ? (data.selfPlayerId === "A" ? "B" : "A") : null;
    
    if (data.opponentPlayerId && data.players[data.opponentPlayerId]) {
      data.players[data.opponentPlayerId].handSize = data.players[data.opponentPlayerId].hand.length;
      data.players[data.opponentPlayerId].hand = undefined;
    }
  }
  return data;
}

function summarizeMatch(match) {
  return {
    id: match.id,
    name: match.name,
    mode: match.mode,
    status: match.status,
    winner: match.winner,
    roundCount: match.roundCount,
    tieCount: match.tieCount,
    updatedAt: match.updatedAt,
    createdAt: match.createdAt,
    ...(match.mode === "human-vs-bot" ? { botStrategy: match.botStrategy } : {
      isPublic: match.isPublic,
      hostUserId: match.hostUserId,
      guestUserId: match.guestUserId,
      matchNumber: match.matchNumber,
    })
  };
}

function getWinner(cardA, cardB) {
  const MASK = 0b0001100010000100011000;
  return [null, "A", "B"][(MASK >> (((cardA << 2) | cardB) << 1)) & 3];
}

// Bot AI Logic
function getBotOutcomeScore(botCard, humanCard) {
  const winner = getWinner(humanCard, botCard);
  return winner === "B" ? 1 : winner === "A" ? -1 : 0;
}

function getPredictedHumanCard(humanHand, history) {
  const scores = Object.fromEntries(CARD_ORDER.map(c => [c, 0]));
  for (const card of humanHand) scores[card] += 1;
  const historyCards = history.filter(e => e.type === "round").map(e => e.cards.A);
  historyCards.forEach((card, index) => { if (humanHand.includes(card)) scores[card] += index + 1; });
  const lastCard = historyCards.at(-1);
  if (lastCard && humanHand.includes(lastCard)) scores[lastCard] += 2;

  const uniqueCards = [...new Set(humanHand)];
  if (uniqueCards.length === 0) return null;
  uniqueCards.sort((a, b) => (scores[b] - scores[a]) || (CARD_ORDER.indexOf(a) - CARD_ORDER.indexOf(b)));
  return uniqueCards[0];
}

export function getInferredHumanHand(match) {
  // Total initial cards: 3x0, 3x1, 4x2
  let r = 3, p = 3, s = 4;
  for (let i = 0; i < match.players.B.hand.length; i++) {
    const card = match.players.B.hand[i];
    if (card === 0) r--;
    else if (card === 1) p--;
    else if (card === 2) s--;
  }
  for (let i = 0; i < match.pool.length; i++) {
    const card = match.pool[i];
    if (card === 0) r--;
    else if (card === 1) p--;
    else if (card === 2) s--;
  }
  const inferred = [];
  while (r-- > 0) inferred.push(0);
  while (p-- > 0) inferred.push(1);
  while (s-- > 0) inferred.push(2);
  return inferred;
}

function chooseBotCard(match) {
  const botHand = match.players.B.hand;
  const inferredHand = getInferredHumanHand(match);
  const strategy = match.botStrategy;
  
  if (strategy === "pattern" || (strategy === "streak" && match.players.B.consecutiveLosses === 0)) {
    const preferredOrder = [CARD_ORDER[match.roundCount % 3], CARD_ORDER[(match.roundCount + 1) % 3], CARD_ORDER[(match.roundCount + 2) % 3]];
    const card = preferredOrder.find(i => botHand.includes(i)) ?? botHand[0];
    return { card, reason: `Machine used pattern strategy.` };
  }
  
  if (strategy === "counter" || strategy === "defensive" || strategy === "streak") {
    const ranked = [...new Set(botHand)].map(card => ({
      card,
      score: inferredHand.reduce((sum, h) => sum + getBotOutcomeScore(card, h), 0),
      wins: inferredHand.filter(h => getWinner(h, card) === "B").length,
      losses: inferredHand.filter(h => getWinner(h, card) === "A").length
    })).sort((a, b) => strategy === "defensive" ? (a.losses - b.losses || b.wins - a.wins) : (b.score - a.score || b.wins - a.wins));
    return { card: ranked[0].card, reason: `Machine used ${strategy} strategy.` };
  }
  
  if (strategy === "adaptive") {
    const predicted = getPredictedHumanCard(inferredHand, match.history);
    if (predicted != null && botHand.includes(COUNTER_CARD[predicted])) {
      return { card: COUNTER_CARD[predicted], reason: "Machine countered predicted move." };
    }
  }
  
  return { card: botHand[Math.floor(Math.random() * botHand.length)], reason: "Machine picked random." };
}

function chooseBotExchangeCard(match) {
  const botHand = match.players.B.hand;
  return { card: botHand[0], reason: "Machine exchanged." };
}

// Core Gameplay Logic
function refreshTieExchangeState(match) {
  for (const player of Object.values(match.players)) {
    if (match.status !== "playing" || !player.userId || player.hand.length === 0) {
      player.tieExchangeReady = false;
      continue;
    }
    player.tieExchangeReady = match.tieCount > 0 && match.tieCount === player.hand.length;
  }
  if (match.mode === "human-vs-bot") {
    match.players.B.tieExchangeReady = match.tieCount > 0 && match.tieCount === match.players.B.hand.length;
  }
}

function finishMatchIfNeeded(match) {
  if (match.players.A.hand.length === 0) {
    match.status = "finished";
    match.winner = "B";
  } else if (match.players.B.hand.length === 0) {
    match.status = "finished";
    match.winner = "A";
  }
}

function resolveOpeningLossExchange(match, seat, roundSummary) {
  const player = match.players[seat];
  if (match.roundCount > 3 || player.consecutiveLosses < 2 || player.hand.length === 0) return;

  const card = sortCards(player.hand)[0];
  const drawnCard = drawRandomCard(match.pool);
  match.pool.push(card); // PUSH AFTER DRAWING TO AVOID DRAWING THE SAME CARD
  
  removeCard(player.hand, card);
  player.hand.push(drawnCard);
  player.hand = sortCards(player.hand);
  match.pool = sortCards(match.pool);
  player.consecutiveLosses = 0;

  roundSummary.specialActions.push({ type: "opening-loss-exchange", playerId: seat, putIntoPool: card, drew: drawnCard });
}

export function resolveRound(match) {
  const cardA = match.pendingMoves?.A ?? match.pendingMoves?.cardA;
  const cardB = match.pendingMoves?.B ?? match.pendingMoves?.cardB;
  
  const playerA = match.players.A;
  const playerB = match.players.B;

  removeCard(playerA.hand, cardA);
  removeCard(playerB.hand, cardB);

  const roundNumber = match.roundCount + 1;
  const winnerId = getWinner(cardA, cardB);
  const roundSummary = {
    type: "round", round: roundNumber,
    cards: { A: cardA, B: cardB }, result: winnerId ?? "tie",
    specialActions: [],
  };

  if (match.mode === "human-vs-bot") {
    roundSummary.botDecision = { strategy: match.botStrategy, reason: match.botDecisionReason };
  }

  if (!winnerId) {
    playerA.hand.push(cardA); playerB.hand.push(cardB);
    playerA.consecutiveLosses = 0; playerB.consecutiveLosses = 0;
    match.tieCount += 1;
  } else {
    const loserId = winnerId === "A" ? "B" : "A";
    const winnerCard = winnerId === "A" ? cardA : cardB;
    const loserCard = loserId === "A" ? cardA : cardB;
    const winner = match.players[winnerId];
    const loser = match.players[loserId];

    winner.hand.push(winnerCard);
    const drawnCard = drawRandomCard(match.pool);
    match.pool.push(loserCard); // PUSH AFTER DRAWING
    winner.hand.push(drawnCard);

    winner.consecutiveLosses = 0;
    loser.consecutiveLosses += 1;
    match.tieCount = 0;
    roundSummary.drew = { playerId: winnerId, card: drawnCard };
  }

  playerA.hand = sortCards(playerA.hand);
  playerB.hand = sortCards(playerB.hand);
  match.pool = sortCards(match.pool);
  match.roundCount = roundNumber;

  resolveOpeningLossExchange(match, "A", roundSummary);
  resolveOpeningLossExchange(match, "B", roundSummary);
  finishMatchIfNeeded(match);
  refreshTieExchangeState(match);

  // Bot Tie Exchange
  if (match.mode === "human-vs-bot" && match.status === "playing" && match.players.B.tieExchangeReady) {
    const decision = chooseBotExchangeCard(match);
    const bot = match.players.B;
    const drawnCard = drawRandomCard(match.pool);
    match.pool.push(decision.card); // PUSH AFTER DRAWING
    
    removeCard(bot.hand, decision.card);
    bot.hand.push(drawnCard);
    bot.hand = sortCards(bot.hand);
    match.pool = sortCards(match.pool);
    bot.tieExchangeReady = false;

    roundSummary.specialActions.push({
      type: "bot-tie-exchange", playerId: "B", strategy: match.botStrategy,
      putIntoPool: decision.card, drew: drawnCard, reason: decision.reason,
    });
  }
  
  finishMatchIfNeeded(match);
  refreshTieExchangeState(match);

  roundSummary.poolAfterRound = [...match.pool];
  roundSummary.handsAfterRound = { A: [...match.players.A.hand], B: [...match.players.B.hand] };

  if (match.status === "finished") {
    roundSummary.gameOver = { loserId: match.winner === "A" ? "B" : "A", winnerId: match.winner };
    
    // Generate match summary log
    const cardNames = { 0: "R", 1: "P", 2: "S" };
    const plays = match.history
      .filter(h => h.type === "round")
      .map(h => `R${h.round}: A(${cardNames[h.cards.A]}) vs B(${cardNames[h.cards.B]}) -> ${h.result}`);
      
    // Add current round to the summary string
    plays.push(`R${roundSummary.round}: A(${cardNames[roundSummary.cards.A]}) vs B(${cardNames[roundSummary.cards.B]}) -> ${roundSummary.result}`);
    
    logger.match(`[${match.name || match.id}] Match finished. Winner: ${match.winner}. Summary: [ ${plays.join(" | ")} ]`);
  }

  match.history.push(roundSummary);
  match.updatedAt = new Date().toISOString();
  
  if (match.mode === "human-vs-human") {
    match.pendingMoves = { A: null, B: null };
  } else {
    match.pendingMoves = null;
  }

  updateMatch(match);
  return { round: JSON.parse(JSON.stringify(roundSummary)), match: serializeMatch(match) };
}

// Exposed API

export async function getOwnedMatch(matchId, userId) {
  const match = getMatchFromCacheOrDb(matchId);
  if (!match) throw new MatchError(404, "Match not found.");
  ensureMatchShape(match);
  
  if (match.mode === "human-vs-bot" && match.ownerId !== userId) {
    throw new MatchError(403, "You do not have access to this game.");
  } else if (match.mode === "human-vs-human" && match.players.A.userId !== userId && match.players.B.userId !== userId) {
    throw new MatchError(403, "You are not a player in this room.");
  }
  
  return match;
}

export async function createMatch(userId, payload) {
  const now = new Date().toISOString();
  const mode = payload?.mode === "human-vs-human" ? "human-vs-human" : "human-vs-bot";
  
  const match = {
    id: randomUUID(),
    ownerId: userId,
    mode,
    status: mode === "human-vs-human" ? "waiting" : "playing",
    createdAt: now, updatedAt: now,
    history: [], pool: sortCards(INITIAL_POOL),
    roundCount: 0, tieCount: 0,
    players: { A: createSeatState(), B: createSeatState() }
  };
  
  if (mode === "human-vs-bot") {
    match.botStrategy = normalizeBotStrategy(payload?.botStrategy);
    match.name = String(payload?.name ?? "").trim().slice(0, 64) || `Game ${new Date(now).toLocaleString("sv-SE").replace(" ", "T")}`;
    match.players.A.userId = userId;
  } else {
    match.name = String(payload?.name ?? "").trim().slice(0, 64) || `Room ${match.id.substring(0, 4).toUpperCase()}`;
    match.isPublic = payload?.isPublic !== false;
    match.inviteCode = match.isPublic ? null : Math.floor(100000 + Math.random() * 900000).toString();
    match.hostUserId = userId;
    match.guestUserId = null;
    match.matchNumber = 1;
    match.startVotes = { A: false, B: false };
    match.rematchVotes = { A: false, B: false };
    match.pendingMoves = { A: null, B: null };
    match.players.A = createSeatState(userId, payload?.username ?? "Host");
  }
  
  insertMatch(match);
  return serializeMatch(match, userId);
}

export async function listMatches(userId) {
  const botGames = listMatchesByOwner(userId).filter(m => m.mode === "human-vs-bot");
  const pvpGames = listMatchesByUser(userId).filter(m => m.mode === "human-vs-human");
  const all = [...botGames, ...pvpGames];
  return all.map(m => { ensureMatchShape(m); return m; })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summarizeMatch);
}

export async function getMatchState(matchId, userId) {
  const match = findMatchById(matchId);
  if (!match) throw new MatchError(404, "Match not found.");
  ensureMatchShape(match);
  
  if (match.mode === "human-vs-human" && match.status === "waiting" && !match.players.A.userId && !match.players.B.userId) {
    // Edge case handling if room is completely empty, should not happen normally
  }
  return serializeMatch(match, userId);
}

export async function submitMove(matchId, userId, payload) {
  const match = await getOwnedMatch(matchId, userId);
  if (match.status !== "playing") throw new MatchError(400, "Match is not playing.");

  if (match.mode === "human-vs-bot") {
    const cardA = normalizeCard(payload?.cardA ?? payload?.card);
    const botDecision = chooseBotCard(match);
    match.pendingMoves = { cardA, cardB: botDecision.card };
    match.botDecisionReason = botDecision.reason;
    return resolveRound(match);
  } else {
    const seat = match.players.A.userId === userId ? "A" : "B";
    const card = normalizeCard(payload?.card);
    
    if (match.pendingMoves[seat] != null) throw new MatchError(400, "You have already submitted a move.");
    if (!match.players[seat].hand.includes(card)) throw new MatchError(400, "Card is not in your hand.");

    match.pendingMoves[seat] = card;
    match.updatedAt = new Date().toISOString();
    updateMatch(match);
    
    if (match.pendingMoves.A != null && match.pendingMoves.B != null) {
      return resolveRound(match);
    }
    return { match: serializeMatch(match, userId) };
  }
}

export async function exchangeCard(matchId, userId, payload) {
  const match = await getOwnedMatch(matchId, userId);
  if (match.status !== "playing") throw new MatchError(400, "Match has already finished.");

  const seat = match.mode === "human-vs-bot" ? "A" : (match.players.A.userId === userId ? "A" : "B");
  if (match.mode === "human-vs-bot" && payload?.playerId && payload.playerId !== "A") {
    throw new MatchError(400, "In human-vs-bot mode only player A can manually exchange.");
  }
  
  const card = normalizeCard(payload?.card);
  const player = match.players[seat];

  if (!player.tieExchangeReady) throw new MatchError(400, "Tie exchange is not available for this player.");

  const drawnCard = drawRandomCard(match.pool);
  match.pool.push(card); // PUSH AFTER DRAWING TO FIX BUG
  
  removeCard(player.hand, card);
  player.hand.push(drawnCard);
  player.hand = sortCards(player.hand);
  match.pool = sortCards(match.pool);
  player.tieExchangeReady = false;

  const exchangeSummary = {
    type: "tie-exchange", afterRound: match.roundCount, playerId: seat,
    putIntoPool: card, drew: drawnCard,
    poolAfterExchange: [...match.pool], handAfterExchange: [...player.hand],
  };

  match.history.push(exchangeSummary);
  match.updatedAt = new Date().toISOString();
  updateMatch(match);

  return { exchange: JSON.parse(JSON.stringify(exchangeSummary)), match: serializeMatch(match, userId) };
}

// Multiplayer Specific Room Functions
export async function joinMatchByCode(inviteCode, userId, username) {
  const normalized = normalizeInviteCode(inviteCode);
  const match = findMatchByInviteCode(normalized);
  if (!match || match.mode !== "human-vs-human") throw new MatchError(404, "Invalid invite code.");
  ensureMatchShape(match);
  
  if (match.players.A.userId === userId || match.players.B.userId === userId) {
    return serializeMatch(match, userId);
  }
  
  if (match.status !== "waiting" || match.guestUserId) throw new MatchError(400, "Room is full or already started.");
  
  match.guestUserId = userId;
  match.players.B = createSeatState(userId, username);
  match.updatedAt = new Date().toISOString();
  updateMatch(match);
  return serializeMatch(match, userId);
}

export async function joinPublicMatch(roomId, userId, username) {
  const match = getMatchFromCacheOrDb(roomId);
  if (!match || match.mode !== "human-vs-human" || !match.isPublic) throw new MatchError(404, "Public room not found.");
  ensureMatchShape(match);
  
  if (match.players.A.userId === userId || match.players.B.userId === userId) return serializeMatch(match, userId);
  if (match.status !== "waiting" || match.guestUserId) throw new MatchError(400, "Room is full or already started.");
  
  match.guestUserId = userId;
  match.players.B = createSeatState(userId, username);
  match.updatedAt = new Date().toISOString();
  updateMatch(match);
  return serializeMatch(match, userId);
}

export async function leaveMatch(roomId, userId) {
  const match = getMatchFromCacheOrDb(roomId);
  if (!match || match.mode !== "human-vs-human") return;
  ensureMatchShape(match);
  
  const seat = match.players.A.userId === userId ? "A" : match.players.B.userId === userId ? "B" : null;
  if (!seat) return;
  
  if (match.status === "waiting") {
    if (seat === "A") {
      deleteMatchFromStore(match.id);
    } else {
      match.guestUserId = null;
      match.players.B = createSeatState();
      match.startVotes.B = false;
      match.updatedAt = new Date().toISOString();
      updateMatch(match);
    }
  } else {
    match.status = "finished";
    match.winner = seat === "A" ? "B" : "A";
    match.history.push({ type: "player-left", round: match.roundCount, playerId: seat });
    match.updatedAt = new Date().toISOString();
    updateMatch(match);
  }
  return serializeMatch(match, userId);
}

export async function setMatchReady(roomId, userId, payload) {
  const match = await getOwnedMatch(roomId, userId);
  if (match.status !== "waiting") throw new MatchError(400, "Match is not in waiting state.");
  
  const seat = match.players.A.userId === userId ? "A" : "B";
  match.startVotes[seat] = Boolean(payload?.ready ?? !match.startVotes[seat]);
  
  if (match.startVotes.A && match.startVotes.B) {
    match.status = "playing";
    logger.match(`[${match.name || match.id}] PVP match started`);
  }
  match.updatedAt = new Date().toISOString();
  updateMatch(match);
  return serializeMatch(match, userId);
}

export async function requestMatchRematch(roomId, userId, payload) {
  const match = await getOwnedMatch(roomId, userId);
  if (match.status !== "finished") throw new MatchError(400, "Rematch is only available after the match finishes.");
  
  const seat = match.players.A.userId === userId ? "A" : "B";
  match.rematchVotes[seat] = Boolean(payload?.ready ?? !match.rematchVotes[seat]);
  
  if (match.rematchVotes.A && match.rematchVotes.B) {
    match.matchNumber += 1;
    match.status = "playing";
    match.winner = null;
    match.roundCount = 0;
    match.tieCount = 0;
    match.pool = sortCards(INITIAL_POOL);
    match.history = [];
    match.rematchVotes = { A: false, B: false };
    match.pendingMoves = { A: null, B: null };
    match.players.A.hand = sortCards(INITIAL_HAND);
    match.players.B.hand = sortCards(INITIAL_HAND);
    match.players.A.consecutiveLosses = 0;
    match.players.B.consecutiveLosses = 0;
    match.players.A.tieExchangeReady = false;
    match.players.B.tieExchangeReady = false;
    logger.match(`[${match.name || match.id}] PVP rematch #${match.matchNumber} started`);
  }
  match.updatedAt = new Date().toISOString();
  updateMatch(match);
  return serializeMatch(match, userId);
}

export async function exportMatch(gameId, userId) {
  return getMatchState(gameId, userId);
}

export async function refreshMatchInviteCode(roomId, userId) {
  const match = await getOwnedMatch(roomId, userId);
  if (match.mode !== "human-vs-human") throw new MatchError(400, "Not a room.");
  match.inviteCode = Math.floor(100000 + Math.random() * 900000).toString();
  match.updatedAt = new Date().toISOString();
  updateMatch(match);
  return serializeMatch(match, userId);
}

export async function renameMatch(roomId, userId, payload) {
  const match = await getOwnedMatch(roomId, userId);
  if (match.mode !== "human-vs-human") throw new MatchError(400, "Not a room.");
  match.name = String(payload?.name ?? "").trim().slice(0, 64) || match.name;
  match.updatedAt = new Date().toISOString();
  updateMatch(match);
  return serializeMatch(match, userId);
}

export async function deleteMatchData(roomId, userId) {
  const match = await getOwnedMatch(roomId, userId);
  deleteMatchFromStore(roomId);
  return { deleted: true };
}