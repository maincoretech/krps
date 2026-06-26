// ═══ KRPS Shared: Game Logic (pure functions) ═══
// No side effects — usable in both server and browser.
import { R, P, S, CARDS, HAND, POOL, has, add, rem, cnt, cnts, unpack, first, draw, infer, winOf } from "./cards.js";
import { botPick, botExchangePick } from "./ai.js";

/** Create initial game state */
export const createState = () => ({
  pool: POOL,
  roundCount: 0,
  tieCount: 0,
  status: "playing",
  winner: null,
  history: [],
  players: {
    A: { hand: HAND, losses: 0, tieEx: 0 },
    B: { hand: HAND, losses: 0, tieEx: 0 },
  },
});

/** Recalculate tie-exchange eligibility */
const refreshTieEx = (state) => {
  if (state.status !== "playing") { state.players.A.tieEx = 0; state.players.B.tieEx = 0; return; }
  const t = state.tieCount;
  state.players.A.tieEx = (t > 0 && t === cnt(state.players.A.hand)) ? 1 : 0;
  state.players.B.tieEx = (t > 0 && t === cnt(state.players.B.hand)) ? 1 : 0;
};

const finishCheck = (state) => {
  if (cnt(state.players.A.hand) === 0) { state.status = "finished"; state.winner = "B"; }
  else if (cnt(state.players.B.hand) === 0) { state.status = "finished"; state.winner = "A"; }
};

const openingLossExchange = (state, seat, actions) => {
  const p = state.players[seat];
  // Only trigger after exactly round 2 with 2 consecutive losses (lost both round 1 & 2)
  if (state.roundCount !== 2 || p.losses < 2 || cnt(p.hand) === 0) return;
  const c = first(p.hand);
  p.hand = rem(p.hand, c);
  state.pool = add(state.pool, c);
  const d = draw(state.pool);
  p.hand = add(p.hand, d.card);
  state.pool = d.np;
  p.losses = 0;
  actions.push({ type: "opening-loss-exchange", playerId: seat, putIntoPool: c, drew: d.card });
};

/**
 * Resolve one round.
 * @param {object} state - game state (mutated in-place)
 * @param {number} cardA - player A's card
 * @param {number} cardB - player B's card (bot)
 * @param {string} botStrategy - only used for history annotation
 * @returns {object} round result + updated state summary
 */
export const resolveRound = (state, cardA, cardB, botStrategy = null) => {
  // Safety: ensure cards are valid 0/1/2
  if (!CARDS.includes(cardA)) cardA = first(state.players.A.hand);
  if (!CARDS.includes(cardB)) cardB = first(state.players.B.hand);
  const isBot = botStrategy !== null;
  const pa = state.players.A, pb = state.players.B;
  pa.hand = rem(pa.hand, cardA);
  pb.hand = rem(pb.hand, cardB);

  const rn = state.roundCount + 1, w = winOf(cardA, cardB);
  const actions = [];

  if (w === 0) {
    pa.hand = add(pa.hand, cardA);
    pb.hand = add(pb.hand, cardB);
    pa.losses = 0; pb.losses = 0;
    state.tieCount++;
  } else {
    const [wid, lid] = w === 1 ? ["A", "B"] : ["B", "A"];
    const winner = state.players[wid], loser = state.players[lid];
    const wc = w === 1 ? cardA : cardB, lc = w === 1 ? cardB : cardA;
    winner.hand = add(winner.hand, wc);
    const d = draw(state.pool);
    state.pool = add(d.np, lc);
    winner.hand = add(winner.hand, d.card);
    winner.losses = 0;
    loser.losses++;
    state.tieCount = 0;
  }

  state.roundCount = rn;
  openingLossExchange(state, "A", actions);
  openingLossExchange(state, "B", actions);
  finishCheck(state);

  // Bot auto tie-exchange (bot mode only)
  if (isBot && state.status === "playing") {
    refreshTieEx(state);
    const aHad = pa.tieEx;
    if (pb.tieEx) {
      const c = botExchangePick(pb.hand);
      pb.hand = rem(pb.hand, c);
      state.pool = add(state.pool, c);
      const d = draw(state.pool);
      pb.hand = add(pb.hand, d.card);
      state.pool = d.np;
      pb.tieEx = 0;
      state.tieCount = 0;
      actions.push({ type: "bot-tie-exchange", playerId: "B", putIntoPool: c, drew: d.card });
    }
    refreshTieEx(state);
    if (aHad && state.status === "playing") pa.tieEx = 1;
  } else {
    refreshTieEx(state);
  }

  finishCheck(state);

  const entry = {
    type: "round", round: rn, cards: { A: cardA, B: cardB },
    result: w === 0 ? "tie" : w === 1 ? "win" : "lose",
    specialActions: actions,
  };
  state.history.push(entry);

  return {
    round: entry,
    state: {
      pool: unpack(state.pool),
      roundCount: state.roundCount,
      tieCount: state.tieCount,
      status: state.status,
      winner: state.winner,
      players: {
        A: { hand: unpack(pa.hand), losses: pa.losses, canExchangeOnTie: !!pa.tieEx },
        B: { hand: unpack(pb.hand), losses: pb.losses, canExchangeOnTie: !!pb.tieEx },
      },
      history: [...state.history],
    },
  };
};

/**
 * Human plays a card against the bot.
 * Returns full result for the frontend to consume.
 */
export const playRound = (state, humanCard, botStrategy = "random") => {
  if (state.status !== "playing") throw new Error("Game not playing");
  const botCard = botPick(state.players.B.hand, state.pool, state.history, botStrategy);
  return resolveRound(state, humanCard, botCard, botStrategy);
};

/**
 * Human requests tie-exchange.
 */
export const doExchange = (state) => {
  if (state.status !== "playing" || !state.players.A.tieEx) return null;
  const c = first(state.players.A.hand);
  state.players.A.hand = rem(state.players.A.hand, c);
  state.pool = add(state.pool, c);
  const d = draw(state.pool);
  state.players.A.hand = add(state.players.A.hand, d.card);
  state.pool = d.np;
  state.players.A.tieEx = 0;
  state.tieCount = 0;
  return { type: "tie-exchange", playerId: "A", putIntoPool: c, drew: d.card };
};
