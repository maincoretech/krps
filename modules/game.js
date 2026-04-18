import logger from "../utils/logger.js";
import { randomUUID } from "node:crypto";
import { updateStore } from "./store.js";

const CARD_ORDER = ["scissors", "rock", "paper"];
const CARD_BEATS = {
  scissors: "paper",
  rock: "scissors",
  paper: "rock",
};
const COUNTER_CARD = {
  scissors: "rock",
  rock: "paper",
  paper: "scissors",
};

const INITIAL_HAND = ["scissors", "rock", "paper"];
const INITIAL_POOL = ["scissors", "scissors", "rock", "paper"];
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
    description: "Rotate through scissors, rock, paper in a fixed order.",
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
  if (typeof card !== "string") {
    throw new GameError(400, "Card must be a string.");
  }

  const normalized = card.trim().toLowerCase();
  if (!CARD_ORDER.includes(normalized)) {
    throw new GameError(400, "Card must be one of: scissors, rock, paper.");
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
  if (cardA === cardB) {
    return null;
  }

  return CARD_BEATS[cardA] === cardB ? "A" : "B";
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
  const allCards = ["scissors", "scissors", "scissors", "scissors", "rock", "rock", "rock", "paper", "paper", "paper"];
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
    const lossCondition = game.roundCount <= 3 && player.consecutiveLosses === 2;
    player.tieExchangeReady = tieCondition || lossCondition;
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

function getOwnedGame(store, gameId, userId) {
  const game = store.games.find((entry) => entry.id === gameId);
  if (!game) {
    throw new GameError(404, "Game not found.");
  }

  ensureGameShape(game);

  if (game.ownerId !== userId) {
    throw new GameError(403, "You do not have access to this game.");
  }

  return game;
}

export function createGame(userId, payload) {
  return updateStore((store) => {
    const now = new Date().toISOString();
    const botStrategy =
      payload?.botStrategy == null || String(payload.botStrategy).trim() === ""
        ? DEFAULT_BOT_STRATEGY
        : normalizeBotStrategy(payload.botStrategy, null);
    const game = {
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

    store.games.push(game);
    logger.match(`[${game.name || game.id}] vs Bot(${botStrategy})`);
    return serializeGame(game);
  });
}

export function listGames(userId) {
  return updateStore((store) =>
    store.games
      .filter((game) => game.ownerId === userId)
      .map((game) => {
        ensureGameShape(game);
        return game;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(summarizeGame)
  );
}

export function getGameState(gameId, userId) {
  return updateStore((store) => serializeGame(getOwnedGame(store, gameId, userId)));
}

export function playRound(gameId, userId, payload) {
  return updateStore((store) => {
    const game = getOwnedGame(store, gameId, userId);
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

      roundSummary.drew = {
        playerId: winnerId,
        card: drawnCard,
      };
    }

    playerA.hand = sortCards(playerA.hand);
    playerB.hand = sortCards(playerB.hand);
    game.pool = sortCards(game.pool);
    game.roundCount = roundNumber;

    finishGameIfNeeded(game);
    refreshTieExchangeState(game);
    autoResolveBotTieExchange(game, roundSummary);

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

    return {
      round: JSON.parse(JSON.stringify(roundSummary)),
      game: serializeGame(game),
    };
  });
}

export function exchangeOnTie(gameId, userId, payload) {
  return updateStore((store) => {
    const game = getOwnedGame(store, gameId, userId);
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

    return {
      exchange: JSON.parse(JSON.stringify(exchangeSummary)),
      game: serializeGame(game),
    };
  });
}

export function exportGame(gameId, userId) {
  return updateStore((store) => serializeGame(getOwnedGame(store, gameId, userId)));
}

export function exportAllGames(userId) {
  return updateStore((store) =>
    store.games
      .filter((game) => game.ownerId === userId)
      .map((game) => {
        ensureGameShape(game);
        return game;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(serializeGame)
  );
}
