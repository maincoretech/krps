import { randomUUID } from "node:crypto";
import { updateStore } from "./store.js";

const CARD_ORDER = ["scissors", "rock", "paper"];
const CARD_BEATS = {
  scissors: "paper",
  rock: "scissors",
  paper: "rock",
};

const INITIAL_HAND = ["scissors", "rock", "paper"];
const INITIAL_POOL = ["scissors", "scissors", "rock", "paper"];

export class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "GameError";
    this.status = status;
  }
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

function createPlayer() {
  return {
    hand: sortCards(INITIAL_HAND),
    consecutiveLosses: 0,
    tieExchangeReady: false,
  };
}

function clonePlayer(player) {
  return {
    hand: [...player.hand],
    consecutiveLosses: player.consecutiveLosses,
    canExchangeOnTie: player.tieExchangeReady,
  };
}

function serializeGame(game) {
  return {
    id: game.id,
    name: game.name,
    ownerId: game.ownerId,
    status: game.status,
    winner: game.winner,
    roundCount: game.roundCount,
    tieCount: game.tieCount,
    pool: sortCards(game.pool),
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    players: {
      A: clonePlayer(game.players.A),
      B: clonePlayer(game.players.B),
    },
    history: game.history.map((entry) => JSON.parse(JSON.stringify(entry))),
  };
}

function summarizeGame(game) {
  return {
    id: game.id,
    name: game.name,
    status: game.status,
    winner: game.winner,
    roundCount: game.roundCount,
    tieCount: game.tieCount,
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

function refreshTieExchangeState(game) {
  for (const player of Object.values(game.players)) {
    player.tieExchangeReady =
      game.status === "playing" &&
      game.tieCount === player.hand.length &&
      player.hand.length > 0;
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

function applyOpeningLossExchange(game, loserId, roundSummary) {
  if (game.roundCount > 3) {
    return;
  }

  const loser = game.players[loserId];
  if (loser.consecutiveLosses !== 2 || loser.hand.length === 0) {
    return;
  }

  const cardToPool = loser.hand.shift();
  game.pool.push(cardToPool);
  const drawnCard = drawRandomCard(game.pool);
  loser.hand.push(drawnCard);
  loser.hand = sortCards(loser.hand);
  game.pool = sortCards(game.pool);

  roundSummary.specialActions.push({
    type: "opening-loss-exchange",
    playerId: loserId,
    putIntoPool: cardToPool,
    drew: drawnCard,
  });
}

function getOwnedGame(store, gameId, userId) {
  const game = store.games.find((entry) => entry.id === gameId);
  if (!game) {
    throw new GameError(404, "Game not found.");
  }

  if (game.ownerId !== userId) {
    throw new GameError(403, "You do not have access to this game.");
  }

  return game;
}

export function createGame(userId, payload) {
  return updateStore((store) => {
    const now = new Date().toISOString();
    const game = {
      id: randomUUID(),
      ownerId: userId,
      name:
        String(payload?.name ?? "").trim().slice(0, 64) ||
        `Game ${new Date(now).toLocaleString("sv-SE").replace(" ", "T")}`,
      status: "playing",
      winner: null,
      roundCount: 0,
      tieCount: 0,
      pool: sortCards(INITIAL_POOL),
      createdAt: now,
      updatedAt: now,
      players: {
        A: createPlayer(),
        B: createPlayer(),
      },
      history: [],
    };

    store.games.push(game);
    return serializeGame(game);
  });
}

export function listGames(userId) {
  return updateStore((store) =>
    store.games
      .filter((game) => game.ownerId === userId)
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
    const cardB = normalizeCard(payload?.cardB);
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

    if (winnerId) {
      const loserId = winnerId === "A" ? "B" : "A";
      applyOpeningLossExchange(game, loserId, roundSummary);
    }

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

    const playerId = normalizePlayerId(payload?.playerId);
    const card = normalizeCard(payload?.card);
    const player = game.players[playerId];

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
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(serializeGame)
  );
}
