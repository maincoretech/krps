import { randomUUID } from "node:crypto";
import logger from "./logger.js";
import {
  findGameById,
  insertGame,
  listGamesByOwner,
  updateGame,
} from "./db.js";

const CARD_ORDER = [0, 1, 2];
const CARD_BEATS = {
  0: 2,
  1: 0,
  2: 1,
};
const COUNTER_CARD = {
  0: 1,
  1: 2,
  2: 0,
};

const INITIAL_HAND = [0, 1, 2];
const INITIAL_POOL = [0, 0, 1, 2];
const DEFAULT_BOT_STRATEGY = "random";

const BOT_STRATEGIES = [
  {
    id: "random",
    name: "Random",
    description: "Play a random legal card and exchange a random card.",
  },
  {
    id: "pattern",
    name: "Pattern",
    description: "Rotate through 0, 1, 2 in a fixed order.",
  },
  {
    id: "counter",
    name: "Counter",
    description: "Choose the card with the best expected result against the human hand.",
  },
  {
    id: "adaptive",
    name: "Adaptive",
    description: "Predict the human's next move from history, then counter it.",
  },
  {
    id: "defensive",
    name: "Defensive",
    description: "Prefer cards with lower loss risk, even if it means taking more ties.",
  },
  {
    id: "streak",
    name: "Streak",
    description: "Switch style by momentum: pattern when stable, counter when losing.",
  },
];

const BOT_STRATEGY_MAP = Object.fromEntries(
  BOT_STRATEGIES.map((strategy) => [strategy.id, strategy])
);

export class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "GameError";
    this.status = status;
  }
}

export function listBotStrategies() {
  return BOT_STRATEGIES.map((strategy) => ({ ...strategy }));
}

function normalizeCard(card) {
  const normalized = Number(card);
  if (![0, 1, 2].includes(normalized)) {
    throw new GameError(400, "Card must be one of: 0, 1, 2.");
  }
  return normalized;
}

function normalizePlayerId(playerId) {
  if (typeof playerId !== "string") {
    throw new GameError(400, "playerId must be a string.");
  }

  const normalized = playerId.trim().toUpperCase();
  if (!["A", "B"].includes(normalized)) {
    throw new GameError(400, "playerId must be A or B.");
  }

  return normalized;
}

function normalizeBotStrategy(botStrategy, fallback = DEFAULT_BOT_STRATEGY) {
  const normalized = String(botStrategy ?? fallback).trim().toLowerCase();
  if (BOT_STRATEGY_MAP[normalized]) {
    return normalized;
  }

  if (fallback && BOT_STRATEGY_MAP[fallback]) {
    return fallback;
  }

  throw new GameError(
    400,
    `botStrategy must be one of: ${BOT_STRATEGIES.map((item) => item.id).join(", ")}.`
  );
}

function getBotStrategyInfo(botStrategy) {
  const strategyId = normalizeBotStrategy(botStrategy);
  return { ...BOT_STRATEGY_MAP[strategyId] };
}

function sortCards(cards) {
  return [...cards].sort(
    (left, right) => CARD_ORDER.indexOf(left) - CARD_ORDER.indexOf(right)
  );
}

function drawRandomCard(pool) {
  if (pool.length === 0) {
    throw new GameError(500, "Pool is empty.");
  }

  const index = Math.floor(Math.random() * pool.length);
  const [card] = pool.splice(index, 1);
  return card;
}

function removeCard(cards, card) {
  const index = cards.indexOf(card);
  if (index === -1) {
    throw new GameError(400, `Card ${card} is not in hand.`);
  }

  cards.splice(index, 1);
}

function createPlayer(role) {
  return {
    role,
    hand: sortCards(INITIAL_HAND),
    consecutiveLosses: 0,
    tieExchangeReady: false,
  };
}

function ensurePlayerShape(player, role) {
  player.role = player.role ?? role;
  player.hand = sortCards(Array.isArray(player.hand) ? player.hand : INITIAL_HAND);
  player.consecutiveLosses = Number(player.consecutiveLosses ?? 0);
  player.tieExchangeReady = Boolean(player.tieExchangeReady);
}

function ensureGameShape(game) {
  game.mode = "human-vs-bot";
  game.botStrategy = normalizeBotStrategy(game.botStrategy, DEFAULT_BOT_STRATEGY);
  game.name = String(game.name ?? "").trim() || `Game ${game.id}`;
  game.status = game.status ?? "playing";
  game.winner = game.winner ?? null;
  game.roundCount = Number(game.roundCount ?? 0);
  game.tieCount = Number(game.tieCount ?? 0);
  game.pool = sortCards(Array.isArray(game.pool) ? game.pool : INITIAL_POOL);
  game.history = Array.isArray(game.history) ? game.history : [];
  game.createdAt = game.createdAt ?? new Date().toISOString();
  game.updatedAt = game.updatedAt ?? game.createdAt;
  game.players = game.players ?? {
    A: createPlayer("human"),
    B: createPlayer("bot"),
  };
  game.players.A = game.players.A ?? createPlayer("human");
  game.players.B = game.players.B ?? createPlayer("bot");
  ensurePlayerShape(game.players.A, "human");
  ensurePlayerShape(game.players.B, "bot");
}

function clonePlayer(player) {
  return {
    role: player.role,
    hand: [...player.hand],
    consecutiveLosses: player.consecutiveLosses,
    canExchangeOnTie: player.tieExchangeReady,
  };
}

function serializeGame(game) {
  const strategy = getBotStrategyInfo(game.botStrategy);

  return {
    id: game.id,
    name: game.name,
    ownerId: game.ownerId,
    mode: game.mode,
    status: game.status,
    winner: game.winner,
    roundCount: game.roundCount,
    tieCount: game.tieCount,
    pool: sortCards(game.pool),
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    humanPlayerId: "A",
    bot: {
      playerId: "B",
      strategy: strategy.id,
      strategyName: strategy.name,
      strategyDescription: strategy.description,
    },
    players: {
      A: clonePlayer(game.players.A),
      B: clonePlayer(game.players.B),
    },
    history: game.history.map((entry) => JSON.parse(JSON.stringify(entry))),
  };
}

function summarizeGame(game) {
  const strategy = getBotStrategyInfo(game.botStrategy);

  return {
    id: game.id,
    name: game.name,
    mode: game.mode,
    status: game.status,
    winner: game.winner,
    roundCount: game.roundCount,
    tieCount: game.tieCount,
    botStrategy: strategy.id,
    botStrategyName: strategy.name,
    updatedAt: game.updatedAt,
    createdAt: game.createdAt,
  };
}

function getWinner(cardA, cardB) {
  const MASK = 0b0001100010000100011000;
  return [null, "A", "B"][(MASK >> (((cardA << 2) | cardB) << 1)) & 3];
}

function getBotOutcomeScore(botCard, humanCard) {
  const winner = getWinner(humanCard, botCard);
  if (winner === "B") {
    return 1;
  }

  if (winner === "A") {
    return -1;
  }

  return 0;
}

function getHumanCardsFromHistory(history) {
  return history.filter((entry) => entry.type === "round").map((entry) => entry.cards.A);
}

function getHumanPredictionScores(humanHand, history) {
  const scores = Object.fromEntries(CARD_ORDER.map((card) => [card, 0]));

  for (const card of humanHand) {
    scores[card] += 1;
  }

  const historyCards = getHumanCardsFromHistory(history);
  historyCards.forEach((card, index) => {
    if (humanHand.includes(card)) {
      scores[card] += index + 1;
    }
  });

  const lastCard = historyCards.at(-1);
  if (lastCard && humanHand.includes(lastCard)) {
    scores[lastCard] += 2;
  }

  return scores;
}

function getPredictedHumanCard(humanHand, history) {
  const scores = getHumanPredictionScores(humanHand, history);
  const uniqueCards = [...new Set(humanHand)];

  if (uniqueCards.length === 0) {
    return null;
  }

  uniqueCards.sort((left, right) => {
    const scoreDiff = scores[right] - scores[left];
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return CARD_ORDER.indexOf(left) - CARD_ORDER.indexOf(right);
  });

  return uniqueCards[0];
}

function getUniqueCards(cards) {
  return [...new Set(cards)];
}

function evaluateBotCardAgainstHumanHand(botCard, humanHand) {
  return humanHand.reduce(
    (sum, humanCard) => sum + getBotOutcomeScore(botCard, humanCard),
    0
  );
}

function countBotWins(botCard, humanHand) {
  return humanHand.filter((humanCard) => getWinner(humanCard, botCard) === "B").length;
}

function countBotLosses(botCard, humanHand) {
  return humanHand.filter((humanCard) => getWinner(humanCard, botCard) === "A").length;
}

function countBotTies(botCard, humanHand) {
  return humanHand.filter((humanCard) => humanCard === botCard).length;
}

function getBestExpectedBotCard(botHand, humanHand) {
  const uniqueBotCards = getUniqueCards(botHand);
  const ranked = uniqueBotCards
    .map((card) => ({
      card,
      expectedScore: evaluateBotCardAgainstHumanHand(card, humanHand),
      winCount: countBotWins(card, humanHand),
    }))
    .sort((left, right) => {
      if (right.expectedScore !== left.expectedScore) {
        return right.expectedScore - left.expectedScore;
      }

      if (right.winCount !== left.winCount) {
        return right.winCount - left.winCount;
      }

      return CARD_ORDER.indexOf(left.card) - CARD_ORDER.indexOf(right.card);
    });

  return ranked[0];
}

function chooseRandomBotCard(botHand) {
  const card = botHand[Math.floor(Math.random() * botHand.length)];
  return {
    card,
    reason: "Machine picked a random legal card.",
  };
}

function choosePatternBotCard(botHand, roundCount) {
  const preferredOrder = [
    CARD_ORDER[roundCount % CARD_ORDER.length],
    CARD_ORDER[(roundCount + 1) % CARD_ORDER.length],
    CARD_ORDER[(roundCount + 2) % CARD_ORDER.length],
  ];
  const card = preferredOrder.find((item) => botHand.includes(item)) ?? botHand[0];

  return {
    card,
    reason: `Machine followed the fixed ${preferredOrder.join(" -> ")} pattern.`,
  };
}

function chooseCounterBotCard(botHand, humanHand) {
  const best = getBestExpectedBotCard(botHand, humanHand);

  return {
    card: best.card,
    reason: `Machine chose the best expected card against the human hand (score ${best.expectedScore}).`,
  };
}

function chooseDefensiveBotCard(botHand, humanHand) {
  const uniqueBotCards = getUniqueCards(botHand);
  const ranked = uniqueBotCards
    .map((card) => ({
      card,
      lossCount: countBotLosses(card, humanHand),
      tieCount: countBotTies(card, humanHand),
      winCount: countBotWins(card, humanHand),
    }))
    .sort((left, right) => {
      if (left.lossCount !== right.lossCount) {
        return left.lossCount - right.lossCount;
      }

      if (right.tieCount !== left.tieCount) {
        return right.tieCount - left.tieCount;
      }

      if (right.winCount !== left.winCount) {
        return right.winCount - left.winCount;
      }

      return CARD_ORDER.indexOf(left.card) - CARD_ORDER.indexOf(right.card);
    });

  const best = ranked[0];

  return {
    card: best.card,
    reason: `Machine played safe by minimizing loss risk (loss ${best.lossCount}, tie ${best.tieCount}).`,
  };
}

function chooseAdaptiveBotCard(game, inferredHand) {
  const botHand = game.players.B.hand;
  const predictedHumanCard = getPredictedHumanCard(inferredHand, game.history);    

  if (!predictedHumanCard) {
    return chooseCounterBotCard(botHand, inferredHand);
  }

  const counterCard = COUNTER_CARD[predictedHumanCard];
  if (botHand.includes(counterCard)) {
    return {
      card: counterCard,
      reason: `Machine predicted ${predictedHumanCard} and countered with ${counterCard}.`,
    };
  }

  const fallback = chooseCounterBotCard(botHand, inferredHand);
  return {
    ...fallback,
    reason: `Machine predicted ${predictedHumanCard} but had no direct counter, so it used the best expected card.`,
  };
}

function chooseStreakBotCard(game, inferredHand) {
  const lossStreak = game.players.B.consecutiveLosses;

  if (lossStreak >= 1) {
    const aggressive = chooseCounterBotCard(game.players.B.hand, inferredHand);
    return {
      ...aggressive,
      reason: `Machine is on a losing streak (${lossStreak}) and switched to counter mode.`,
    };
  }

  const stable = choosePatternBotCard(game.players.B.hand, game.roundCount);
  return {
    ...stable,
    reason: `Machine kept stable tempo with the pattern strategy (loss streak ${lossStreak}).`,
  };
}

function getInferredHumanHand(game) {
  const allCards = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2];
  const outOfHands = [...allCards];
  for (const card of game.players.B.hand) {
    const idx = outOfHands.indexOf(card);
    if (idx !== -1) outOfHands.splice(idx, 1);
  }
  return outOfHands;
}

function chooseBotCard(game) {
  const inferredHand = getInferredHumanHand(game);

  switch (game.botStrategy) {
    case "pattern":
      return choosePatternBotCard(game.players.B.hand, game.roundCount);        
    case "counter":
      return chooseCounterBotCard(game.players.B.hand, inferredHand);    
    case "adaptive":
      return chooseAdaptiveBotCard(game, inferredHand);
    case "defensive":
      return chooseDefensiveBotCard(game.players.B.hand, inferredHand);  
    case "streak":
      return chooseStreakBotCard(game, inferredHand);
    case "random":
    default:
      return chooseRandomBotCard(game.players.B.hand);
  }
}

function chooseBotExchangeCard(game) {
  const botHand = game.players.B.hand;
  const inferredHand = getInferredHumanHand(game);
  const uniqueBotCards = getUniqueCards(botHand);

  if (game.botStrategy === "random") {
    const card = botHand[Math.floor(Math.random() * botHand.length)];
    return {
      card,
      reason: "Machine exchanged a random card.",
    };
  }

  if (game.botStrategy === "pattern") {
    const preferredOrder = [
      CARD_ORDER[(game.roundCount + 2) % CARD_ORDER.length],
      CARD_ORDER[(game.roundCount + 1) % CARD_ORDER.length],
      CARD_ORDER[game.roundCount % CARD_ORDER.length],
    ];
    const card =
      preferredOrder.find((item) => botHand.includes(item)) ?? sortCards(botHand)[0];

    return {
      card,
      reason: `Machine exchanged according to the reversed ${preferredOrder.join(" -> ")} pattern.`,
    };
  }

  const ranked = uniqueBotCards
    .map((card) => ({
      card,
      expectedScore: evaluateBotCardAgainstHumanHand(card, inferredHand),
      predictedScore: getBotOutcomeScore(
        card,
        getPredictedHumanCard(inferredHand, game.history) ?? inferredHand[0]
      ),
    }))
    .sort((left, right) => {
      if (left.predictedScore !== right.predictedScore) {
        return left.predictedScore - right.predictedScore;
      }

      if (left.expectedScore !== right.expectedScore) {
        return left.expectedScore - right.expectedScore;
      }

      return CARD_ORDER.indexOf(left.card) - CARD_ORDER.indexOf(right.card);
    });

  return {
    card: ranked[0].card,
    reason:
      game.botStrategy === "adaptive"
        ? "Machine exchanged the card that looked weakest against the predicted human move."
        : "Machine exchanged the card with the lowest expected result against the human hand.",
  };
}

function refreshTieExchangeState(game) {
  for (const player of Object.values(game.players)) {
    if (game.status !== "playing" || player.hand.length === 0) {
      player.tieExchangeReady = false;
      continue;
    }

    const tieCondition = game.tieCount > 0 && game.tieCount === player.hand.length;
    player.tieExchangeReady = tieCondition;
  }
}

function finishGameIfNeeded(game) {
  if (game.players.A.hand.length === 0) {
    game.status = "finished";
    game.winner = "B";
  } else if (game.players.B.hand.length === 0) {
    game.status = "finished";
    game.winner = "A";
  }
}

function autoResolveBotTieExchange(game, roundSummary) {
  const bot = game.players.B;
  if (game.status !== "playing" || !bot.tieExchangeReady) {
    return;
  }

  const decision = chooseBotExchangeCard(game);
  removeCard(bot.hand, decision.card);
  game.pool.push(decision.card);
  const drawnCard = drawRandomCard(game.pool);
  bot.hand.push(drawnCard);
  bot.hand = sortCards(bot.hand);
  game.pool = sortCards(game.pool);
  bot.tieExchangeReady = false;

  roundSummary.specialActions.push({
    type: "bot-tie-exchange",
    playerId: "B",
    strategy: game.botStrategy,
    putIntoPool: decision.card,
    drew: drawnCard,
    reason: decision.reason,
  });
}

function autoResolveGameOpeningLossExchange(game, roundSummary) {
  const checkExchange = (seat) => {
    const player = game.players[seat];
    if (game.roundCount > 3 || player.consecutiveLosses < 2 || player.hand.length === 0) {
      return;
    }

    const card = sortCards(player.hand)[0];
    removeCard(player.hand, card);
    game.pool.push(card);
    const drawnCard = drawRandomCard(game.pool);
    player.hand.push(drawnCard);
    player.hand = sortCards(player.hand);
    game.pool = sortCards(game.pool);
    player.consecutiveLosses = 0;

    roundSummary.specialActions.push({
      type: "opening-loss-exchange",
      playerId: seat,
      putIntoPool: card,
      drew: drawnCard,
    });
  };

  checkExchange("A");
  checkExchange("B");
}


export async function getOwnedGame(gameId, userId) {
  const game = findGameById(gameId);
  if (!game) {
    throw new GameError(404, "Game not found.");
  }
  ensureGameShape(game);
  if (game.ownerId !== userId) {
    throw new GameError(403, "You do not have access to this game.");
  }
  return game;
}

export async function createGame(userId, payload) {
  const now = new Date().toISOString();
  const botStrategy =
    payload?.botStrategy == null || String(payload.botStrategy).trim() === ""
      ? DEFAULT_BOT_STRATEGY
      : normalizeBotStrategy(payload.botStrategy, null);
  const game = {
    type: "game",
    id: randomUUID(),
    ownerId: userId,
    name:
      String(payload?.name ?? "").trim().slice(0, 64) ||
      `Game ${new Date(now).toLocaleString("sv-SE").replace(" ", "T")}`,
    mode: "human-vs-bot",
    botStrategy,
    status: "playing",
    winner: null,
    roundCount: 0,
    tieCount: 0,
    pool: sortCards(INITIAL_POOL),
    createdAt: now,
    updatedAt: now,
    players: {
      A: createPlayer("human"),
      B: createPlayer("bot"),
    },
    history: [],
  };

  insertGame(game);
  logger.match(`[${game.name || game.id}] vs Bot(${botStrategy})`);
  return serializeGame(game);
}

export async function listGames(userId) {
  const games = listGamesByOwner(userId);
  return games.map((game) => {
    ensureGameShape(game);
    return game;
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(summarizeGame);
}

export async function getGameState(gameId, userId) {
  const game = await getOwnedGame(gameId, userId);
  return serializeGame(game);
}

export async function playRound(gameId, userId, payload) {
  const game = await getOwnedGame(gameId, userId);
  if (game.status !== "playing") {
    throw new GameError(400, "Game has already finished.");
  }

  const cardA = normalizeCard(payload?.cardA);
  const botDecision = chooseBotCard(game);
  const cardB = botDecision.card;
  const playerA = game.players.A;
  const playerB = game.players.B;

  removeCard(playerA.hand, cardA);
  removeCard(playerB.hand, cardB);

  const roundNumber = game.roundCount + 1;
  const winnerId = getWinner(cardA, cardB);
  const roundSummary = {
    type: "round",
    round: roundNumber,
    cards: { A: cardA, B: cardB },
    result: winnerId ?? "tie",
    botDecision: {
      strategy: game.botStrategy,
      reason: botDecision.reason,
    },
    poolAfterRound: [],
    handsAfterRound: { A: [], B: [] },
    specialActions: [],
  };

  if (!winnerId) {
    playerA.hand.push(cardA);
    playerB.hand.push(cardB);
    playerA.consecutiveLosses = 0;
    playerB.consecutiveLosses = 0;
    game.tieCount += 1;
  } else {
    const loserId = winnerId === "A" ? "B" : "A";
    const winnerCard = winnerId === "A" ? cardA : cardB;
    const loserCard = loserId === "A" ? cardA : cardB;
    const winner = game.players[winnerId];
    const loser = game.players[loserId];

    winner.hand.push(winnerCard);
    game.pool.push(loserCard);
    const drawnCard = drawRandomCard(game.pool);
    winner.hand.push(drawnCard);

    winner.consecutiveLosses = 0;
    loser.consecutiveLosses += 1;
    game.tieCount = 0;

    roundSummary.drew = {
      playerId: winnerId,
      card: drawnCard,
    };
  }

  playerA.hand = sortCards(playerA.hand);
  playerB.hand = sortCards(playerB.hand);
  game.pool = sortCards(game.pool);
  game.roundCount = roundNumber;

  autoResolveGameOpeningLossExchange(game, roundSummary);
  finishGameIfNeeded(game);
  refreshTieExchangeState(game);
  autoResolveBotTieExchange(game, roundSummary);
  finishGameIfNeeded(game);
  refreshTieExchangeState(game);

  roundSummary.poolAfterRound = [...game.pool];
  roundSummary.handsAfterRound = {
    A: [...game.players.A.hand],
    B: [...game.players.B.hand],
  };

  if (game.status === "finished") {
    roundSummary.gameOver = {
      loserId: game.winner === "A" ? "B" : "A",
      winnerId: game.winner,
    };
  }

  game.history.push(roundSummary);
  game.updatedAt = new Date().toISOString();

  const shortResult = winnerId ? `${winnerId} wins` : "Tie";
  logger.match(`[${game.name || game.id}] R${roundNumber}: ${cardA} vs ${cardB}. ${shortResult}`);
  if (game.status === "finished") {
    logger.match(`[${game.name || game.id}] End. Winner: ${game.winner}`);
  }

  updateGame(game);

  return {
    round: JSON.parse(JSON.stringify(roundSummary)),
    game: serializeGame(game),
  };
}

export async function exchangeOnTie(gameId, userId, payload) {
  const game = await getOwnedGame(gameId, userId);
  if (game.status !== "playing") {
    throw new GameError(400, "Game has already finished.");
  }

  const playerId = payload?.playerId ? normalizePlayerId(payload.playerId) : "A";
  if (playerId !== "A") {
    throw new GameError(
      400,
      "In human-vs-bot mode only player A can manually exchange."
    );
  }

  const card = normalizeCard(payload?.card);
  const player = game.players.A;

  if (!player.tieExchangeReady) {
    throw new GameError(400, "Tie exchange is not available for this player.");
  }

  removeCard(player.hand, card);
  game.pool.push(card);
  const drawnCard = drawRandomCard(game.pool);
  player.hand.push(drawnCard);
  player.hand = sortCards(player.hand);
  game.pool = sortCards(game.pool);
  player.tieExchangeReady = false;

  const exchangeSummary = {
    type: "tie-exchange",
    afterRound: game.roundCount,
    playerId,
    putIntoPool: card,
    drew: drawnCard,
    poolAfterExchange: [...game.pool],
    handAfterExchange: [...player.hand],
  };

  game.history.push(exchangeSummary);
  game.updatedAt = new Date().toISOString();

  updateGame(game);

  return {
    exchange: JSON.parse(JSON.stringify(exchangeSummary)),
    game: serializeGame(game),
  };
}

export async function exportGame(gameId, userId) {
  const game = await getOwnedGame(gameId, userId);
  return serializeGame(game);
}

export async function exportAllGames(userId) {
  const games = listGamesByOwner(userId);
  return games.map((game) => {
    ensureGameShape(game);
    return game;
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(serializeGame);
}


import {
  findRoomById,
  findRoomByInviteCode,
  insertRoom,
  listRoomsByUser,
  updateRoom,
  deleteRoom as deleteRoomFromStore,
} from "./db.js";


export class RoomError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "RoomError";
    this.status = status;
  }
}


function normalizeInviteCode(inviteCode) {
  const normalized = String(inviteCode ?? "").trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new RoomError(400, "Invite code must be a 6-digit string.");
  }
  return normalized;
}





function createSeatState(userId = null, username = "") {
  return {
    userId,
    username,
    role: "human",
    hand: sortCards(INITIAL_HAND),
    consecutiveLosses: 0,
    tieExchangeReady: false,
  };
}

function resetSeatState(player) {
  player.role = "human";
  player.hand = sortCards(INITIAL_HAND);
  player.consecutiveLosses = 0;
  player.tieExchangeReady = false;
}

function ensureSeatState(player) {
  player.userId = player.userId ?? null;
  player.username = String(player.username ?? "");
  player.role = "human";
  player.hand = sortCards(Array.isArray(player.hand) ? player.hand : INITIAL_HAND);
  player.consecutiveLosses = Number(player.consecutiveLosses ?? 0);
  player.tieExchangeReady = Boolean(player.tieExchangeReady);
}

function ensureRoomShape(room) {
  room.mode = "human-vs-human";
  room.name = String(room.name ?? "").trim() || `Room ${room.id}`;
  room.status = room.status ?? "waiting";
  room.isPublic = room.isPublic ?? true;
  room.hostUserId = room.hostUserId ?? room.players?.A?.userId ?? null;
  room.guestUserId = room.guestUserId ?? room.players?.B?.userId ?? null;
  room.inviteCode = room.inviteCode ?? null;
  room.matchNumber = Number(room.matchNumber ?? 1);
  room.winner = room.winner ?? null;
  room.roundCount = Number(room.roundCount ?? 0);
  room.tieCount = Number(room.tieCount ?? 0);
  room.pool = sortCards(Array.isArray(room.pool) ? room.pool : INITIAL_POOL);
  room.history = Array.isArray(room.history) ? room.history : [];
  room.createdAt = room.createdAt ?? new Date().toISOString();
  room.updatedAt = room.updatedAt ?? room.createdAt;
  room.startVotes = {
    A: Boolean(room.startVotes?.A),
    B: Boolean(room.startVotes?.B),
  };
  room.rematchVotes = {
    A: Boolean(room.rematchVotes?.A),
    B: Boolean(room.rematchVotes?.B),
  };
  room.pendingMoves = {
    A: room.pendingMoves?.A == null ? null : Number(room.pendingMoves.A),
    B: room.pendingMoves?.B == null ? null : Number(room.pendingMoves.B),
  };
  room.players = room.players ?? {
    A: createSeatState(),
    B: createSeatState(),
  };
  room.players.A = room.players.A ?? createSeatState();
  room.players.B = room.players.B ?? createSeatState();
  ensureSeatState(room.players.A);
  ensureSeatState(room.players.B);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getSeatForUser(room, userId) {
  if (room.players.A.userId === userId) return "A";
  if (room.players.B.userId === userId) return "B";
  return null;
}

function getOpponentSeat(seat) {
  if (!seat) return null;
  return seat === "A" ? "B" : "A";
}

function refreshTieExchangeState(room) {
  for (const player of Object.values(room.players)) {
    if (room.status !== "playing" || !player.userId || player.hand.length === 0) {
      player.tieExchangeReady = false;
      continue;
    }

    player.tieExchangeReady = room.tieCount > 0 && room.tieCount === player.hand.length;
  }
}

function autoResolveRoomOpeningLossExchange(room, seat, specialActions) {
  const player = room.players[seat];
  if (room.roundCount > 3 || player.consecutiveLosses < 2 || player.hand.length === 0) {
    return;
  }

  const card = sortCards(player.hand)[0];
  removeCard(player.hand, card);
  room.pool.push(card);
  const drawnCard = drawRandomCard(room.pool);
  player.hand.push(drawnCard);
  player.hand = sortCards(player.hand);
  room.pool = sortCards(room.pool);
  player.consecutiveLosses = 0;

  specialActions.push({
    type: "opening-loss-exchange",
    playerId: seat,
    putIntoPool: card,
    drew: drawnCard,
  });
}

function finishRoomIfNeeded(room) {
  if (room.players.A.hand.length === 0) {
    room.status = "finished";
    room.winner = "B";
  } else if (room.players.B.hand.length === 0) {
    room.status = "finished";
    room.winner = "A";
  }
}

function resetRoomMatch(room) {
  room.status = "playing";
  room.winner = null;
  room.roundCount = 0;
  room.tieCount = 0;
  room.pool = sortCards(INITIAL_POOL);
  room.history = [];
  room.pendingMoves = { A: null, B: null };
  room.startVotes = { A: false, B: false };
  room.rematchVotes = { A: false, B: false };
  resetSeatState(room.players.A);
  resetSeatState(room.players.B);
}

function createInviteCode() {
  const min = 0;
  const max = 1000000;
  const randomInt = Math.floor(Math.random() * (max - min)) + min;
  return randomInt.toString().padStart(6, "0");
}

function createUniqueInviteCode(roomIdToIgnore = null) {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const inviteCode = createInviteCode();
    const existing = findRoomByInviteCode(inviteCode);
    if (!existing || existing.id === roomIdToIgnore) {
      return inviteCode;
    }
  }

  throw new RoomError(500, "Failed to allocate invite code.");
}

function serializePlayerForViewer(player, revealHand) {
  return {
    userId: player.userId,
    username: player.username,
    role: player.role,
    hand: revealHand ? [...player.hand] : [],
    handCount: player.hand.length,
    consecutiveLosses: player.consecutiveLosses,
    canExchangeOnTie: player.tieExchangeReady,
  };
}

function sanitizeHistoryEntryForViewer(entry, selfPlayerId) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }

  if (entry.type === "round") {
    return {
      ...entry,
      handsAfterRound: selfPlayerId ? {
        [selfPlayerId]: [...(entry.handsAfterRound?.[selfPlayerId] ?? [])],
      } : {},
      opponentHandCountAfterRound:
        entry.handsAfterRound?.[getOpponentSeat(selfPlayerId) || "A"]?.length ?? 0, // Fallback A for spectator
    };
  }

  if (entry.type === "tie-exchange") {
    if (entry.playerId !== selfPlayerId) {
      return {
        type: entry.type,
        afterRound: entry.afterRound,
        playerId: entry.playerId,
        poolAfterExchange: [...(entry.poolAfterExchange ?? [])],
        opponentHandCountAfterExchange:
          entry.handAfterExchange?.length ?? 0,
      };
    }

    return {
      ...entry,
      handAfterExchange: [...(entry.handAfterExchange ?? [])],
    };
  }

  return clone(entry);
}

function serializeRoom(room, userId) {
  ensureRoomShape(room);
  const selfPlayerId = getSeatForUser(room, userId);
  const opponentPlayerId = getOpponentSeat(selfPlayerId);

  return {
    id: room.id,
    name: room.name,
    mode: room.mode,
    status: room.status,
    isPublic: room.isPublic,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    inviteCode:
      selfPlayerId === "A" && room.status === "waiting" && !room.players.B.userId
        ? room.inviteCode
        : null,
    canRefreshInviteCode:
      selfPlayerId === "A" && room.status === "waiting" && !room.players.B.userId,
    matchNumber: room.matchNumber,
    winner: room.winner,
    roundCount: room.roundCount,
    tieCount: room.tieCount,
    pool: [...room.pool],
    selfPlayerId,
    opponentPlayerId,
    startVotes: { ...room.startVotes },
    rematchVotes: { ...room.rematchVotes },
    pendingMoves: {
      A: room.pendingMoves.A != null,
      B: room.pendingMoves.B != null,
    },
    players: {
      A: serializePlayerForViewer(room.players.A, selfPlayerId === "A"),
      B: serializePlayerForViewer(room.players.B, selfPlayerId === "B"),
    },
    history: room.history.map((entry) =>
      sanitizeHistoryEntryForViewer(entry, selfPlayerId)
    ),
  };
}

function summarizeRoom(room, userId) {
  ensureRoomShape(room);
  return {
    id: room.id,
    name: room.name,
    mode: room.mode,
    status: room.status,
    isPublic: room.isPublic,
    matchNumber: room.matchNumber,
    roundCount: room.roundCount,
    tieCount: room.tieCount,
    winner: room.winner,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    selfPlayerId: getSeatForUser(room, userId),
    opponentPlayerId: getOpponentSeat(getSeatForUser(room, userId)),
    players: {
      A: {
        userId: room.players.A.userId,
        username: room.players.A.username,
      },
      B: {
        userId: room.players.B.userId,
        username: room.players.B.username,
      },
    },
  };
}

function getOwnedRoom(roomId, userId) {
  const room = findRoomById(roomId);
  if (!room) {
    throw new RoomError(404, "Room not found.");
  }

  ensureRoomShape(room);
  const seat = getSeatForUser(room, userId);
  if (!seat) {
    throw new RoomError(403, "You do not have access to this room.");
  }
  return room;
}

function resolvePendingRound(room) {
  const cardA = room.pendingMoves.A;
  const cardB = room.pendingMoves.B;
  if (cardA == null || cardB == null) {
    return null;
  }

  room.pendingMoves = { A: null, B: null };

  const playerA = room.players.A;
  const playerB = room.players.B;
  removeCard(playerA.hand, cardA);
  removeCard(playerB.hand, cardB);

  const roundNumber = room.roundCount + 1;
  const winnerId = getWinner(cardA, cardB);
  const roundSummary = {
    type: "round",
    round: roundNumber,
    cards: { A: cardA, B: cardB },
    result: winnerId ?? "tie",
    poolAfterRound: [],
    handsAfterRound: { A: [], B: [] },
    specialActions: [],
  };

  if (!winnerId) {
    playerA.hand.push(cardA);
    playerB.hand.push(cardB);
    playerA.consecutiveLosses = 0;
    playerB.consecutiveLosses = 0;
    room.tieCount += 1;
  } else {
    const loserId = winnerId === "A" ? "B" : "A";
    const winnerCard = winnerId === "A" ? cardA : cardB;
    const loserCard = loserId === "A" ? cardA : cardB;
    const winner = room.players[winnerId];
    const loser = room.players[loserId];

    winner.hand.push(winnerCard);
    room.pool.push(loserCard);
    const drawnCard = drawRandomCard(room.pool);
    winner.hand.push(drawnCard);
    winner.consecutiveLosses = 0;
    loser.consecutiveLosses += 1;
    room.tieCount = 0;

    roundSummary.drew = {
      playerId: winnerId,
      card: drawnCard,
    };
  }

  playerA.hand = sortCards(playerA.hand);
  playerB.hand = sortCards(playerB.hand);
  room.pool = sortCards(room.pool);
  room.roundCount = roundNumber;

  autoResolveRoomOpeningLossExchange(room, "A", roundSummary.specialActions);
  autoResolveRoomOpeningLossExchange(room, "B", roundSummary.specialActions);
  finishRoomIfNeeded(room);
  refreshTieExchangeState(room);

  roundSummary.poolAfterRound = [...room.pool];
  roundSummary.handsAfterRound = {
    A: [...room.players.A.hand],
    B: [...room.players.B.hand],
  };

  if (room.status === "finished") {
    roundSummary.gameOver = {
      loserId: room.winner === "A" ? "B" : "A",
      winnerId: room.winner,
    };
  }

  room.history.push(roundSummary);
  room.updatedAt = new Date().toISOString();
  logger.match(
    `[${room.name || room.id}] PVP R${roundNumber}: ${cardA} vs ${cardB}. ${winnerId ?? "tie"}`
  );
  if (room.status === "finished") {
    logger.match(`[${room.name || room.id}] PVP End. Winner: ${room.winner}`);
  }
  return roundSummary;
}

export async function createRoom(user, payload) {
  const now = new Date().toISOString();
  const room = {
    id: randomUUID(),
    hostUserId: user.id,
    guestUserId: null,
    name:
      String(payload?.name ?? "").trim().slice(0, 64) ||
      `Room ${new Date(now).toLocaleString("sv-SE").replace(" ", "T")}`,
    mode: "human-vs-human",
    status: "waiting",
    isPublic: payload?.isPublic !== false, // default true
    inviteCode: createUniqueInviteCode(),
    createdAt: now,
    updatedAt: now,
    matchNumber: 1,
    winner: null,
    roundCount: 0,
    tieCount: 0,
    pool: sortCards(INITIAL_POOL),
    startVotes: { A: false, B: false },
    rematchVotes: { A: false, B: false },
    pendingMoves: { A: null, B: null },
    players: {
      A: createSeatState(user.id, user.username),
      B: createSeatState(),
    },
    history: [],
  };

  insertRoom(room);
  logger.match(`[${room.name || room.id}] room created by ${user.username}`);
  return serializeRoom(room, user.id);
}

export async function listRooms(userId) {
  return listRoomsByUser(userId).map((room) => summarizeRoom(room, userId));
}

export async function getRoomState(roomId, userId) {
  return serializeRoom(getOwnedRoom(roomId, userId), userId);
}

export async function refreshRoomInviteCode(roomId, userId) {
  const room = getOwnedRoom(roomId, userId);
  if (room.players.A.userId !== userId) {
    throw new RoomError(403, "Only the room host can refresh the invite code.");
  }
  if (room.status !== "waiting") {
    throw new RoomError(400, "Invite code can only be refreshed while waiting.");
  }
  if (room.players.B.userId) {
    throw new RoomError(400, "Invite code can no longer be refreshed after someone joins.");
  }

  room.inviteCode = createUniqueInviteCode(room.id);
  room.updatedAt = new Date().toISOString();
  updateRoom(room);
  return serializeRoom(room, userId);
}

export async function joinRoomByCode(user, payload) {
  const inviteCode = normalizeInviteCode(payload?.inviteCode);
  const room = findRoomByInviteCode(inviteCode);
  if (!room) {
    throw new RoomError(404, "Invite code not found.");
  }

  ensureRoomShape(room);
  if (room.status !== "waiting") {
    throw new RoomError(400, "This room is no longer joinable.");
  }
  if (room.players.A.userId === user.id) {
    throw new RoomError(400, "You are already the host of this room.");
  }
  if (room.players.B.userId && room.players.B.userId !== user.id) {
    throw new RoomError(400, "This room is already full.");
  }

  room.guestUserId = user.id;
  room.inviteCode = null;
  room.players.B.userId = user.id;
  room.players.B.username = user.username;
  room.updatedAt = new Date().toISOString();
  updateRoom(room);
  logger.match(`[${room.name || room.id}] ${user.username} joined room`);
  return serializeRoom(room, user.id);
}

export async function setRoomReady(roomId, userId, payload) {
  const room = getOwnedRoom(roomId, userId);
  if (room.status !== "waiting") {
    throw new RoomError(400, "This room has already started.");
  }

  const seat = getSeatForUser(room, userId);
  const ready = payload?.ready ?? !room.startVotes[seat];
  room.startVotes[seat] = Boolean(ready);

  if (room.players.A.userId && room.players.B.userId && room.startVotes.A && room.startVotes.B) {
    resetRoomMatch(room);
    logger.match(`[${room.name || room.id}] PVP start: ${room.players.A.username} vs ${room.players.B.username}`);
  }

  room.updatedAt = new Date().toISOString();
  updateRoom(room);
  return serializeRoom(room, userId);
}

export async function submitRoomMove(roomId, userId, payload) {
  const room = getOwnedRoom(roomId, userId);
  if (room.status !== "playing") {
    throw new RoomError(400, "The room is not currently playing.");
  }

  const seat = getSeatForUser(room, userId);
  if (room.pendingMoves[seat] != null) {
    throw new RoomError(400, "You have already locked in a card for this round.");
  }

  const card = normalizeCard(payload?.card);
  if (!room.players[seat].hand.includes(card)) {
    throw new RoomError(400, `Card ${card} is not in hand.`);
  }

  room.pendingMoves[seat] = card;
  resolvePendingRound(room);
  room.updatedAt = new Date().toISOString();
  updateRoom(room);
  return serializeRoom(room, userId);
}

export async function exchangeRoomOnTie(roomId, userId, payload) {
  const room = getOwnedRoom(roomId, userId);
  if (room.status !== "playing") {
    throw new RoomError(400, "The room is not currently playing.");
  }

  const seat = getSeatForUser(room, userId);
  if (room.pendingMoves[seat] != null) {
    throw new RoomError(400, "You cannot exchange after locking in your move.");
  }

  const player = room.players[seat];
  if (!player.tieExchangeReady) {
    throw new RoomError(400, "Tie exchange is not available for this player.");
  }

  const card = normalizeCard(payload?.card);
  removeCard(player.hand, card);
  room.pool.push(card);
  const drawnCard = drawRandomCard(room.pool);
  player.hand.push(drawnCard);
  player.hand = sortCards(player.hand);
  room.pool = sortCards(room.pool);
  refreshTieExchangeState(room);

  room.history.push({
    type: "tie-exchange",
    afterRound: room.roundCount,
    playerId: seat,
    putIntoPool: card,
    drew: drawnCard,
    poolAfterExchange: [...room.pool],
    handAfterExchange: [...player.hand],
  });

  room.updatedAt = new Date().toISOString();
  updateRoom(room);
  return serializeRoom(room, userId);
}

export async function requestRoomRematch(roomId, userId, payload) {
  const room = getOwnedRoom(roomId, userId);
  if (room.status !== "finished") {
    throw new RoomError(400, "Rematch is only available after the match finishes.");
  }

  const seat = getSeatForUser(room, userId);
  const ready = payload?.ready ?? !room.rematchVotes[seat];
  room.rematchVotes[seat] = Boolean(ready);

  if (room.rematchVotes.A && room.rematchVotes.B) {
    room.matchNumber += 1;
    resetRoomMatch(room);
    logger.match(`[${room.name || room.id}] PVP rematch #${room.matchNumber} started`);
  }

  room.updatedAt = new Date().toISOString();
  updateRoom(room);
  return serializeRoom(room, userId);
}

export async function renameRoom(roomId, userId, payload) {
  const room = getOwnedRoom(roomId, userId);
  if (room.players.A.userId !== userId) {
    throw new RoomError(403, "Only the room host can rename the room.");
  }

  const name = String(payload?.name ?? "").trim().slice(0, 64);
  if (!name) {
    throw new RoomError(400, "Room name cannot be empty.");
  }

  room.name = name;
  room.updatedAt = new Date().toISOString();
  updateRoom(room);
  logger.match(`[${room.id}] room renamed to ${name} by ${userId}`);
  return serializeRoom(room, userId);
}

export async function deleteRoom(roomId, userId) {
  const room = getOwnedRoom(roomId, userId);
  if (room.players.A.userId !== userId) {
    throw new RoomError(403, "Only the room host can delete the room.");
  }

  deleteRoomFromStore(roomId);
  logger.match(`[${room.name || room.id}] room deleted by ${userId}`);
  return { deleted: true };
}
